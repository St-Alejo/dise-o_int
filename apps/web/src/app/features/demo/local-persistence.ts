import { Injectable, inject } from '@angular/core';
import {
  DesignProjectSchema,
  FurnishedSceneSchema,
  effectiveDimensions,
  fitPlacementsToRoom,
  furnishedTemplateInfo,
  resizeRoomShell,
  type DesignBrief,
  type DesignProject,
  type FurnishedScene,
  type StyleId,
  type UpdateRoomRequest,
  type UpdateSceneRequest,
} from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { CatalogApi } from '../../core/api/projects.api';
import { ProjectPersistence } from '../project/project-persistence';

/** Prefijo del id de un proyecto de demostración: `demo-<plantilla>`. */
export const DEMO_PREFIX = 'demo-';
const STORAGE_PREFIX = 'interiores.demo.';

/** Un proyecto de demostración a partir de la escena de una plantilla. */
export function demoProject(scene: FurnishedScene, now = new Date().toISOString()): DesignProject {
  return {
    id: `${DEMO_PREFIX}${scene.id}`,
    ownerId: 'demo',
    name: scene.name,
    roomType: scene.roomType,
    status: 'ready',
    lastError: null,
    sourcePhotoUrl: null,
    roomShell: scene.roomShell,
    stylePreviews: [],
    selectedStyleId: scene.styleId,
    furniturePlacements: scene.furniturePlacements,
    finishes: scene.finishes,
    versions: [],
    visibility: 'private',
    saved: false,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Persistencia de la demo sin registro: el proyecto vive en este navegador. La primera vez sale
 * de la plantilla; después, de lo último que se guardó aquí. Hace el mismo trabajo que el
 * servidor en lo que el editor espera de vuelta (revisión nueva, muebles dentro del cuarto).
 */
@Injectable()
export class LocalPersistence extends ProjectPersistence {
  private readonly catalog = inject(CatalogApi);

  async get(id: string): Promise<DesignProject> {
    return this.read(id) ?? this.fromTemplate(id);
  }

  async saveScene(id: string, body: UpdateSceneRequest): Promise<DesignProject> {
    const current = await this.get(id);
    return this.write({
      ...current,
      furniturePlacements: body.furniturePlacements,
      ...(body.roomShell ? { roomShell: body.roomShell } : {}),
      ...(body.finishes !== undefined ? { finishes: body.finishes } : {}),
      ...(body.selectedStyleId !== undefined ? { selectedStyleId: body.selectedStyleId } : {}),
    });
  }

  async updateRoom(id: string, body: UpdateRoomRequest): Promise<DesignProject> {
    const current = await this.get(id);
    if (!current.roomShell) throw new ApiError(422, 'Este cuarto no se puede medir todavía.');
    const { revision: _revision, openings, ...dims } = body;
    const shell = resizeRoomShell(current.roomShell, dims, openings);
    const items = new Map((await this.catalog.all()).map((c) => [c.id, c]));
    const fitted = fitPlacementsToRoom(
      current.furniturePlacements,
      (p) => {
        const item = items.get(p.catalogItemId);
        return item ? effectiveDimensions(item.dimensionsM, p) : undefined;
      },
      shell,
    );
    return this.write({ ...current, roomShell: shell, furniturePlacements: fitted.placements });
  }

  async selectStyle(id: string, styleId: StyleId | null): Promise<DesignProject> {
    return this.write({ ...(await this.get(id)), selectedStyleId: styleId });
  }

  async setBudget(id: string, cap: number | null): Promise<DesignProject> {
    return this.write({ ...(await this.get(id)), budgetCap: cap }, false);
  }

  async setBrief(id: string, brief: DesignBrief | null): Promise<DesignProject> {
    return this.write({ ...(await this.get(id)), brief }, false);
  }

  /** Olvida lo guardado: la próxima vez se abre la plantilla tal como viene. */
  reset(id: string): void {
    try {
      localStorage.removeItem(STORAGE_PREFIX + id);
    } catch {
      // Sin almacenamiento no hay nada que olvidar.
    }
  }

  private async fromTemplate(id: string): Promise<DesignProject> {
    const templateId = id.startsWith(DEMO_PREFIX) ? id.slice(DEMO_PREFIX.length) : id;
    if (!furnishedTemplateInfo(templateId)) throw new ApiError(404, 'Esa plantilla no existe.');
    const res = await fetch(`/escenas/${encodeURIComponent(templateId)}.json`);
    if (!res.ok) throw new ApiError(res.status, 'No se pudo cargar la plantilla. Vuelve a intentarlo.');
    return demoProject(FurnishedSceneSchema.parse(await res.json()));
  }

  private read(id: string): DesignProject | null {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      const parsed = raw ? DesignProjectSchema.safeParse(JSON.parse(raw)) : null;
      return parsed?.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** `bump: false` para lo que no es la escena (el tope de gasto): la revisión es la de lo dibujado. */
  private write(project: DesignProject, bump = true): DesignProject {
    const next = { ...project, revision: project.revision + (bump ? 1 : 0), updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(STORAGE_PREFIX + next.id, JSON.stringify(next));
    } catch {
      // Sin almacenamiento (modo privado, cuota llena) la demo sigue, pero no sobrevive a recargar.
    }
    return next;
  }
}
