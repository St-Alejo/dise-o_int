/**
 * Plantas técnicas del cuarto (lógica pura): arquitectónica, de amoblamiento, de cielo raso e
 * iluminación y de acabados. Todas parten de lo mismo (muros con grosor achurados, vanos con su
 * símbolo, tabiques de las zonas) y añaden lo suyo. Coordenadas en metros: (x, z) de la planta.
 */
import type { RoomFinishes, RoomShell } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { footprint, roomPolygon } from '../../geometry.js';
import { resolveFinishMaterial, wallMaterialId } from '../../materials.js';
import { interiorAnchor, signedArea, type Point2 } from '../../polygon.js';
import { wallFrames, type WallFrame } from '../../walls.js';
import { partitions, zoneArea } from '../../zones.js';
import type { TechnicalSpec } from '../technical.js';
import { partitionPieces, thickWalls, wallGaps, wallPieces, type ThickWall } from '../walls-2d.js';
import { DrawingBuilder, formatMeters, fromPlan, type Drawing, type P } from './model.js';
import { drawInstallations } from '../installations/plan-symbols.js';

export const PLAN_KINDS = ['architectural', 'furniture', 'ceiling', 'finishes', 'electrical', 'plumbing'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_TITLES: Record<PlanKind, string> = {
  architectural: 'Planta arquitectónica',
  furniture: 'Planta de amoblamiento',
  ceiling: 'Planta de cielo raso e iluminación',
  finishes: 'Planta de acabados',
  electrical: 'Plano eléctrico',
  plumbing: 'Plano hidrosanitario',
};

export interface PlanViewInput {
  shell: RoomShell;
  spec: TechnicalSpec;
  pieces: readonly DesignPiece[];
  finishes?: RoomFinishes | null;
  roomName: string;
}

/** Alto de la letra base en el papel (mm) y su equivalente en metros reales a la escala de la ficha. */
export const TEXT_MM = 2.5;
export const textHeightM = (spec: Pick<TechnicalSpec, 'sheet'>) => (TEXT_MM * spec.sheet.scale) / 1000;
/** Metros reales que mide `mm` de papel a la escala de la ficha. */
const paper = (spec: Pick<TechnicalSpec, 'sheet'>, mm: number) => (mm * spec.sheet.scale) / 1000;

const at = (a: Point2, dir: Point2, t: number, n: Point2 = { x: 0, z: 0 }, k = 0): P => ({ x: a.x + dir.x * t + n.x * k, y: a.z + dir.z * t + n.z * k });

/** Una planta del tipo pedido. */
export function planView(kind: PlanKind, input: PlanViewInput): Drawing {
  const { shell, spec } = input;
  const d = new DrawingBuilder(textHeightM(spec));
  const thick = thickWalls(shell, spec);
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));

  drawWalls(d, input, thick);
  drawOpenings(d, input, thick, frames, kind !== 'ceiling');
  drawPartitions(d, input);

  if (kind === 'architectural') {
    drawChainDimensions(d, input, thick, true);
    drawSectionMarker(d, input);
  } else {
    drawChainDimensions(d, input, thick, false);
  }
  if (kind === 'furniture') drawFurniture(d, input, true);
  if (kind === 'architectural') drawFurniture(d, input, false);
  if (kind === 'ceiling') drawCeiling(d, input);
  if (kind === 'finishes') drawFinishes(d, input, thick);
  if (kind === 'electrical' || kind === 'plumbing') {
    drawFurniture(d, input, false);
    drawInstallations(d, kind, shell, spec.installations, (mm) => paper(spec, mm));
  }
  drawRoomLabels(d, input, kind);
  return d.build(PLAN_TITLES[kind]);
}

