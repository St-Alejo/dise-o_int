/**
 * Modelo de dibujo técnico, independiente del formato (patrón Composite). Una vista (planta, alzado,
 * corte) o una lámina entera es un `Drawing`: capas con nombre y una lista de entidades simples
 * (línea, polilínea, arco, círculo, texto, cota, achurado) o grupos que las trasladan y escalan.
 * Los renderizadores (SVG, DXF, PDF) recorren el mismo árbol (Visitor), así lo que se ve en
 * pantalla, lo que se imprime y lo que abre AutoCAD es lo mismo.
 *
 * Coordenadas: en una vista, metros con la y hacia ABAJO (como el papel y el SVG): la planta usa
 * (x, z) tal cual y un alzado usa (a lo largo, −altura). En una lámina, milímetros de papel.
 */
import type { Point2 } from '../../polygon.js';

/** Un punto del dibujo: x a la derecha, y hacia abajo. */
export interface P {
  x: number;
  y: number;
}

/** Capas con nombres al estilo AIA/ISO 13567, para que en CAD se puedan apagar por separado. */
export const LAYERS = {
  wall: { name: 'A-WALL', color: 7, weight: 0.5 },
  wallHatch: { name: 'A-WALL-PATT', color: 8, weight: 0.13 },
  partition: { name: 'A-WALL-PRTN', color: 7, weight: 0.35 },
  door: { name: 'A-DOOR', color: 3, weight: 0.25 },
  glazing: { name: 'A-GLAZ', color: 4, weight: 0.25 },
  furniture: { name: 'A-FURN', color: 6, weight: 0.18 },
  floorPattern: { name: 'A-FLOR-PATT', color: 9, weight: 0.09 },
  ceiling: { name: 'A-CLNG', color: 5, weight: 0.18 },
  lighting: { name: 'E-LITE', color: 2, weight: 0.25 },
  power: { name: 'E-POWR', color: 1, weight: 0.25 },
  plumbing: { name: 'P-SANR', color: 5, weight: 0.25 },
  dims: { name: 'A-ANNO-DIMS', color: 1, weight: 0.13 },
  text: { name: 'A-ANNO-TEXT', color: 7, weight: 0.18 },
  symbol: { name: 'A-ANNO-SYMB', color: 7, weight: 0.25 },
  hidden: { name: 'A-ANNO-HIDN', color: 8, weight: 0.13 },
  section: { name: 'A-SECT', color: 7, weight: 0.5 },
  frame: { name: 'G-ANNO-TTLB', color: 7, weight: 0.35 },
} as const;

export type LayerKey = keyof typeof LAYERS;
export interface LayerDef {
  name: string;
  /** Color ACI de AutoCAD (1 rojo, 2 amarillo, 3 verde, 4 cian, 5 azul, 6 magenta, 7 negro/blanco...). */
  color: number;
  /** Grosor de trazo en milímetros de papel. */
  weight: number;
}

export type HatchPattern = 'solid' | 'diagonal' | 'cross' | 'dots';
export type TextAnchor = 'start' | 'middle' | 'end';
export type LineStyle = 'continuous' | 'dashed' | 'dashdot';

interface Base {
  layer: LayerKey;
  style?: LineStyle;
}

