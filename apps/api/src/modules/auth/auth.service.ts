import { Injectable } from '@nestjs/common';
import type { AuthResponse, AuthUser, LoginRequest, RegisterRequest } from '@interiores/shared-types';
import argon2 from 'argon2';
import { ConflictError, UnauthorizedError } from '../../common/errors.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { TokenService } from './token.service.js';


export interface SessionResult {
  response: AuthResponse;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /**
   * Hash real de una contraseña aleatoria: se verifica contra él cuando el email no existe,
   * para que la latencia sea la misma y no se puedan enumerar usuarios.
   */
  private readonly dummyHash = argon2.hash(`dummy-${Math.random()}`, { type: argon2.argon2id });

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterRequest, userAgent?: string): Promise<SessionResult> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await this.prisma.user.create({
        data: { email: input.email, passwordHash, displayName: input.displayName },
      });
      return this.startSession(user, userAgent);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Ya existe una cuenta con ese email');
      }
      throw err;
    }
  }

  async login(input: LoginRequest, userAgent?: string): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), input.password).catch(() => false);
    if (!user || !valid) throw new UnauthorizedError('Email o contraseña incorrectos');
    return this.startSession(user, userAgent);
  }

  async refresh(refreshToken: string | undefined, userAgent?: string): Promise<SessionResult> {
    if (!refreshToken) throw new UnauthorizedError('No hay sesión activa');
    const rotated = await this.tokens.rotateRefresh(refreshToken, userAgent);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw new UnauthorizedError('La cuenta ya no existe');
    return {
      response: this.buildResponse(user),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefresh(refreshToken);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError('La cuenta ya no existe');
    return { id: user.id, email: user.email, displayName: user.displayName };
  }

  private async startSession(
    user: { id: string; email: string; displayName: string },
    userAgent?: string,
  ): Promise<SessionResult> {
    const refreshToken = await this.tokens.issueRefresh(user.id, undefined, userAgent);
    return { response: this.buildResponse(user), refreshToken };
  }

  private buildResponse(user: { id: string; email: string; displayName: string }): AuthResponse {
    return {
      accessToken: this.tokens.signAccess(user),
      expiresIn: this.tokens.accessTtlSeconds,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }
}
