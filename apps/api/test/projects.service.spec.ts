import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createRectangularShell } from '@interiores/shared-types';
import {
  NotFoundError,
  QuotaExceededError,
  StaleRevisionError,
  UnsupportedMediaError,
  ValidationError,
} from '../src/common/errors.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import {
  FakeBroker,
  FakeQueue,
  FakeQuota,
  InMemoryCatalogRepository,
  InMemoryProjectRepository,
  testConfig,
} from './fakes.js';

async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#c8a97e' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'CamaraPrueba' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '4/1 36/1 0/1' } })
    .toBuffer();
}

describe('ProjectsService', () => {
  let repo: InMemoryProjectRepository;
  let storage: MemoryFileStorage;
  let queue: FakeQueue;
  let broker: FakeBroker;
  let quota: FakeQuota;
  let service: ProjectsService;
  const alice = { userId: 'alice', requestId: 'req-1' };
  const bob = { userId: 'bob' };

  beforeEach(() => {
    repo = new InMemoryProjectRepository();
    storage = new MemoryFileStorage();
    queue = new FakeQueue();
    broker = new FakeBroker();
    quota = new FakeQuota(10);
    service = new ProjectsService(
      repo,
      new InMemoryCatalogRepository(),
      storage,
      queue,
      broker,
      quota,
      testConfig,
      new PhotoProcessor(),
      new MediaUrlSigner(testConfig),
    );
  });

  async function readyProject() {
    const p = await service.create(alice, { name: 'Sala', roomType: 'living' }, await photoWithGps());
    await repo.update(p.id, { roomShell: createRectangularShell(4, 3.5, 2.6), status: 'ready' }, { bumpRevision: true });
    return (await service.get(alice, p.id));
  }

  describe('create', () => {
    it('normaliza la foto, ELIMINA el EXIF/GPS, consume cuota y encola el análisis', async () => {
      const project = await service.create(alice, { name: 'Sala', roomType: 'living', styles: 'moderno,bohemio' }, await photoWithGps());

      const stored = storage.objects.get(`projects/${project.id}/source.jpg`)!;
      const meta = await sharp(stored.body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(storage.objects.has(`projects/${project.id}/thumb.webp`)).toBe(true);

      expect(quota.used.get('alice')).toBe(2);
      expect(queue.jobs).toEqual([
        expect.objectContaining({ kind: 'analyze-room', jobId: `analyze.${project.id}`, data: expect.objectContaining({ styles: ['moderno', 'bohemio'], requestId: 'req-1' }) }),
      ]);
      expect(broker.events[0]).toMatchObject({ stage: 'queued', projectId: project.id });
      expect(project.status).toBe('processing');
      expect(project.sourcePhotoUrl).toMatch(/^\/api\/media\/projects\//);
    });

    it('rechaza archivos que no son imágenes aunque digan serlo', async () => {
      const fakeJpg = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2000)]);
      await expect(service.create(alice, {}, fakeJpg)).rejects.toBeInstanceOf(UnsupportedMediaError);
      expect(quota.used.get('alice')).toBeUndefined();
    });

    it('rechaza cuando se agota la cuota diaria', async () => {
      quota = new FakeQuota(1);
      service = new ProjectsService(repo, new InMemoryCatalogRepository(), storage, queue, broker, quota, testConfig, new PhotoProcessor(), new MediaUrlSigner(testConfig));
      await expect(service.create(alice, {}, await photoWithGps())).rejects.toBeInstanceOf(QuotaExceededError);
      expect(storage.objects.size).toBe(0);
    });
  });

  describe('create con el cuarto definido a mano', () => {
    const lRoom = { shape: 'L', widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 } as const;

    it('sin foto: el cuarto queda definido, no consume cuota y se encola amueblarlo', async () => {
      const project = await service.create(alice, { name: 'Estudio', roomType: 'office', styles: 'bohemio', roomSpec: JSON.stringify(lRoom) }, undefined);

      expect(project.roomShell).toMatchObject({ shape: 'L', widthM: 5, depthM: 4, needsCalibration: false, scaleConfidence: 1 });
      expect(project.roomShell!.walls.map((w) => w.id)).toEqual(['w-back', 'w-right', 'w-3', 'w-4', 'w-front', 'w-left']);
      // Sin aberturas indicadas nace con una ventana al fondo y una puerta al frente.
      expect(project.roomShell!.openings.map((o) => [o.type, o.wallId])).toEqual([['window', 'w-back'], ['door', 'w-front']]);
      expect(project.sourcePhotoUrl).toBeNull();
      expect(storage.objects.size).toBe(0);
      expect(quota.used.get('alice')).toBeUndefined();
      expect(queue.jobs).toEqual([
        expect.objectContaining({ kind: 'build-scene', jobId: `scene.${project.id}`, data: expect.objectContaining({ styleId: 'bohemio', keepLocked: false, finalize: true }) }),
      ]);
      expect(broker.events[0]).toMatchObject({ stage: 'queued', kind: 'build-scene' });
    });

    it('con foto: el cuarto a mano manda y la foto sigue al análisis para las propuestas', async () => {
      const project = await service.create(alice, { roomSpec: { shape: 'U', widthM: 6, depthM: 5, heightM: 2.8 } }, await photoWithGps());
      expect(project.roomShell!.walls).toHaveLength(8);
      expect(project.sourcePhotoUrl).not.toBeNull();
      expect(queue.jobs[0]).toMatchObject({ kind: 'analyze-room' });
    });

    it('respeta las aberturas indicadas y rechaza las que no caben o apuntan a otra pared', async () => {
      const door = { id: 'o-door-1', type: 'door', wallId: 'w-3', widthM: 0.9, heightM: 2.05, offsetM: 1, sillHeightM: 0 } as const;
      const project = await service.create(alice, { roomSpec: { ...lRoom, openings: [door] } }, undefined);
      expect(project.roomShell!.openings).toEqual([door]);

      await expect(service.create(alice, { roomSpec: { ...lRoom, openings: [{ ...door, offsetM: 1.9 }] } }, undefined)).rejects.toThrow(/no cabe/);
      await expect(service.create(alice, { roomSpec: { ...lRoom, openings: [{ ...door, wallId: 'w-9' }] } }, undefined)).rejects.toBeInstanceOf(ValidationError);
      expect(repo.projects.size).toBe(1);
    });

    it('sin foto ni cuarto a mano no hay con qué empezar', async () => {
      await expect(service.create(alice, { name: 'Nada' }, undefined)).rejects.toBeInstanceOf(ValidationError);
      await expect(service.create(alice, { roomSpec: '{no es json' }, undefined)).rejects.toThrow();
    });

    it('reintentar un proyecto sin foto vuelve a encolar el amueblado', async () => {
      const p = await service.create(alice, { styles: 'moderno', roomSpec: lRoom }, undefined);
      await repo.update(p.id, { status: 'failed', lastError: 'IA caída' });
      queue.jobs = [];
      await service.retryAnalysis(alice, p.id);
      expect(queue.jobs[0]).toMatchObject({ kind: 'build-scene', data: { finalize: true, styleId: 'moderno' } });
    });
  });

  describe('retryAnalysis', () => {
    it('solo reintenta proyectos fallidos y vuelve a encolar el análisis', async () => {
      const p = await service.create(alice, { styles: 'moderno' }, await photoWithGps());
      await expect(service.retryAnalysis(alice, p.id)).rejects.toBeInstanceOf(ValidationError);
      await repo.update(p.id, { status: 'failed', lastError: 'IA caída' });
      queue.jobs = [];
      const retried = await service.retryAnalysis(alice, p.id);
      expect(retried.status).toBe('processing');
      expect(retried.lastError).toBeNull();
      expect(queue.jobs[0]).toMatchObject({ kind: 'analyze-room', data: { styles: ['moderno'] } });
    });
  });

  describe('propiedad', () => {
    it('un usuario no puede ver ni borrar proyectos ajenos (404, no 403)', async () => {
      const p = await service.create(alice, {}, await photoWithGps());
      await expect(service.get(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.remove(bob, p.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateScene', () => {
    it('aplica control de concurrencia optimista', async () => {
      const p = await readyProject();
      const placement = { id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: true };
      const saved = await service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [placement] });
      expect(saved.revision).toBe(p.revision + 1);
      await expect(
        service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [] }),
      ).rejects.toBeInstanceOf(StaleRevisionError);
    });

    it('mete dentro del cuarto los muebles fuera de límites y fija la altura de los colgantes', async () => {
      const p = await readyProject();
      const saved = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          { id: 'p1', catalogItemId: 'sofa-test', position: { x: -5, y: 3, z: 99 }, rotationY: -Math.PI / 2, lockedByUser: true },
          { id: 'p2', catalogItemId: 'lamp', position: { x: 2, y: 0, z: 2 }, rotationY: 0, lockedByUser: true },
        ],
      });
      const [sofa, lamp] = saved.furniturePlacements;
      expect(sofa!.position.x).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(sofa!.position.z).toBeLessThanOrEqual(3.5 - 1 + 1e-9);
      expect(sofa!.position.y).toBe(0);
      expect(sofa!.rotationY).toBeCloseTo((3 * Math.PI) / 2);
      expect(lamp!.position.y).toBeCloseTo(2.6 - 0.9);
    });

    it('rechaza muebles que no existen en el catálogo e ids repetidos', async () => {
      const p = await readyProject();
      const base = { position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false };
      await expect(
        service.updateScene(alice, p.id, { revision: p.revision, furniturePlacements: [{ id: 'x', catalogItemId: 'no-existe', ...base }] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.updateScene(alice, p.id, {
          revision: p.revision,
          furniturePlacements: [
            { id: 'x', catalogItemId: 'sofa-test', ...base },
            { id: 'x', catalogItemId: 'sofa-test', ...base },
          ],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('calibrate', () => {
    it('reescala cuarto y posiciones y marca la escala como confiable', async () => {
      const p = await readyProject();
      const withSofa = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1.5 }, rotationY: 0, lockedByUser: false }],
      });
      const out = await service.calibrate(alice, p.id, { revision: withSofa.revision, reference: 'room-width', valueM: 5 });
      expect(out.roomShell!.widthM).toBeCloseTo(5);
      expect(out.roomShell!.needsCalibration).toBe(false);
      expect(out.furniturePlacements[0]!.position.x).toBeCloseTo(2.5);
    });

    it('traduce factores absurdos a 422', async () => {
      const p = await readyProject();
      await expect(service.calibrate(alice, p.id, { revision: p.revision, reference: 'room-width', valueM: 25 })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('generateStyles', () => {
    it('reutiliza renders en caché sin consumir cuota ni encolar', async () => {
      const p = await readyProject();
      const used = quota.used.get('alice')!;
      const first = await service.generateStyles(alice, p.id, { styles: ['clasico'], promptStrength: 0.7 });
      expect(first.jobId).toMatch(/^styles./);
      expect(quota.used.get('alice')).toBe(used + 1);

      // El worker completó la generación
      const preview = repo.previews.find((x) => x.styleId === 'clasico')!;
      await repo.updatePreview(preview.id, { status: 'ready', imageKey: 'projects/x/previews/a.jpg', provider: 'mock' });

      const second = await service.generateStyles(alice, p.id, { styles: ['clasico'], promptStrength: 0.7 });
      expect(second.jobId).toBe('cached');
      expect(quota.used.get('alice')).toBe(used + 1);
      expect(repo.previews.filter((x) => x.styleId === 'clasico')).toHaveLength(2);
    });
  });

  describe('versiones, compartir y borrado', () => {
    it('guardar una versión marca el proyecto como guardado y se puede restaurar', async () => {
      const p = await readyProject();
      const v1 = await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false }],
      });
      const withVersion = await service.saveVersion(alice, p.id, 'primera');
      expect(withVersion.saved).toBe(true);
      expect(withVersion.versions[0]).toMatchObject({ number: 1, note: 'primera', itemCount: 1 });

      await service.updateScene(alice, p.id, { revision: v1.revision, furniturePlacements: [] });
      const restored = await service.restoreVersion(alice, p.id, withVersion.versions[0]!.id);
      expect(restored.furniturePlacements).toHaveLength(1);
    });

    it('compartir genera un token nuevo y revoca los anteriores', async () => {
      const p = await readyProject();
      const a = await service.share(alice, p.id);
      const b = await service.share(alice, p.id);
      expect(a.token).not.toBe(b.token);
      expect(await repo.findProjectIdByShareToken(a.token)).toBeNull();
      expect(await repo.findProjectIdByShareToken(b.token)).toBe(p.id);
      expect((await service.get(alice, p.id)).visibility).toBe('shared-link');
    });

    it('borrar elimina de verdad los archivos en S3 y el registro', async () => {
      const p = await readyProject();
      await service.remove(alice, p.id);
      expect([...storage.objects.keys()].some((k) => k.includes(p.id))).toBe(false);
      expect(await repo.findById(p.id)).toBeNull();
    });

    it('la lista de compras agrupa por mueble y suma precios', async () => {
      const p = await readyProject();
      const base = { rotationY: 0, lockedByUser: false };
      await service.updateScene(alice, p.id, {
        revision: p.revision,
        furniturePlacements: [
          { id: 'a', catalogItemId: 'sofa-test', position: { x: 1.1, y: 0, z: 0.5 }, ...base },
          { id: 'b', catalogItemId: 'sofa-test', position: { x: 2.9, y: 0, z: 3 }, ...base },
          { id: 'c', catalogItemId: 'lamp', position: { x: 2, y: 0, z: 2 }, ...base },
        ],
      });
      const list = await service.shoppingList(alice, p.id);
      expect(list.lines.find((l) => l.catalogItemId === 'sofa-test')).toMatchObject({ quantity: 2, subtotal: 1000 });
      expect(list.total).toBe(1100);
    });
  });
});
