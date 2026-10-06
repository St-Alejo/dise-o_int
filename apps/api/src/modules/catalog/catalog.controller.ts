import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CatalogQuerySchema, type CatalogItem, type CatalogQuery } from '@interiores/shared-types';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { NotFoundError } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.js';
import {
  CATALOG_REPOSITORY,
  FILE_STORAGE,
  type CatalogRecord,
  type ICatalogRepository,
  type IFileStorage,
} from '../../ports/index.js';
import { Public } from '../auth/auth.decorators.js';

/** La clave del modelo incluye un hash de contenido → la URL es inmutable y cacheable 1 año. */
function modelVersion(modelKey: string): string {
  return modelKey.match(/\.([0-9a-f]{8,})\.glb$/)?.[1] ?? '0';
}

export function toCatalogItem(r: CatalogRecord): CatalogItem {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    ...(r.subcategory ? { subcategory: r.subcategory } : {}),
    styleTags: r.styleTags,
    roomTypes: r.roomTypes,
    dimensionsM: { x: r.widthM, y: r.heightM, z: r.depthM },
    mount: r.mount,
    modelUrl: `/api/catalog/${encodeURIComponent(r.id)}/model.glb?v=${modelVersion(r.modelKey)}`,
    ...(r.thumbnailKey ? { thumbnailUrl: `/api/catalog/${encodeURIComponent(r.id)}/thumbnail?v=${modelVersion(r.modelKey)}` } : {}),
    ...(r.price !== null ? { price: r.price } : {}),
    currency: r.currency,
    ...(r.productUrl ? { productUrl: r.productUrl } : {}),
    license: r.license,
    ...(r.attribution ? { attribution: r.attribution } : {}),
    tags: r.tags,
    synonyms: r.synonyms,
    ...(r.description ? { description: r.description } : {}),
    source: catalogSource(r.source),
    ...r.spec,
  };
}

/** En la base de datos `source` es "polyhaven:asset" o "procedural:kind"; la API expone solo la familia. */
export function catalogSource(source: string): CatalogItem['source'] {
  const family = source.split(':')[0];
  return family === 'polyhaven' || family === 'parametric' ? family : 'procedural';
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: ICatalogRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
  ) {}

  @Public()
  @Get()
  async search(@Query(new ZodPipe(CatalogQuerySchema)) query: CatalogQuery, @Res({ passthrough: true }) res: Response): Promise<CatalogItem[]> {
    res.setHeader('cache-control', 'public, max-age=60');
    return (await this.catalog.search(query)).map(toCatalogItem);
  }

  @Public()
  @Get(':id')
  async get(@Param('id') id: string): Promise<CatalogItem> {
    const item = await this.catalog.findById(id);
    if (!item?.active) throw new NotFoundError('El mueble no existe');
    return toCatalogItem(item);
  }

  @Public()
  @SkipThrottle()
  @Get(':id/model.glb')
  async model(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const item = await this.catalog.findById(id);
    if (!item) throw new NotFoundError('El mueble no existe');
    await this.stream(item.modelKey, req, res, 'model/gltf-binary');
  }

  @Public()
  @SkipThrottle()
  @Get(':id/thumbnail')
  async thumbnail(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const item = await this.catalog.findById(id);
    if (!item?.thumbnailKey) throw new NotFoundError('Sin miniatura');
    await this.stream(item.thumbnailKey, req, res, 'image/webp');
  }

  private async stream(key: string, req: Request, res: Response, fallbackType: string): Promise<void> {
    const obj = await this.storage.get(key);
    if (!obj) throw new NotFoundError('Archivo no encontrado');
    if (obj.etag && req.headers['if-none-match'] === obj.etag) {
      obj.body.resume();
      res.status(304).end();
      return;
    }
    res.setHeader('content-type', obj.contentType || fallbackType);
    if (obj.contentLength !== undefined) res.setHeader('content-length', String(obj.contentLength));
    if (obj.etag) res.setHeader('etag', obj.etag);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('access-control-allow-origin', '*');
    await pipeline(obj.body, res);
  }
}
