import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CatalogQuerySchema, type CatalogItem, type CatalogQuery, type CatalogSearchResponse } from '@interiores/shared-types';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { NotFoundError } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.js';
import { CATALOG_REPOSITORY, FILE_STORAGE, type ICatalogRepository, type IFileStorage } from '../../ports/index.js';
import { Public } from '../auth/auth.decorators.js';
import { CatalogService, toCatalogItem } from './catalog.service.js';

export { catalogSource, toCatalogItem } from './catalog.service.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: ICatalogRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    @Inject(CatalogService) private readonly service: CatalogService,
  ) {}

  @Public()
  @Get()
  async list(@Query(new ZodPipe(CatalogQuerySchema)) query: CatalogQuery, @Res({ passthrough: true }) res: Response): Promise<CatalogItem[]> {
    res.setHeader('cache-control', 'public, max-age=60');
    return this.service.list(query);
  }

  /** Búsqueda paginada (texto sin acentos, sinónimos es/en, tolerante a errores) + filtros. */
  @Public()
  @Get('search')
  async search(
    @Query(new ZodPipe(CatalogQuerySchema)) query: CatalogQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CatalogSearchResponse> {
    res.setHeader('cache-control', 'public, max-age=60');
    return this.service.search(query);
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
