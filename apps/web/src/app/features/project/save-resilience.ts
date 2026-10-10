/**
 * Piezas puras del guardado resistente (sin Angular): cuándo reintentar, cómo reconocer que el
 * servidor no cambió la escena y la copia local de lo que aún no se pudo guardar.
 */
import type { DesignProject, FurniturePlacement, RoomFinishes, RoomShell } from '@interiores/shared-types';

/** La escena editable de un proyecto: lo que viaja al guardar. */
export interface SceneContent {
  placements: readonly FurniturePlacement[];
  finishes: RoomFinishes | null;
  shell: RoomShell | null;
}

/** Huella de una escena: dos escenas con la misma huella son iguales. */
export function sceneKey(scene: SceneContent): string {
  return JSON.stringify([scene.placements, scene.finishes, scene.shell]);
}

export function sceneOf(project: Pick<DesignProject, 'furniturePlacements' | 'finishes' | 'roomShell'>): SceneContent {
  return { placements: project.furniturePlacements, finishes: project.finishes ?? null, shell: project.roomShell };
}

/**
 * ¿Vale la pena reintentar solo? Sí si falló la red o el servidor (0 = sin conexión, 408, 429,
 * 5xx); no si el servidor rechazó los datos (4xx): repetir lo mismo daría el mismo error.
 */
export function isTransient(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Espera antes del reintento número `attempt` (0, 1, 2…): 2 s, 4 s, 8 s… hasta 30 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 2000 * 2 ** Math.max(0, attempt));
}

/** Copia local de una escena que no llegó a guardarse. */
export interface SceneDraft extends SceneContent {
  /** Revisión del servidor sobre la que se hicieron los cambios. */
  revision: number;
  /** Cuándo se editó por última vez (ms desde 1970). */
  savedAt: number;
}

const KEY = (projectId: string) => `interiores.borrador.${projectId}`;

/**
 * Borradores en el almacenamiento del navegador, uno por proyecto. Si no hay almacenamiento (modo
 * privado, cuota llena) simplemente no hay borradores: nunca lanza.
 */
export class DraftStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {}

  write(projectId: string, draft: SceneDraft): void {
    try {
      this.storage?.setItem(KEY(projectId), JSON.stringify(draft));
    } catch {
      // Sin espacio o sin permiso: se sigue sin copia local.
    }
  }

  read(projectId: string): SceneDraft | null {
    try {
      const raw = this.storage?.getItem(KEY(projectId));
      if (!raw) return null;
      const draft = JSON.parse(raw) as Partial<SceneDraft>;
      return typeof draft.revision === 'number' && Array.isArray(draft.placements) ? (draft as SceneDraft) : null;
    } catch {
      return null;
    }
  }

  clear(projectId: string): void {
    try {
      this.storage?.removeItem(KEY(projectId));
    } catch {
      // Nada que limpiar.
    }
  }
}

/**
 * ¿Se le ofrece al usuario recuperar este borrador? Solo si se hizo sobre la misma revisión que
 * tiene ahora el servidor (si el proyecto cambió después, mezclarlos sería adivinar) y si de
 * verdad difiere de lo guardado.
 */
export function draftIsRecoverable(draft: SceneDraft | null, project: Pick<DesignProject, 'revision' | 'furniturePlacements' | 'finishes' | 'roomShell'>): draft is SceneDraft {
  return !!draft && draft.revision === project.revision && sceneKey(draft) !== sceneKey(sceneOf(project));
}

/** "hace 3 min", "hace 2 h", "ayer"… para decir de cuándo es un borrador. */
export function agoLabel(thenMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - thenMs) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}
