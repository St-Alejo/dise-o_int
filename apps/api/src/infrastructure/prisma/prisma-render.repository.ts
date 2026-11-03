import { Injectable } from '@nestjs/common';
import { Prisma, type Render as RenderRow } from '../../generated/prisma/client.js';
import { RenderSpecSchema, type PhotorealFidelity, type RenderKind, type RenderMediaType } from '@interiores/shared-types';
import type { IRenderRepository, NewRender, RenderPatch, RenderRecord } from '../../ports/index.js';
import { PrismaService } from './prisma.service.js';

function toRecord(row: RenderRow): RenderRecord {
  const spec = row.spec === null ? null : RenderSpecSchema.safeParse(row.spec);
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as RenderKind,
    status: row.status,
    mediaType: (row.mediaType as RenderMediaType | null) ?? null,
    fileKey: row.fileKey,
    spec: spec?.success ? spec.data : null,
    sourceRenderId: row.sourceRenderId,
    fidelity: (row.fidelity as PhotorealFidelity | null) ?? null,
    provider: row.provider,
    cacheKey: row.cacheKey,
    shared: row.shared,
    error: row.error,
    createdAt: row.createdAt,
  };
}

/** Galería del estudio de render en PostgreSQL (tabla `renders`). */
@Injectable()
export class PrismaRenderRepository implements IRenderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewRender): Promise<RenderRecord> {
    const row = await this.prisma.render.create({
      data: { ...data, spec: data.spec === null ? Prisma.DbNull : (data.spec as Prisma.InputJsonValue) },
    });
    return toRecord(row);
  }

  async findById(projectId: string, id: string): Promise<RenderRecord | null> {
    const row = await this.prisma.render.findFirst({ where: { id, projectId } });
    return row ? toRecord(row) : null;
  }

  async listByProject(projectId: string, opts: { sharedOnly?: boolean } = {}): Promise<RenderRecord[]> {
    const rows = await this.prisma.render.findMany({
      where: { projectId, ...(opts.sharedOnly ? { shared: true, status: 'ready' } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async findByCacheKey(projectId: string, cacheKey: string): Promise<RenderRecord | null> {
    const row = await this.prisma.render.findFirst({ where: { projectId, cacheKey }, orderBy: { createdAt: 'desc' } });
    return row ? toRecord(row) : null;
  }

  async update(id: string, patch: RenderPatch): Promise<RenderRecord> {
    return toRecord(await this.prisma.render.update({ where: { id }, data: patch }));
  }

  async delete(id: string): Promise<void> {
    await this.prisma.render.deleteMany({ where: { id } });
  }

  countByProject(projectId: string): Promise<number> {
    return this.prisma.render.count({ where: { projectId } });
  }

  async listPending(provider: string): Promise<RenderRecord[]> {
    const rows = await this.prisma.render.findMany({ where: { provider, status: 'pending' }, orderBy: { createdAt: 'asc' } });
    return rows.map(toRecord);
  }
}