function drawWalls(d: DrawingBuilder, input: PlanViewInput, thick: readonly ThickWall[]): void {
  const spacing = Math.max(0.03, textHeightM(input.spec) * 0.35);
  for (const piece of wallPieces(input.shell, input.spec)) {
    const outline = piece.outline.map(fromPlan);
    d.hatch('wallHatch', outline, 'diagonal', spacing);
    d.polyline('wall', outline, true);
  }
  // Las caras sin cortar (bajo y sobre las ventanas) se ven en proyección.
  for (const w of thick) {
    for (const g of wallGaps(input.shell).filter((g) => g.wallId === w.wallId && g.opening.type === 'window')) {
      const dir = { x: (w.inner[1].x - w.inner[0].x) / w.lengthM, z: (w.inner[1].z - w.inner[0].z) / w.lengthM };
      d.line('wall', at(w.inner[0], dir, g.from), at(w.inner[0], dir, g.from, w.outward, w.thicknessM));
      d.line('wall', at(w.inner[0], dir, g.to), at(w.inner[0], dir, g.to, w.outward, w.thicknessM));
    }
  }
}

function drawOpenings(d: DrawingBuilder, input: PlanViewInput, thick: readonly ThickWall[], frames: Map<string, WallFrame>, swings: boolean): void {
  const byId = new Map(thick.map((w) => [w.wallId, w]));
  for (const g of wallGaps(input.shell)) {
    const w = byId.get(g.wallId);
    const frame = frames.get(g.wallId);
    if (!w || !frame) continue;
    const dir = { x: (w.inner[1].x - w.inner[0].x) / w.lengthM, z: (w.inner[1].z - w.inner[0].z) / w.lengthM };
    const t = w.thicknessM;
    if (g.opening.type === 'window') {
      // Ventana: cara interior y exterior del vano y dos líneas del vidrio.
      for (const k of [0, t / 3, (2 * t) / 3, t]) d.line(k === 0 || k === t ? 'wall' : 'glazing', at(w.inner[0], dir, g.from, w.outward, k), at(w.inner[0], dir, g.to, w.outward, k));
    } else {
      // Jamba a jamba en la cara exterior (el umbral) y la hoja abierta 90° hacia dentro con su arco.
      d.line('door', at(w.inner[0], dir, g.from, w.outward, t), at(w.inner[0], dir, g.to, w.outward, t), 'dashed');
      if (!swings) continue;
      const hinge = at(w.inner[0], dir, g.from);
      const width = g.to - g.from;
      const n = frame.normal;
      const leafEnd = { x: hinge.x + n.x * width, y: hinge.y + n.z * width };
      d.line('door', hinge, leafEnd);
      const aAlong = Math.atan2(dir.z, dir.x);
      const aIn = Math.atan2(n.z, n.x);
      const delta = Math.atan2(Math.sin(aIn - aAlong), Math.cos(aIn - aAlong));
      if (delta > 0) d.arc('door', hinge, width, aAlong, aIn);
      else d.arc('door', hinge, width, aIn, aAlong);
    }
  }
}

function drawPartitions(d: DrawingBuilder, input: PlanViewInput): void {
  const spacing = Math.max(0.03, textHeightM(input.spec) * 0.35);
  for (const piece of partitionPieces(input.shell, input.spec)) {
    const outline = piece.outline.map(fromPlan);
    d.hatch('wallHatch', outline, 'diagonal', spacing);
    d.polyline('partition', outline, true);
  }
  // Puerta de cada zona, abriendo hacia dentro de la zona.
  for (const p of partitions(input.shell)) {
    if (!p.door) continue;
    const zone = input.shell.zones?.find((z) => z.id === p.zoneId);
    if (!zone) continue;
    const dir = { x: (p.b.x - p.a.x) / p.lengthM, z: (p.b.z - p.a.z) / p.lengthM };
    const ccw = signedArea(zone.outline) > 0;
    // Normal hacia el interior de la zona.
    const n = ccw ? { x: -dir.z, z: dir.x } : { x: dir.z, z: -dir.x };
    const from = p.door.offsetM - p.door.widthM / 2;
    const hinge = at(p.a, dir, from);
    const leafEnd = { x: hinge.x + n.x * p.door.widthM, y: hinge.y + n.z * p.door.widthM };
    d.line('door', hinge, leafEnd);
    const aAlong = Math.atan2(dir.z, dir.x);
    const aIn = Math.atan2(n.z, n.x);
    const delta = Math.atan2(Math.sin(aIn - aAlong), Math.cos(aIn - aAlong));
    if (delta > 0) d.arc('door', hinge, p.door.widthM, aAlong, aIn);
    else d.arc('door', hinge, p.door.widthM, aIn, aAlong);
  }
}

