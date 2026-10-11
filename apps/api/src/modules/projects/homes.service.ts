import type { DesignProject, SetHomeRequest } from '@interiores/shared-types';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../common/errors.js';
import type { IProjectRepository } from '../../ports/index.js';
import type { Actor, ProjectAccess } from './project-access.js';

/** Viviendas: los cuartos de una persona que comparten `homeId` (ADR-0021). */
export class HomesService {
  constructor(
    private readonly projects: IProjectRepository,
    private readonly access: ProjectAccess,
  ) {}

  /**
   * A qué vivienda pertenece un cuarto. Una vivienda no es una entidad aparte: son los cuartos de
   * una persona que comparten `homeId`, así que crearla, renombrarla o vaciarla es tocar esos cuartos.
   */
  async setHome(actor: Actor, id: string, req: SetHomeRequest): Promise<DesignProject> {
    const project = await this.access.own(actor, id);
    if (req.homeId === null) {
      return this.access.toDto(await this.projects.update(id, { homeId: null, homeName: null }));
    }
    if (req.homeId) {
      const home = await this.homeOf(actor, req.homeId);
      return this.access.toDto(await this.projects.update(id, { homeId: home.id, homeName: req.homeName ?? home.name }));
    }
    const name = req.homeName!;
    if (!project.homeId) {
      return this.access.toDto(await this.projects.update(id, { homeId: randomUUID(), homeName: name }));
    }
    // Ya tiene vivienda: el nombre nuevo es para todos sus cuartos.
    const rooms = (await this.projects.listByOwner(actor.userId)).filter((p) => p.homeId === project.homeId);
    await Promise.all(rooms.map((room) => this.projects.update(room.id, { homeName: name })));
    return this.access.toDto((await this.projects.findById(id))!);
  }

  /** La vivienda `homeId` de esta persona; si no tiene ningún cuarto en ella, no existe para ella. */
  async homeOf(actor: Actor, homeId: string): Promise<{ id: string; name: string }> {
    const room = (await this.projects.listByOwner(actor.userId)).find((p) => p.homeId === homeId);
    if (!room) throw new ValidationError('Esa vivienda no existe');
    return { id: homeId, name: room.homeName ?? 'Vivienda' };
  }
}
