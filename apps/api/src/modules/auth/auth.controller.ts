import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthResponse,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
} from '@interiores/shared-types';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../config/env.js';
import { openApiSchema, ZodPipe } from '../../common/zod.js';
import { APP_CONFIG } from '../../ports/index.js';
import { CurrentUser, Public, type AuthPrincipal } from './auth.decorators.js';
import { AuthService, type SessionResult } from './auth.service.js';

const REFRESH_COOKIE = 'rt';
const COOKIE_PATH = '/api/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiBody({ schema: openApiSchema(RegisterRequestSchema) })
  async register(
    @Body(new ZodPipe(RegisterRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.withCookie(res, await this.auth.register(body, req.get('user-agent')));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiBody({ schema: openApiSchema(LoginRequestSchema) })
  async login(
    @Body(new ZodPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.withCookie(res, await this.auth.login(body, req.get('user-agent')));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    try {
      return this.withCookie(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], req.get('user-agent')));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  me(@CurrentUser() user: AuthPrincipal): Promise<AuthUser> {
    return this.auth.me(user.userId);
  }

  private withCookie(res: Response, session: SessionResult): AuthResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: this.config.REFRESH_TTL_DAYS * 86400_000,
    });
    return session.response;
  }
}
