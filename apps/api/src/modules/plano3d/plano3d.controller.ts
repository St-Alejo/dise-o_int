import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { perMinute } from '../../common/rate-limit.js';
import { ZodPipe } from '../../common/zod.js';
import { CurrentUser, RequestId, type AuthPrincipal } from '../auth/auth.decorators.js';
import { Plano3dService, type Plano3dLinkSummary } from './plano3d.service.js';

const LinkRequestSchema = z.object({ code: z.string().trim().min(6).max(20) });
type LinkRequest = z.infer<typeof LinkRequestSchema>;
const uuid = new ParseUUIDPipe({ version: '4' });

/** Casas de Plano 3D enlazadas por código (ADR-0039). */
@ApiTags('plano3d')
@ApiBearerAuth()
@Controller('plano3d/links')
export class Plano3dController {
  constructor(private readonly service: Plano3dService) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal): Promise<Plano3dLinkSummary[]> {
    return this.service.list({ userId: user.userId });
  }

  @Post()
  @Throttle(perMinute(10))
  link(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Body(new ZodPipe(LinkRequestSchema)) body: LinkRequest,
  ): Promise<Plano3dLinkSummary> {
    return this.service.link({ userId: user.userId, requestId }, body.code);
  }

  @Post(':linkId/sync')
  @Throttle(perMinute(20))
  sync(@CurrentUser() user: AuthPrincipal, @Param('linkId', uuid) linkId: string): Promise<Plano3dLinkSummary> {
    return this.service.refresh({ userId: user.userId }, linkId);
  }

  @Delete(':linkId')
  @HttpCode(204)
  async unlink(@CurrentUser() user: AuthPrincipal, @Param('linkId', uuid) linkId: string): Promise<void> {
    await this.service.unlink({ userId: user.userId }, linkId);
  }
}