export interface LineEntity extends Base {
  kind: 'line';
  a: P;
  b: P;
}
export interface PolylineEntity extends Base {
  kind: 'polyline';
  points: P[];
  closed: boolean;
}
export interface ArcEntity extends Base {
  kind: 'arc';
  center: P;
  radius: number;
  /** Ángulos en radianes, en el sistema del dibujo (y hacia abajo: crecen en sentido horario). */
  start: number;
  end: number;
}
export interface CircleEntity extends Base {
  kind: 'circle';
  center: P;
  radius: number;
  filled?: boolean;
}
export interface TextEntity extends Base {
  kind: 'text';
  at: P;
  text: string;
  /** Alto de la letra en unidades del dibujo. */
  height: number;
  anchor: TextAnchor;
  /** Giro en radianes (sentido horario, como el resto del dibujo). */
  rotation?: number;
  bold?: boolean;
}
/** Cota alineada entre `a` y `b`, desplazada `offset` hacia la izquierda del sentido a→b. */
export interface DimensionEntity extends Base {
  kind: 'dimension';
  a: P;
  b: P;
  offset: number;
  text: string;
  /** Alto del texto en unidades del dibujo. */
  height: number;
}
export interface HatchEntity extends Base {
  kind: 'hatch';
  outline: P[];
  pattern: HatchPattern;
  /** Separación de las líneas del achurado, en unidades del dibujo. */
  spacing: number;
}
/** Grupo (el "compuesto"): sus hijos se dibujan escalados por `scale` y luego trasladados. */
export interface GroupEntity {
  kind: 'group';
  name?: string;
  translate: P;
  scale: number;
  children: Entity[];
}

export type Entity =
  | LineEntity
  | PolylineEntity
  | ArcEntity
  | CircleEntity
  | TextEntity
  | DimensionEntity
  | HatchEntity
  | GroupEntity;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Un dibujo: entidades y un título opcional. */
export interface Drawing {
  title: string;
  /** Unidades de las coordenadas: metros (una vista) o milímetros de papel (una lámina). */
  units: 'm' | 'mm';
  entities: Entity[];
}

/** Convierte un punto de planta (x, z) en uno del dibujo. */
export const fromPlan = (p: Point2): P => ({ x: p.x, y: p.z });

/** Recorre todas las entidades simples con su transformación acumulada (el Visitor de base). */
export function walk(
  entities: readonly Entity[],
  visit: (e: Exclude<Entity, GroupEntity>, t: { scale: number; dx: number; dy: number }) => void,
  t = { scale: 1, dx: 0, dy: 0 },
): void {
  for (const e of entities) {
    if (e.kind === 'group') {
      walk(e.children, visit, { scale: t.scale * e.scale, dx: t.dx + e.translate.x * t.scale, dy: t.dy + e.translate.y * t.scale });
    } else visit(e, t);
  }
}

export const apply = (p: P, t: { scale: number; dx: number; dy: number }): P => ({ x: p.x * t.scale + t.dx, y: p.y * t.scale + t.dy });

/** Caja que envuelve todo el dibujo (las cotas y los textos incluidos, aproximados). */
export function boundsOf(entities: readonly Entity[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: P) => {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  };
  walk(entities, (e, t) => {
    const s = t.scale;
    switch (e.kind) {
      case 'line':
        add(apply(e.a, t));
        add(apply(e.b, t));
        break;
      case 'polyline':
      case 'hatch':
        for (const p of e.kind === 'polyline' ? e.points : e.outline) add(apply(p, t));
        break;
      case 'arc':
      case 'circle': {
        const c = apply(e.center, t);
        add({ x: c.x - e.radius * s, y: c.y - e.radius * s });
        add({ x: c.x + e.radius * s, y: c.y + e.radius * s });
        break;
      }
      case 'text': {
        const c = apply(e.at, t);
        const w = e.text.length * e.height * 0.6 * s;
        const x0 = e.anchor === 'start' ? c.x : e.anchor === 'middle' ? c.x - w / 2 : c.x - w;
        add({ x: x0, y: c.y - e.height * s });
        add({ x: x0 + w, y: c.y });
        break;
      }
      case 'dimension': {
        const g = dimensionGeometry(e);
        for (const p of [g.extA[0], g.extA[1], g.extB[0], g.extB[1], g.textAt]) add(apply(p, t));
        break;
      }
    }
  });
  return Number.isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** Geometría de una cota: líneas de extensión, línea de cota y dónde va el texto. */
export function dimensionGeometry(d: Pick<DimensionEntity, 'a' | 'b' | 'offset' | 'height'>): {
  extA: [P, P];
  extB: [P, P];
  line: [P, P];
  textAt: P;
  angle: number;
} {
  const dx = d.b.x - d.a.x;
  const dy = d.b.y - d.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Normal "a la izquierda" del sentido a→b con la y hacia abajo.
  const nx = uy;
  const ny = -ux;
  const off = (p: P, k: number): P => ({ x: p.x + nx * k, y: p.y + ny * k });
  const gap = d.height * 0.4;
  const over = d.height * 0.5;
  const sign = Math.sign(d.offset) || 1;
  const la = off(d.a, d.offset);
  const lb = off(d.b, d.offset);
  let angle = Math.atan2(dy, dx);
  // El texto nunca queda boca abajo.
  if (angle > Math.PI / 2 + 1e-6 || angle <= -Math.PI / 2 - 1e-6) angle += Math.PI;
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  // "Arriba" del texto según como se lee (con la y hacia abajo).
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };
  const mid = { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 };
  return {
    extA: [off(d.a, gap * sign), off(d.a, d.offset + over * sign)],
    extB: [off(d.b, gap * sign), off(d.b, d.offset + over * sign)],
    line: [la, lb],
    // El texto va centrado y apoyado sobre la línea de cota, en el sentido en que se lee.
    textAt: { x: mid.x + up.x * d.height * 0.3, y: mid.y + up.y * d.height * 0.3 },
    angle,
  };
}

