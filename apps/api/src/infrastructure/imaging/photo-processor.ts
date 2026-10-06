import { Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { PayloadTooLargeError, UnsupportedMediaError, ValidationError } from '../../common/errors.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PIXELS = 40_000_000;
const MIN_SIDE = 320;
const MAX_SIDE = 2048;

export interface ProcessedPhoto {
  photo: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
  /** sha256 de la imagen normalizada: base del caché de generaciones. */
  hash: string;
}

/**
 * Normaliza una foto subida:
 *  - valida el tipo REAL por magic bytes (no se confía en la extensión ni en el Content-Type),
 *  - rechaza bombas de descompresión (límite de píxeles),
 *  - aplica la orientación EXIF y ELIMINA todos los metadatos (GPS incluido: privacidad),
 *  - reduce a 2048 px el lado mayor y genera un thumbnail WebP.
 */
@Injectable()
export class PhotoProcessor {
  async process(input: Buffer, maxBytes: number): Promise<ProcessedPhoto> {
    if (input.length > maxBytes) {
      throw new PayloadTooLargeError(`La foto supera ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    const type = await fileTypeFromBuffer(input);
    if (!type || !ALLOWED_MIME.has(type.mime)) {
      throw new UnsupportedMediaError('Sube una foto JPG, PNG o WebP');
    }

    let meta: Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new UnsupportedMediaError('La imagen está dañada o es demasiado grande');
    }
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE) {
      throw new ValidationError(`La foto es muy pequeña (mínimo ${MIN_SIDE}px por lado)`);
    }

    // sharp NO copia metadatos a la salida salvo que se pida con keepMetadata(): EXIF/GPS/XMP se descartan.
    const base = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
    const { data: photo, info } = await base
      .clone()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await base
      .clone()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();

    return {
      photo,
      thumbnail,
      width: info.width,
      height: info.height,
      hash: createHash('sha256').update(photo).digest('hex'),
    };
  }
}
