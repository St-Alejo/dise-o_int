/**
 * Reglas de normativa y ergonomía (patrón Specification): cada regla dice si aplica al cuarto y,
 * si aplica, qué encontró, con lo medido y lo exigido. Las reglas leen los números del perfil
 * elegido (`profiles.ts`); el motor (`check.ts`) solo las recorre.
 */
import type { RoomShell, RoomType } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { footprint, rotateXZ } from '../../geometry.js';
import { canStand, type WalkWorld } from '../../walk.js';
import { distanceToBoundary, pointInPolygon, polygonBounds, quadInsidePolygon, segmentsCross, signedArea, type Point2 } from '../../polygon.js';
import { wallFrames } from '../../walls.js';
import { partitionSolids } from '../../zones.js';
import { formatMeters } from '../drawing/model.js';
import type { DaylightResult, IlluminanceGrid } from './lighting-calc.js';
import type { ComplianceProfile } from './profiles.js';
import type { InstallationsSpec } from '../technical.js';
import { BREAKER_USAGE, loadSchedule, MAX_POINTS_PER_CIRCUIT } from '../installations/circuits.js';
import { isOutlet, isSwitch, placePoints } from '../installations/points.js';
import { OUTLET_REACH_M, WET_FIXTURES, WET_REACH_M } from '../installations/propose.js';

export type ComplianceStatus = 'pass' | 'warn' | 'fail' | 'na';
export const COMPLIANCE_GROUPS = ['circulation', 'accessibility', 'habitability', 'ergonomics', 'lighting', 'electrical'] as const;
export type ComplianceGroup = (typeof COMPLIANCE_GROUPS)[number];

export const GROUP_TITLES: Record<ComplianceGroup, string> = {
  circulation: 'Circulación',
  accessibility: 'Accesibilidad',
  habitability: 'Habitabilidad',
  ergonomics: 'Ergonomía',
  lighting: 'Iluminación',
  electrical: 'Instalaciones eléctricas',
};

export interface ComplianceFinding {
  /** Estable entre revisiones: regla + objeto. */
  id: string;
  ruleId: string;
  group: ComplianceGroup;
  status: ComplianceStatus;
  title: string;
  detail: string;
  measured?: string;
  required?: string;
  reference: string;
  /** Piezas implicadas (al pulsar el hallazgo se selecciona la primera). */
  placementIds: string[];
}

export interface Doorway {
  id: string;
  widthM: number;
  /** Centro del vano sobre la cara interior y normal hacia dentro. */
  at: Point2;
  normal: Point2;
}

/** Todo lo que una regla necesita saber del cuarto. Lo caro (rejillas) se calcula una vez y solo si hace falta. */
export interface ComplianceContext {
  shell: RoomShell;
  pieces: readonly DesignPiece[];
  roomType: RoomType;
  profile: ComplianceProfile;
  accessible: boolean;
  room: Point2[];
  /** Muebles que estorban el paso. */
  obstacles: DesignPiece[];
  world: WalkWorld;
  doors: Doorway[];
  /** Celdas a las que se llega desde la puerta con un círculo de ese diámetro. */
  reachable(diameterM: number): Point2[];
  lighting(): IlluminanceGrid;
  daylight(): DaylightResult;
  /** Puntos y circuitos de la ficha técnica (vacío si aún no hay). */
  installations: InstallationsSpec;
}

export interface ComplianceRule {
  id: string;
  group: ComplianceGroup;
  applies(ctx: ComplianceContext): boolean;
  evaluate(ctx: ComplianceContext): ComplianceFinding[];
}

const m = (v: number) => `${formatMeters(v)} m`;
const pct = (v: number) => `${v.toFixed(1).replace('.', ',')} %`;
const flat = (v: { x: number; z: number }): Point2 => ({ x: v.x, z: v.z });
export const cornersOf = (p: Pick<DesignPiece, 'position' | 'dims' | 'rotationY'>): Point2[] => footprint(p.position, p.dims, p.rotationY).corners.map(flat);

/** Tramo junto a la cabecera que no se mide a los lados (donde van las mesas de noche). */
const SIDE_HEAD_M = 0.6;

/** Piezas auxiliares: basta con llegar a ellas con el paso mínimo, no con el de la circulación principal. */
const SECONDARY = new Set(['nightstand', 'side-table', 'plant', 'floor-lamp', 'ottoman', 'stool', 'vanity-stool', 'dining-chair', 'office-chair', 'vase']);

