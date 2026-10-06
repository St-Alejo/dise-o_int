/**
 * Pruebas HTTP (supertest) de los controladores reales con sus pipes, el filtro RFC 7807 y
 * un guard de prueba. Verifican el contrato que ve la web: códigos de estado, validación en
 * el borde y que la vista pública no filtre datos privados.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { createRectangularShell } from '@interiores/shared-types';
import { ProblemDetailsFilter } from '../src/common/problem-details.filter.js';
import { UnauthorizedError } from '../src/common/errors.js';
import { PhotoProcessor } from '../src/infrastructure/imaging/photo-processor.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { IS_PUBLIC, type AuthenticatedRequest } from '../src/modules/auth/auth.decorators.js';
import { CatalogController } from '../src/modules/catalog/catalog.controller.js';
import { ProjectsController } from '../src/modules/projects/projects.controller.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { PublicController } from '../src/modules/public/public.controller.js';
import { APP_CONFIG, CATALOG_REPOSITORY, FILE_STORAGE, PROJECT_REPOSITORY } from '../src/ports/index.js';
import { FakeBroker, FakeQueue, FakeQuota, InMemoryCatalogRepository, InMemoryProjectRepository, testConfig } from './fakes.js';

/** Guard de prueba: "Bearer <userId>" autentica a ese usuario; respeta @Public(). */
class TestAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Falta el token de acceso');
    const userId = header.slice(7);
    req.user = { userId, email: `${userId}@example.com`, displayName: userId };
    return true;
  }
}

// Vitest no emite `design:paramtypes`; se declaran los tipos de los constructores a mano.
Reflect.defineMetadata('design:paramtypes', [ProjectsService], ProjectsController);
Reflect.defineMetadata('design:paramtypes', [Object, Object, ProjectsService, MediaUrlSigner], PublicController);
Reflect.defineMetadata('design:paramtypes', [Object, Object], CatalogController);

