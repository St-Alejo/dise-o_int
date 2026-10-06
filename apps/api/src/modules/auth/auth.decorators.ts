import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthPrincipal {
  userId: string;
  email: string;
  displayName: string;
}

export type AuthenticatedRequest = Request & { user?: AuthPrincipal; id?: string | number };

export const IS_PUBLIC = 'isPublic';
/** Marca un endpoint como accesible sin autenticación (el guard JWT es global). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthPrincipal => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.user) throw new Error('CurrentUser usado en una ruta pública');
  return req.user;
});

/** Id de la petición (lo asigna pino-http); se propaga a jobs y a la IA para correlacionar logs. */
export const RequestId = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const id = ctx.switchToHttp().getRequest<AuthenticatedRequest>().id;
  return id === undefined ? undefined : String(id);
});
