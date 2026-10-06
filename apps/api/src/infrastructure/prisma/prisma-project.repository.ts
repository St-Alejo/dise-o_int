import { Injectable } from '@nestjs/common';
import {
  FurniturePlacementSchema,
  RoomDimensionsSchema,
  RoomFinishesSchema,
  RoomShellSchema,
  type FurniturePlacement,
  type RoomDimensions,
  type RoomFinishes,
  type RoomShell,
  type RoomType,
  type StyleId,
} from '@interiores/shared-types';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  Project as ProjectRow,
  ProjectVersion as VersionRow,
  StylePreview as PreviewRow,
} from '../../generated/prisma/client.js';
import { NotFoundError, StaleRevisionError } from '../../common/errors.js';
import type {
  IProjectRepository,
  PreviewRecord,
  ProjectPatch,
  ProjectRecord,
  UpdateOptions,
  VersionRecord,
} from '../../ports/index.js';
import { PrismaService } from './prisma.service.js';

const PlacementsSchema = z.array(FurniturePlacementSchema);

/** Lee JSONB validándolo: si la fila está corrupta preferimos un error claro a datos inválidos. */
function parseShell(value: unknown): RoomShell | null {
  return value === null || value === undefined ? null : RoomShellSchema.parse(value);
}
function parsePlacements(value: unknown): FurniturePlacement[] {
  return PlacementsSchema.parse(value ?? []);
}
function parseFinishes(value: unknown): RoomFinishes | null {
  return value === null || value === undefined ? null : RoomFinishesSchema.parse(value);
}
function parseRoomDims(value: unknown): RoomDimensions | null {
  return value === null || value === undefined ? null : RoomDimensionsSchema.parse(value);
}
/** null de dominio → NULL de SQL (Prisma distingue DbNull de JsonNull). */
function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    roomType: row.roomType as RoomType,
    status: row.status,
    lastError: row.lastError,
    photoKey: row.photoKey,
    photoHash: row.photoHash,
    thumbKey: row.thumbKey,
    roomShell: parseShell(row.roomShell),
    placements: parsePlacements(row.placements),
    finishes: parseFinishes(row.finishes),
    requestedRoom: parseRoomDims(row.requestedRoom),
    selectedStyleId: row.selectedStyleId as StyleId | null,
    requestedStyles: row.requestedStyles as StyleId[],
    saved: row.saved,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVersion(row: VersionRow): VersionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    note: row.note,
    roomShell: parseShell(row.roomShell),
    placements: parsePlacements(row.placements),
    finishes: parseFinishes(row.finishes),
    selectedStyleId: row.selectedStyleId as StyleId | null,
    createdAt: row.createdAt,
  };
}

function toPreview(row: PreviewRow): PreviewRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    styleId: row.styleId as StyleId,
    promptStrength: row.promptStrength,
    status: row.status,
    imageKey: row.imageKey,
    cacheKey: row.cacheKey,
    provider: row.provider,
    error: row.error,
    createdAt: row.createdAt,
  };
}

function patchToData(patch: ProjectPatch): Prisma.ProjectUpdateManyMutationInput {
  const data: Prisma.ProjectUpdateManyMutationInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.lastError !== undefined) data.lastError = patch.lastError;
  if (patch.photoKey !== undefined) data.photoKey = patch.photoKey;
  if (patch.photoHash !== undefined) data.photoHash = patch.photoHash;
  if (patch.thumbKey !== undefined) data.thumbKey = patch.thumbKey;
  if (patch.roomShell !== undefined) data.roomShell = patch.roomShell === null ? Prisma.DbNull : toJson(patch.roomShell);
  if (patch.placements !== undefined) data.placements = toJson(patch.placements);
  if (patch.finishes !== undefined) data.finishes = nullableJson(patch.finishes);
  if (patch.requestedRoom !== undefined) data.requestedRoom = nullableJson(patch.requestedRoom);
  if (patch.selectedStyleId !== undefined) data.selectedStyleId = patch.selectedStyleId;
  if (patch.requestedStyles !== undefined) data.requestedStyles = patch.requestedStyles;
  if (patch.saved !== undefined) data.saved = patch.saved;
  return data;
}