/** "de el clóset" → "del clóset". */
const of = (label: string) => `de ${label}`.replace(/^de el /, 'del ');

/** Asientos y lo que se mueve con la mano: no cuentan al medir holguras delante de un mueble. */
const MOVABLE = new Set(['office-chair', 'dining-chair', 'stool', 'vanity-stool', 'ottoman', 'rug', 'plant', 'vase', 'floor-lamp']);

function finding(rule: Pick<ComplianceRule, 'id' | 'group'>, ctx: ComplianceContext, f: Omit<ComplianceFinding, 'ruleId' | 'group' | 'reference' | 'placementIds'> & { placementIds?: string[] }): ComplianceFinding {
  return { ruleId: rule.id, group: rule.group, reference: ctx.profile.references[rule.group], placementIds: [], ...f };
}

/** Estado según cuánto se queda corto: a partir del 75 % de lo exigido es un aviso. */
function grade(measured: number, required: number): ComplianceStatus {
  if (measured >= required - 1e-6) return 'pass';
  return measured >= required * 0.75 ? 'warn' : 'fail';
}

// ---------------------------------------------------------------------------
// Geometría de apoyo
// ---------------------------------------------------------------------------

/** ¿Se tocan dos polígonos convexos? (separación de ejes). */
export function convexOverlap(a: readonly Point2[], b: readonly Point2[], tolerance = 0.005): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const nx = -(q.z - p.z);
      const nz = q.x - p.x;
      const len = Math.hypot(nx, nz) || 1;
      const proj = (pts: readonly Point2[]) => pts.map((v) => (v.x * nx + v.z * nz) / len);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) + tolerance || Math.max(...pb) <= Math.min(...pa) + tolerance) return false;
    }
  }
  return true;
}

/**
 * Hondo libre (m) delante de una cara de un mueble: se alarga un rectángulo del ancho de esa cara
 * hasta que choca con una pared, un tabique u otro mueble. `side` es el eje local hacia el que mira
 * la cara (+z = el frente).
 */
export function freeDepth(ctx: Pick<ComplianceContext, 'room' | 'shell' | 'obstacles'>, piece: DesignPiece, side: 'front' | 'left' | 'right', max = 2): number {
  const local = side === 'front' ? { x: 0, z: 1 } : side === 'left' ? { x: -1, z: 0 } : { x: 1, z: 0 };
  const dir = rotateXZ(local.x, local.z, piece.rotationY);
  const across = rotateXZ(local.z, -local.x, piece.rotationY);
  const halfDepth = (side === 'front' ? piece.dims.z : piece.dims.x) / 2;
  // A los lados solo cuenta el tramo hacia el frente: junto a la cabecera de una cama van las
  // mesas de noche, y no por eso falta sitio para subirse.
  const headroom = side === 'front' ? 0 : Math.min(SIDE_HEAD_M, piece.dims.z * 0.4);
  const halfFace = ((side === 'front' ? piece.dims.x : piece.dims.z) - headroom) / 2;
  const width = Math.max(0.15, halfFace - 0.05);
  const shift = rotateXZ(0, headroom / 2, piece.rotationY);
  const face = { x: piece.position.x + dir.x * halfDepth + shift.x, z: piece.position.z + dir.z * halfDepth + shift.z };
  const others = ctx.obstacles.filter((o) => o.id !== piece.id && !MOVABLE.has(o.subcategory ?? '')).map(cornersOf);
  const partitions = partitionSolids(ctx.shell);
  const free = (d: number) => {
    const near = { x: face.x + dir.x * 0.01, z: face.z + dir.z * 0.01 };
    const far = { x: face.x + dir.x * d, z: face.z + dir.z * d };
    const rect = [
      { x: near.x - across.x * width, z: near.z - across.z * width },
      { x: near.x + across.x * width, z: near.z + across.z * width },
      { x: far.x + across.x * width, z: far.z + across.z * width },
      { x: far.x - across.x * width, z: far.z - across.z * width },
    ];
    const center = { x: (near.x + far.x) / 2, z: (near.z + far.z) / 2 };
    if (!quadInsidePolygon(rect, center, ctx.room)) return false;
    if (partitions.some((s) => rect.some((p, i) => segmentsCross(p, rect[(i + 1) % 4]!, s.a, s.b)))) return false;
    return !others.some((o) => convexOverlap(rect, o));
  };
  let depth = 0;
  for (let d = 0.05; d <= max + 1e-9; d += 0.05) {
    if (!free(d)) break;
    depth = d;
  }
  return depth;
}

