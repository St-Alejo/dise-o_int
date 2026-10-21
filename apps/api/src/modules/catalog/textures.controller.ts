import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { TEXTURE_MANIFEST_KEY, TextureManifestSchema, type TextureManifest } from '@interiores/shared-types';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { NotFoundError } from '../../common/errors.js';
import { FILE_STORAGE, type IFileStorage } from '../../ports/index.js';
import { Public } from '../auth/auth.decorators.js';

const CACHE_MS = 60_000;
const KEY = /^textures\/[a-z0-9_]+\/(albedo|normal|arm)\.[0-9a-f]{12}\.webp$/;

/**
 * Texturas PBR sembradas: el manifiesto (con URLs listas para la web) y cada imagen. Sin
 * manifiesto (seed sin red) responde un manifiesto vacío y la web dibuja las suyas.
 */
@ApiTags('catalog')
@Controller('textures')
export class TexturesController {
  private cached: { at: number; manifest: TextureManifest } | null = null;

  constructor(@Inject(FILE_STORAGE) private readonly storage: IFileStorage) {}

  @Public()
  @Get()
  async manifest(@Res({ passthrough: true }) res: Response): Promise<TextureManifest> {
    res.setHeader('cache-control', 'public, max-age=300');
    const stored = await this.stored();
    const url = (key: string) => `/api/textures/${key.slice('textures/'.length)}`;
    return {
      ...stored,
      sets: Object.fromEntries(
        Object.entries(stored.sets).map(([asset, set]) => [
          asset,
          { ...set, maps: { albedo: url(set.maps.albedo), normal: url(set.maps.normal), arm: url(set.maps.arm) } },
        ]),
      ),
    };
  }

  @Public()
  @SkipThrottle()
  @Get(':asset/:file')
  async file(@Param('asset') asset: string, @Param('file') file: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const key = `textures/${asset}/${file}`;
    if (!KEY.test(key)) throw new NotFoundError('Textura no encontrada');
    const obj = await this.storage.get(key);
    if (!obj) throw new NotFoundError('Textura no encontrada');
    if (obj.etag && req.headers['if-none-match'] === obj.etag) {
      obj.body.resume();
      res.status(304).end();
      return;
    }
    res.setHeader('content-type', 'image/webp');
    if (obj.contentLength !== undefined) res.setHeader('content-length', String(obj.contentLength));
    if (obj.etag) res.setHeader('etag', obj.etag);
    // La clave lleva el hash del contenido: nunca cambia bajo la misma URL.
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('access-control-allow-origin', '*');
    await pipeline(obj.body, res);
  }

  private async stored(): Promise<TextureManifest> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.manifest;
    const raw = await this.storage.getBuffer(TEXTURE_MANIFEST_KEY).catch(() => null);
    let manifest: TextureManifest = { sets: {}, surfaces: {}, furniture: {}, credits: '' };
    if (raw) {
      const parsed = TextureManifestSchema.safeParse(JSON.parse(raw.toString('utf8')));
      if (parsed.success) manifest = parsed.data;
    }
    this.cached = { at: Date.now(), manifest };
    return manifest;
  }
}
