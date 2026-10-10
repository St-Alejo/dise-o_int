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
  name: string;
  centre: PlanPoint;
  /** Caja de la huella en el plano (para saber si cabe su nombre). */
  widthM: number;
  depthM: number;
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
  name?: string;
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

/** Distancia libre desde un lado de un mueble hasta la pared que tiene enfrente. */
export interface PlanClearance {
  from: PlanPoint;
  to: PlanPoint;
  lengthM: number;
  label: PlanPoint & { text: string };
}

/**
 * Cotas de un mueble: cuánto hay desde cada uno de sus cuatro lados (los de su caja en el plano)
 * hasta la pared de enfrente. Sirve para centrar una cama o dejar un pasillo de 70 cm.
 */
export function clearancesOf(shell: Pick<RoomShell, 'walls'>, corners: readonly { x: number; z: number }[]): PlanClearance[] {
  if (!corners.length) return [];
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const mid = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  const rays = [
    { o: { x: box.minX, z: mid.z }, d: { x: -1, z: 0 } },
    { o: { x: box.maxX, z: mid.z }, d: { x: 1, z: 0 } },
    { o: { x: mid.x, z: box.minZ }, d: { x: 0, z: -1 } },
    { o: { x: mid.x, z: box.maxZ }, d: { x: 0, z: 1 } },
  ];
  return rays.flatMap(({ o, d }) => {
    let best = Infinity;
    for (const w of shell.walls) {
      // Coordenada "a través" del rayo (la que no cambia) y "a lo largo" (por donde avanza).
      const [a0, a1, b0, b1, across, start] = d.x !== 0 ? [w.start.z, w.start.x, w.end.z, w.end.x, o.z, o.x] : [w.start.x, w.start.z, w.end.x, w.end.z, o.x, o.z];
      if (Math.abs(a0 - b0) < 1e-9 || (a0 - across) * (b0 - across) > 0) continue;
      const hit = a1 + ((across - a0) / (b0 - a0)) * (b1 - a1);
      const t = (hit - start) * (d.x + d.z);
      if (t > -1e-6 && t < best) best = t;
    }
    if (!Number.isFinite(best) || best < 0.02) return [];
    const to = { x: o.x + d.x * best, z: o.z + d.z * best };
    // El texto va a un lado de la línea, en su punto medio.
    const side = 0.14;
    return [
      {
        from: at(o),
        to: at(to),
        lengthM: best,
        label: { x: r3((o.x + to.x) / 2 + Math.abs(d.z) * side), y: r3((o.z + to.z) / 2 - Math.abs(d.x) * side), text: metres(best) },
      },
    ];
  });
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
    items: footprints.map((f) => {
      const xs = f.corners.map((c) => c.x);
      const zs = f.corners.map((c) => c.z);
      const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      return {
        id: f.id,
        points: pts(f.corners),
        name: f.name ?? '',
        centre: { x: r3((minX + maxX) / 2), y: r3((minZ + maxZ) / 2) },
        widthM: maxX - minX,
        depthM: maxZ - minZ,
      };
    }),
    summary:
      `Plano del cuarto ${SHAPE_NAMES[shell.shape ?? 'rect']}: ${metres(shell.widthM)} de ancho por ${metres(shell.depthM)} de fondo, ` +
      `${plural(shell.walls.length, 'pared', 'paredes')}, ${plural(doors, 'puerta', 'puertas')} y ${plural(windows, 'ventana', 'ventanas')}.`,
  };
}

/** Nombre recortado para que quepa en una huella de `widthM` × `depthM` con letra de `fontM` ('' si no cabe). */
export function captionFor(name: string, widthM: number, depthM: number, fontM: number): string {
  const fits = depthM > fontM ? Math.floor(widthM / (fontM * 0.42)) : 0;
  if (fits < 3 || !name) return '';
  return name.length > fits ? `${name.slice(0, fits - 1)}…` : name;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const xml = (text: string) => text.replace(/[&<>"]/g, (c) => XML_ESCAPES[c] ?? c);

/**
 * El plano como archivo SVG suelto, para imprimir o enviar: fondo blanco, paredes negras, cotas y
 * el nombre de cada mueble. No depende de los estilos de la app.
 */
export function planSvg(shell: RoomShell, footprints: readonly PlanFootprint[], title: string): string {
  const plan = floorPlanOf(shell, footprints);
  const [x, y, w, h] = plan.viewBox.split(' ').map(Number) as [number, number, number, number];
  const font = Math.min(0.42, Math.max(0.2, Math.max(shell.widthM, shell.depthM) * 0.042));
  const head = font * 2.4;
  const line = (a: PlanPoint, b: PlanPoint, style: string) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${style}/>`;
  const parts = [
    `<rect x="${x}" y="${r3(y - head)}" width="${w}" height="${r3(h + head)}" fill="#ffffff"/>`,
    `<text x="${r3(x + 0.3)}" y="${r3(y - head / 2)}" font-size="${r3(font * 1.3)}" font-weight="700" dominant-baseline="middle">${xml(title)}</text>`,
    `<polygon points="${plan.outline}" fill="#f4f1ec"/>`,
    ...plan.items.map((item) => {
      const caption = captionFor(item.name, item.widthM, item.depthM, font * 0.72);
      const label = caption
        ? `<text x="${item.centre.x}" y="${item.centre.y}" font-size="${r3(font * 0.72)}" text-anchor="middle" dominant-baseline="middle">${xml(caption)}</text>`
        : '';
      return `<polygon points="${item.points}" fill="#e3dbcf" stroke="#6f655b" stroke-width="0.025"/>${label}`;
    }),
    ...plan.walls.map((wall) => line(wall.from, wall.to, 'stroke="#1b1714" stroke-width="0.1" stroke-linecap="square"')),
    ...plan.openings.map(
      (o) =>
        line(o.from, o.to, o.type === 'door' ? 'stroke="#f4f1ec" stroke-width="0.12"' : 'stroke="#3f6b5a" stroke-width="0.06"') +
        (o.swing ? `<path d="${o.swing}" fill="none" stroke="#6f655b" stroke-width="0.025" stroke-dasharray="0.08 0.06"/>` : ''),
    ),
    ...plan.walls.map(
      (wall) =>
        `<text x="${wall.label.x}" y="${wall.label.y}" font-size="${r3(font)}" text-anchor="${wall.label.anchor}" dominant-baseline="middle" fill="#4a423b">${wall.label.text}</text>`,
    ),
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${r3(y - head)} ${w} ${r3(h + head)}" width="${Math.round(w * 120)}" height="${Math.round((h + head) * 120)}" ` +
    `font-family="Helvetica, Arial, sans-serif" fill="#1b1714"><title>${xml(title)}</title>${parts.join('')}</svg>`
  );
}
