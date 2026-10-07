import { Injectable } from '@nestjs/common';
import {
  CatalogSpecSchema,
  MountSchema,
  type CatalogCategory,
  type CatalogFilters,
  type CatalogSpec,
  type RoomType,
  type StyleId,
} from '@interiores/shared-types';
import { Prisma, type CatalogItem as CatalogRow } from '../../generated/prisma/client.js';
import type { CatalogRecord, ICatalogRepository } from '../../ports/index.js';
import { PrismaService } from './prisma.service.js';

/** Un spec corrupto no debe tumbar el catálogo entero: el ítem queda como no personalizable. */
function parseSpec(value: unknown): CatalogSpec | null {
  if (value === null || value === undefined) return null;
  const parsed = CatalogSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toRecord(row: CatalogRow): CatalogRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category as CatalogCategory,
    subcategory: row.subcategory,
    styleTags: row.styleTags as StyleId[],
    roomTypes: row.roomTypes as RoomType[],
    widthM: row.widthM,
    heightM: row.heightM,
    depthM: row.depthM,
    mount: MountSchema.catch('floor').parse(row.mount),
    modelKey: row.modelKey,
    thumbnailKey: row.thumbnailKey,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
    license: row.license as CatalogRecord['license'],
    attribution: row.attribution,
    source: row.source,
    tags: row.tags,
    synonyms: row.synonyms,
    description: row.description,
    spec: parseSpec(row.spec),
    active: row.active,
  };
}

@Injectable()
export class PrismaCatalogRepository implements ICatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<CatalogRecord[]> {
    const rows = await this.prisma.catalogItem.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    return rows.map(toRecord);
  }

  async search(query: CatalogFilters): Promise<CatalogRecord[]> {
    const where: Prisma.CatalogItemWhereInput = { active: true };
    if (query.category) where.category = query.category;
    if (query.style) where.styleTags = { has: query.style };
    if (query.roomType) where.roomTypes = { has: query.roomType };
    if (query.mount) where.mount = query.mount;
    if (query.q) {
      const term = query.q.toLowerCase();
      where.OR = [{ name: { contains: query.q, mode: 'insensitive' } }, { tags: { has: term } }, { synonyms: { has: term } }];
    }
    const rows = await this.prisma.catalogItem.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], take: 500 });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<CatalogRecord | null> {
    const row = await this.prisma.catalogItem.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<CatalogRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.catalogItem.findMany({ where: { id: { in: [...new Set(ids)] } } });
    return rows.map(toRecord);
  }

  async upsert(item: CatalogRecord): Promise<void> {
    const { id, spec, ...rest } = item;
    const data = { ...rest, spec: spec === null ? Prisma.DbNull : (spec as Prisma.InputJsonValue) };
    await this.prisma.catalogItem.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  async count(): Promise<number> {
    return this.prisma.catalogItem.count({ where: { active: true } });
  }
}
