import type { DesignProject, RoomShell } from '@interiores/shared-types';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import type { IProjectRepository, ProjectRecord } from '../../ports/index.js';
import { toDesignProject } from './project.mapper.js';

export interface Actor {
  userId: string;
  requestId?: string | undefined;
}

/** Guarda de concurrencia optimista: solo si el cliente envió la revisión que leyó. */
export const revisionGuard = (revision?: number) => (revision === undefined ? {} : { expectedRevision: revision });

/**
 * Lo que comparten todos los casos de uso de un proyecto: comprobar que es de quien lo pide
 * (404 si no, para no revelar que existe) y convertirlo en lo que ve el cliente.
 */
export class ProjectAccess {
  constructor(
    private readonly projects: IProjectRepository,
    private readonly signer: MediaUrlSigner,
  ) {}

  async own(actor: Actor, id: string): Promise<ProjectRecord> {
    const project = await this.projects.findById(id);
    if (!project || project.ownerId !== actor.userId) throw new NotFoundError('El proyecto no existe');
    return project;
  }

  async toDto(project: ProjectRecord): Promise<DesignProject> {
    const [previews, versions, shared] = await Promise.all([
      this.projects.listPreviews(project.id),
      this.projects.listVersions(project.id),
      this.projects.hasActiveShareLink(project.id),
    ]);
    const homeRooms = project.homeId ? (await this.projects.listByOwner(project.ownerId)).filter((p) => p.homeId === project.homeId) : [];
    return toDesignProject(project, previews, versions, shared, this.signer, homeRooms);
  }

  requireShell(project: ProjectRecord): RoomShell {
    if (!project.roomShell) throw new ValidationError('El cuarto aún se está analizando');
    return project.roomShell;
  }
}
