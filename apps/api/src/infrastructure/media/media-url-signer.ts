import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG } from '../../ports/index.js';

/**
 * URLs firmadas (HMAC) de vida corta para medios privados (fotos, renders).
 * Permiten usar `<img src>` y `<model-viewer>` sin exponer el bucket ni el access token,
 * y funcionan igual detrás de cualquier CDN. Las expiraciones se redondean a la hora para
 * que el navegador pueda cachear la misma URL.
 */
@Injectable()
export class MediaUrlSigner {
  private readonly secret: string;
  private readonly ttl: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.secret = config.MEDIA_SIGNING_SECRET;
    this.ttl = config.MEDIA_URL_TTL_SECONDS;
  }

  sign(key: string, nowMs = Date.now()): string {
    const bucket = 3600;
    const exp = Math.ceil((nowMs / 1000 + this.ttl) / bucket) * bucket;
    const sig = this.signature(key, exp);
    return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
  }

  verify(key: string, exp: number, sig: string, nowMs = Date.now()): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
    const expected = Buffer.from(this.signature(key, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private signature(key: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${key}\n${exp}`).digest('base64url');
  }
}
