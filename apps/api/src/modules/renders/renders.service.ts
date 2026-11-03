import { Inject, Injectable } from '@nestjs/common';
import type { CreateRenderFields, Render, RenderMediaType, UpdateRenderRequest } from '@interiores/shared-types';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { ConflictError, NotFoundError, PayloadTooLargeError, UnsupportedMediaError, ValidationError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import {
  APP_CONFIG,
  FILE_STORAGE,
  PROJECT_REPOSITORY,
  RENDER_JOB_QUEUE,
  RENDER_REPOSITORY,
  type IFileStorage,
  type IProjectRepository,
  type IRenderJobQueue,
  type IRenderRepository,
  type RenderRecord,
} from '../../ports/index.js';
import { ProjectAccess, type Actor } from '../projects/project-access.js';
import { projectKeys } from '../projects/project.mapper.js';

/** Extensión con la que se guarda cada tipo de archivo. */
const EXTENSIONS: Record<RenderMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** El render del estudio es una imagen; el recorrido, un vídeo. */
const ACCEPTS: Record<CreateRenderFields['kind'], readonly RenderMediaType[]> = {
  path: ['image/png', 'image/jpeg'],
  video: ['video/mp4', 'video/webm'],
};

/** Proveedor de los renders hechos en el nodo Blender. */
export const CYCLES_PROVIDER = 'cycles';

export function toRenderDto(r: RenderRecord, signer: MediaUrlSigner): Render {
  const ready = r.status === 'ready';
  // El nodo deja junto a la vista previa (JPEG) el PNG sin comprimir y la escena .blend.
  const downloads =
    ready && r.provider === CYCLES_PROVIDER
      ? { png: signer.sign(projectKeys.render(r.projectId, r.id, 'png')), blend: signer.sign(projectKeys.render(r.projectId, r.id, 'blend')) }
      : undefined;
  return {
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    status: r.status,
    mediaType: r.mediaType,
    url: r.status === 'ready' && r.fileKey ? signer.sign(r.fileKey) : null,
    spec: r.spec,
    sourceRenderId: r.sourceRenderId,
    fidelity: r.fidelity,
    provider: r.provider,
    shared: r.shared,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    ...(downloads ? { downloads } : {}),
  };
}

/**
 * Galería del estudio de render. Los renders se hacen en el navegador (trazado de rayos o raster)
 * y aquí solo se validan, se guardan y se sirven firmados; la foto realista la encarga
 * PhotorealService a la cola de IA.
 */
@Injectable()
export class RendersService {
  private readonly access: ProjectAccess;

  constructor(
    @Inject(PROJECT_REPOSITORY) projects: IProjectRepository,
    @Inject(RENDER_REPOSITORY) private readonly renders: IRenderRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly signer: MediaUrlSigner,
    @Inject(RENDER_JOB_QUEUE) private readonly renderQueue: IRenderJobQueue,
  ) {
    this.access = new ProjectAccess(projects, signer);
  }

  async list(actor: Actor, projectId: string): Promise<Render[]> {
    await this.access.own(actor, projectId);
    return (await this.renders.listByProject(projectId)).map((r) => toRenderDto(r, this.signer));
  }

  /** Los renders que la persona marcó para el enlace público. */
  async listShared(projectId: string): Promise<Render[]> {
    return (await this.renders.listByProject(projectId, { sharedOnly: true })).map((r) => toRenderDto(r, this.signer));
  }

  async upload(actor: Actor, projectId: string, fields: CreateRenderFields, file: Buffer | undefined): Promise<Render> {
    await this.access.own(actor, projectId);
    if (!file || file.length === 0) throw new ValidationError('Falta el archivo del render');
    if (file.length > this.config.RENDERS_MAX_MB * 1024 * 1024) {
      throw new PayloadTooLargeError(`El render supera los ${this.config.RENDERS_MAX_MB} MB`);
    }
    const mediaType = await this.sniff(file);
    if (!mediaType || !ACCEPTS[fields.kind].includes(mediaType)) {
      throw new UnsupportedMediaError(fields.kind === 'video' ? 'El recorrido debe ser MP4 o WebM' : 'El render debe ser PNG o JPEG');
    }
    if ((await this.renders.countByProject(projectId)) >= this.config.RENDERS_PER_PROJECT) {
      throw new ConflictError(`La galería ya tiene ${this.config.RENDERS_PER_PROJECT} renders: borra alguno para guardar más`);
    }

    const id = randomUUID();
    const fileKey = projectKeys.render(projectId, id, EXTENSIONS[mediaType]);
    await this.storage.put(fileKey, file, mediaType);
    const record = await this.renders.create({
      id,
      projectId,
      kind: fields.kind,
      status: 'ready',
      mediaType,
      fileKey,
      spec: fields.spec,
      sourceRenderId: null,
      fidelity: null,
      provider: fields.spec.engine,
      cacheKey: null,
    });
    return toRenderDto(record, this.signer);
  }

  async update(actor: Actor, projectId: string, renderId: string, patch: UpdateRenderRequest): Promise<Render> {
    await this.access.own(actor, projectId);
    const render = await this.find(projectId, renderId);
    if (patch.shared && render.status !== 'ready') throw new ValidationError('Solo se comparten renders terminados');
    return toRenderDto(await this.renders.update(render.id, { shared: patch.shared }), this.signer);
  }

  async remove(actor: Actor, projectId: string, renderId: string): Promise<void> {
    await this.access.own(actor, projectId);
    const render = await this.find(projectId, renderId);
    // Si el nodo Blender aún lo tiene en cola (o lo está renderizando), que no siga gastando GPU.
    if (render.provider === CYCLES_PROVIDER && render.status === 'pending') await this.renderQueue.cancel(render.id).catch(() => undefined);
    // "…/renders/<id>." como prefijo: solo toca este archivo y sus acompañantes (profundidad, escena, .blend).
    await this.storage.deletePrefix(projectKeys.render(projectId, render.id, ''));
    await this.renders.delete(render.id);
  }

  private async find(projectId: string, renderId: string): Promise<RenderRecord> {
    const render = await this.renders.findById(projectId, renderId);
    if (!render) throw new NotFoundError('El render no existe');
    return render;
  }

  /** Tipo REAL por magic bytes: no se confía en la extensión ni en el Content-Type. */
  private async sniff(file: Buffer): Promise<RenderMediaType | null> {
    const type = await fileTypeFromBuffer(file);
    if (!type) return null;
    return (EXTENSIONS as Record<string, string>)[type.mime] ? (type.mime as RenderMediaType) : null;
  }
}
