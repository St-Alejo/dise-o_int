/**
 * Lógica pura del formulario "Medidas del cuarto" (sin Angular ni DOM, para probarla sola).
 * El formulario trabaja con un borrador en unidades cómodas para el usuario —la abertura se
 * ubica por la distancia desde la esquina izquierda de la pared, no por su centro— y se
 * convierte al modelo canónico con las MISMAS funciones que usa el servidor.
 */
import {
  ROOM_LIMITS,
  RoomGeometryError,
  dropOverlappingOpenings,
  fitPlacementsToRoom,
  resizeRoomShell,
  type FurniturePlacement,
  type Opening,
  type RoomShell,
  type Vector3,
} from '@interiores/shared-types';

export const WALL_LABELS: Record<string, string> = {
  'w-back': 'Fondo (la que ves en la foto)',
  'w-right': 'Derecha',
  'w-front': 'Frente (detrás de la cámara)',
  'w-left': 'Izquierda',
};

export interface OpeningDraft {
  id: string;
  type: 'door' | 'window';
  wallId: string;
  widthM: number;
  heightM: number;
  /** Distancia desde el inicio de la pared hasta el borde de la abertura. */
  fromCornerM: number;
  sillHeightM: number;
}

export interface RoomDraft {
  widthM: number;
  depthM: number;
  heightM: number;
  openings: OpeningDraft[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function draftFromShell(shell: RoomShell): RoomDraft {
  return {
    widthM: round2(shell.widthM),
    depthM: round2(shell.depthM),
    heightM: round2(shell.heightM),
    // El formulario parte de aberturas válidas (proyectos viejos podían traer duplicados).
    openings: dropOverlappingOpenings(shell.openings).map((o) => ({
      id: o.id,
      type: o.type,
      wallId: o.wallId,
      widthM: round2(o.widthM),
      heightM: round2(o.heightM),
      fromCornerM: round2(Math.max(0, o.offsetM - o.widthM / 2)),
      sillHeightM: round2(o.sillHeightM),
    })),
  };
}

export function openingsFromDraft(draft: RoomDraft): Opening[] {
  return draft.openings.map((o) => ({
    id: o.id,
    type: o.type,
    wallId: o.wallId,
    widthM: o.widthM,
    heightM: o.heightM,
    offsetM: o.fromCornerM + o.widthM / 2,
    sillHeightM: o.type === 'door' ? 0 : o.sillHeightM,
  }));
}

const MARGIN = ROOM_LIMITS.openingMarginM;
/** Orden en que se prueban las paredes para una abertura nueva. */
const WALL_PREFERENCE = { door: ['w-front', 'w-left', 'w-right', 'w-back'], window: ['w-back', 'w-left', 'w-right', 'w-front'] } as const;

/** Primer hueco libre de una pared donde quepa `widthM` (distancia desde la esquina), o null. */
function freeSpot(wallId: string, widthM: number, lengthM: number, existing: OpeningDraft[]): number | null {
  const taken = existing
    .filter((o) => o.wallId === wallId)
    .map((o) => [o.fromCornerM, o.fromCornerM + o.widthM] as const)
    .sort((a, b) => a[0] - b[0]);
  let cursor = Math.max(MARGIN, 0.3); // separado de la esquina
  for (const [start, end] of taken) {
    if (start - MARGIN - cursor >= widthM) return round2(cursor);
    cursor = Math.max(cursor, end + MARGIN);
  }
  return lengthM - MARGIN - cursor >= widthM ? round2(cursor) : null;
}

/**
 * Abertura nueva con medidas típicas, ubicada en el primer hueco libre (prefiere la pared de
 * enfrente para puertas y la del fondo para ventanas). Si no cabe en ninguna, se deja en la
 * preferida y la vista previa explica por qué no cabe.
 */
export function newOpening(type: 'door' | 'window', existing: OpeningDraft[], lengths?: Record<string, number>): OpeningDraft {
  let n = existing.length + 1;
  while (existing.some((o) => o.id === `o-${type}-${n}`)) n++;
  const base =
    type === 'door'
      ? { widthM: 0.9, heightM: 2.05, sillHeightM: 0 }
      : { widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 };
  const preferred = WALL_PREFERENCE[type];
  for (const wallId of preferred) {
    const spot = lengths ? freeSpot(wallId, base.widthM, lengths[wallId] ?? 0, existing) : 0.3;
    if (spot !== null) return { id: `o-${type}-${n}`, type, wallId, fromCornerM: spot, ...base };
  }
  return { id: `o-${type}-${n}`, type, wallId: preferred[0], fromCornerM: 0.3, ...base };
}

/**
 * Cambia una medida del cuarto en el borrador y reubica las aberturas afectadas igual que el
 * servidor (posición proporcional en su pared, recortadas si ya no caben): así el usuario no
 * tiene que mover a mano una ventana solo porque achicó el cuarto.
 */
export function withDimension(draft: RoomDraft, key: 'widthM' | 'depthM' | 'heightM', value: number): RoomDraft {
  const next = { ...draft, [key]: value };
  if (!Number.isFinite(value) || value <= 0) return next;
  const before = wallLengthsFor(draft);
  const after = wallLengthsFor(next);
  return {
    ...next,
    openings: draft.openings.map((o) => {
      let fitted = o;
      const oldLen = before[o.wallId];
      const newLen = after[o.wallId];
      if (oldLen && newLen && oldLen !== newLen) {
        const widthM = round2(Math.min(o.widthM, Math.max(0.2, newLen - 2 * MARGIN)));
        const center = (o.fromCornerM + o.widthM / 2) * (newLen / oldLen);
        const fromCornerM = round2(Math.min(newLen - MARGIN - widthM, Math.max(MARGIN, center - widthM / 2)));
        fitted = { ...fitted, widthM, fromCornerM };
      }
      if (key === 'heightM') {
        const sillHeightM = round2(Math.min(fitted.sillHeightM, Math.max(0, value - 0.5)));
        const heightM = round2(Math.min(fitted.heightM, Math.max(0.2, value - sillHeightM - MARGIN)));
        fitted = { ...fitted, sillHeightM, heightM };
      }
      return fitted;
    }),
  };
}

export interface RoomPreview {
  shell: RoomShell | null;
  error: string | null;
  /** Muebles que el servidor moverá para que queden dentro. */
  moved: number;
  /** Muebles que no caben ni moviéndolos (quedarán marcados en rojo). */
  tooBig: number;
}

/**
 * Lo que pasará al aplicar el borrador: el cuarto resultante o el error (el mismo mensaje
 * que daría el servidor), y cuántos muebles se reacomodan.
 */
export function previewRoom(
  shell: RoomShell,
  draft: RoomDraft,
  placements: readonly FurniturePlacement[],
  dimensionsOf: (p: FurniturePlacement) => Vector3 | undefined,
): RoomPreview {
  const values = [draft.widthM, draft.depthM, draft.heightM, ...draft.openings.flatMap((o) => [o.widthM, o.heightM, o.fromCornerM])];
  if (values.some((v) => !Number.isFinite(v))) return { shell: null, error: 'Completa todas las medidas', moved: 0, tooBig: 0 };
  const ids = new Set<string>();
  for (const o of draft.openings) {
    if (ids.has(o.id)) return { shell: null, error: `Abertura repetida: ${o.id}`, moved: 0, tooBig: 0 };
    ids.add(o.id);
  }
  try {
    const next = resizeRoomShell(
      shell,
      { widthM: draft.widthM, depthM: draft.depthM, heightM: draft.heightM },
      openingsFromDraft(draft),
    );
    const fit = fitPlacementsToRoom([...placements], dimensionsOf, next);
    return { shell: next, error: null, moved: fit.moved.length, tooBig: fit.tooBig.length };
  } catch (err) {
    const message = err instanceof RoomGeometryError ? err.message : 'Medidas inválidas';
    return { shell: null, error: message, moved: 0, tooBig: 0 };
  }
}

/** Largo de cada pared con el borrador actual (para mostrar "máx. X m" junto a cada abertura). */
export function wallLengthsFor(draft: RoomDraft): Record<string, number> {
  return { 'w-back': draft.widthM, 'w-front': draft.widthM, 'w-right': draft.depthM, 'w-left': draft.depthM };
}
