import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CreateBlenderRenderFieldsSchema,
  CreateRenderFieldsSchema,
  UpdateRenderRequestSchema,
  type CreateBlenderRenderFields,
  type CreateRenderFields,
  type Render,
  type RenderNodeStatus,
  type UpdateRenderRequest,
} from '@interiores/shared-types';
import { perMinute } from '../../common/rate-limit.js';
import { openApiSchema, ZodPipe } from '../../common/zod.js';
import { CurrentUser, RequestId, type AuthPrincipal } from '../auth/auth.decorators.js';
import { BlenderRendersService } from './blender-renders.service.js';
import { RendersService } from './renders.service.js';

/** Tope duro de Multer; el configurable (RENDERS_MAX_MB) lo aplica el servicio. */
const MULTER_HARD_LIMIT = 200 * 1024 * 1024;
const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('renders')
@ApiBearerAuth()
@Controller('projects/:id/renders')
export class RendersController {
  constructor(
    private readonly service: RendersService,
    private readonly blender: BlenderRendersService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<Render[]> {
    return this.service.list({ userId: user.userId }, id);
  }

  @Post()
  @Throttle(perMinute(20))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'PNG/JPEG del estudio o MP4/WebM del recorrido' },
        kind: { type: 'string', enum: ['path', 'video'] },
        spec: { type: 'string', description: 'RenderSpec como JSON' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT, files: 1, fields: 4 } }))
  upload(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateRenderFieldsSchema)) fields: CreateRenderFields,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<Render> {
    return this.service.upload({ userId: user.userId, requestId }, id, fields, file?.buffer);
  }

  /** Render fotorrealista en el nodo Blender: la web manda la escena .glb y el nodo la renderiza. */
  @Post('blender')
  @Throttle(perMinute(6))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Escena exportada del estudio (.glb)' },
        spec: { type: 'string', description: 'RenderSpec como JSON' },
        lights: { type: 'string', description: 'BlenderLights como JSON (sol, lámparas, techo)' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT, files: 1, fields: 4 } }))
  renderInBlender(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CreateBlenderRenderFieldsSchema)) fields: CreateBlenderRenderFields,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<Render> {
    return this.blender.create({ userId: user.userId, requestId }, id, fields, file?.buffer);
  }

  @Patch(':rid')
  @ApiBody({ schema: openApiSchema(UpdateRenderRequestSchema) })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('rid', uuid) rid: string,
    @Body(new ZodPipe(UpdateRenderRequestSchema)) body: UpdateRenderRequest,
  ): Promise<Render> {
    return this.service.update({ userId: user.userId }, id, rid, body);
  }

  @Delete(':rid')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string, @Param('rid', uuid) rid: string): Promise<void> {
    return this.service.remove({ userId: user.userId }, id, rid);
  }
}

/** ¿Está encendido el nodo Blender? La web lo consulta para ofrecer (o no) el motor fotorrealista. */
@ApiTags('renders')
@ApiBearerAuth()
@Controller('render-node')
export class RenderNodeController {
  constructor(private readonly blender: BlenderRendersService) {}

  @Get()
  status(): Promise<RenderNodeStatus> {
    return this.blender.node();
  }
}