/**
 * Cotas por fuera de cada muro: una fila encadenada (esquina, vanos, esquina) medida en la cara
 * interior, que es lo que importa en interiores, y una fila total más afuera.
 */
function drawChainDimensions(d: DrawingBuilder, input: PlanViewInput, thick: readonly ThickWall[], chained: boolean): void {
  const gaps = wallGaps(input.shell);
  const row = paper(input.spec, 8);
  for (const w of thick) {
    const dir = { x: (w.inner[1].x - w.inner[0].x) / w.lengthM, z: (w.inner[1].z - w.inner[0].z) / w.lengthM };
    // ¿La izquierda del sentido start→end (con la y hacia abajo) es el lado de fuera?
    const left = { x: dir.z, z: -dir.x };
    const side = left.x * w.outward.x + left.z * w.outward.z >= 0 ? 1 : -1;
    const base = w.thicknessM + row;
    const stops = [0, ...gaps.filter((g) => g.wallId === w.wallId).flatMap((g) => [g.from, g.to]), w.lengthM]
      .filter((v, i, all) => i === 0 || v - all[i - 1]! > 0.005)
      .sort((a, b) => a - b);
    const point = (t: number) => at(w.inner[0], dir, t);
    if (chained && stops.length > 2) {
      for (let i = 0; i + 1 < stops.length; i++) d.dimension(point(stops[i]!), point(stops[i + 1]!), side * base);
      d.dimension(point(0), point(w.lengthM), side * (base + row));
    } else {
      d.dimension(point(0), point(w.lengthM), side * base);
    }
  }
}

function drawSectionMarker(d: DrawingBuilder, input: PlanViewInput): void {
  const s = input.spec.section;
  if (!s) return;
  const a = fromPlan(s.a);
  const b = fromPlan(s.b);
  d.line('section', a, b, 'dashdot');
  // Flechas hacia donde se mira (la izquierda de a→b en planta) y la letra en cada punta.
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const look = { x: uy, y: -ux };
  const k = paper(input.spec, 6);
  for (const p of [a, b]) {
    const tip = { x: p.x + look.x * k, y: p.y + look.y * k };
    d.line('section', p, tip);
    d.line('section', tip, { x: tip.x - look.x * k * 0.35 + ux * k * 0.25, y: tip.y - look.y * k * 0.35 + uy * k * 0.25 });
    d.line('section', tip, { x: tip.x - look.x * k * 0.35 - ux * k * 0.25, y: tip.y - look.y * k * 0.35 - uy * k * 0.25 });
    d.text('symbol', { x: p.x - ux * k * 0.6, y: p.y - uy * k * 0.6 + d.textHeight / 2 }, 'A', { scale: 1.6, bold: true });
  }
}

const isLight = (p: DesignPiece) => p.category === 'lighting';

function drawFurniture(d: DrawingBuilder, input: PlanViewInput, labelled: boolean): void {
  for (const p of input.pieces) {
    if (p.mount === 'ceiling') continue;
    const corners = footprint(p.position, p.dims, p.rotationY).corners.map((c) => ({ x: c.x, y: c.z }));
    d.polyline('furniture', corners, true, p.mount === 'wall' || p.supportId ? 'dashed' : undefined);
    if (labelled && !p.supportId && Math.min(p.dims.x, p.dims.z) > 0.35) {
      d.text('text', { x: p.position.x, y: p.position.z + d.textHeight * 0.35 }, p.name, { scale: 0.75 });
    }
  }
}

/** Cielo raso: cota de altura libre y luminarias con su símbolo (cruz en círculo) y leyenda. */
function drawCeiling(d: DrawingBuilder, input: PlanViewInput): void {
  const r = paper(input.spec, 2.5);
  let n = 0;
  for (const p of input.pieces.filter(isLight)) {
    const c = { x: p.position.x, y: p.position.z };
    n++;
    if (p.mount === 'ceiling') {
      d.circle('lighting', c, r);
      d.line('lighting', { x: c.x - r * 0.7, y: c.y - r * 0.7 }, { x: c.x + r * 0.7, y: c.y + r * 0.7 });
      d.line('lighting', { x: c.x - r * 0.7, y: c.y + r * 0.7 }, { x: c.x + r * 0.7, y: c.y - r * 0.7 });
    } else {
      // Lámpara de mesa, de pie o aplique: círculo con punto.
      d.circle('lighting', c, r * 0.7);
      d.circle('lighting', c, r * 0.18, true);
    }
    d.text('text', { x: c.x + r * 1.2, y: c.y - r * 0.8 }, `L${n}`, { scale: 0.75, anchor: 'start' });
  }
}

