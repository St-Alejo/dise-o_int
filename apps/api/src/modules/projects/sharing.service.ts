import type { ShareLink } from '@interiores/shared-types';
import { randomBytes } from 'node:crypto';
import type { IProjectRepository } from '../../ports/index.js';
import type { Actor, ProjectAccess } from './project-access.js';

/** El enlace público de solo lectura de un cuarto. */
export class SharingService {
  constructor(
    private readonly projects: IProjectRepository,
    private readonly access: ProjectAccess,
  ) {}

  async share(actor: Actor, id: string): Promise<ShareLink> {
    await this.access.own(actor, id);
    const token = randomBytes(24).toString('base64url');
    // Atómico: revoca los anteriores, crea el nuevo y marca el proyecto como guardado.
    await this.projects.replaceShareLink(id, token);
    return { token, path: `/p/${token}` };
  }

  async unshare(actor: Actor, id: string): Promise<void> {
    await this.access.own(actor, id);
    await this.projects.revokeShareLinks(id);
  }
}
