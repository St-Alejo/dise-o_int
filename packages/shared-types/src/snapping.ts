/**
 * Guías de alineación al mover un mueble (lógica pura): si uno de sus bordes o su centro queda casi
 * en línea con el borde o el centro de otro mueble, se "imanta" a esa línea y se devuelve la guía
 * para dibujarla. Si no hay nada cerca, la posición cae en la rejilla.
 */
export interface SnapBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SnapGuide {
  /** Eje en el que la guía es constante: `x` = línea vertical en el plano, `z` = horizontal. */
  axis: 'x' | 'z';
  at: number;
  /** Tramo de la línea, sobre el otro eje. */
  from: number;
  to: number;
}

export interface SnapOptions {
  /** A menos de esta distancia el mueble se alinea solo. */
  toleranceM?: number;
  /** Paso de la rejilla cuando no hay nada con qué alinearse (0 = sin rejilla). */
  gridM?: number;
}

export interface SnapResult {
  /** Cuánto hay que correr el mueble. */
  dx: number;
  dz: number;
  guides: SnapGuide[];
}

export const SNAP_DEFAULTS = { toleranceM: 0.08, gridM: 0.05 } as const;

const lines = (min: number, max: number) => [min, (min + max) / 2, max];

interface AxisSnap {
  delta: number;
  at: number;
  other: SnapBox;
}

function snapAxis(moving: SnapBox, others: readonly SnapBox[], axis: 'x' | 'z', tolerance: number): AxisSnap | null {
  const mine = axis === 'x' ? lines(moving.minX, moving.maxX) : lines(moving.minZ, moving.maxZ);
  let best: AxisSnap | null = null;
  for (const other of others) {
    const theirs = axis === 'x' ? lines(other.minX, other.maxX) : lines(other.minZ, other.maxZ);
    for (const m of mine) {
      for (const t of theirs) {
        const delta = t - m;
        if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = { delta, at: t, other };
      }
    }
  }
  return best;
}

/**
 * Ajuste de `moving` (la caja del mueble donde lo quiere dejar el cursor) contra las cajas de los
 * demás. Cada eje se resuelve por separado: se puede alinear en x con un mueble y en z con otro.
 */
export function snapMove(moving: SnapBox, others: readonly SnapBox[], options: SnapOptions = {}): SnapResult {
  const tolerance = options.toleranceM ?? SNAP_DEFAULTS.toleranceM;
  const grid = options.gridM ?? SNAP_DEFAULTS.gridM;
  const toGrid = (centre: number) => (grid > 0 ? Math.round(centre / grid) * grid - centre : 0);
  const guides: SnapGuide[] = [];

  const sx = snapAxis(moving, others, 'x', tolerance);
  const sz = snapAxis(moving, others, 'z', tolerance);
  const dx = sx ? sx.delta : toGrid((moving.minX + moving.maxX) / 2);
  const dz = sz ? sz.delta : toGrid((moving.minZ + moving.maxZ) / 2);
  if (sx) {
    guides.push({ axis: 'x', at: sx.at, from: Math.min(moving.minZ + dz, sx.other.minZ), to: Math.max(moving.maxZ + dz, sx.other.maxZ) });
  }
  if (sz) {
    guides.push({ axis: 'z', at: sz.at, from: Math.min(moving.minX + dx, sz.other.minX), to: Math.max(moving.maxX + dx, sz.other.maxX) });
  }
  return { dx, dz, guides };
}
