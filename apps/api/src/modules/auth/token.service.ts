import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { UnauthorizedError } from '../../common/errors.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { APP_CONFIG } from '../../ports/index.js';
import type { AuthPrincipal } from './auth.decorators.js';

const ISSUER = 'interiores-api';
const AUDIENCE = 'interiores-web';

interface AccessClaims {
  sub: string;
  email: string;
  name: string;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Access token: JWT HS256 de vida corta (en memoria del cliente, nunca en localStorage).
 * Refresh token: valor aleatorio opaco en cookie httpOnly, guardado solo como hash y
 * ROTADO en cada uso. Reutilizar un refresh ya rotado revoca toda la familia (detección de robo).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  signAccess(user: { id: string; email: string; displayName: string }): string {
    const claims: AccessClaims = { sub: user.id, email: user.email, name: user.displayName };
    return this.jwt.sign(claims, {
      secret: this.config.JWT_ACCESS_SECRET,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    });
  }

  verifyAccess(token: string): AuthPrincipal {
    try {
      const claims = this.jwt.verify<AccessClaims>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return { userId: claims.sub, email: claims.email, displayName: claims.name };
    } catch {
      throw new UnauthorizedError('Sesión inválida o expirada');
    }
  }

  async issueRefresh(userId: string, family: string = randomUUID(), userAgent?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        family,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.config.REFRESH_TTL_DAYS * 86400_000),
        userAgent: userAgent?.slice(0, 200) ?? null,
      },
    });
    return token;
  }

  /** Rota el refresh token: devuelve el userId y un token nuevo de la misma familia. */
  async rotateRefresh(token: string, userAgent?: string): Promise<{ userId: string; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record) throw new UnauthorizedError('Sesión expirada, vuelve a iniciar sesión');
    if (record.revokedAt) {
      // Gracia de 10 s: dos pestañas que refrescan a la vez no deben cerrar la sesión de ambas.
      if (Date.now() - record.revokedAt.getTime() < 10_000) {
        throw new UnauthorizedError('Refresco concurrente, reintenta');
      }
      // Un token ya rotado se volvió a usar: posible robo. Se revoca toda la familia.
      await this.revokeFamily(record.family);
      throw new UnauthorizedError('Sesión revocada por seguridad, vuelve a iniciar sesión');
    }
    if (record.expiresAt.getTime() < Date.now()) throw new UnauthorizedError('Sesión expirada, vuelve a iniciar sesión');

    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      // Dos refresh simultáneos con el mismo token: el perdedor se trata como reutilización.
      await this.revokeFamily(record.family);
      throw new UnauthorizedError('Sesión revocada por seguridad, vuelve a iniciar sesión');
    }
    const refreshToken = await this.issueRefresh(record.userId, record.family, userAgent);
    return { userId: record.userId, refreshToken };
  }

  async revokeRefresh(token: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (record) await this.revokeFamily(record.family);
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { family, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
