/**
 * Renderizador DXF (AutoCAD R12, ASCII), escrito a mano para no depender de librerías. Es el
 * formato que abre cualquier programa de CAD (AutoCAD, LibreCAD, BricsCAD, QCAD). Exporta en
 * metros reales con una capa por familia de elementos (A-WALL, A-DOOR, A-ANNO-DIMS...).
 *
 * - Se invierte la y (el dibujo va con la y hacia abajo; el CAD, hacia arriba).
 * - Cotas y achurados se descomponen en líneas y textos: R12 no tiene HATCH y así se ven igual en
 *   todos los programas.
 * - Los caracteres fuera de Latin-1 van como \U+XXXX, que AutoCAD y LibreCAD entienden.
 */
import { hatchGeometry } from './hatch.js';
import { apply, boundsOf, dimensionGeometry, LAYERS, walk, type Drawing, type LayerKey, type LineStyle, type P } from './model.js';

const LTYPES: Record<LineStyle, { name: string; desc: string; pattern: number[] }> = {
  continuous: { name: 'CONTINUOUS', desc: 'Solid line', pattern: [] },
  dashed: { name: 'DASHED', desc: '__ __ __', pattern: [0.05, -0.03] },
  dashdot: { name: 'DASHDOT', desc: '__ . __ .', pattern: [0.12, -0.03, 0, -0.03] },
};

/** Texto apto para DXF R12: sin saltos de línea y con lo que no es Latin-1 escapado. */
export function dxfText(s: string): string {
  return [...s.replace(/[\r\n]+/g, ' ')]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return code > 255 ? `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}` : ch;
    })
    .join('');
}

const f = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

class DxfWriter {
  private readonly lines: string[] = [];

  pair(code: number, value: string | number): this {
    this.lines.push(String(code), typeof value === 'number' ? f(value) : value);
    return this;
  }

  toString(): string {
    return this.lines.join('\r\n') + '\r\n';
  }
}

export interface DxfOptions {
  /** Escala 1:N con la que se pensó la vista (decide el factor de escala de los tipos de línea). */
  scale?: number;
}

