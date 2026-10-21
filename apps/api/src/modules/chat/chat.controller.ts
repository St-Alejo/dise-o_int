import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { perMinute } from '../../common/rate-limit.js';
import { ChatRequestSchema, type ChatRequest, type ChatResponse } from '@interiores/shared-types';
import type { Request } from 'express';
import { ValidationError } from '../../common/errors.js';
import { openApiSchema, ZodPipe } from '../../common/zod.js';
import { CurrentUser, type AuthPrincipal } from '../auth/auth.decorators.js';
import { ChatService } from './chat.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });
/** Tope duro de Multer; el configurable (UPLOAD_MAX_MB) lo aplica PhotoProcessor. */
const MULTER_HARD_LIMIT = 50 * 1024 * 1024;

/** Si el usuario cierra la pestaña, se corta la llamada al modelo (no se paga lo que nadie verá). */
function abortOnClose(req: Request): AbortSignal {
  const abort = new AbortController();
  req.on('close', () => {
    if (!req.complete) abort.abort();
  });
  return abort.signal;
}

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
    return this.service.chat({ userId: user.userId }, id, body, abortOnClose(req));
  }

  /** Imagen de referencia ("hazlo como esta foto"): la lee, fija lo visto y pide una propuesta. */
  @Post(':id/chat/reference')
  @HttpCode(200)
  @Throttle(perMinute(6))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['image', 'revision'], properties: { image: { type: 'string', format: 'binary' }, revision: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MULTER_HARD_LIMIT, files: 1, fields: 2 } }))
  reference(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Body() body: { revision?: string },
    @Req() req: Request,
  ): Promise<ChatResponse> {
    if (!image) throw new ValidationError('Adjunta una imagen');
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 0) throw new ValidationError('Falta la revisión del proyecto');
    return this.service.fromReference({ userId: user.userId }, id, revision, image.buffer, abortOnClose(req));
  }
}
