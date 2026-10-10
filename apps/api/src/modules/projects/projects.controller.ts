import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { perMinute } from '../../common/rate-limit.js';
import {
  AutoLayoutRequestSchema,
  CalibrateRequestSchema,
  CreateProjectFieldsSchema,
  RestoreVersionRequestSchema,
  GenerateStylesRequestSchema,
  SaveVersionRequestSchema,
  SelectStyleRequestSchema,
  UpdateProjectRequestSchema,
  UpdateRoomRequestSchema,
  UpdateSceneRequestSchema,
  type AutoLayoutRequest,
  type CalibrateRequest,
  type CreateProjectFields,
  type DesignProject,
  type GenerateStylesRequest,
  type JobAccepted,
  type JobProgressEvent,
  type ProjectListItem,
  type RestoreVersionRequest,
  type SaveVersionRequest,
  type SelectStyleRequest,
  type ShareLink,
  type ShoppingList,
  type UpdateProjectRequest,
  type UpdateRoomRequest,
  type UpdateSceneRequest,
} from '@interiores/shared-types';
import type { Response } from 'express';
import { openApiSchema, ZodPipe } from '../../common/zod.js';
import { CurrentUser, RequestId, type AuthPrincipal } from '../auth/auth.decorators.js';
import { ProjectsService, type Actor } from './projects.service.js';
import { renderShoppingListPdf } from './shopping-list.pdf.js';

/** Tope duro de Multer; el límite configurable (UPLOAD_MAX_MB) lo aplica PhotoProcessor. */
const MULTER_HARD_LIMIT = 50 * 1024 * 1024;
const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  private actor(user: AuthPrincipal, requestId?: string): Actor {
    return { userId: user.userId, requestId };
  }

  @Get()
  list(@CurrentUser() user: AuthPrincipal): Promise<ProjectListItem[]> {
    return this.service.list(this.actor(user));
  }

  @Post()
  @Throttle(perMinute(12))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary', description: 'Foto del cuarto (opcional si se envía roomSpec)' }, roomSpec: { type: 'string', description: 'Cuarto definido a mano, como JSON: { shape, widthM, depthM, heightM, notchWidthM?, notchDepthM?, openings? }' }, name: { type: 'string' }, roomType: { type: 'string', enum: ['living', 'bedroom', 'dining', 'office', 'kitchen', 'bathroom'] }, styles: { type: 'string', description: 'Estilos separados por comas' }, widthM: { type: 'string', description: 'Ancho real en metros (opcional; junto con depthM y heightM)' }, depthM: { type: 'string' }, heightM: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MULTER_HARD_LIMIT, files: 1, fields: 10 } }))
  create(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Body(new ZodPipe(CreateProjectFieldsSchema)) fields: CreateProjectFields,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ): Promise<DesignProject> {
    return this.service.create(this.actor(user, requestId), fields, photo?.buffer);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<DesignProject> {
    return this.service.get(this.actor(user), id);
  }

  @Patch(':id')
  @ApiBody({ schema: openApiSchema(UpdateProjectRequestSchema) })
  rename(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateProjectRequestSchema)) body: UpdateProjectRequest,
  ): Promise<DesignProject> {
    return this.service.rename(this.actor(user), id, body.name, body.revision);
  }

  @Post(':id/duplicate')
  @Throttle(perMinute(12))
  duplicate(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<DesignProject> {
    return this.service.duplicate(this.actor(user), id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<void> {
    return this.service.remove(this.actor(user), id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  retry(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Param('id', uuid) id: string,
  ): Promise<DesignProject> {
    return this.service.retryAnalysis(this.actor(user, requestId), id);
  }

  @Get(':id/progress')
  progress(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<JobProgressEvent[]> {
    return this.service.progressHistory(this.actor(user), id);
  }

  @Put(':id/scene')
  @ApiBody({ schema: openApiSchema(UpdateSceneRequestSchema) })
  updateScene(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateSceneRequestSchema)) body: UpdateSceneRequest,
  ): Promise<DesignProject> {
    return this.service.updateScene(this.actor(user), id, body);
  }

  @Put(':id/room')
  @ApiBody({ schema: openApiSchema(UpdateRoomRequestSchema) })
  updateRoom(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateRoomRequestSchema)) body: UpdateRoomRequest,
  ): Promise<DesignProject> {
    return this.service.updateRoom(this.actor(user), id, body);
  }

  @Post(':id/calibrate')
  @HttpCode(200)
  @ApiBody({ schema: openApiSchema(CalibrateRequestSchema) })
  calibrate(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(CalibrateRequestSchema)) body: CalibrateRequest,
  ): Promise<DesignProject> {
    return this.service.calibrate(this.actor(user), id, body);
  }

  @Put(':id/selected-style')
  @ApiBody({ schema: openApiSchema(SelectStyleRequestSchema) })
  selectStyle(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(SelectStyleRequestSchema)) body: SelectStyleRequest,
  ): Promise<DesignProject> {
    return this.service.selectStyle(this.actor(user), id, body.styleId, body.revision);
  }

  @Post(':id/styles')
  @HttpCode(202)
  @Throttle(perMinute(20))
  @ApiBody({ schema: openApiSchema(GenerateStylesRequestSchema) })
  generateStyles(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(GenerateStylesRequestSchema)) body: GenerateStylesRequest,
  ): Promise<JobAccepted> {
    return this.service.generateStyles(this.actor(user, requestId), id, body);
  }

  @Post(':id/layout')
  @HttpCode(202)
  @ApiBody({ schema: openApiSchema(AutoLayoutRequestSchema) })
  autoLayout(
    @CurrentUser() user: AuthPrincipal,
    @RequestId() requestId: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(AutoLayoutRequestSchema)) body: AutoLayoutRequest,
  ): Promise<JobAccepted> {
    return this.service.autoLayout(this.actor(user, requestId), id, body);
  }

  @Post(':id/versions')
  @ApiBody({ schema: openApiSchema(SaveVersionRequestSchema) })
  saveVersion(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(SaveVersionRequestSchema)) body: SaveVersionRequest,
  ): Promise<DesignProject> {
    return this.service.saveVersion(this.actor(user), id, body.note);
  }

  @Post(':id/versions/:versionId/restore')
  @HttpCode(200)
  @ApiBody({ schema: openApiSchema(RestoreVersionRequestSchema), required: false })
  restoreVersion(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('versionId', uuid) versionId: string,
    @Body(new ZodPipe(RestoreVersionRequestSchema)) body: RestoreVersionRequest,
  ): Promise<DesignProject> {
    return this.service.restoreVersion(this.actor(user), id, versionId, body.revision);
  }

  @Post(':id/share')
  share(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<ShareLink> {
    return this.service.share(this.actor(user), id);
  }

  @Delete(':id/share')
  @HttpCode(204)
  unshare(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<void> {
    return this.service.unshare(this.actor(user), id);
  }

  @Get(':id/shopping-list')
  shoppingList(@CurrentUser() user: AuthPrincipal, @Param('id', uuid) id: string): Promise<ShoppingList> {
    return this.service.shoppingList(this.actor(user), id);
  }

  @Get(':id/shopping-list.pdf')
  async shoppingListPdf(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const list = await this.service.shoppingList(this.actor(user), id);
    const pdf = await renderShoppingListPdf(list);
    res
      .type('application/pdf')
      .setHeader('content-disposition', `attachment; filename="lista-de-compras-${id.slice(0, 8)}.pdf"`)
      .setHeader('cache-control', 'no-store')
      .send(pdf);
  }
}
