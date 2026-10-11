import type { DesignProject, DesignProjectVersion } from '@interiores/shared-types';
import { NotFoundError } from '../../common/errors.js';
import type { IProjectRepository } from '../../ports/index.js';
import { toVersion } from './project.mapper.js';
import { ProjectAccess, revisionGuard, type Actor } from './project-access.js';

/** Versiones guardadas de un cuarto: copias fijas que se pueden mirar y restaurar. */
export class VersionsService {
  constructor(
    private readonly projects: IProjectRepository,
    private readonly access: ProjectAccess,
  ) {}

  async saveVersion(actor: Actor, id: string, note?: string): Promise<DesignProject> {
    await this.access.own(actor, id);
    await this.projects.addVersion(id, note?.trim() || null);
    return this.access.toDto(await this.access.own(actor, id));
  }

  /** Una versión guardada entera (planta, muebles y acabados), sin restaurarla. */
  async version(actor: Actor, id: string, versionId: string): Promise<DesignProjectVersion> {
    await this.access.own(actor, id);
    const version = await this.projects.getVersion(id, versionId);
    if (!version) throw new NotFoundError('La versión no existe');
    return toVersion(version);
  }

  async restoreVersion(actor: Actor, id: string, versionId: string, revision?: number): Promise<DesignProject> {
    await this.access.own(actor, id);
    const version = await this.projects.getVersion(id, versionId);
    if (!version) throw new NotFoundError('La versión no existe');
    const updated = await this.projects.update(
      id,
      {
        roomShell: version.roomShell,
        placements: version.placements,
        finishes: version.finishes,
        selectedStyleId: version.selectedStyleId,
      },
      { ...revisionGuard(revision), bumpRevision: true },
    );
    return this.access.toDto(updated);
  }
}