/** Texto de una medida en metros, como se acota en arquitectura (dos decimales, coma decimal). */
export function formatMeters(m: number): string {
  return (Math.round(m * 100) / 100).toFixed(2).replace('.', ',');
}

/** Constructor fluido de dibujos (patrón Builder): las vistas lo usan para no repetir literales. */
export class DrawingBuilder {
  readonly entities: Entity[] = [];

  constructor(
    /** Alto de letra base, en unidades del dibujo (en una vista: metros reales). */
    readonly textHeight: number,
  ) {}

  line(layer: LayerKey, a: P, b: P, style?: LineStyle): this {
    this.entities.push({ kind: 'line', layer, a, b, ...(style ? { style } : {}) });
    return this;
  }

  polyline(layer: LayerKey, points: P[], closed = true, style?: LineStyle): this {
    if (points.length >= 2) this.entities.push({ kind: 'polyline', layer, points, closed, ...(style ? { style } : {}) });
    return this;
  }

  arc(layer: LayerKey, center: P, radius: number, start: number, end: number): this {
    this.entities.push({ kind: 'arc', layer, center, radius, start, end });
    return this;
  }

  circle(layer: LayerKey, center: P, radius: number, filled = false): this {
    this.entities.push({ kind: 'circle', layer, center, radius, ...(filled ? { filled } : {}) });
    return this;
  }

  text(layer: LayerKey, at: P, text: string, opts: { scale?: number; anchor?: TextAnchor; rotation?: number; bold?: boolean } = {}): this {
    this.entities.push({
      kind: 'text',
      layer,
      at,
      text,
      height: this.textHeight * (opts.scale ?? 1),
      anchor: opts.anchor ?? 'middle',
      ...(opts.rotation ? { rotation: opts.rotation } : {}),
      ...(opts.bold ? { bold: true } : {}),
    });
    return this;
  }

  dimension(a: P, b: P, offset: number, text?: string): this {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.005) return this;
    this.entities.push({ kind: 'dimension', layer: 'dims', a, b, offset, text: text ?? formatMeters(len), height: this.textHeight * 0.85 });
    return this;
  }

  hatch(layer: LayerKey, outline: P[], pattern: HatchPattern, spacing: number): this {
    if (outline.length >= 3) this.entities.push({ kind: 'hatch', layer, outline, pattern, spacing });
    return this;
  }

  group(children: Entity[], translate: P, scale = 1, name?: string): this {
    this.entities.push({ kind: 'group', translate, scale, children, ...(name ? { name } : {}) });
    return this;
  }

  build(title: string, units: Drawing['units'] = 'm'): Drawing {
    return { title, units, entities: this.entities };
  }
}
