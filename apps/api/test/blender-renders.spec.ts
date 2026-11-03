import { beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { defaultRenderSpec, type BlenderLights, type CreateBlenderRenderFields } from '@interiores/shared-types';
import { ConflictError, DependencyError, NotFoundError, PayloadTooLargeError, QuotaExceededError, UnsupportedMediaError, ValidationError } from '../src/common/errors.js';
import type { AppConfig } from '../src/config/env.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { BlenderRendersService, isGlb } from '../src/modules/renders/blender-renders.service.js';
import { RenderJobsListener, friendlyRenderError } from '../src/modules/renders/render-jobs.listener.js';
import { RendersService } from '../src/modules/renders/renders.service.js';
import { FakeBroker, FakeQueue, FakeQuota, FakeRenderQueue, InMemoryCatalogRepository, InMemoryProjectRepository, InMemoryRenderRepository, testConfig } from './fakes.js';

const spec = defaultRenderSpec({ position: { x: 1, y: 1.6, z: 3 }, target: { x: 2, y: 1, z: 0 }, focalMm: 24, straightVerticals: true });
const lights: BlenderLights = { sunDirection: { x: 0.5, y: -0.6, z: 0.3 }, lamps: [], ceiling: null, mood: 'calida', level: 'media' };
const fields: CreateBlenderRenderFields = { spec, lights };

/** Un .glb mínimo: cabecera de 12 bytes ("glTF", versión 2, largo total) y relleno. */
function glb(extra = 20): Buffer {
  const file = Buffer.alloc(12 + extra);
  file.write('glTF', 0, 'ascii');
  file.writeUInt32LE(2, 4);
  file.writeUInt32LE(file.length, 8);
  return file;
}

describe('render en Blender (ADR-0036)', () => {
  let projects: InMemoryProjectRepository;
  let renders: InMemoryRenderRepository;
  let storage: MemoryFileStorage;
  let queue: FakeRenderQueue;
  let quota: FakeQuota;
  let broker: FakeBroker;
  let blender: BlenderRendersService;
  let gallery: RendersService;
  let listener: RenderJobsListener;
  let projectId: string;
  const alice = { userId: 'alice' };
  const bob = { userId: 'bob' };
  const signer = new MediaUrlSigner(testConfig);

  function build(config: AppConfig = testConfig) {
    blender = new BlenderRendersService(projects, renders, storage, queue, quota, config, signer);
    gallery = new RendersService(projects, renders, storage, config, signer, queue);
    listener = new RenderJobsListener({} as Redis, queue, renders, storage, broker, quota);
  }

  beforeEach(async () => {
    projects = new InMemoryProjectRepository();
    renders = new InMemoryRenderRepository();
    storage = new MemoryFileStorage();
    queue = new FakeRenderQueue();
    quota = new FakeQuota(3);
    broker = new FakeBroker();
    const projectsService = new ProjectsService(
      projects,
      new InMemoryCatalogRepository(),
      storage,
      new FakeQueue(),
      new FakeBroker(),
      new FakeQuota(10),
      testConfig,
      new PhotoProcessor(),
      signer,
    );
    projectId = (await projectsService.create(alice, { name: 'Sala', roomType: 'living', roomSpec: { shape: 'rect', widthM: 4, depthM: 3, heightM: 2.5 } } as never, undefined)).id;
    build();
  });

  const keysUnder = (prefix: string) => [...storage.objects.keys()].filter((k) => k.startsWith(prefix));

  /** Lo que sube el nodo al terminar y lo que devuelve a la cola. */
  async function nodeFinishes(renderId: string) {
    const prefix = queue.jobs.get(renderId)!.job!.outputPrefix;
    for (const ext of ['png', 'jpg', 'blend']) await storage.put(`${prefix}.${ext}`, Buffer.from(ext), 'application/octet-stream');
    queue.finish(renderId, { state: 'completed', result: { imageKey: `${prefix}.png`, previewKey: `${prefix}.jpg`, blendKey: `${prefix}.blend`, seconds: 42, device: 'CUDA' } });
  }

  it('reconoce un glTF binario por su cabecera', () => {
    expect(isGlb(glb())).toBe(true);
    expect(isGlb(Buffer.from('glTF no lo es'))).toBe(false);
    const wrongLength = glb();
    wrongLength.writeUInt32LE(999, 8);
    expect(isGlb(wrongLength)).toBe(false);
  });

  it('guarda la escena, crea el render pendiente y encola el plan con quién lo pidió', async () => {
    const render = await blender.create(alice, projectId, fields, glb());
    expect(render).toMatchObject({ kind: 'path', status: 'pending', provider: 'cycles', url: null, spec: { engine: 'cycles' } });
    expect(render.downloads).toBeUndefined();
    expect(await storage.exists(`projects/${projectId}/renders/${render.id}.scene.glb`)).toBe(true);
    const { job } = await queue.info(render.id);
    expect(job).toMatchObject({
      renderId: render.id,
      projectId,
      userId: 'alice',
      sceneKey: `projects/${projectId}/renders/${render.id}.scene.glb`,
      outputPrefix: `projects/${projectId}/renders/${render.id}`,
      plan: { width: 2560, height: 1440 },
    });
    expect(quota.used.get('alice')).toBe(1);
  });

  it('exportar a Blender guarda el propósito y encola una miniatura con el .blend en calidad final', async () => {
    const render = await blender.create(alice, projectId, { ...fields, spec: { ...spec, purpose: 'export' } }, glb());
    expect(render.spec).toMatchObject({ engine: 'cycles', purpose: 'export' });
    const { job } = await queue.info(render.id);
    expect(job!.plan.preview).toMatchObject({ width: 960 });
    expect(job!.plan.cycles.samples).toBe(2048);
  });

  it('sin nodo encendido responde 503 y no gasta cuota', async () => {
    queue.alive = false;
    await expect(blender.create(alice, projectId, fields, glb())).rejects.toBeInstanceOf(DependencyError);
    expect(quota.used.get('alice') ?? 0).toBe(0);
    expect(renders.rows).toHaveLength(0);
    expect(await blender.node()).toEqual({ available: false, device: null });
  });

  it('si no se puede encolar, deshace todo y devuelve la cuota', async () => {
    queue.failEnqueue = true;
    await expect(blender.create(alice, projectId, fields, glb())).rejects.toBeInstanceOf(DependencyError);
    expect(quota.used.get('alice')).toBe(0);
    expect(renders.rows).toHaveLength(0);
    expect(keysUnder(`projects/${projectId}/renders/`)).toEqual([]);
  });

  it('valida archivo, tamaño, cupo de la galería, cuota y dueño', async () => {
    await expect(blender.create(alice, projectId, fields, undefined)).rejects.toBeInstanceOf(ValidationError);
    await expect(blender.create(alice, projectId, fields, Buffer.from('PNG falso'))).rejects.toBeInstanceOf(UnsupportedMediaError);
    await expect(blender.create(bob, projectId, fields, glb())).rejects.toBeInstanceOf(NotFoundError);
    build({ ...testConfig, RENDER_SCENE_MAX_MB: 0.00001 } as AppConfig);
    await expect(blender.create(alice, projectId, fields, glb())).rejects.toBeInstanceOf(PayloadTooLargeError);
    build();
    for (let i = 0; i < 3; i++) await blender.create(alice, projectId, fields, glb());
    await expect(blender.create(alice, projectId, fields, glb())).rejects.toBeInstanceOf(QuotaExceededError);
    build({ ...testConfig, RENDERS_PER_PROJECT: 3 } as AppConfig);
    await expect(blender.create(alice, projectId, fields, glb())).rejects.toBeInstanceOf(ConflictError);
  });

  it('el avance del nodo llega a la web como etapa "rendering"', async () => {
    const render = await blender.create(alice, projectId, fields, glb());
    await listener.progress(render.id, 37.4);
    await listener.progress(render.id, 'no es un número');
    expect(broker.events).toEqual([expect.objectContaining({ jobId: render.id, projectId, kind: 'blender-render', stage: 'rendering', pct: 37, status: 'active' })]);
  });

  it('al terminar, el render queda listo con la vista previa y las descargas firmadas', async () => {
    const render = await blender.create(alice, projectId, fields, glb());
    await nodeFinishes(render.id);
    await listener.settle(render.id);
    const [ready] = await gallery.list(alice, projectId);
    expect(ready).toMatchObject({ id: render.id, status: 'ready', mediaType: 'image/jpeg' });
    expect(ready!.url).toContain(`renders/${render.id}.jpg`);
    expect(ready!.downloads!.png).toContain(`renders/${render.id}.png`);
    expect(ready!.downloads!.blend).toContain(`renders/${render.id}.blend`);
    expect(broker.events.at(-1)).toMatchObject({ status: 'completed', stage: 'done', pct: 100 });
    // Repetir el evento no cambia nada (idempotente).
    await listener.settle(render.id);
    expect(broker.events.filter((e) => e.status === 'completed')).toHaveLength(1);
  });

  it('no firma claves ajenas aunque el nodo las devuelva', async () => {
    const render = await blender.create(alice, projectId, fields, glb());
    queue.finish(render.id, { state: 'completed', result: { imageKey: 'projects/otro/x.png', previewKey: 'projects/otro/x.jpg', blendKey: null, seconds: 1, device: 'CPU' } });
    await listener.settle(render.id);
    expect((await renders.findById(projectId, render.id))!.status).toBe('failed');
    expect(quota.used.get('alice')).toBe(0);
  });

  it('si falla, queda con un error legible y devuelve la cuota', async () => {
    const render = await blender.create(alice, projectId, fields, glb());
    queue.finish(render.id, { state: 'failed', error: 'CUDA error: out of memory in cuMemAlloc' });
    await listener.settle(render.id);
    expect(await renders.findById(projectId, render.id)).toMatchObject({ status: 'failed', error: friendlyRenderError('out of memory') });
    expect(quota.used.get('alice')).toBe(0);
    expect(broker.events.at(-1)).toMatchObject({ status: 'failed', kind: 'blender-render' });
  });

  it('borrar un render en curso cancela el trabajo; lo que llegue después se limpia', async () => {
    const render = await blender.create(alice, projectId, fields, glb());
    await gallery.remove(alice, projectId, render.id);
    expect(queue.cancelled).toEqual([render.id]);
    expect(await storage.exists(`projects/${projectId}/renders/${render.id}.scene.glb`)).toBe(false);
    await nodeFinishes(render.id);
    await listener.settle(render.id);
    expect(keysUnder(`projects/${projectId}/renders/`)).toEqual([]);
  });

  it('al arrancar reconcilia los pendientes con la cola', async () => {
    const done = await blender.create(alice, projectId, fields, glb());
    const lost = await blender.create(alice, projectId, fields, glb());
    const waiting = await blender.create(alice, projectId, fields, glb());
    await nodeFinishes(done.id);
    queue.jobs.delete(lost.id);
    await listener.reconcile();
    expect((await renders.findById(projectId, done.id))!.status).toBe('ready');
    expect((await renders.findById(projectId, lost.id))!.status).toBe('failed');
    expect((await renders.findById(projectId, waiting.id))!.status).toBe('pending');
  });
});
