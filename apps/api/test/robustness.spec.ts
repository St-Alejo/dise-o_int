/**
 * Pruebas de los arreglos de robustez (Fase 0): cuota y previews ante fallos, bloqueo
 * optimista en todas las escrituras, operaciones atómicas y barrido de huérfanos.
 * Cada caso reproduce un fallo real que antes dejaba el sistema en un estado inválido.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createRectangularShell } from '@interiores/shared-types';
import { AiServiceError, DependencyError, QuotaExceededError, StaleRevisionError } from '../src/common/errors.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { PipelineService, type JobContext } from '../src/modules/jobs/pipeline.service.js';
import { RetentionService } from '../src/modules/jobs/retention.service.js';
import { ProjectsService, STALE_PENDING_MS } from '../src/modules/projects/projects.service.js';
import {
  FakeAi,
  FakeBroker,
  FakeQueue,
  FakeQuota,
  InMemoryCatalogRepository,
  InMemoryProjectRepository,
  testConfig,
} from './fakes.js';

class FailingQueue extends FakeQueue {
  fail = false;
  override async enqueue(...args: Parameters<FakeQueue['enqueue']>) {
    if (this.fail) throw new DependencyError('Redis caído');
    return super.enqueue(...args);
  }
}

const photo = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#b0a090' } }).jpeg().toBuffer();
const alice = { userId: 'alice' };

describe('Robustez — ProjectsService', () => {
  let repo: InMemoryProjectRepository;
  let storage: MemoryFileStorage;
  let queue: FailingQueue;
  let quota: FakeQuota;
  let service: ProjectsService;

  beforeEach(() => {
    repo = new InMemoryProjectRepository();
    storage = new MemoryFileStorage();
    queue = new FailingQueue();
    quota = new FakeQuota(10);
    service = new ProjectsService(
      repo,
      new InMemoryCatalogRepository(),
      storage,
      queue,
      new FakeBroker(),
      quota,
      testConfig,
      new PhotoProcessor(),
      new MediaUrlSigner(testConfig),
    );
  });

  async function project() {
    const p = await service.create(alice, { styles: 'moderno' }, await photo());
    await repo.update(p.id, { roomShell: createRectangularShell(4, 3.5, 2.6), status: 'ready' }, { bumpRevision: true });
    // El reloj del servicio va junto al del repositorio en memoria (fechas fijas de 2026-01-01).
    service.clock = () => Date.UTC(2026, 0, 1, 0, 1);
    return service.get(alice, p.id);
  }

  describe('generateStyles', () => {
    it('si la cuota se agota no deja previews "pending" que bloqueen ese estilo para siempre', async () => {
      const p = await project();
      quota.used.set('alice', 10);
      await expect(service.generateStyles(alice, p.id, { styles: ['industrial'], promptStrength: 0.6 })).rejects.toBeInstanceOf(
        QuotaExceededError,
      );
      expect(repo.previews.filter((x) => x.status === 'pending' && x.styleId === 'industrial')).toHaveLength(0);

      quota.used.set('alice', 0);
      const job = await service.generateStyles(alice, p.id, { styles: ['industrial'], promptStrength: 0.6 });
      expect(job.jobId).not.toBe('cached');
    });

    it('si no se puede encolar, marca las previews como fallidas y devuelve la cuota', async () => {
      const p = await project();
      const before = quota.used.get('alice') ?? 0;
      queue.fail = true;
      await expect(
        service.generateStyles(alice, p.id, { styles: ['industrial', 'bohemio'], promptStrength: 0.6 }),
      ).rejects.toBeInstanceOf(DependencyError);
      expect(quota.used.get('alice')).toBe(before);
      const created = repo.previews.filter((x) => x.styleId === 'industrial' || x.styleId === 'bohemio');
      expect(created.map((x) => x.status)).toEqual(['failed', 'failed']);

      queue.fail = false;
      const job = await service.generateStyles(alice, p.id, { styles: ['industrial'], promptStrength: 0.6 });
      expect(job.jobId).toMatch(/^styles\./);
    });

    it('una preview "pending" colgada más allá del umbral se vuelve a pedir', async () => {
      const p = await project();
      await service.generateStyles(alice, p.id, { styles: ['industrial'], promptStrength: 0.6 });
      const again = await service.generateStyles(alice, p.id, { styles: ['industrial'], promptStrength: 0.6 });
      expect(again.jobId).toBe('cached'); // todavía en curso

      service.clock = () => Date.UTC(2026, 0, 1) + STALE_PENDING_MS * 2;
      const retried = await service.generateStyles(alice, p.id, { styles: ['industrial'], promptStrength: 0.6 });
      expect(retried.jobId).toMatch(/^styles\./);
      expect(repo.previews.filter((x) => x.styleId === 'industrial').map((x) => x.status)).toEqual(['failed', 'pending']);
    });
  });

  describe('bloqueo optimista', () => {
    it('restaurar una versión con una revisión vieja falla con 409 sin tocar la escena', async () => {
      const p = await project();
      const saved = await service.saveVersion(alice, p.id);
      const versionId = saved.versions[0]!.id;
      await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [] });
      await expect(service.restoreVersion(alice, p.id, versionId, p.revision)).rejects.toBeInstanceOf(StaleRevisionError);
      const fresh = await service.get(alice, p.id);
      await expect(service.restoreVersion(alice, p.id, versionId, fresh.revision)).resolves.toMatchObject({
        revision: fresh.revision + 1,
      });
    });

    it('renombrar y elegir estilo respetan la revisión cuando el cliente la envía', async () => {
      const p = await project();
      await expect(service.rename(alice, p.id, 'Otro', p.revision + 5)).rejects.toBeInstanceOf(StaleRevisionError);
      await expect(service.selectStyle(alice, p.id, 'bohemio', p.revision + 5)).rejects.toBeInstanceOf(StaleRevisionError);
      await expect(service.rename(alice, p.id, 'Otro', p.revision)).resolves.toMatchObject({ name: 'Otro' });
      await expect(service.rename(alice, p.id, 'Sin revisión')).resolves.toMatchObject({ name: 'Sin revisión' });
    });
  });

  it('compartir revoca el enlace anterior, crea uno nuevo y guarda el proyecto en un solo paso', async () => {
    const p = await project();
    const first = await service.share(alice, p.id);
    const second = await service.share(alice, p.id);
    expect(await repo.findProjectIdByShareToken(first.token)).toBeNull();
    expect(await repo.findProjectIdByShareToken(second.token)).toBe(p.id);
    expect((await repo.findById(p.id))!.saved).toBe(true);
  });

  it('borrar elimina primero la fila: si S3 falla, el proyecto igual deja de existir', async () => {
    const p = await project();
    storage.deletePrefix = async () => {
      throw new Error('S3 caído');
    };
    await service.remove(alice, p.id);
    expect(await repo.findById(p.id)).toBeNull();
    expect([...storage.objects.keys()].some((k) => k.includes(p.id))).toBe(true); // quedan para el barrido
  });
});

describe('Robustez — PipelineService', () => {
  let repo: InMemoryProjectRepository;
  let ai: FakeAi;
  let quota: FakeQuota;
  let pipeline: PipelineService;
  const ctx = (final = false): JobContext => ({ jobId: 'job-1', kind: 'build-scene', isFinalAttempt: final });

  beforeEach(async () => {
    repo = new InMemoryProjectRepository();
    ai = new FakeAi();
    quota = new FakeQuota(10);
    pipeline = new PipelineService(repo, new InMemoryCatalogRepository(), ai, new FakeBroker(), quota);
    await repo.create({
      id: 'p1',
      ownerId: 'alice',
      name: 'Sala',
      roomType: 'living',
      status: 'ready',
      photoKey: 'projects/p1/source.jpg',
      photoHash: 'hash',
      thumbKey: null,
      roomShell: createRectangularShell(4, 3.5, 2.6),
      placements: [],
      selectedStyleId: null,
      requestedStyles: ['moderno'],
      saved: false,
    });
  });

  it('si el usuario guarda mientras corre el layout, se recalcula respetando sus muebles fijados', async () => {
    const userPiece = { id: 'mine', catalogItemId: 'lamp', position: { x: 1, y: 2, z: 1 }, rotationY: 0, lockedByUser: true };
    const original = ai.placeFurniture.bind(ai);
    let calls = 0;
    ai.placeFurniture = async (req) => {
      calls++;
      // Durante el primer cálculo el usuario guarda su escena (sube la revisión).
      if (calls === 1) await repo.update('p1', { placements: [userPiece] }, { bumpRevision: true });
      return original(req);
    };
    await pipeline.buildScene({ projectId: 'p1', styleId: 'moderno', keepLocked: true }, ctx());
    const p = (await repo.findById('p1'))!;
    expect(calls).toBe(2);
    expect(p.placements.map((x) => x.id)).toContain('mine');
    expect(p.revision).toBe(2);
  });

  it('un fallo definitivo devuelve la cuota de cada preview que no se generó', async () => {
    quota.used.set('alice', 3);
    for (const styleId of ['moderno', 'industrial'] as const) {
      await repo.createPreview({ projectId: 'p1', styleId, promptStrength: 0.6, status: 'pending', imageKey: null, cacheKey: styleId, provider: null });
    }
    await pipeline.markFailed('generate-styles', 'p1', ctx(true), new AiServiceError('caído', null, true, 'unreachable'));
    expect(quota.used.get('alice')).toBe(1);
    expect(repo.previews.every((p) => p.status === 'failed')).toBe(true);
    expect(repo.previews[0]!.error).toBe('El servicio de IA no está disponible en este momento.');
  });

  it('el mensaje al usuario depende del tipo de fallo, también si viene envuelto (cause)', () => {
    const wrapped = Object.assign(new Error('Unrecoverable'), { cause: new AiServiceError('x', 422, false, 'rejected') });
    expect(pipeline.friendlyError(wrapped)).toMatch(/interpretar la foto/);
    expect(pipeline.friendlyError(new AiServiceError('x', null, true, 'timeout'))).toMatch(/tardó demasiado/);
    expect(pipeline.friendlyError(new Error('ECONNREFUSED'))).toMatch(/Ocurrió un error/);
  });
});

describe('Robustez — RetentionService.sweepOrphans', () => {
  it('borra archivos sin proyecto con más de una hora, y respeta los recientes y los vivos', async () => {
    const repo = new InMemoryProjectRepository();
    const storage = new MemoryFileStorage();
    const service = new RetentionService({} as never, testConfig, repo, storage);
    await repo.create({
      id: 'vivo',
      ownerId: 'a',
      name: 'x',
      roomType: 'living',
      status: 'ready',
      photoKey: null,
      photoHash: null,
      thumbKey: null,
      roomShell: null,
      placements: [],
      selectedStyleId: null,
      requestedStyles: [],
      saved: true,
    });
    const old = new Date(Date.UTC(2026, 0, 1));
    for (const key of ['projects/vivo/source.jpg', 'projects/huerfano/source.jpg', 'projects/huerfano/thumb.webp', 'projects/creandose/source.jpg']) {
      await storage.put(key, Buffer.from('x'), 'image/jpeg');
    }
    storage.objects.get('projects/vivo/source.jpg')!.lastModified = old;
    storage.objects.get('projects/huerfano/source.jpg')!.lastModified = old;
    storage.objects.get('projects/huerfano/thumb.webp')!.lastModified = old;
    const now = new Date(old.getTime() + RetentionService.ORPHAN_GRACE_MS * 2);
    storage.objects.get('projects/creandose/source.jpg')!.lastModified = now;

    expect(await service.sweepOrphans(now)).toBe(2);
    expect([...storage.objects.keys()].sort()).toEqual(['projects/creandose/source.jpg', 'projects/vivo/source.jpg']);
  });
});
