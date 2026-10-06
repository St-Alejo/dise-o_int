import { Injectable } from '@nestjs/common';
import type { CatalogCategory, CatalogQuery, RoomType, StyleId } from '@interiores/shared-types';
import type { CatalogItem as CatalogRow, Prisma } from '../../generated/prisma/client.js';
import type { CatalogRecord, ICatalogRepository } from '../../ports/index.js';
import { PrismaService } from './prisma.service.js';

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
    mount: row.mount === 'ceiling' ? 'ceiling' : 'floor',
    modelKey: row.modelKey,
    thumbnailKey: row.thumbnailKey,
    price: row.price,
    currency: row.currency,
    productUrl: row.productUrl,
    license: row.license as CatalogRecord['license'],
    attribution: row.attribution,
    source: row.source,
    active: row.active,
  };
}

@Injectable()
export class PrismaCatalogRepository implements ICatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: CatalogQuery): Promise<CatalogRecord[]> {
    const where: Prisma.CatalogItemWhereInput = { active: true };
    if (query.category) where.category = query.category;
    if (query.style) where.styleTags = { has: query.style };
    if (query.roomType) where.roomTypes = { has: query.roomType };
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
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
    const { id, ...rest } = item;
    await this.prisma.catalogItem.upsert({ where: { id }, create: item, update: rest });
  }

  async count(): Promise<number> {
    return this.prisma.catalogItem.count({ where: { active: true } });
  }
}
