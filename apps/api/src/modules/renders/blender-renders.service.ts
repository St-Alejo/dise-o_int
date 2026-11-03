import { Inject, Injectable, Logger } from '@nestjs/common';
import { blenderPlan, type CreateBlenderRenderFields, type Render, type RenderNodeStatus } from '@interiores/shared-types';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { ConflictError, DependencyError, PayloadTooLargeError, UnsupportedMediaError, ValidationError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import {
  APP_CONFIG,
  BLENDER_QUOTA,
  FILE_STORAGE,
  PROJECT_REPOSITORY,
  RENDER_JOB_QUEUE,
  RENDER_REPOSITORY,
  type IFileStorage,
  type IProjectRepository,
  type IQuota,
  type IRenderJobQueue,
  type IRenderRepository,
  type RenderRecord,
} from '../../ports/index.js';
import { ProjectAccess, type Actor } from '../projects/project-access.js';
import { projectKeys } from '../projects/project.mapper.js';
import { CYCLES_PROVIDER, toRenderDto } from './renders.service.js';

/** Cabecera de un glTF binario: "glTF", versión 2 y el largo total del archivo. */
const GLB_MAGIC = 0x46546c67;

/** ¿Es un .glb bien formado? Basta la cabecera de 12 bytes: Blender valida el resto. */
export function isGlb(file: Buffer): boolean {
  return file.length >= 12 && file.readUInt32LE(0) === GLB_MAGIC && file.readUInt32LE(4) === 2 && file.readUInt32LE(8) === file.length;
}

/**
 * Render en Blender (ADR-0036). La web manda la escena exportada (.glb) y la API la guarda,
 * crea el render pendiente y lo encola para el nodo con GPU. El resultado lo recoge
 * RenderJobsListener en el proceso worker.
 */
@Injectable()
export class BlenderRendersService {
  private readonly logger = new Logger(BlenderRendersService.name);
  private readonly access: ProjectAccess;

  constructor(
    @Inject(PROJECT_REPOSITORY) projects: IProjectRepository,
    @Inject(RENDER_REPOSITORY) private readonly renders: IRenderRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    @Inject(RENDER_JOB_QUEUE) private readonly queue: IRenderJobQueue,
    @Inject(BLENDER_QUOTA) private readonly quota: IQuota,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly signer: MediaUrlSigner,
  ) {
    this.access = new ProjectAccess(projects, signer);
  }

  node(): Promise<RenderNodeStatus> {
    return this.queue.node();
  }

  async create(actor: Actor, projectId: string, fields: CreateBlenderRenderFields, file: Buffer | undefined): Promise<Render> {
    await this.access.own(actor, projectId);
    if (!file || file.length === 0) throw new ValidationError('Falta la escena 3D');
    if (file.length > this.config.RENDER_SCENE_MAX_MB * 1024 * 1024) {
      throw new PayloadTooLargeError(`La escena supera los ${this.config.RENDER_SCENE_MAX_MB} MB`);
    }
    if (!isGlb(file)) throw new UnsupportedMediaError('La escena debe ser un archivo glTF binario (.glb)');
    if ((await this.renders.countByProject(projectId)) >= this.config.RENDERS_PER_PROJECT) {
      throw new ConflictError(`La galería ya tiene ${this.config.RENDERS_PER_PROJECT} renders: borra alguno para pedir más`);
    }
    if (!(await this.queue.node()).available) {
      throw new DependencyError('El nodo de render con Blender está apagado. Enciéndelo o usa el render del navegador.');
    }
    await this.quota.consume(actor.userId, 1);

    const id = randomUUID();
    const spec = { ...fields.spec, engine: 'cycles' as const };
    const sceneKey = projectKeys.render(projectId, id, 'scene.glb');
    let record: RenderRecord | null = null;
    try {
      await this.storage.put(sceneKey, file, 'model/gltf-binary');
      record = await this.renders.create({
        id,
        projectId,
        kind: 'path',
        status: 'pending',
        mediaType: null,
        fileKey: null,
        spec,
        sourceRenderId: null,
        fidelity: null,
        provider: CYCLES_PROVIDER,
        cacheKey: null,
      });
      await this.queue.enqueue({
        renderId: id,
        projectId,
        userId: actor.userId,
        sceneKey,
        outputPrefix: projectKeys.render(projectId, id, '').slice(0, -1),
        plan: blenderPlan(spec, fields.lights),
      });
    } catch (err) {
      // Nada a medias: sin trabajo en cola no hay render pendiente, ni escena, ni cuota gastada.
      await this.quota.refund(actor.userId, 1).catch(() => undefined);
      await this.storage.deletePrefix(projectKeys.render(projectId, id, '')).catch(() => undefined);
      if (record) await this.renders.delete(id).catch(() => undefined);
      this.logger.warn({ projectId, renderId: id, err: err instanceof Error ? err.message : err }, 'No se pudo encolar el render en Blender');
      throw err;
    }
    return toRenderDto(record, this.signer);
  }
}
