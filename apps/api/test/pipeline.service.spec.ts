import { beforeEach, describe, expect, it } from 'vitest';
import { AiServiceError } from '../src/common/errors.js';
import { PipelineService, type JobContext } from '../src/modules/jobs/pipeline.service.js';
import { FakeAi, FakeBroker, FakeQuota, InMemoryCatalogRepository, InMemoryProjectRepository } from './fakes.js';

describe('PipelineService', () => {
  let repo: InMemoryProjectRepository;
  let ai: FakeAi;
  let broker: FakeBroker;
  let pipeline: PipelineService;
  const ctx = (final = false): JobContext => ({ jobId: 'job-1', kind: 'analyze-room', isFinalAttempt: final });

  beforeEach(async () => {
    repo = new InMemoryProjectRepository();
    ai = new FakeAi();
    broker = new FakeBroker();
    pipeline = new PipelineService(repo, new InMemoryCatalogRepository(), ai, broker, new FakeQuota(100));
    await repo.create({
      id: 'p1',
      ownerId: 'alice',
      name: 'Sala',
      roomType: 'living',
      status: 'processing',
      photoKey: 'projects/p1/source.jpg',
      photoHash: 'hash',
      thumbKey: null,
      roomShell: null,
      placements: [],
      finishes: null,
      requestedRoom: null,
      selectedStyleId: null,
      requestedStyles: ['moderno', 'industrial'],
      saved: false,
    });
  });

  it('ejecuta análisis → estilos → escena y reporta progreso monótono hasta 100', async () => {
    await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno', 'industrial'], promptStrength: 0.6 }, ctx());

    const project = (await repo.findById('p1'))!;
    expect(project.status).toBe('ready');
    expect(project.roomShell?.widthM).toBe(4);
    expect(project.placements).toHaveLength(1);
    expect(project.selectedStyleId).toBe('moderno');
    expect(repo.previews.map((p) => p.status)).toEqual(['ready', 'ready']);
    expect(ai.calls).toEqual(['analyze', 'style:moderno', 'style:industrial', 'layout']);

    const pcts = broker.events.map((e) => e.pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(broker.events.at(-1)).toMatchObject({ stage: 'done', pct: 100, status: 'completed' });
    expect(broker.events.map((e) => e.stage)).toEqual(expect.arrayContaining(['geometry', 'surfaces', 'styles', 'scene', 'done']));
  });

  it('un estilo que falla no tumba el pipeline: se marca fallido y la escena usa el que salió bien', async () => {
    ai.failStyles.add('moderno');
    await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno', 'industrial'], promptStrength: 0.6 }, ctx());
    const project = (await repo.findById('p1'))!;
    expect(project.status).toBe('ready');
    expect(project.selectedStyleId).toBe('industrial');
    expect(repo.previews.find((p) => p.styleId === 'moderno')?.status).toBe('failed');
  });

  it('en el job dedicado de estilos relanza el error para que BullMQ reintente (salvo en el último intento)', async () => {
    const preview = await repo.createPreview({ projectId: 'p1', styleId: 'bohemio', promptStrength: 0.6, status: 'pending', imageKey: null, cacheKey: 'k', provider: null });
    ai.failStyles.add('bohemio');
    await expect(pipeline.generateStyles({ projectId: 'p1', previewIds: [preview.id] }, { ...ctx(false), kind: 'generate-styles' })).rejects.toThrow();
    expect(repo.previews[0]!.status).toBe('pending');

    await pipeline.generateStyles({ projectId: 'p1', previewIds: [preview.id] }, { ...ctx(true), kind: 'generate-styles' });
    expect(repo.previews[0]!.status).toBe('failed');
  });

  it('build-scene conserva los muebles bloqueados por el usuario', async () => {
    await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());
    const locked = { id: 'mine', catalogItemId: 'lamp', position: { x: 1, y: 1.7, z: 1 }, rotationY: 0, lockedByUser: true };
    await repo.update('p1', { placements: [locked] });
    await pipeline.buildScene({ projectId: 'p1', styleId: 'moderno', keepLocked: true }, { ...ctx(), kind: 'build-scene' });
    const project = (await repo.findById('p1'))!;
    expect(project.placements.map((p) => p.id)).toEqual(['mine', 'auto-1']);
  });

  it('markFailed deja el proyecto en estado fallido con un mensaje entendible', async () => {
    await pipeline.markFailed(
      'analyze-room',
      'p1',
      ctx(true),
      new AiServiceError('La IA no respondió a tiempo (/v1/room/analyze)', null, true, 'timeout'),
    );
    const project = (await repo.findById('p1'))!;
    expect(project.status).toBe('failed');
    expect(project.lastError).toMatch(/tardó demasiado/);
    expect(broker.events.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('si el proyecto se borró mientras estaba en cola, el job termina sin error', async () => {
    await repo.delete('p1');
    await expect(pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx())).resolves.toBeUndefined();
  });
});
