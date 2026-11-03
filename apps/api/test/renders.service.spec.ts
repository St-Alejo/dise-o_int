import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { defaultRenderSpec, type CreateRenderFields } from '@interiores/shared-types';
import { ConflictError, NotFoundError, PayloadTooLargeError, UnsupportedMediaError, ValidationError } from '../src/common/errors.js';
import type { AppConfig } from '../src/config/env.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { RendersService } from '../src/modules/renders/renders.service.js';
import { FakeBroker, FakeQueue, FakeQuota, FakeRenderQueue, InMemoryCatalogRepository, InMemoryProjectRepository, InMemoryRenderRepository, testConfig } from './fakes.js';

const spec = defaultRenderSpec({ position: { x: 1, y: 1.6, z: 3 }, target: { x: 2, y: 1, z: 0 }, focalMm: 24, straightVerticals: true });
const pathFields: CreateRenderFields = { kind: 'path', spec };
const videoFields: CreateRenderFields = { kind: 'video', spec: { ...spec, engine: 'raster' } };

const png = () => sharp({ create: { width: 64, height: 36, channels: 3, background: '#d8cbb5' } }).png().toBuffer();
/** Cabecera mínima de un MP4 (caja ftyp isom): basta para el reconocimiento por magic bytes. */
const mp4 = () =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2'),
    Buffer.alloc(64),
  ]);

describe('RendersService (galería del estudio de render)', () => {
  let projects: InMemoryProjectRepository;
  let renders: InMemoryRenderRepository;
  let storage: MemoryFileStorage;
  let service: RendersService;
  let projectId: string;
  const alice = { userId: 'alice' };
  const bob = { userId: 'bob' };

  function build(config: AppConfig = testConfig) {
    service = new RendersService(projects, renders, storage, config, new MediaUrlSigner(testConfig), new FakeRenderQueue());
  }

  beforeEach(async () => {
    projects = new InMemoryProjectRepository();
    renders = new InMemoryRenderRepository();
    storage = new MemoryFileStorage();
    const projectsService = new ProjectsService(
      projects,
      new InMemoryCatalogRepository(),
      storage,
      new FakeQueue(),
      new FakeBroker(),
      new FakeQuota(10),
      testConfig,
      new PhotoProcessor(),
      new MediaUrlSigner(testConfig),
    );
    projectId = (await projectsService.create(alice, { name: 'Sala', roomType: 'living', roomSpec: { shape: 'rect', widthM: 4, depthM: 3, heightM: 2.5 } } as never, undefined)).id;
    build();
  });

  it('guarda un PNG del estudio con su spec y lo devuelve firmado', async () => {
    const saved = await service.upload(alice, projectId, pathFields, await png());
    expect(saved).toMatchObject({ kind: 'path', status: 'ready', mediaType: 'image/png', spec, shared: false, provider: 'pathtracer' });
    expect(saved.url).toContain(`projects/${projectId}/renders/${saved.id}.png`);
    expect(await storage.exists(`projects/${projectId}/renders/${saved.id}.png`)).toBe(true);
    expect((await service.list(alice, projectId)).map((r) => r.id)).toEqual([saved.id]);
  });

  it('guarda un recorrido MP4', async () => {
    const saved = await service.upload(alice, projectId, videoFields, mp4());
    expect(saved).toMatchObject({ kind: 'video', mediaType: 'video/mp4' });
    expect(saved.url).toContain('.mp4');
  });

  it('decide el tipo por los bytes, no por lo que dice el cliente', async () => {
    await expect(service.upload(alice, projectId, pathFields, mp4())).rejects.toBeInstanceOf(UnsupportedMediaError);
    await expect(service.upload(alice, projectId, videoFields, await png())).rejects.toBeInstanceOf(UnsupportedMediaError);
    await expect(service.upload(alice, projectId, pathFields, Buffer.from('no soy una imagen'))).rejects.toBeInstanceOf(UnsupportedMediaError);
    await expect(service.upload(alice, projectId, pathFields, undefined)).rejects.toBeInstanceOf(ValidationError);
  });

  it('respeta el tope de tamaño y el de renders por proyecto', async () => {
    build({ ...testConfig, RENDERS_MAX_MB: 0.0001 } as AppConfig);
    await expect(service.upload(alice, projectId, pathFields, await png())).rejects.toBeInstanceOf(PayloadTooLargeError);
    build({ ...testConfig, RENDERS_PER_PROJECT: 1 } as AppConfig);
    await service.upload(alice, projectId, pathFields, await png());
    await expect(service.upload(alice, projectId, pathFields, await png())).rejects.toBeInstanceOf(ConflictError);
  });

  it('otra persona no ve ni toca la galería (404)', async () => {
    const saved = await service.upload(alice, projectId, pathFields, await png());
    await expect(service.list(bob, projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.upload(bob, projectId, pathFields, await png())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.remove(bob, projectId, saved.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('compartir lo saca en el enlace público; borrar quita archivo y registro', async () => {
    const a = await service.upload(alice, projectId, pathFields, await png());
    const b = await service.upload(alice, projectId, pathFields, await png());
    await storage.put(`projects/${projectId}/renders/${a.id}.depth.png`, await png(), 'image/png');
    await service.update(alice, projectId, b.id, { shared: true });
    expect((await service.listShared(projectId)).map((r) => r.id)).toEqual([b.id]);

    await service.remove(alice, projectId, a.id);
    expect(await storage.exists(`projects/${projectId}/renders/${a.id}.png`)).toBe(false);
    expect(await storage.exists(`projects/${projectId}/renders/${a.id}.depth.png`)).toBe(false);
    expect(await storage.exists(`projects/${projectId}/renders/${b.id}.png`)).toBe(true);
    expect((await service.list(alice, projectId)).map((r) => r.id)).toEqual([b.id]);
    await expect(service.remove(alice, projectId, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
