import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { PublicProject, ShoppingList } from '@interiores/shared-types';
import type { Response } from 'express';
import type { AppConfig } from '../../config/env.js';
import { NotFoundError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import { APP_CONFIG, PROJECT_REPOSITORY, type IProjectRepository, type ProjectRecord } from '../../ports/index.js';
import { Public } from '../auth/auth.decorators.js';
import { toPublicProject } from '../projects/project.mapper.js';
import { ProjectsService } from '../projects/projects.service.js';
import { renderShoppingListPdf } from '../projects/shopping-list.pdf.js';

/** Vista pública de solo lectura de un proyecto compartido por link (paso 7). */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly service: ProjectsService,
    private readonly signer: MediaUrlSigner,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  async get(@Param('token') token: string): Promise<PublicProject> {
    const project = await this.resolve(token);
    return toPublicProject(project, await this.projects.listPreviews(project.id), this.signer);
  }

  @Public()
  @Get(':token/shopping-list')
  async shoppingList(@Param('token') token: string): Promise<ShoppingList> {
    return this.service.buildShoppingList(await this.resolve(token));
  }

  @Public()
  @Get(':token/shopping-list.pdf')
  async shoppingListPdf(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const list = await this.service.buildShoppingList(await this.resolve(token));
    const pdf = await renderShoppingListPdf(list, `${this.config.PUBLIC_WEB_URL}/p/${token}`);
    res.type('application/pdf').setHeader('content-disposition', 'attachment; filename="lista-de-compras.pdf"').send(pdf);
  }

  private async resolve(token: string): Promise<ProjectRecord> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new NotFoundError('Enlace no válido');
    const projectId = await this.projects.findProjectIdByShareToken(token);
    const project = projectId ? await this.projects.findById(projectId) : null;
    if (!project) throw new NotFoundError('Este enlace ya no está disponible');
    return project;
  }
}