/** Acabados: trama del piso según su tipo, y la etiqueta del acabado de cada pared por dentro. */
function drawFinishes(d: DrawingBuilder, input: PlanViewInput, thick: readonly ThickWall[]): void {
  const finishes = input.finishes;
  const poly = roomPolygon(input.shell).map(fromPlan);
  const floor = finishes ? resolveFinishMaterial(finishes, finishes.floor) : undefined;
  const pattern = floor?.kind === 'ceramic' || floor?.kind === 'stone' ? 'cross' : floor?.kind === 'fabric' ? 'dots' : 'diagonal';
  const spacing = floor?.kind === 'ceramic' || floor?.kind === 'stone' ? 0.6 : 0.25;
  d.hatch('floorPattern', poly, pattern, spacing);
  if (!finishes) return;
  const frames = new Map(wallFrames(input.shell).map((f) => [f.id, f]));
  const inset = paper(input.spec, 5);
  for (const w of thick) {
    const frame = frames.get(w.wallId);
    const mat = resolveFinishMaterial(finishes, wallMaterialId(finishes, { id: w.wallId }));
    if (!frame || !mat) continue;
    const mid = { x: (w.inner[0].x + w.inner[1].x) / 2 + frame.normal.x * inset, y: (w.inner[0].z + w.inner[1].z) / 2 + frame.normal.z * inset };
    const angle = Math.atan2(w.inner[1].z - w.inner[0].z, w.inner[1].x - w.inner[0].x);
    const upright = Math.atan2(Math.sin(angle), Math.cos(angle));
    const rotation = upright > Math.PI / 2 || upright < -Math.PI / 2 ? upright + Math.PI : upright;
    const tiles = finishes.wallTiles && (!finishes.wallTiles.walls || finishes.wallTiles.walls.includes(w.wallId));
    const tileName = tiles ? resolveFinishMaterial(finishes, finishes.wallTiles!.material)?.name : undefined;
    d.text('text', mid, tileName ? `${mat.name} · ${tileName} h=${formatMeters(finishes.wallTiles!.heightM)}` : mat.name, { scale: 0.7, rotation });
  }
}

function drawRoomLabels(d: DrawingBuilder, input: PlanViewInput, kind: PlanKind): void {
  const { shell } = input;
  const poly = roomPolygon(shell);
  const zones = shell.zones ?? [];
  const usefulArea = Math.abs(signedArea(poly)) - zones.filter((z) => !z.open).reduce((s, z) => s + zoneArea(z), 0);
  const anchor = interiorAnchor(poly);
  const h = d.textHeight;
  const lines = [input.roomName.toUpperCase(), `A = ${formatMeters(usefulArea)} m²`];
  if (kind === 'ceiling') lines.push(`h libre = ${formatMeters(shell.heightM)}`);
  if (kind === 'finishes' && input.finishes) {
    const floor = resolveFinishMaterial(input.finishes, input.finishes.floor);
    const ceiling = resolveFinishMaterial(input.finishes, input.finishes.ceiling);
    if (floor) lines.push(`Piso: ${floor.name}`);
    if (ceiling) lines.push(`Techo: ${ceiling.name}`);
  }
  lines.forEach((text, i) => d.text('text', { x: anchor.x, y: anchor.z + i * h * 1.5 }, text, { scale: i === 0 ? 1.2 : 0.9, bold: i === 0 }));
  for (const z of zones) {
    const c = interiorAnchor(z.outline);
    d.text('text', { x: c.x, y: c.z }, (z.name ?? 'Zona').toUpperCase(), { scale: 0.9, bold: true });
    d.text('text', { x: c.x, y: c.z + h * 1.4 }, `A = ${formatMeters(zoneArea(z))} m²`, { scale: 0.8 });
  }
}