describe('HTTP', () => {
  let app: INestApplication;
  let repo: InMemoryProjectRepository;
  let quota: FakeQuota;
  const alice = { authorization: 'Bearer alice' };
  const bob = { authorization: 'Bearer bob' };

  beforeAll(async () => {
    repo = new InMemoryProjectRepository();
    quota = new FakeQuota(50);
    const catalog = new InMemoryCatalogRepository();
    const storage = new MemoryFileStorage();
    const signer = new MediaUrlSigner(testConfig);
    const service = new ProjectsService(repo, catalog, storage, new FakeQueue(), new FakeBroker(), quota, testConfig, new PhotoProcessor(), signer);
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectsController, PublicController, CatalogController],
      providers: [
        { provide: ProjectsService, useValue: service },
        { provide: MediaUrlSigner, useValue: signer },
        { provide: PROJECT_REPOSITORY, useValue: repo },
        { provide: CATALOG_REPOSITORY, useValue: catalog },
        { provide: FILE_STORAGE, useValue: storage },
        { provide: APP_CONFIG, useValue: { ...testConfig, PUBLIC_WEB_URL: 'http://localhost' } },
        { provide: APP_GUARD, useFactory: (r: Reflector) => new TestAuthGuard(r), inject: [Reflector] },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const photo = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#a08070' } }).jpeg().toBuffer();

  async function createReady(): Promise<{ id: string; revision: number }> {
    const res = await request(app.getHttpServer())
      .post('/api/projects')
      .set(alice)
      .field('name', 'Sala')
      .field('roomType', 'living')
      .attach('photo', await photo(), { filename: 'sala.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const updated = await repo.update(res.body.id, { roomShell: createRectangularShell(4, 3.5, 2.6), status: 'ready' }, { bumpRevision: true });
    return { id: updated.id, revision: updated.revision };
  }

  it('sin token responde 401 en formato problem+json', async () => {
    const res = await request(app.getHttpServer()).get('/api/projects').expect(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('valida los campos del multipart en el borde (422) sin consumir cuota', async () => {
    const before = quota.used.get('alice') ?? 0;
    const res = await request(app.getHttpServer())
      .post('/api/projects')
      .set(alice)
      .field('roomType', 'cocina-espacial')
      .attach('photo', await photo(), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(422);
    expect(res.body.code).toBe('validation_failed');
    expect(quota.used.get('alice') ?? 0).toBe(before);
  });

  // Regresión: el pipe del controlador y el caso de uso parseaban dos veces el multipart y la
  // segunda pasada recibía `styles` ya convertido en lista → 422 con cualquier estilo elegido.
  it('crea un proyecto con estilos y medidas reales del multipart (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/projects')
      .set(alice)
      .field('name', 'Con estilos')
      .field('roomType', 'bedroom')
      .field('styles', 'escandinavo,industrial')
      .field('widthM', '4.2')
      .field('depthM', '3,5')
      .field('heightM', '2.6')
      .attach('photo', await photo(), { filename: 'cuarto.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const stored = await repo.findById(res.body.id);
    expect(stored!.requestedStyles).toEqual(['escandinavo', 'industrial']);
    expect(stored!.requestedRoom).toEqual({ widthM: 4.2, depthM: 3.5, heightM: 2.6 });
  });

  it('PUT room valida en el borde (422) y aplica medidas exactas (200)', async () => {
    const { id, revision } = await createReady();
    await request(app.getHttpServer())
      .put(`/api/projects/${id}/room`)
      .set(alice)
      .send({ revision, widthM: 4, depthM: 3, heightM: 12 })
      .expect(422);
    const ok = await request(app.getHttpServer())
      .put(`/api/projects/${id}/room`)
      .set(alice)
      .send({ revision, widthM: 4.4, depthM: 3.1, heightM: 2.5 })
      .expect(200);
    expect(ok.body.roomShell).toMatchObject({ widthM: 4.4, depthM: 3.1, heightM: 2.5 });
  });

  it('crea un proyecto (201) y otro usuario recibe 404, no 403', async () => {
    const { id } = await createReady();
    await request(app.getHttpServer()).get(`/api/projects/${id}`).set(alice).expect(200);
    await request(app.getHttpServer()).get(`/api/projects/${id}`).set(bob).expect(404);
  });

  it('un id que no es UUID se rechaza con 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/projects/no-es-uuid').set(alice).expect(400);
    expect(res.body.status).toBe(400);
  });

  it('guardar la escena con una revisión vieja devuelve 409 stale_revision', async () => {
    const { id, revision } = await createReady();
    const body = { revision, furniturePlacements: [] };
    await request(app.getHttpServer()).put(`/api/projects/${id}/scene`).set(alice).send(body).expect(200);
    const res = await request(app.getHttpServer()).put(`/api/projects/${id}/scene`).set(alice).send(body).expect(409);
    expect(res.body.code).toBe('stale_revision');
  });

  it('restaurar una versión funciona sin cuerpo y responde 409 con una revisión vieja', async () => {
    const { id, revision } = await createReady();
    const saved = await request(app.getHttpServer()).post(`/api/projects/${id}/versions`).set(alice).send({ note: 'v1' }).expect(201);
    const versionId = saved.body.versions[0].id;
    await request(app.getHttpServer()).post(`/api/projects/${id}/versions/${versionId}/restore`).set(alice).expect(200);
    await request(app.getHttpServer())
      .post(`/api/projects/${id}/versions/${versionId}/restore`)
      .set(alice)
      .send({ revision })
      .expect(409);
  });

  it('la vista pública no expone datos privados y deja de funcionar al dejar de compartir', async () => {
    const { id } = await createReady();
    const share = await request(app.getHttpServer()).post(`/api/projects/${id}/share`).set(alice).expect(201);
    const pub = await request(app.getHttpServer()).get(`/api/public/${share.body.token}`).expect(200);
    expect(pub.body.id).toBe(id);
    expect(pub.body).not.toHaveProperty('ownerId');
    expect(pub.body).not.toHaveProperty('versions');
    await request(app.getHttpServer()).get(`/api/public/${share.body.token}/shopping-list`).expect(200);

    await request(app.getHttpServer()).delete(`/api/projects/${id}/share`).set(alice).expect(204);
    await request(app.getHttpServer()).get(`/api/public/${share.body.token}`).expect(404);
    await request(app.getHttpServer()).get('/api/public/x').expect(404);
  });

  it('el catálogo es público y valida los filtros', async () => {
    const res = await request(app.getHttpServer()).get('/api/catalog').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toMatch(/max-age/);
    await request(app.getHttpServer()).get('/api/catalog?category=nave-espacial').expect(422);
  });
});
