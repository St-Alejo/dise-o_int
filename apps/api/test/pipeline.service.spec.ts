import { beforeEach, describe, expect, it } from 'vitest';
import { buildRoomFromSpec, cornerZone, createRectangularShell } from '@interiores/shared-types';
import { AiServiceError } from '../src/common/errors.js';
import { PipelineService, type JobContext } from '../src/modules/jobs/pipeline.service.js';
import { FakeAi, FakeBroker, FakeQuota, InMemoryCatalogRepository, InMemoryProjectRepository, catalogItem } from './fakes.js';

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

  it('tras distribuir, decora con lo que haya en el catálogo: cortinas a medida en la ventana', async () => {
    const catalog = new InMemoryCatalogRepository();
    await catalog.upsert(
      catalogItem({ id: 'cortinas', name: 'Cortinas', category: 'textile', subcategory: 'curtains', mount: 'wall', widthM: 2.2, heightM: 2.4, depthM: 0.12, spec: { elevationDefaultM: 0 } }),
    );
    pipeline = new PipelineService(repo, catalog, ai, broker, new FakeQuota(100));
    await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());
    const project = (await repo.findById('p1'))!;
    const windows = project.roomShell!.openings.filter((o) => o.type === 'window');
    const curtains = project.placements.filter((p) => p.catalogItemId === 'cortinas');
    expect(windows.length).toBeGreaterThan(0);
    expect(curtains).toHaveLength(Math.min(windows.length, 3));
    expect(curtains[0]).toMatchObject({ origin: 'layout', lockedByUser: false, wallId: windows[0]!.wallId });
    // La distribución del motor sigue ahí, primero.
    expect(project.placements[0]!.id).toBe('auto-1');
  });

  it('build-scene con semilla pide al motor esa variante; sin semilla, la de siempre', async () => {
    await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());
    await pipeline.buildScene({ projectId: 'p1', styleId: 'moderno', keepLocked: true, seed: 1234 }, { ...ctx(), kind: 'build-scene' });
    expect(ai.layoutRequests.map((r) => r.seed)).toEqual([undefined, 1234]);
  });

  it('con un baño privado ofrece también las piezas de baño, y lo que pide el Brief llega al motor', async () => {
    const catalog = new InMemoryCatalogRepository();
    await catalog.upsert(catalogItem({ id: 'inodoro', name: 'Inodoro', category: 'bathroom', subcategory: 'toilet', roomTypes: ['bathroom'] }));
    pipeline = new PipelineService(repo, catalog, ai, broker, new FakeQuota(100));
    const base = createRectangularShell(4.5, 4, 2.6);
    const shell = { ...base, zones: [cornerZone(base, { id: 'bano', kind: 'bathroom', widthM: 2, depthM: 1.6 })!] };
    await repo.update('p1', {
      roomShell: shell,
      status: 'ready',
      brief: { surfaces: {}, mustHave: [{ subcategory: 'dressing-table' }, { subcategory: 'towel-rail', zoneKind: 'bathroom' }], avoid: [], zones: [] },
    });
    await pipeline.buildScene({ projectId: 'p1', styleId: 'moderno', keepLocked: true }, { ...ctx(), kind: 'build-scene' });
    const req = ai.layoutRequests.at(-1)!;
    expect(req.candidates.map((c) => c.id)).toContain('inodoro');
    expect(req.roomShell.zones).toHaveLength(1);
    // Lo de la zona lo pone la plantilla de la zona: al motor solo va lo del espacio común.
    expect(req.mustHave).toEqual(['dressing-table']);
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

  describe('lo que el análisis vio en la foto', () => {
    const office = {
      detectedObjects: [
        { label: 'desk', confidence: 0.85, bbox: [0, 0, 1, 1] as [number, number, number, number], category: 'desk', count: 1 },
        { label: 'chair', confidence: 0.85, bbox: [0, 0, 1, 1] as [number, number, number, number], category: 'chair', count: 3 },
        { label: 'mueble', confidence: 0.3, bbox: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] },
      ],
      suggestions: { wallColor: '#4a6fa5', floorColor: '#8b7355', floorMaterial: 'wood' as const },
    };

    it('pinta el cuarto con los colores de la foto y amuebla con su inventario', async () => {
      ai.seen = office;
      await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());

      const project = (await repo.findById('p1'))!;
      // Pared azul y piso de madera oscura: los materiales de la biblioteca más parecidos.
      expect(project.finishes).toEqual({ floor: 'wood-teak', walls: { all: 'paint-steel-blue' }, ceiling: 'paint-white' });
      // Solo cuenta lo que trae categoría (lo que reconoce un modelo de visión).
      expect(ai.layoutRequests[0]!.inventory).toEqual([
        { category: 'desk', count: 1 },
        { category: 'chair', count: 3 },
      ]);
      // Y puede elegir entre todo el catálogo, no solo lo típico de una sala.
      expect(ai.layoutRequests[0]!.candidates.length).toBeGreaterThan(0);
    });

    it('sin inventario ni colores (análisis local) todo sigue como antes', async () => {
      await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());
      expect((await repo.findById('p1'))!.finishes).toBeNull();
      expect(ai.layoutRequests[0]!.inventory).toBeUndefined();
    });

    it('reacomodar después vuelve a colocar lo que se vio en la foto, no la plantilla', async () => {
      ai.seen = office;
      await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());
      expect((await repo.findById('p1'))!.photoInventory).toEqual(ai.layoutRequests[0]!.inventory);
      await pipeline.buildScene({ projectId: 'p1', styleId: 'moderno', keepLocked: true }, { ...ctx(), kind: 'build-scene' });
      expect(ai.layoutRequests[1]!.inventory).toEqual(ai.layoutRequests[0]!.inventory);
    });
  });

  describe('cuarto definido a mano', () => {
    const lShell = buildRoomFromSpec({ shape: 'L', widthM: 5, depthM: 4, heightM: 2.6 });
    const sceneCtx = (final = false): JobContext => ({ ...ctx(final), kind: 'build-scene' });

    it('sin foto: amueblar el cuarto deja el proyecto listo', async () => {
      await repo.update('p1', { photoKey: null, photoHash: null, roomShell: lShell });
      await pipeline.buildScene({ projectId: 'p1', styleId: 'bohemio', keepLocked: false, finalize: true }, sceneCtx());

      const project = (await repo.findById('p1'))!;
      expect(project.status).toBe('ready');
      expect(project.selectedStyleId).toBe('bohemio');
      expect(project.placements).toHaveLength(1);
      expect(ai.calls).toEqual(['layout']);
      expect(broker.events.at(-1)).toMatchObject({ stage: 'done', status: 'completed' });
    });

    it('con foto: el análisis no pisa la forma que eligió el usuario', async () => {
      await repo.update('p1', { roomShell: lShell });
      await pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx());

      const project = (await repo.findById('p1'))!;
      expect(project.roomShell!.walls).toHaveLength(6);
      expect(project.status).toBe('ready');
      expect(ai.calls).toEqual(['analyze', 'style:moderno', 'layout']);
    });

    it('si amueblar falla del todo, el proyecto nuevo queda fallido; uno ya listo no se toca', async () => {
      await repo.update('p1', { photoKey: null, roomShell: lShell });
      await pipeline.markFailed('build-scene', 'p1', sceneCtx(true), new AiServiceError('IA caída', null, true, 'unreachable'));
      expect((await repo.findById('p1'))!.status).toBe('failed');

      await repo.update('p1', { status: 'ready', lastError: null });
      await pipeline.markFailed('build-scene', 'p1', sceneCtx(true), new AiServiceError('IA caída', null, true, 'unreachable'));
      expect((await repo.findById('p1'))!.status).toBe('ready');
    });
  });

  it('si el proyecto se borró mientras estaba en cola, el job termina sin error', async () => {
    await repo.delete('p1');
    await expect(pipeline.analyzeRoom({ projectId: 'p1', styles: ['moderno'], promptStrength: 0.6 }, ctx())).resolves.toBeUndefined();
  });
});
