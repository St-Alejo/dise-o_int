import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import { FILE_STORAGE, type IFileStorage } from '../../ports/index.js';
import { Public } from '../auth/auth.decorators.js';

/**
 * Sirve medios privados (foto original, thumbnails, renders) mediante URLs firmadas.
 * El bucket nunca se expone; la firma limita el acceso a la clave concreta y por tiempo.
 */
@ApiExcludeController()
@Controller('media')
export class MediaController {
  constructor(
    private readonly signer: MediaUrlSigner,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('*key')
  async get(
    @Param('key') keyParam: string | string[],
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const key = Array.isArray(keyParam) ? keyParam.join('/') : keyParam;
    if (!key.startsWith('projects/') || key.includes('..')) throw new NotFoundError('Archivo no encontrado');
    if (!sig || !this.signer.verify(key, Number(exp), sig)) throw new ForbiddenError('Enlace inválido o expirado');

    const obj = await this.storage.get(key);
    if (!obj) throw new NotFoundError('Archivo no encontrado');
    res.setHeader('content-type', obj.contentType);
    if (obj.contentLength !== undefined) res.setHeader('content-length', String(obj.contentLength));
    if (obj.etag) res.setHeader('etag', obj.etag);
    const remaining = Math.max(0, Number(exp) - Math.floor(Date.now() / 1000));
    res.setHeader('cache-control', `private, max-age=${Math.min(remaining, 3600)}`);
    res.setHeader('x-content-type-options', 'nosniff');
    await pipeline(obj.body, res);
  }
}
