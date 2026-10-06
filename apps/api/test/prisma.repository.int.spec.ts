/**
 * Integración contra PostgreSQL real (no dobles): el bloqueo optimista con updateMany, las
 * transacciones y la numeración de versiones dependen del motor. Se ejecuta solo si hay
 * TEST_DATABASE_URL (CI levanta un Postgres y aplica las migraciones antes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRectangularShell } from '@interiores/shared-types';
import { StaleRevisionError } from '../src/common/errors.js';
import type { AppConfig } from '../src/config/env.js';
import { PrismaProjectRepository } from '../src/infrastructure/prisma/prisma-project.repository.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('PrismaProjectRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repo: PrismaProjectRepository;
  let ownerId: string;

  beforeAll(async () => {
    prisma = new PrismaService({ DATABASE_URL: url } as AppConfig);
    await prisma.$connect();
    repo = new PrismaProjectRepository(prisma);
    const user = await prisma.user.create({
      data: { email: `int-${randomUUID()}@example.com`, passwordHash: 'x', displayName: 'Int' },
    });
    ownerId = user.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: ownerId } }); // cascada a proyectos
    await prisma.$disconnect();
  });

  const newProject = () =>
    repo.create({
      id: randomUUID(),
      ownerId,
      name: 'Integración',
      roomType: 'living',
      status: 'ready',
      photoKey: null,
      photoHash: null,
      thumbKey: null,
      roomShell: createRectangularShell(4, 3.5, 2.6),
      placements: [],
      selectedStyleId: null,
      requestedStyles: ['moderno'],
      saved: false,
    });

  it('dos escrituras con la misma revisión: la segunda recibe StaleRevisionError', async () => {
    const p = await newProject();
    const results = await Promise.allSettled([
      repo.update(p.id, { name: 'A' }, { expectedRevision: p.revision, bumpRevision: true }),
      repo.update(p.id, { name: 'B' }, { expectedRevision: p.revision, bumpRevision: true }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StaleRevisionError);
    expect((await repo.findById(p.id))!.revision).toBe(p.revision + 1);
  });

  it('replaceShareLink deja exactamente un enlace activo y marca el proyecto guardado', async () => {
    const p = await newProject();
    await repo.replaceShareLink(p.id, `tok-${randomUUID()}`);
    const token = `tok-${randomUUID()}`;
    await repo.replaceShareLink(p.id, token);
    expect(await prisma.shareLink.count({ where: { projectId: p.id, revokedAt: null } })).toBe(1);
    expect(await repo.findProjectIdByShareToken(token)).toBe(p.id);
    expect((await repo.findById(p.id))!.saved).toBe(true);
  });

  it('versiones concurrentes reciben números consecutivos sin duplicarse', async () => {
    const p = await newProject();
    const versions = await Promise.all([repo.addVersion(p.id, 'a'), repo.addVersion(p.id, 'b'), repo.addVersion(p.id, 'c')]);
    expect(versions.map((v) => v.number).sort()).toEqual([1, 2, 3]);
  });

  it('existingIds filtra los ids que no existen', async () => {
    const p = await newProject();
    const ghost = randomUUID();
    expect(await repo.existingIds([p.id, ghost])).toEqual([p.id]);
  });
});
