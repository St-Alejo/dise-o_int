/**
 * Autenticación: registro/login con argon2, rotación del refresh token y revocación de
 * toda la familia cuando se reutiliza un token ya rotado (detección de robo).
 * Prisma se sustituye por un doble en memoria con solo las operaciones que usa el servicio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ConflictError, UnauthorizedError } from '../src/common/errors.js';
import type { AppConfig } from '../src/config/env.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TokenService } from '../src/modules/auth/token.service.js';

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}
interface TokenRow {
  id: string;
  userId: string;
  family: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
}

class FakePrisma {
  users: UserRow[] = [];
  tokens: TokenRow[] = [];

  user = {
    create: async ({ data }: { data: Omit<UserRow, 'id'> }) => {
      if (this.users.some((u) => u.email === data.email)) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
      }
      const row = { id: randomUUID(), ...data };
      this.users.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      this.users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
  };

  refreshToken = {
    create: async ({ data }: { data: Omit<TokenRow, 'id' | 'revokedAt'> }) => {
      const row = { id: randomUUID(), revokedAt: null, ...data };
      this.tokens.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      this.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    updateMany: async ({ where, data }: { where: { id?: string; family?: string; revokedAt: null }; data: { revokedAt: Date } }) => {
      const rows = this.tokens.filter(
        (t) => t.revokedAt === null && (where.id ? t.id === where.id : true) && (where.family ? t.family === where.family : true),
      );
      rows.forEach((t) => (t.revokedAt = data.revokedAt));
      return { count: rows.length };
    },
  };
}

const config = {
  JWT_ACCESS_SECRET: 's'.repeat(40),
  JWT_ACCESS_TTL_SECONDS: 900,
  REFRESH_TTL_DAYS: 30,
} as unknown as AppConfig;

describe('AuthService + TokenService', () => {
  let prisma: FakePrisma;
  let tokens: TokenService;
  let auth: AuthService;
  const creds = { email: 'ana@example.com', password: 'clave-segura-1', displayName: 'Ana' };

  beforeEach(() => {
    prisma = new FakePrisma();
    tokens = new TokenService(new JwtService(), prisma as never, config);
    auth = new AuthService(prisma as never, tokens);
  });
  afterEach(() => vi.useRealTimers());

  it('registra con hash argon2 (nunca la contraseña en claro) y emite un access token válido', async () => {
    const session = await auth.register(creds);
    expect(prisma.users[0]!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(prisma.users[0]!.passwordHash).not.toContain(creds.password);
    expect(tokens.verifyAccess(session.response.accessToken)).toMatchObject({ email: creds.email, displayName: 'Ana' });
    // El refresh se guarda solo como hash.
    expect(prisma.tokens[0]!.tokenHash).not.toBe(session.refreshToken);
  });

  it('rechaza un email repetido con 409', async () => {
    await auth.register(creds);
    await expect(auth.register(creds)).rejects.toBeInstanceOf(ConflictError);
  });

  it('login: misma respuesta genérica para email inexistente y contraseña incorrecta', async () => {
    await auth.register(creds);
    const wrongPass = auth.login({ email: creds.email, password: 'otra-clave' });
    const noUser = auth.login({ email: 'nadie@example.com', password: 'otra-clave' });
    await expect(wrongPass).rejects.toThrow('Email o contraseña incorrectos');
    await expect(noUser).rejects.toThrow('Email o contraseña incorrectos');
    await expect(auth.login({ email: creds.email, password: creds.password })).resolves.toHaveProperty('refreshToken');
  });

  it('rota el refresh token en cada uso: el anterior queda revocado y el nuevo es de la misma familia', async () => {
    const { refreshToken } = await auth.register(creds);
    const rotated = await auth.refresh(refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);
    expect(prisma.tokens).toHaveLength(2);
    expect(prisma.tokens[0]!.revokedAt).not.toBeNull();
    expect(prisma.tokens[1]!.family).toBe(prisma.tokens[0]!.family);
    await expect(auth.refresh(rotated.refreshToken)).resolves.toHaveProperty('refreshToken');
  });

  it('reutilizar un refresh ya rotado (fuera de la gracia de 10 s) revoca TODA la familia', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    const { refreshToken: stolen } = await auth.register(creds);
    const legit = await auth.refresh(stolen);

    vi.setSystemTime(new Date('2026-03-01T10:00:30Z'));
    await expect(auth.refresh(stolen)).rejects.toThrow(/revocada por seguridad/);
    // El token legítimo (el más nuevo) también deja de servir.
    await expect(auth.refresh(legit.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(prisma.tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('dentro de la gracia de 10 s un refresco concurrente no cierra la sesión', async () => {
    const { refreshToken } = await auth.register(creds);
    const legit = await auth.refresh(refreshToken);
    await expect(auth.refresh(refreshToken)).rejects.toThrow(/concurrente/);
    await expect(auth.refresh(legit.refreshToken)).resolves.toHaveProperty('refreshToken');
  });

  it('un refresh expirado o desconocido se rechaza', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    const { refreshToken } = await auth.register(creds);
    vi.setSystemTime(new Date('2026-05-01T10:00:00Z'));
    await expect(auth.refresh(refreshToken)).rejects.toThrow(/expirada/);
    await expect(auth.refresh('no-existe')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.refresh(undefined)).rejects.toThrow(/No hay sesión/);
  });

  it('logout revoca la familia completa', async () => {
    const { refreshToken } = await auth.register(creds);
    const rotated = await auth.refresh(refreshToken);
    await auth.logout(rotated.refreshToken);
    expect(prisma.tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('un access token manipulado o firmado con otro secreto se rechaza', async () => {
    const { response } = await auth.register(creds);
    const [h, p, sig] = response.accessToken.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'otro', email: 'x', name: 'x' })).toString('base64url')}.${sig}`;
    expect(() => tokens.verifyAccess(tampered)).toThrow(UnauthorizedError);
    const other = new TokenService(new JwtService(), prisma as never, { ...config, JWT_ACCESS_SECRET: 'o'.repeat(40) } as AppConfig);
    expect(() => other.verifyAccess(`${h}.${p}.${sig}`)).toThrow(UnauthorizedError);
  });
});
