import { Injectable, inject } from '@angular/core';
import { finishesForStyle, type DesignProject } from '@interiores/shared-types';
import { Plano3dApi, type Plano3dHouse } from '../../core/api/plano3d.api';
import { ProjectsApi } from '../../core/api/projects.api';
import type { HouseRoomData } from '../viewport-3d/scene/house-view';

export type HouseLevelData = Plano3dHouse['levels'][number];

/**
 * Los cuartos de un piso listos para dibujar. Los amueblables llevan sus acabados (o la paleta de
 * su estilo) y sus muebles; si uno no carga, se dibuja vacío en vez de romper la casa.
 */
export async function houseRooms(level: HouseLevelData, load: (projectId: string) => Promise<DesignProject>, skipProjectId: string | null = null): Promise<HouseRoomData[]> {
  const rooms = level.rooms.filter((r) => !skipProjectId || r.projectId !== skipProjectId);
  return Promise.all(
    rooms.map(async (r) => {
      const base: HouseRoomData = { roomId: r.roomId, name: r.name, projectId: r.projectId, origin: r.origin, shell: r.shell };
      if (!r.projectId) return base;
      try {
        const project = await load(r.projectId);
        return {
          ...base,
          // el cuarto guardado manda: puede tener la geometría más nueva que la casa en caché
          shell: project.roomShell ?? r.shell,
          finishes: project.finishes ?? finishesForStyle(project.selectedStyleId ?? null),
          placements: project.furniturePlacements,
        };
      } catch {
        return base;
      }
    }),
  );
}

/** La casa de Plano 3D de una vivienda (o de un cuarto enlazado), con una caché corta. */
@Injectable({ providedIn: 'root' })
export class HouseData {
  private readonly plano3d = inject(Plano3dApi);
  private readonly projects = inject(ProjectsApi);
  private readonly cache = new Map<string, { at: number; house: Promise<Plano3dHouse> }>();
  private static readonly TTL_MS = 20_000;

  /** Por el id del enlace (lo trae cada cuarto enlazado en `plano3d.linkId`). */
  byLink(linkId: string): Promise<Plano3dHouse> {
    const hit = this.cache.get(linkId);
    if (hit && Date.now() - hit.at < HouseData.TTL_MS) return hit.house;
    const house = this.plano3d.house(linkId);
    this.cache.set(linkId, { at: Date.now(), house });
    house.catch(() => this.cache.delete(linkId));
    return house;
  }

  /** Por la vivienda: busca su enlace entre las casas enlazadas (null si no es de Plano 3D). */
  async byHome(homeId: string): Promise<Plano3dHouse | null> {
    const link = (await this.plano3d.list()).find((l) => l.homeId === homeId);
    return link ? this.byLink(link.id) : null;
  }

  rooms(level: HouseLevelData, skipProjectId: string | null = null): Promise<HouseRoomData[]> {
    return houseRooms(level, (id) => this.projects.get(id), skipProjectId);
  }

  /** Olvida la casa (tras sincronizar o al volver de amueblar un cuarto). */
  forget(linkId?: string): void {
    if (linkId) this.cache.delete(linkId);
    else this.cache.clear();
  }
}
