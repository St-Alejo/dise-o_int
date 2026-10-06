import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { QuotaExceededError, StaleRevisionError } from '../src/common/errors.js';
import { ProblemDetailsFilter } from '../src/common/problem-details.filter.js';
import { EnvSchema, loadConfig } from '../src/config/env.js';
import { MediaUrlSigner } from '../src/infrastructure/media/media-url-signer.js';
import { InMemoryProjectRepository, testConfig } from './fakes.js';
import { RetentionService } from '../src/modules/jobs/retention.service.js';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';

const validEnv = {
  DATABASE_URL: 'postgresql://u:p@db:5432/x',
  REDIS_URL: 'redis://redis:6379',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 'b',
  JWT_ACCESS_SECRET: 'j'.repeat(40),
  MEDIA_SIGNING_SECRET: 'm'.repeat(40),
  AI_SERVICE_URL: 'http://ai:8000',
  AI_INTERNAL_TOKEN: 't'.repeat(20),
};

describe('config', () => {
  it('aplica valores por defecto y convierte tipos', () => {
    const c = loadConfig({ ...validEnv, S3_FORCE_PATH_STYLE: 'false', CORS_ORIGINS: 'http://a.com, http://b.com' });
    expect(c.PORT).toBe(3000);
    expect(c.S3_FORCE_PATH_STYLE).toBe(false);
    expect(c.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('falla rápido con un mensaje claro si falta algo', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('en producción rechaza secretos por defecto', () => {
    const r = EnvSchema.safeParse({ ...validEnv, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-only-jwt-secret-please-replace-0123456789' });
    expect(r.success).toBe(false);
  });
});

describe('MediaUrlSigner', () => {
  const signer = new MediaUrlSigner(testConfig);
  const parse = (url: string) => {
    const u = new URL(url, 'http://x');
    return { exp: Number(u.searchParams.get('exp')), sig: u.searchParams.get('sig')! };
  };

  it('acepta la firma válida y rechaza manipulaciones o expiradas', () => {
    const key = 'projects/abc/source.jpg';
    const { exp, sig } = parse(signer.sign(key));
    expect(signer.verify(key, exp, sig)).toBe(true);
    expect(signer.verify('projects/otro/source.jpg', exp, sig)).toBe(false);
    expect(signer.verify(key, exp + 3600, sig)).toBe(false);
    expect(signer.verify(key, exp, sig, (exp + 1) * 1000)).toBe(false);
  });

  it('produce la misma URL dentro de la misma hora (cacheable)', () => {
    const t = Date.UTC(2026, 0, 1, 10, 5);
    expect(signer.sign('projects/a/b.jpg', t)).toBe(signer.sign('projects/a/b.jpg', t + 60_000));
  });
});

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('traduce errores de dominio a RFC 7807', () => {
    expect(filter.toProblem(new StaleRevisionError('cambió'))).toMatchObject({ status: 409, code: 'stale_revision', detail: 'cambió' });
    expect(filter.toProblem(new QuotaExceededError('x'))).toMatchObject({ status: 429 });
  });

  it('traduce errores de zod a 422 con la lista de campos', () => {
    const err = z.object({ a: z.number() }).safeParse({ a: 'x' }).error!;
    expect(filter.toProblem(err)).toMatchObject({ status: 422, errors: [{ path: 'a' }] });
  });

  it('no filtra detalles internos en errores 500', () => {
    const p = filter.toProblem(new Error('password=supersecret en la consulta SQL'));
    expect(p.status).toBe(500);
    expect(JSON.stringify(p)).not.toContain('supersecret');
  });

  it('respeta HttpException de Nest y el límite de Multer', () => {
    expect(filter.toProblem(new NotFoundException())).toMatchObject({ status: 404 });
    expect(filter.toProblem(new HttpException('x', 429)).detail).toMatch(/Demasiadas/);
    expect(filter.toProblem({ code: 'LIMIT_FILE_SIZE' })).toMatchObject({ status: 413 });
  });
});

describe('RetentionService', () => {
  it('borra (S3 + DB) solo los proyectos no guardados más viejos que la retención', async () => {
    const repo = new InMemoryProjectRepository();
    const storage = new MemoryFileStorage();
    const base = { ownerId: 'u', name: 'x', roomType: 'living' as const, status: 'ready' as const, photoKey: null, photoHash: null, thumbKey: null, roomShell: null, placements: [], finishes: null, requestedRoom: null, selectedStyleId: null, requestedStyles: [] };
    await repo.create({ ...base, id: 'viejo', saved: false });
    await repo.create({ ...base, id: 'guardado', saved: true });
    await storage.put('projects/viejo/source.jpg', Buffer.from('x'), 'image/jpeg');
    await storage.put('projects/guardado/source.jpg', Buffer.from('x'), 'image/jpeg');

    const service = new RetentionService(null as never, testConfig, repo, storage);
    const purged = await service.purgeExpired(new Date(Date.UTC(2026, 0, 3)));
    expect(purged).toBe(1);
    expect(await repo.findById('viejo')).toBeNull();
    expect(await repo.findById('guardado')).not.toBeNull();
    expect(storage.objects.has('projects/viejo/source.jpg')).toBe(false);
    expect(storage.objects.has('projects/guardado/source.jpg')).toBe(true);
  });
});