@Injectable()
export class PrismaProjectRepository implements IProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Omit<ProjectRecord, 'createdAt' | 'updatedAt' | 'revision' | 'lastError'>): Promise<ProjectRecord> {
    const row = await this.prisma.project.create({
      data: {
        id: data.id,
        ownerId: data.ownerId,
        name: data.name,
        roomType: data.roomType,
        status: data.status,
        photoKey: data.photoKey,
        photoHash: data.photoHash,
        thumbKey: data.thumbKey,
        roomShell: data.roomShell ? toJson(data.roomShell) : Prisma.DbNull,
        placements: toJson(data.placements),
        finishes: nullableJson(data.finishes),
        requestedRoom: nullableJson(data.requestedRoom),
        selectedStyleId: data.selectedStyleId,
        requestedStyles: data.requestedStyles,
        saved: data.saved,
      },
    });
    return toProject(row);
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row ? toProject(row) : null;
  }

  async listByOwner(ownerId: string): Promise<ProjectRecord[]> {
    const rows = await this.prisma.project.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' }, take: 200 });
    return rows.map(toProject);
  }

  async update(id: string, patch: ProjectPatch, opts: UpdateOptions = {}): Promise<ProjectRecord> {
    const data = patchToData(patch);
    if (opts.bumpRevision) data.revision = { increment: 1 };
    // updateMany permite condicionar por revisión de forma atómica (optimistic locking).
    const where: Prisma.ProjectWhereInput = { id };
    if (opts.expectedRevision !== undefined) where.revision = opts.expectedRevision;
    const { count } = await this.prisma.project.updateMany({ where, data });
    if (count === 0) {
      const exists = await this.prisma.project.count({ where: { id } });
      if (!exists) throw new NotFoundError('El proyecto no existe');
      throw new StaleRevisionError('Otra pestaña o el generador modificó el proyecto; recarga para continuar.');
    }
    const row = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    return toProject(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.project.deleteMany({ where: { id } });
  }

  async addVersion(projectId: string, note: string | null): Promise<VersionRecord> {
    // El número de versión se calcula dentro de una transacción serializable; si dos
    // guardados compiten, la restricción única (projectId, number) hace fallar a uno y se reintenta.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
          const last = await tx.projectVersion.findFirst({ where: { projectId }, orderBy: { number: 'desc' } });
          const version = await tx.projectVersion.create({
            data: {
              projectId,
              number: (last?.number ?? 0) + 1,
              note,
              roomShell: project.roomShell === null ? Prisma.DbNull : toJson(project.roomShell),
              placements: toJson(project.placements),
              finishes: project.finishes === null ? Prisma.DbNull : toJson(project.finishes),
              selectedStyleId: project.selectedStyleId,
            },
          });
          await tx.project.update({ where: { id: projectId }, data: { saved: true } });
          return version;
        });
        return toVersion(row);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) continue;
        throw err;
      }
    }
    throw new Error('unreachable');
  }

  async listVersions(projectId: string): Promise<VersionRecord[]> {
    const rows = await this.prisma.projectVersion.findMany({ where: { projectId }, orderBy: { number: 'desc' } });
    return rows.map(toVersion);
  }

  async getVersion(projectId: string, versionId: string): Promise<VersionRecord | null> {
    const row = await this.prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
    return row ? toVersion(row) : null;
  }

  async createPreview(data: Omit<PreviewRecord, 'id' | 'createdAt' | 'error'>): Promise<PreviewRecord> {
    const row = await this.prisma.stylePreview.create({ data });
    return toPreview(row);
  }

  async updatePreview(
    id: string,
    patch: Partial<Pick<PreviewRecord, 'status' | 'imageKey' | 'provider' | 'error'>>,
  ): Promise<PreviewRecord> {
    const row = await this.prisma.stylePreview.update({ where: { id }, data: patch });
    return toPreview(row);
  }

  async listPreviews(projectId: string): Promise<PreviewRecord[]> {
    const rows = await this.prisma.stylePreview.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toPreview);
  }

  async findPreviewByCacheKey(projectId: string, cacheKey: string): Promise<PreviewRecord | null> {
    const row = await this.prisma.stylePreview.findFirst({
      where: { projectId, cacheKey, status: { in: ['ready', 'pending'] } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toPreview(row) : null;
  }

  async createShareLink(projectId: string, token: string): Promise<void> {
    await this.prisma.shareLink.create({ data: { projectId, token } });
  }

  async replaceShareLink(projectId: string, token: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.shareLink.updateMany({ where: { projectId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.shareLink.create({ data: { projectId, token } }),
      // Compartir implica querer conservarlo: deja de estar sujeto a la limpieza por retención.
      this.prisma.project.update({ where: { id: projectId }, data: { saved: true } }),
    ]);
  }

  async revokeShareLinks(projectId: string): Promise<void> {
    await this.prisma.shareLink.updateMany({ where: { projectId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async hasActiveShareLink(projectId: string): Promise<boolean> {
    return (await this.prisma.shareLink.count({ where: { projectId, revokedAt: null } })) > 0;
  }

  async findProjectIdByShareToken(token: string): Promise<string | null> {
    const link = await this.prisma.shareLink.findUnique({ where: { token } });
    return link && !link.revokedAt ? link.projectId : null;
  }

  async listExpiredUnsaved(before: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { saved: false, createdAt: { lt: before } },
      select: { id: true },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  async existingIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async auditJob(entry: Parameters<IProjectRepository['auditJob']>[0]): Promise<void> {
    if (entry.status === 'started') {
      await this.prisma.jobAudit.create({
        data: {
          projectId: entry.projectId,
          jobId: entry.jobId,
          kind: entry.kind,
          status: 'started',
          attempts: entry.attempts,
          requestId: entry.requestId ?? null,
        },
      });
      return;
    }
    await this.prisma.jobAudit.updateMany({
      where: { jobId: entry.jobId, projectId: entry.projectId, finishedAt: null },
      data: {
        status: entry.status,
        attempts: entry.attempts,
        error: entry.error?.slice(0, 2000) ?? null,
        finishedAt: new Date(),
        durationMs: entry.durationMs ?? null,
      },
    });
  }
}
