/**
 * Símbolos de instalaciones en planta (patrón Factory: un símbolo por tipo de punto) y leyenda.
 * Eléctricos en las capas E-POWR / E-LITE, hidrosanitarios en P-SANR.
 */
import type { RoomShell } from '../../domain.js';
import { roomPolygon } from '../../geometry.js';
import { polygonBounds } from '../../polygon.js';
import type { DrawingBuilder, LayerKey, P } from '../drawing/model.js';
import { formatMeters } from '../drawing/model.js';
import { isElectrical, type InstallationKind, type InstallationsSpec } from '../technical.js';
import { INSTALLATION_INFO, isOutlet, isSwitch, placePoints, type PlacedPoint } from './points.js';

export type InstallationFamily = 'electrical' | 'plumbing';

const layerOf = (k: InstallationKind): LayerKey => (!isElectrical(k) ? 'plumbing' : k === 'light' || isSwitch(k) ? 'lighting' : 'power');

/** Dibuja el símbolo de un tipo de punto centrado en `c`; `r` es su radio en metros reales. */
export function drawSymbol(d: DrawingBuilder, kind: InstallationKind, c: P, r: number): void {
  const layer = layerOf(kind);
  if (kind === 'light') {
    d.circle(layer, c, r);
    d.line(layer, { x: c.x - r * 0.7, y: c.y - r * 0.7 }, { x: c.x + r * 0.7, y: c.y + r * 0.7 });
    d.line(layer, { x: c.x - r * 0.7, y: c.y + r * 0.7 }, { x: c.x + r * 0.7, y: c.y - r * 0.7 });
    return;
  }
  if (isOutlet(kind)) {
    d.circle(layer, c, r);
    d.line(layer, { x: c.x - r, y: c.y }, { x: c.x + r, y: c.y });
    if (kind === 'outlet-gfci') d.circle(layer, c, r * 0.35, true);
    return;
  }
  if (isSwitch(kind)) {
    d.circle(layer, c, r * 0.45, true);
    d.line(layer, c, { x: c.x + r * 1.3, y: c.y - r * 1.3 });
    if (kind !== 'switch') d.line(layer, { x: c.x + r * 0.9, y: c.y - r * 0.9 }, { x: c.x + r * 1.4, y: c.y - r * 0.4 });
    if (kind === 'switch-3way') d.line(layer, { x: c.x + r * 0.5, y: c.y - r * 0.5 }, { x: c.x + r * 1, y: c.y });
    return;
  }
  if (kind === 'tv-data') {
    d.polyline(layer, [{ x: c.x, y: c.y - r }, { x: c.x + r, y: c.y + r * 0.8 }, { x: c.x - r, y: c.y + r * 0.8 }], true);
    return;
  }
  if (kind === 'floor-drain') {
    d.polyline(layer, [{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y - r }, { x: c.x + r, y: c.y + r }, { x: c.x - r, y: c.y + r }], true);
    d.line(layer, { x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
    d.line(layer, { x: c.x - r, y: c.y + r }, { x: c.x + r, y: c.y - r });
    return;
  }
  // Agua fría, caliente y desagüe: círculo; el desagüe, relleno.
  d.circle(layer, c, r * 0.8, kind === 'drain');
}

/**
 * Los puntos de una familia en planta: símbolo apenas por dentro del muro, su abreviatura con la
 * altura, el circuito, la línea de mando de cada interruptor a sus luces y la leyenda.
 */
export function drawInstallations(d: DrawingBuilder, family: InstallationFamily, shell: RoomShell, spec: InstallationsSpec, mm: (v: number) => number): void {
  const placed = placePoints(shell, spec.points).filter((p) => isElectrical(p.point.kind) === (family === 'electrical'));
  const r = mm(1.6);
  const pos = (p: PlacedPoint): P => {
    const inset = p.normal ? r * 1.6 : 0;
    return { x: p.at.x + (p.normal?.x ?? 0) * inset, y: p.at.z + (p.normal?.z ?? 0) * inset };
  };
  const byId = new Map(placed.map((p) => [p.point.id, p]));
  for (const p of placed) {
    const c = pos(p);
    drawSymbol(d, p.point.kind, c, r);
    const info = INSTALLATION_INFO[p.point.kind];
    const label = p.point.kind === 'light' ? (p.point.circuitId ?? '') : `${info.short}${p.normal ? ` h=${formatMeters(p.point.heightM)}` : ''}${p.point.circuitId ? ` ${p.point.circuitId}` : ''}`;
    // La etiqueta hacia dentro del cuarto: en una pared que mira a −x, a la izquierda del símbolo.
    const toLeft = (p.normal?.x ?? 0) < -0.5;
    if (label) d.text('text', { x: c.x + (toLeft ? -r * 1.5 : r * 1.5), y: c.y + r * 2.4 }, label, { scale: 0.6, anchor: toLeft ? 'end' : 'start' });
    // Línea de mando: del interruptor a cada luz que enciende (curva punteada).
    if (isSwitch(p.point.kind)) {
      for (const id of p.point.controls ?? []) {
        const light = byId.get(id);
        if (!light) continue;
        const a = c;
        const b = pos(light);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const bend = { x: mid.x - ((b.y - a.y) / len) * len * 0.15, y: mid.y + ((b.x - a.x) / len) * len * 0.15 };
        const pts: P[] = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * bend.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * bend.y + t * t * b.y });
        }
        d.polyline('lighting', pts, false, 'dashed');
      }
    }
  }

  // Leyenda bajo la planta: un renglón por tipo presente.
  const kinds = [...new Set(placed.map((p) => p.point.kind))];
  if (!kinds.length) return;
  const b = polygonBounds(roomPolygon(shell));
  const h = d.textHeight;
  let y = b.maxZ + mm(28);
  d.text('text', { x: b.minX, y }, family === 'electrical' ? 'CONVENCIONES ELÉCTRICAS' : 'CONVENCIONES HIDROSANITARIAS', { scale: 0.8, anchor: 'start', bold: true });
  for (const k of kinds) {
    y += h * 1.7;
    drawSymbol(d, k, { x: b.minX + r, y: y - h * 0.35 }, r);
    const n = placed.filter((p) => p.point.kind === k).length;
    d.text('text', { x: b.minX + r * 3, y }, `${INSTALLATION_INFO[k].label} (${n})`, { scale: 0.7, anchor: 'start' });
  }
}
