/**
 * Renderizador SVG (un Visitor del modelo de dibujo). Aplana los grupos y escribe todo en las
 * unidades finales: milímetros de papel en una lámina, metros en una vista suelta. Los grosores de
 * trazo de cada capa están en milímetros de papel; en una vista se pasan a metros con su escala.
 */
import { hatchGeometry } from './hatch.js';
import { PAPER_MM, type Sheet } from './sheet.js';
import { apply, boundsOf, dimensionGeometry, LAYERS, walk, type Drawing, type LayerKey, type LineStyle, type P } from './model.js';

/** Colores de impresión por capa (las láminas se ven siempre sobre papel blanco). */
export const LAYER_COLORS: Record<LayerKey, string> = {
  wall: '#111111',
  wallHatch: '#8a8a8a',
  partition: '#222222',
  door: '#2d6a3e',
  glazing: '#1b6f96',
  furniture: '#5a5a5a',
  floorPattern: '#b5b5b5',
  ceiling: '#3d4f8a',
  lighting: '#b07a00',
  power: '#b8322a',
  plumbing: '#1f5fbf',
  dims: '#333333',
  text: '#111111',
  symbol: '#111111',
  hidden: '#9a9a9a',
  section: '#111111',
  frame: '#111111',
};

export interface SvgOptions {
  /** Escala 1:N de una vista en metros (para pasar los grosores de trazo a metros). */
  scale?: number;
  /** Margen alrededor de una vista suelta, en unidades del dibujo. */
  padding?: number;
  /** Atributos de accesibilidad: título del SVG. */
  title?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function renderSvg(drawing: Drawing, opts: SvgOptions = {}): string {
  /** Milímetros de papel → unidades del dibujo. */
  const mm = drawing.units === 'mm' ? 1 : (opts.scale ?? 50) / 1000;
  const out: string[] = [];
  const stroke = (layer: LayerKey, style?: LineStyle, factor = 1) => {
    const w = LAYERS[layer].weight * mm * factor;
    const dash = style === 'dashed' ? ` stroke-dasharray="${n(1.6 * mm)} ${n(1 * mm)}"` : style === 'dashdot' ? ` stroke-dasharray="${n(4 * mm)} ${n(1 * mm)} ${n(0.4 * mm)} ${n(1 * mm)}"` : '';
    return `stroke="${LAYER_COLORS[layer]}" stroke-width="${n(w)}"${dash}`;
  };
  const pts = (ps: readonly P[]) => ps.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

  walk(drawing.entities, (e, t) => {
    const k = t.scale;
    switch (e.kind) {
      case 'line': {
        const a = apply(e.a, t);
        const b = apply(e.b, t);
        out.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" ${stroke(e.layer, e.style)}/>`);
        break;
      }
      case 'polyline': {
        const tag = e.closed ? 'polygon' : 'polyline';
        out.push(`<${tag} points="${pts(e.points.map((p) => apply(p, t)))}" fill="none" ${stroke(e.layer, e.style)}/>`);
        break;
      }
      case 'arc': {
        const c = apply(e.center, t);
        const r = e.radius * k;
        const a = { x: c.x + r * Math.cos(e.start), y: c.y + r * Math.sin(e.start) };
        const b = { x: c.x + r * Math.cos(e.end), y: c.y + r * Math.sin(e.end) };
        let sweep = e.end - e.start;
        while (sweep < 0) sweep += Math.PI * 2;
        out.push(`<path d="M${n(a.x)} ${n(a.y)} A${n(r)} ${n(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${n(b.x)} ${n(b.y)}" fill="none" ${stroke(e.layer, e.style, 0.8)}/>`);
        break;
      }
      case 'circle': {
        const c = apply(e.center, t);
        const fill = e.filled ? LAYER_COLORS[e.layer] : 'none';
        out.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(e.radius * k)}" fill="${fill}" ${stroke(e.layer, e.style)}/>`);
        break;
      }
      case 'text': {
        const p = apply(e.at, t);
        const rot = e.rotation ? ` transform="rotate(${n((e.rotation * 180) / Math.PI)} ${n(p.x)} ${n(p.y)})"` : '';
        out.push(
          `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(e.height * k)}" text-anchor="${e.anchor}" fill="${LAYER_COLORS[e.layer]}"${e.bold ? ' font-weight="700"' : ''}${rot}>${esc(e.text)}</text>`,
        );
        break;
      }
      case 'dimension': {
        const g = dimensionGeometry(e);
        const s = stroke('dims');
        for (const [a, b] of [g.extA, g.extB, g.line]) {
          const pa = apply(a, t);
          const pb = apply(b, t);
          out.push(`<line x1="${n(pa.x)}" y1="${n(pa.y)}" x2="${n(pb.x)}" y2="${n(pb.y)}" ${s}/>`);
        }
        // Marcas oblicuas a 45° en los extremos, como en los planos de arquitectura.
        const tick = e.height * 0.45;
        const ux = Math.cos(g.angle);
        const uy = Math.sin(g.angle);
        const diag = { x: (ux - uy) * Math.SQRT1_2, y: (uy + ux) * Math.SQRT1_2 };
        for (const p of g.line) {
          const a = apply({ x: p.x - diag.x * tick, y: p.y - diag.y * tick }, t);
          const b = apply({ x: p.x + diag.x * tick, y: p.y + diag.y * tick }, t);
          out.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" ${stroke('dims', undefined, 2.2)}/>`);
        }
        const p = apply(g.textAt, t);
        out.push(
          `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(e.height * k)}" text-anchor="middle" fill="${LAYER_COLORS.dims}" transform="rotate(${n((g.angle * 180) / Math.PI)} ${n(p.x)} ${n(p.y)})">${esc(e.text)}</text>`,
        );
        break;
      }
      case 'hatch': {
        const outline = e.outline.map((p) => apply(p, t));
        if (e.pattern === 'solid') {
          out.push(`<polygon points="${pts(outline)}" fill="${LAYER_COLORS[e.layer]}" stroke="none"/>`);
          break;
        }
        const g = hatchGeometry(outline, e.pattern, e.spacing * k);
        if (g.lines.length) {
          const d = g.lines.map(([a, b]) => `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`).join('');
          out.push(`<path d="${d}" fill="none" stroke="${LAYER_COLORS[e.layer]}" stroke-width="${n(LAYERS[e.layer].weight * mm)}"/>`);
        }
        for (const p of g.dots) out.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(0.25 * mm)}" fill="${LAYER_COLORS[e.layer]}"/>`);
        break;
      }
    }
  });

  let viewBox: string;
  let size: string;
  if (drawing.units === 'mm' && 'paper' in drawing) {
    // Una lámina mide su papel.
    const { w, h } = PAPER_MM[(drawing as Sheet).paper];
    viewBox = `0 0 ${w} ${h}`;
    size = `width="${w}mm" height="${h}mm"`;
  } else {
    const b = boundsOf(drawing.entities);
    const pad = opts.padding ?? 6 * mm;
    viewBox = `${n(b.minX - pad)} ${n(b.minY - pad)} ${n(b.maxX - b.minX + 2 * pad)} ${n(b.maxY - b.minY + 2 * pad)}`;
    size = drawing.units === 'm' ? `width="${n(((b.maxX - b.minX + 2 * pad) / mm))}mm" height="${n(((b.maxY - b.minY + 2 * pad) / mm))}mm"` : '';
  }
  const title = esc(opts.title ?? drawing.title);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${size} role="img" aria-label="${title}" font-family="Inter, Arial, DejaVu Sans, sans-serif" stroke-linecap="round" stroke-linejoin="round">`,
    `<title>${title}</title>`,
    `<rect x="${viewBox.split(' ')[0]}" y="${viewBox.split(' ')[1]}" width="100%" height="100%" fill="#ffffff"/>`,
    ...out,
    '</svg>',
  ].join('\n');
}
