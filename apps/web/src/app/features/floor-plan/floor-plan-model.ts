/**
 * Plano 2D del cuarto visto desde arriba (lógica pura, sin Angular): convierte un RoomShell en
 * las primitivas que dibuja el SVG. La pared del fondo queda arriba y x crece a la derecha, igual
 * que se ve el cuarto desde la cámara. Todo va en metros: el `viewBox` hace la escala.
 */
import { wallFrames, type RoomShell, type Vector3 } from '@interiores/shared-types';

export interface PlanPoint {
  x: number;
  y: number;
}

export interface PlanWall {
  id: string;
  from: PlanPoint;
  to: PlanPoint;
  lengthM: number;
  /** Cota: el largo de la pared, escrito por fuera del cuarto. `anchor` hace que el texto crezca alejándose de ella. */
  label: PlanPoint & { text: string; anchor: 'start' | 'middle' | 'end' };
}

export interface PlanOpening {
  id: string;
  type: 'door' | 'window';
  from: PlanPoint;
  to: PlanPoint;
  /** Arco de apertura de la puerta (path SVG); vacío en las ventanas. */
  swing: string;
}

export interface PlanItem {
  id: string;
  /** Huella del mueble como lista de puntos SVG. */
  points: string;
}

export interface FloorPlan {
  viewBox: string;
  /** Contorno del piso como lista de puntos SVG. */
  outline: string;
  walls: PlanWall[];
  openings: PlanOpening[];
  items: PlanItem[];
  /** Descripción para lectores de pantalla. */
  summary: string;
}

/** Un mueble sobre el plano: su id y las esquinas de su huella (x, z). */
export interface PlanFootprint {
  id: string;
  corners: readonly { x: number; z: number }[];
}

/** Margen alrededor del cuarto: caben las cotas laterales, que se escriben hacia fuera. */
const MARGIN_M = 1.1;
/** Separación de la cota: más holgada arriba y abajo (el texto es bajo) que a los lados. */
const LABEL_OFFSET_M = { vertical: 0.34, sideways: 0.18 };
const SHAPE_NAMES: Record<string, string> = { rect: 'rectangular', L: 'en L', T: 'en T', U: 'en U', free: 'de forma libre' };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const at = (v: Pick<Vector3, 'x' | 'z'>): PlanPoint => ({ x: r3(v.x), y: r3(v.z) });
const pts = (list: readonly { x: number; z: number }[]) => list.map((p) => `${r3(p.x)},${r3(p.z)}`).join(' ');

/** Metros con coma decimal y dos cifras, como se escriben en español: 3,20 m. */
export function metres(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} m`;
}

/** La cota va del lado de fuera (en contra de la normal interior) y su texto se aleja de la pared. */
function labelFor(mid: { x: number; z: number }, normal: { x: number; z: number }, text: string): PlanWall['label'] {
  const sideways = Math.abs(normal.x) > Math.abs(normal.z);
  const offset = sideways ? LABEL_OFFSET_M.sideways : LABEL_OFFSET_M.vertical;
  const anchor = !sideways ? 'middle' : normal.x > 0 ? 'end' : 'start';
  return { x: r3(mid.x - normal.x * offset), y: r3(mid.z - normal.z * offset), text, anchor };
}

/** Ancho aproximado de un carácter de cota y alto de una línea, en metros del plano. */
const GLYPH_M = 0.125;
const LINE_M = 0.28;

/** Tramo horizontal que ocupa el texto de una cota. */
function extent(label: PlanWall['label']): [number, number] {
  const width = label.text.length * GLYPH_M;
  if (label.anchor === 'start') return [label.x, label.x + width];
  return label.anchor === 'end' ? [label.x - width, label.x] : [label.x - width / 2, label.x + width / 2];
}

/** Si dos cotas caerían una encima de otra (las dos paredes de una muesca angosta), la segunda baja una línea. */
function spreadLabels(walls: PlanWall[]): void {
  const placed: PlanWall['label'][] = [];
  for (const wall of walls) {
    const label = wall.label;
    const clashes = () =>
      placed.some((other) => {
        const [a0, a1] = extent(label);
        const [b0, b1] = extent(other);
        return Math.abs(label.y - other.y) < LINE_M * 0.85 && a0 < b1 && b0 < a1;
      });
    for (let tries = 0; tries < 4 && clashes(); tries++) label.y = r3(label.y + LINE_M);
    placed.push(label);
  }
}

export function floorPlanOf(shell: RoomShell, footprints: readonly PlanFootprint[] = []): FloorPlan {
  const frames = wallFrames(shell);
  const walls: PlanWall[] = shell.walls.map((wall, i) => {
    const normal = frames[i]!.normal;
    const lengthM = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    const mid = { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 };
    return {
      id: wall.id,
      from: at(wall.start),
      to: at(wall.end),
      lengthM,
      label: labelFor(mid, normal, metres(lengthM)),
    };
  });

  spreadLabels(walls);

  const openings: PlanOpening[] = shell.openings.flatMap((o) => {
    const index = shell.walls.findIndex((w) => w.id === o.wallId);
    const wall = shell.walls[index];
    if (!wall) return [];
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) || 1;
    const dir = { x: (wall.end.x - wall.start.x) / length, z: (wall.end.z - wall.start.z) / length };
    const point = (t: number) => ({ x: wall.start.x + dir.x * t, z: wall.start.z + dir.z * t });
    const a = point(o.offsetM - o.widthM / 2);
    const b = point(o.offsetM + o.widthM / 2);
    let swing = '';
    if (o.type === 'door') {
      // La hoja gira sobre `a` y abre hacia dentro: un cuarto de círculo de radio = ancho.
      const normal = frames[index]!.normal;
      const leaf = { x: a.x + normal.x * o.widthM, z: a.z + normal.z * o.widthM };
      const cross = (leaf.x - a.x) * (b.z - a.z) - (leaf.z - a.z) * (b.x - a.x);
      const r = r3(o.widthM);
      swing = `M ${r3(a.x)} ${r3(a.z)} L ${r3(leaf.x)} ${r3(leaf.z)} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${r3(b.x)} ${r3(b.z)}`;
    }
    return [{ id: o.id, type: o.type, from: at(a), to: at(b), swing }];
  });

  const doors = shell.openings.filter((o) => o.type === 'door').length;
  const windows = shell.openings.length - doors;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return {
    viewBox: `${-MARGIN_M} ${-MARGIN_M} ${r3(shell.widthM + MARGIN_M * 2)} ${r3(shell.depthM + MARGIN_M * 2)}`,
    outline: pts(shell.walls.map((w) => w.start)),
    walls,
    openings,
    items: footprints.map((f) => ({ id: f.id, points: pts(f.corners) })),
    summary:
      `Plano del cuarto ${SHAPE_NAMES[shell.shape ?? 'rect']}: ${metres(shell.widthM)} de ancho por ${metres(shell.depthM)} de fondo, ` +
      `${plural(shell.walls.length, 'pared', 'paredes')}, ${plural(doors, 'puerta', 'puertas')} y ${plural(windows, 'ventana', 'ventanas')}.`,
  };
}
