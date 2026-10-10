import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { perMinute } from '../../common/rate-limit.js';
import { ChatRequestSchema, type ChatRequest, type ChatResponse } from '@interiores/shared-types';
import type { Request } from 'express';
import { openApiSchema, ZodPipe } from '../../common/zod.js';
import { CurrentUser, type AuthPrincipal } from '../auth/auth.decorators.js';
import { ChatService } from './chat.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('chat')
@ApiBearerAuth()
@Controller('projects')
export class ChatController {
  constructor(@Inject(ChatService) private readonly service: ChatService) {}

  /** Mensaje al asistente de diseño: devuelve la respuesta y las operaciones a aplicar (no guarda). */
  @Post(':id/chat')
  @HttpCode(200)
  @Throttle(perMinute(20))
  @ApiBody({ schema: openApiSchema(ChatRequestSchema) })
  chat(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ChatRequestSchema)) body: ChatRequest,
    @Req() req: Request,
  ): Promise<ChatResponse> {
    // Si el usuario cierra la pestaña, se corta la llamada a Claude (no se paga lo que nadie verá).
    const abort = new AbortController();
    req.on('close', () => {
      if (!req.complete) abort.abort();
    });
    return this.service.chat({ userId: user.userId }, id, body, abort.signal);
  }
}