/** Las puertas del cuarto, cada una con su centro sobre la pared y la normal hacia dentro. */
export function doorwaysOf(shell: Pick<RoomShell, 'walls' | 'openings'>): Doorway[] {
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  return shell.openings.flatMap((o) => {
    const f = frames.get(o.wallId);
    if (o.type !== 'door' || !f) return [];
    const along = f.startAtBase ? o.offsetM : f.length - o.offsetM;
    return [{ id: o.id, widthM: o.widthM, at: { x: f.base.x + f.dir.x * along, z: f.base.z + f.dir.z * along }, normal: f.normal }];
  });
}

/** Paso de la rejilla con que se recorre el piso. */
export const REACH_GRID_M = 0.1;

/** Celdas del piso a las que llega, desde alguna puerta, un círculo del diámetro dado. */
export function reachableCells(world: WalkWorld, doors: readonly Doorway[], diameterM: number): Point2[] {
  const r = diameterM / 2;
  const b = polygonBounds(world.room);
  const cols = Math.ceil((b.maxX - b.minX) / REACH_GRID_M) + 1;
  const rows = Math.ceil((b.maxZ - b.minZ) / REACH_GRID_M) + 1;
  const at = (i: number, j: number): Point2 => ({ x: b.minX + i * REACH_GRID_M, z: b.minZ + j * REACH_GRID_M });
  const seen = new Set<number>();
  const out: Point2[] = [];
  const queue: [number, number][] = [];
  const visit = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows || seen.has(j * cols + i)) return;
    seen.add(j * cols + i);
    if (!canStand(at(i, j), world, r)) return;
    out.push(at(i, j));
    queue.push([i, j]);
  };
  for (const door of doors) {
    // Justo al entrar: a un radio de la pared, buscando alrededor si la puerta está en un rincón.
    const start = { x: door.at.x + door.normal.x * (r + 0.05), z: door.at.z + door.normal.z * (r + 0.05) };
    const si = Math.round((start.x - b.minX) / REACH_GRID_M);
    const sj = Math.round((start.z - b.minZ) / REACH_GRID_M);
    const reach = Math.max(1, Math.round(door.widthM / 2 / REACH_GRID_M));
    let found = false;
    for (let k = 0; k <= reach && !found; k++) {
      for (let di = -k; di <= k && !found; di++) {
        for (let dj = -k; dj <= k && !found; dj++) {
          const before = out.length;
          visit(si + di, sj + dj);
          found = out.length > before;
        }
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const [i, j] = queue[q]!;
    visit(i + 1, j);
    visit(i - 1, j);
    visit(i, j + 1);
    visit(i, j - 1);
  }
  return out;
}

/** ¿Llega a la pieza alguien que circula por esas celdas? (a un brazo de su borde). */
function served(cells: readonly Point2[], piece: DesignPiece, diameterM: number): boolean {
  const outline = cornersOf(piece);
  const limit = diameterM / 2 + 0.4;
  return cells.some((c) => distanceToBoundary(c, outline) <= limit || pointInPolygon(c, outline));
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

const clearPath: ComplianceRule = {
  id: 'clear-path',
  group: 'circulation',
  applies: () => true,
  evaluate(ctx) {
    const width = ctx.accessible ? ctx.profile.accessiblePathM : ctx.profile.clearPathM;
    const minimum = ctx.profile.minPassM;
    if (!ctx.doors.length) return [finding(this, ctx, { id: 'clear-path', status: 'na', title: 'Paso libre', detail: 'El cuarto no tiene ninguna puerta dibujada: no se puede revisar la circulación desde la entrada.' })];
    const main = ctx.reachable(width);
    if (!main.length) {
      const culprit = [...ctx.obstacles].sort((a, b) => Math.min(...ctx.doors.map((d) => distanceToBoundary(d.at, cornersOf(a)))) - Math.min(...ctx.doors.map((d) => distanceToBoundary(d.at, cornersOf(b)))))[0];
      return [
        finding(this, ctx, {
          id: 'clear-path:entry',
          status: 'fail',
          title: `La entrada no deja un paso de ${m(width)}`,
          detail: culprit ? `${culprit.name} queda muy cerca de la puerta.` : 'El cuarto es demasiado estrecho junto a la puerta.',
          required: m(width),
          placementIds: culprit ? [culprit.id] : [],
        }),
      ];
    }
    const narrow = ctx.reachable(minimum);
    const out: ComplianceFinding[] = [];
    for (const p of ctx.obstacles) {
      if (served(main, p, width)) continue;
      const ok = served(narrow, p, minimum);
      if (ok && SECONDARY.has(p.subcategory ?? '')) continue;
      out.push(
        finding(this, ctx, {
          id: `clear-path:${p.id}`,
          status: ok ? 'warn' : 'fail',
          title: ok ? `A ${p.name} se llega con menos de ${m(width)}` : `No se llega a ${p.name}`,
          detail: ok ? `El paso hasta ${p.name} es más angosto que la circulación recomendada.` : `Ni con ${m(minimum)} de paso se llega desde la puerta: abre un pasillo.`,
          required: m(width),
          placementIds: [p.id],
        }),
      );
    }
    if (!out.length) out.push(finding(this, ctx, { id: 'clear-path', status: 'pass', title: 'Paso libre', detail: `Desde la puerta se llega a todos los muebles con un paso de ${m(width)}.`, required: m(width) }));
    return out;
  },
};

const doorWidth: ComplianceRule = {
  id: 'door-width',
  group: 'circulation',
  applies: () => true,
  evaluate(ctx) {
    const required = ctx.accessible ? ctx.profile.accessibleDoorWidthM : ctx.profile.doorWidthM;
    const doors = [
      ...ctx.doors.map((d) => ({ id: d.id, label: 'Puerta del cuarto', width: d.widthM })),
      ...(ctx.shell.zones ?? []).flatMap((z) => (z.door && !z.open ? [{ id: z.id, label: `Puerta de ${z.name ?? 'la zona'}`, width: z.door.widthM }] : [])),
    ];
    if (!doors.length) return [finding(this, ctx, { id: 'door-width', status: 'na', title: 'Ancho de puertas', detail: 'No hay puertas dibujadas.' })];
    return doors.map((d) => {
      const status = d.width >= required - 1e-6 ? 'pass' : 'fail';
      return finding(this, ctx, {
        id: `door-width:${d.id}`,
        status,
        title: `${d.label}: vano de ${m(d.width)}`,
        detail: status === 'pass' ? 'El vano cumple.' : `El vano es angosto${ctx.accessible ? ' para una silla de ruedas' : ''}: amplíalo a ${m(required)}.`,
        measured: m(d.width),
        required: m(required),
      });
    });
  },
};

const turningCircle: ComplianceRule = {
  id: 'turning-circle',
  group: 'accessibility',
  applies: (ctx) => ctx.accessible,
  evaluate(ctx) {
    const d = ctx.profile.turningDiameterM;
    const reached = ctx.reachable(ctx.profile.accessiblePathM);
    const fits = reached.some((c) => canStand(c, ctx.world, d / 2));
    const out = [
      finding(this, ctx, {
        id: 'turning-circle',
        status: fits ? 'pass' : 'fail',
        title: `Giro de silla de ruedas (Ø ${formatMeters(d)} m)`,
        detail: fits ? 'Hay un espacio libre donde la silla puede dar la vuelta.' : 'No queda ningún círculo libre de ese tamaño al que se llegue desde la puerta. Despeja el centro del cuarto.',
        required: `Ø ${m(d)}`,
      }),
    ];
    for (const zone of (ctx.shell.zones ?? []).filter((z) => z.kind === 'bathroom' && !z.open)) {
      const b = polygonBounds(zone.outline);
      let ok = false;
      for (let x = b.minX; x <= b.maxX && !ok; x += 0.1) for (let z = b.minZ; z <= b.maxZ && !ok; z += 0.1) ok = pointInPolygon({ x, z }, zone.outline) && canStand({ x, z }, ctx.world, d / 2);
      out.push(
        finding(this, ctx, {
          id: `turning-circle:${zone.id}`,
          status: ok ? 'pass' : 'fail',
          title: `Giro dentro de ${zone.name ?? 'el baño'}`,
          detail: ok ? 'La silla puede girar dentro.' : 'El baño es pequeño para girar una silla de ruedas.',
          required: `Ø ${m(d)}`,
        }),
      );
    }
    return out;
  },
};

const ceilingHeight: ComplianceRule = {
  id: 'ceiling-height',
  group: 'habitability',
  applies: () => true,
  evaluate(ctx) {
    const h = ctx.shell.heightM;
    const need = ctx.profile.minCeilingM;
    const status = h >= need - 1e-6 ? 'pass' : h >= need - 0.2 ? 'warn' : 'fail';
    return [finding(this, ctx, { id: 'ceiling-height', status, title: 'Altura libre', detail: status === 'pass' ? 'La altura de piso a cielo raso cumple.' : 'El cuarto es bajo para el perfil elegido.', measured: m(h), required: `≥ ${m(need)}` })];
  },
};

const naturalLight: ComplianceRule = {
  id: 'natural-light',
  group: 'habitability',
  applies: () => true,
  evaluate(ctx) {
    const floor = Math.abs(signedArea(ctx.room));
    const windows = ctx.shell.openings.filter((o) => o.type === 'window').reduce((sum, o) => sum + o.widthM * o.heightM, 0);
    const wet = ctx.roomType === 'bathroom';
    // Se supone practicable la mitad de cada ventana (corrediza): es lo que ventila.
    const light = windows / floor;
    const air = windows / 2 / floor;
    const soften = (s: ComplianceStatus): ComplianceStatus => (wet && s === 'fail' ? 'warn' : s);
    const ls = soften(grade(light, ctx.profile.naturalLightRatio));
    const vs = soften(grade(air, ctx.profile.ventilationRatio));
    const note = wet ? ' En un baño se admite extracción mecánica.' : '';
    return [
      finding(this, ctx, {
        id: 'natural-light',
        status: ls,
        title: 'Iluminación natural',
        detail: (ls === 'pass' ? 'El área de ventanas es suficiente para el piso.' : 'Poca ventana para el tamaño del piso.') + (ls === 'pass' ? '' : note),
        measured: pct(light * 100),
        required: `≥ ${pct(ctx.profile.naturalLightRatio * 100)} del piso`,
      }),
      finding(this, ctx, {
        id: 'ventilation',
        status: vs,
        title: 'Ventilación natural',
        detail: (vs === 'pass' ? 'Se puede ventilar abriendo las ventanas.' : 'El área que se abre es poca para ventilar.') + (vs === 'pass' ? '' : note) + ' (Se supone que abre la mitad de cada ventana.)',
        measured: pct(air * 100),
        required: `≥ ${pct(ctx.profile.ventilationRatio * 100)} del piso`,
      }),
    ];
  },
};

const fixtureClearance: ComplianceRule = {
  id: 'clearance',
  group: 'ergonomics',
  applies: () => true,
  evaluate(ctx) {
    const out: ComplianceFinding[] = [];
    for (const p of ctx.pieces) {
      if (p.supportId) continue;
      const key = p.category === 'bed' ? 'bed' : (p.subcategory ?? '');
      const spec = ctx.profile.clearances[key];
      if (!spec || (p.mount !== 'floor' && p.mount !== 'wall')) continue;
      const need = ctx.accessible ? spec.accessibleM : spec.minM;
      if (key === 'bed') {
        const sides = [freeDepth(ctx, p, 'left', need + 0.4), freeDepth(ctx, p, 'right', need + 0.4)].sort((a, b) => b - a);
        const best = sides[0]!;
        const double = p.dims.x >= 1.3;
        let status = grade(best, need);
        if (status === 'pass' && double && sides[1]! < need * 0.75) status = 'warn';
        out.push(
          finding(this, ctx, {
            id: `clearance:${p.id}`,
            status,
            title: `Espacio junto a ${spec.label}`,
            detail: status === 'pass' ? 'Se puede subir y tender la cama.' : double && best >= need ? 'Una cama doble necesita paso por los dos lados.' : 'Falta espacio a los lados para subir a la cama.',
            measured: double ? `${m(sides[0]!)} y ${m(sides[1]!)}` : m(best),
            required: m(need),
            placementIds: [p.id],
          }),
        );
        continue;
      }
      const free = freeDepth(ctx, p, 'front', need + 0.4);
      const status = grade(free, need);
      out.push(
        finding(this, ctx, {
          id: `clearance:${p.id}`,
          status,
          title: `Espacio delante ${of(spec.label)}`,
          detail: status === 'pass' ? 'Se puede usar con comodidad.' : `Delante ${of(spec.label)} queda poco espacio para usarlo.`,
          measured: m(free),
          required: m(need),
          placementIds: [p.id],
        }),
      );
    }
    return out;
  },
};

const kitchenTriangle: ComplianceRule = {
  id: 'kitchen-triangle',
  group: 'ergonomics',
  applies: (ctx) => ctx.roomType === 'kitchen' || ctx.pieces.filter((p) => ['sink', 'stove', 'fridge'].includes(p.subcategory ?? '')).length >= 2,
  evaluate(ctx) {
    const pick = (sub: string) => ctx.pieces.find((p) => p.category === 'kitchen' && p.subcategory === sub);
    const sink = pick('sink');
    const stove = pick('stove');
    const fridge = pick('fridge');
    const missing = [!sink && 'el lavaplatos', !stove && 'la estufa', !fridge && 'la nevera'].filter(Boolean);
    if (!sink || !stove || !fridge) return [finding(this, ctx, { id: 'kitchen-triangle', status: 'na', title: 'Triángulo de trabajo', detail: `Falta ${missing.join(' y ')} para revisarlo.` })];
    const t = ctx.profile.kitchenTriangle;
    const d = (a: DesignPiece, b: DesignPiece) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const legs = [d(sink, stove), d(stove, fridge), d(fridge, sink)];
    const perimeter = legs.reduce((a, b) => a + b, 0);
    const okPerimeter = perimeter >= t.minPerimeterM && perimeter <= t.maxPerimeterM;
    const badLeg = legs.some((l) => l < t.minLegM || l > t.maxLegM);
    const status: ComplianceStatus = okPerimeter && !badLeg ? 'pass' : 'warn';
    return [
      finding(this, ctx, {
        id: 'kitchen-triangle',
        status,
        title: 'Triángulo de trabajo',
        detail: status === 'pass' ? 'Lavaplatos, estufa y nevera quedan a una distancia cómoda.' : perimeter > t.maxPerimeterM ? 'Se camina demasiado entre lavaplatos, estufa y nevera.' : perimeter < t.minPerimeterM ? 'Lavaplatos, estufa y nevera quedan apretados.' : 'Algún lado del triángulo es muy corto o muy largo.',
        measured: `${m(perimeter)} (lados ${legs.map(formatMeters).join(' · ')})`,
        required: `${formatMeters(t.minPerimeterM)}–${formatMeters(t.maxPerimeterM)} m, lados de ${formatMeters(t.minLegM)} a ${formatMeters(t.maxLegM)} m`,
        placementIds: [sink.id, stove.id, fridge.id],
      }),
    ];
  },
};

const workHeights: ComplianceRule = {
  id: 'work-height',
  group: 'ergonomics',
  applies: () => true,
  evaluate(ctx) {
    return ctx.pieces.flatMap((p) => {
      const range = ctx.profile.heights[p.subcategory ?? ''];
      if (!range) return [];
      const top = p.position.y + p.dims.y;
      // Un lavamanos de pared es más alto que su mueble: se mide su borde, que es el tope.
      const ok = top >= range.min - 0.005 && top <= range.max + 0.005;
      return [
        finding(this, ctx, {
          id: `work-height:${p.id}`,
          status: ok ? 'pass' : 'warn',
          title: `${range.label}: altura`,
          detail: ok ? 'Altura de trabajo cómoda.' : top < range.min ? 'Queda bajo: obliga a agacharse.' : 'Queda alto para trabajar cómodo.',
          measured: m(top),
          required: `${formatMeters(range.min)}–${formatMeters(range.max)} m`,
          placementIds: [p.id],
        }),
      ];
    });
  },
};

const illuminance: ComplianceRule = {
  id: 'illuminance',
  group: 'lighting',
  applies: () => true,
  evaluate(ctx) {
    const target = ctx.profile.targetLux[ctx.roomType];
    const grid = ctx.lighting();
    const lamps = ctx.pieces.filter((p) => p.category === 'lighting').map((p) => p.id);
    if (!lamps.length || grid.avgLux <= 0) {
      return [finding(this, ctx, { id: 'illuminance', status: 'fail', title: 'Iluminación artificial', detail: 'No hay luminarias: de noche el cuarto queda a oscuras.', required: `${target} lx` })];
    }
    const avg = Math.round(grid.avgLux);
    const status = avg >= target ? 'pass' : avg >= target * 0.6 ? 'warn' : 'fail';
    const out = [
      finding(this, ctx, {
        id: 'illuminance',
        status,
        title: 'Iluminancia media',
        detail: status === 'pass' ? 'Las luminarias dan luz suficiente para el uso del cuarto.' : 'Falta luz para el uso del cuarto: añade luminarias o usa bombillas de más lúmenes.',
        measured: `${avg} lx`,
        required: `${target} lx a ${formatMeters(grid.workPlaneM)} m`,
        placementIds: lamps,
      }),
    ];
    const u = grid.uniformity;
    out.push(
      finding(this, ctx, {
        id: 'uniformity',
        status: u >= ctx.profile.uniformity ? 'pass' : 'warn',
        title: 'Uniformidad',
        detail: u >= ctx.profile.uniformity ? 'La luz se reparte bien por el cuarto.' : 'Hay zonas mucho más oscuras que otras: reparte las luminarias.',
        measured: u.toFixed(2).replace('.', ','),
        required: `≥ ${ctx.profile.uniformity.toFixed(2).replace('.', ',')}`,
        placementIds: lamps,
      }),
    );
    return out;
  },
};

const daylightFactor: ComplianceRule = {
  id: 'daylight',
  group: 'lighting',
  applies: () => true,
  evaluate(ctx) {
    const need = ctx.profile.daylightFactor[ctx.roomType];
    const day = ctx.daylight();
    if (need <= 0) return [finding(this, ctx, { id: 'daylight', status: 'na', title: 'Luz natural', detail: 'Para este tipo de cuarto no se exige luz natural.', measured: pct(day.factorPct) })];
    const status: ComplianceStatus = day.factorPct >= need ? 'pass' : day.factorPct >= need * 0.5 ? 'warn' : 'fail';
    return [
      finding(this, ctx, {
        id: 'daylight',
        status,
        title: 'Factor de luz diurna',
        detail: status === 'pass' ? `Con cielo cubierto a mediodía llegan unos ${Math.round(day.grid.avgLux)} lx de luz natural.` : 'De día hará falta encender luces: amplía las ventanas o usa colores claros.',
        measured: pct(day.factorPct),
        required: `≥ ${pct(need)}`,
      }),
    ];
  },
};

const hasElectrical = (ctx: ComplianceContext) => ctx.installations.points.some((p) => isOutlet(p.kind) || isSwitch(p.kind) || p.kind === 'light');
const noPoints = (rule: Pick<ComplianceRule, 'id' | 'group'>, ctx: ComplianceContext, title: string) =>
  finding(rule, ctx, { id: rule.id, status: 'na', title, detail: 'Aún no hay puntos eléctricos: usa "Proponer instalaciones" en la pestaña Pro.' });

/** Desde cualquier punto del muro (sin contar las puertas) hay una toma a menos de 1,8 m, medido por el perímetro. */
const outletSpacing: ComplianceRule = {
  id: 'outlet-spacing',
  group: 'electrical',
  applies: (ctx) => ctx.roomType !== 'bathroom',
  evaluate(ctx) {
    if (!hasElectrical(ctx)) return [noPoints(this, ctx, 'Tomas por el perímetro')];
    const starts = new Map<string, number>();
    let total = 0;
    for (const w of ctx.shell.walls) {
      starts.set(w.id, total);
      total += Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
    }
    const outlets = ctx.installations.points
      .filter((p) => isOutlet(p.kind) && p.wallId !== undefined && p.offsetM !== undefined && starts.has(p.wallId))
      .map((p) => starts.get(p.wallId!)! + p.offsetM!);
    const doors = ctx.shell.openings
      .filter((o) => o.type === 'door' && starts.has(o.wallId))
      .map((o) => [starts.get(o.wallId)! + o.offsetM - o.widthM / 2, starts.get(o.wallId)! + o.offsetM + o.widthM / 2] as const);
    let worst = 0;
    for (let s = 0.05; s < total; s += 0.1) {
      if (doors.some(([a, b]) => s > a && s < b)) continue;
      const d = outlets.length ? Math.min(...outlets.map((o) => Math.min(Math.abs(s - o), total - Math.abs(s - o)))) : Infinity;
      worst = Math.max(worst, d);
    }
    const ok = worst <= OUTLET_REACH_M + 0.05;
    return [
      finding(this, ctx, {
        id: 'outlet-spacing',
        status: ok ? 'pass' : 'warn',
        title: 'Tomas por el perímetro',
        detail: ok ? 'Desde cualquier punto del muro hay una toma a menos de 1,80 m.' : 'Hay tramos de muro lejos de una toma: se acabarían usando extensiones.',
        measured: Number.isFinite(worst) ? `${m(worst)} hasta la toma más cercana` : 'sin tomas',
        required: `≤ ${m(OUTLET_REACH_M)}`,
      }),
    ];
  },
};

/** Las tomas a menos de 1,8 m de un aparato con agua llevan protección diferencial (GFCI). */
const gfciNearWater: ComplianceRule = {
  id: 'gfci',
  group: 'electrical',
  applies: (ctx) => ctx.pieces.some((p) => WET_FIXTURES.has(p.subcategory ?? '')),
  evaluate(ctx) {
    if (!hasElectrical(ctx)) return [noPoints(this, ctx, 'Tomas GFCI junto al agua')];
    const wet = ctx.pieces.filter((p) => !p.supportId && WET_FIXTURES.has(p.subcategory ?? ''));
    const required = `GFCI a menos de ${m(WET_REACH_M)} del agua`;
    const bad = placePoints(ctx.shell, ctx.installations.points).filter(
      (pp) => pp.point.kind === 'outlet' && wet.some((w) => Math.hypot(w.position.x - pp.at.x, w.position.z - pp.at.z) <= WET_REACH_M),
    );
    if (!bad.length) return [finding(this, ctx, { id: 'gfci', status: 'pass', title: 'Tomas GFCI junto al agua', detail: 'Las tomas cerca del agua tienen protección diferencial.', required })];
    return bad.map((pp) =>
      finding(this, ctx, { id: `gfci:${pp.point.id}`, status: 'fail', title: 'Toma sin GFCI junto al agua', detail: 'Cámbiala por una toma con protección diferencial (GFCI).', required }),
    );
  },
};

/** Un interruptor a mano al entrar por cada puerta. */
const switchAtDoor: ComplianceRule = {
  id: 'switch-door',
  group: 'electrical',
  applies: (ctx) => ctx.doors.length > 0,
  evaluate(ctx) {
    if (!hasElectrical(ctx)) return [noPoints(this, ctx, 'Interruptor junto a la puerta')];
    const switches = placePoints(ctx.shell, ctx.installations.points).filter((pp) => isSwitch(pp.point.kind));
    return ctx.doors.map((d) => {
      const near = switches.some((s) => Math.hypot(s.at.x - d.at.x, s.at.z - d.at.z) <= d.widthM / 2 + 0.6);
      return finding(this, ctx, {
        id: `switch-door:${d.id}`,
        status: near ? 'pass' : 'warn',
        title: 'Interruptor junto a la puerta',
        detail: near ? 'Al entrar se enciende la luz sin cruzar el cuarto a oscuras.' : 'Al entrar no hay un interruptor a mano: ponlo del lado de la chapa a 1,20 m.',
        required: 'a menos de 0,60 m del marco',
      });
    });
  },
};

/** Ningún circuito por encima del 80 % de su interruptor ni con más de 12 salidas. */
const circuitLoad: ComplianceRule = {
  id: 'circuit-load',
  group: 'electrical',
  applies: (ctx) => ctx.installations.circuits.length > 0,
  evaluate(ctx) {
    return loadSchedule(ctx.installations).rows.map((r) => {
      const status: ComplianceStatus = r.usage > BREAKER_USAGE + 1e-9 ? 'fail' : r.points > MAX_POINTS_PER_CIRCUIT ? 'warn' : 'pass';
      return finding(this, ctx, {
        id: `circuit-load:${r.circuit.id}`,
        status,
        title: `Circuito ${r.circuit.id} · ${r.circuit.name}`,
        detail:
          status === 'pass'
            ? `${r.points} salidas en un interruptor de ${r.circuit.breakerA} A con cable AWG ${r.awg}.`
            : status === 'fail'
              ? 'El circuito va sobrecargado: reparte sus salidas en otro circuito.'
              : 'Demasiadas salidas en un solo circuito: divídelo.',
        measured: `${Math.round(r.va)} VA · ${Math.round(r.usage * 100)} % · ${r.points} salidas`,
        required: `≤ ${Math.round(BREAKER_USAGE * 100)} % y ≤ ${MAX_POINTS_PER_CIRCUIT} salidas`,
      });
    });
  },
};

/** Todas las reglas, en el orden en que se muestran. */
export const COMPLIANCE_RULES: readonly ComplianceRule[] = [
  clearPath,
  doorWidth,
  turningCircle,
  ceilingHeight,
  naturalLight,
  fixtureClearance,
  kitchenTriangle,
  workHeights,
  illuminance,
  daylightFactor,
  outletSpacing,
  gfciNearWater,
  switchAtDoor,
  circuitLoad,
];