/** Un DXF de una o varias vistas en metros, colocadas una al lado de otra. */
export function renderDxf(views: readonly Drawing[], opts: DxfOptions = {}): string {
  const w = new DxfWriter();
  const used = new Set<LayerKey>();
  const entities = new DxfWriter();
  const flip = (p: P): P => ({ x: p.x, y: -p.y });
  const ltype = (style?: LineStyle) => LTYPES[style ?? 'continuous'].name;

  const line = (layer: LayerKey, a: P, b: P, style?: LineStyle) => {
    used.add(layer);
    const pa = flip(a);
    const pb = flip(b);
    entities.pair(0, 'LINE').pair(8, LAYERS[layer].name).pair(6, ltype(style)).pair(10, pa.x).pair(20, pa.y).pair(30, 0).pair(11, pb.x).pair(21, pb.y).pair(31, 0);
  };
  const text = (layer: LayerKey, at: P, value: string, height: number, anchor: 'start' | 'middle' | 'end', rotation = 0) => {
    used.add(layer);
    const p = flip(at);
    const just = anchor === 'start' ? 0 : anchor === 'middle' ? 1 : 2;
    entities.pair(0, 'TEXT').pair(8, LAYERS[layer].name).pair(10, p.x).pair(20, p.y).pair(30, 0).pair(40, height).pair(1, dxfText(value));
    if (rotation) entities.pair(50, (-rotation * 180) / Math.PI);
    if (just) entities.pair(72, just).pair(11, p.x).pair(21, p.y).pair(31, 0);
  };

  let offsetX = 0;
  for (const view of views) {
    const b = boundsOf(view.entities);
    const shift = offsetX - b.minX;
    walk(view.entities, (e, t0) => {
      const t = { ...t0, dx: t0.dx + shift };
      switch (e.kind) {
        case 'line':
          line(e.layer, apply(e.a, t), apply(e.b, t), e.style);
          break;
        case 'polyline': {
          used.add(e.layer);
          const ps = e.points.map((p) => apply(p, t));
          entities.pair(0, 'POLYLINE').pair(8, LAYERS[e.layer].name).pair(6, ltype(e.style)).pair(66, 1).pair(10, 0).pair(20, 0).pair(30, 0).pair(70, e.closed ? 1 : 0);
          for (const p of ps.map(flip)) entities.pair(0, 'VERTEX').pair(8, LAYERS[e.layer].name).pair(10, p.x).pair(20, p.y).pair(30, 0);
          entities.pair(0, 'SEQEND').pair(8, LAYERS[e.layer].name);
          break;
        }
        case 'arc': {
          used.add(e.layer);
          const c = flip(apply(e.center, t));
          // Con la y invertida, el arco horario de start a end es antihorario de −end a −start.
          const deg = (a: number) => ((((-a * 180) / Math.PI) % 360) + 360) % 360;
          entities.pair(0, 'ARC').pair(8, LAYERS[e.layer].name).pair(10, c.x).pair(20, c.y).pair(30, 0).pair(40, e.radius * t.scale).pair(50, deg(e.end)).pair(51, deg(e.start));
          break;
        }
        case 'circle': {
          used.add(e.layer);
          const c = flip(apply(e.center, t));
          entities.pair(0, 'CIRCLE').pair(8, LAYERS[e.layer].name).pair(10, c.x).pair(20, c.y).pair(30, 0).pair(40, e.radius * t.scale);
          break;
        }
        case 'text':
          text(e.layer, apply(e.at, t), e.text, e.height * t.scale, e.anchor, e.rotation);
          break;
        case 'dimension': {
          const g = dimensionGeometry(e);
          for (const [a, b] of [g.extA, g.extB, g.line]) line('dims', apply(a, t), apply(b, t));
          const tick = e.height * 0.45;
          const ux = Math.cos(g.angle);
          const uy = Math.sin(g.angle);
          const diag = { x: (ux - uy) * Math.SQRT1_2, y: (uy + ux) * Math.SQRT1_2 };
          for (const p of g.line) line('dims', apply({ x: p.x - diag.x * tick, y: p.y - diag.y * tick }, t), apply({ x: p.x + diag.x * tick, y: p.y + diag.y * tick }, t));
          text('dims', apply(g.textAt, t), e.text, e.height * t.scale, 'middle', g.angle);
          break;
        }
        case 'hatch': {
          const outline = e.outline.map((p) => apply(p, t));
          const g = hatchGeometry(outline, e.pattern, e.spacing * t.scale);
          for (const [a, b] of g.lines) line(e.layer, a, b);
          for (const p of g.dots) {
            used.add(e.layer);
            const c = flip(p);
            entities.pair(0, 'POINT').pair(8, LAYERS[e.layer].name).pair(10, c.x).pair(20, c.y).pair(30, 0);
          }
          break;
        }
      }
    });
    // La vista siguiente, a la derecha con un hueco de 1 m.
    offsetX += b.maxX - b.minX + 1;
  }

  const ltscale = (opts.scale ?? 50) / 50;
  w.pair(0, 'SECTION').pair(2, 'HEADER');
  w.pair(9, '$ACADVER').pair(1, 'AC1009');
  w.pair(9, '$DWGCODEPAGE').pair(3, 'ANSI_1252');
  w.pair(9, '$INSUNITS').pair(70, 6);
  w.pair(9, '$MEASUREMENT').pair(70, 1);
  w.pair(9, '$LTSCALE').pair(40, ltscale);
  w.pair(0, 'ENDSEC');
  w.pair(0, 'SECTION').pair(2, 'TABLES');
  w.pair(0, 'TABLE').pair(2, 'LTYPE').pair(70, Object.keys(LTYPES).length);
  for (const lt of Object.values(LTYPES)) {
    const total = lt.pattern.reduce((s, v) => s + Math.abs(v), 0);
    w.pair(0, 'LTYPE').pair(2, lt.name).pair(70, 0).pair(3, lt.desc).pair(72, 65).pair(73, lt.pattern.length).pair(40, total);
    for (const v of lt.pattern) w.pair(49, v);
  }
  w.pair(0, 'ENDTAB');
  const layers = (Object.keys(LAYERS) as LayerKey[]).filter((k) => used.has(k));
  w.pair(0, 'TABLE').pair(2, 'LAYER').pair(70, layers.length + 1);
  w.pair(0, 'LAYER').pair(2, '0').pair(70, 0).pair(62, 7).pair(6, 'CONTINUOUS');
  for (const k of layers) w.pair(0, 'LAYER').pair(2, LAYERS[k].name).pair(70, 0).pair(62, LAYERS[k].color).pair(6, 'CONTINUOUS');
  w.pair(0, 'ENDTAB');
  w.pair(0, 'TABLE').pair(2, 'STYLE').pair(70, 1);
  w.pair(0, 'STYLE').pair(2, 'STANDARD').pair(70, 0).pair(40, 0).pair(41, 1).pair(50, 0).pair(71, 0).pair(42, 0.2).pair(3, 'txt').pair(4, '');
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');
  w.pair(0, 'SECTION').pair(2, 'ENTITIES');
  return w.toString() + entities.toString() + ['0', 'ENDSEC', '0', 'EOF'].join('\r\n') + '\r\n';
}

/** Lee las entidades de un DXF ASCII (para las pruebas: tipo y capa de cada una). */
export function parseDxfEntities(dxf: string): { type: string; layer: string; values: Map<number, string[]> }[] {
  const rows = dxf.split(/\r?\n/);
  const out: { type: string; layer: string; values: Map<number, string[]> }[] = [];
  let inEntities = false;
  let cur: { type: string; layer: string; values: Map<number, string[]> } | null = null;
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const code = Number(rows[i]!.trim());
    const value = rows[i + 1]!;
    if (code === 2 && value === 'ENTITIES') inEntities = true;
    if (!inEntities) continue;
    if (code === 0) {
      if (cur) out.push(cur);
      cur = value === 'ENDSEC' || value === 'EOF' ? null : { type: value, layer: '', values: new Map() };
      if (value === 'ENDSEC') inEntities = false;
      continue;
    }
    if (!cur) continue;
    if (code === 8) cur.layer = value;
    const list = cur.values.get(code) ?? [];
    list.push(value);
    cur.values.set(code, list);
  }
  return out;
}
