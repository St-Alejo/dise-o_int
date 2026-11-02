import {
  apply,
  dimensionGeometry,
  hatchGeometry,
  LAYER_COLORS,
  LAYERS,
  PAPER_MM,
  walk,
  type LayerKey,
  type LineStyle,
  type P,
  type Sheet,
} from '@interiores/shared-types';
import PDFDocument from 'pdfkit';

/** Puntos PDF por milímetro. */
const MM = 72 / 25.4;

type Doc = InstanceType<typeof PDFDocument>;

function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * Juego de planos en PDF vectorial (otro Visitor del modelo de dibujo): una página por lámina, del
 * tamaño de su papel, con los mismos trazos, grosores y textos que la vista previa SVG. Se imprime
 * a escala real ("tamaño real" en el diálogo de impresión).
 */
export async function renderDrawingSetPdf(sheets: readonly Sheet[], title: string): Promise<Buffer> {
  const first = sheets[0];
  const size = (s: Sheet) => [PAPER_MM[s.paper].w * MM, PAPER_MM[s.paper].h * MM] as [number, number];
  const doc = new PDFDocument({ size: first ? size(first) : 'A3', layout: 'portrait', margin: 0, autoFirstPage: false, info: { Title: title, Creator: 'Interiores IA' } });
  const done = collect(doc);
  for (const sheet of sheets) {
    doc.addPage({ size: size(sheet), margin: 0 });
    drawSheet(doc, sheet);
  }
  if (!sheets.length) doc.addPage();
  doc.end();
  return done;
}

const pt = (p: P): [number, number] => [p.x * MM, p.y * MM];

function stroke(doc: Doc, layer: LayerKey, style?: LineStyle, factor = 1): void {
  doc.lineWidth(Math.max(0.1, LAYERS[layer].weight * MM * factor)).strokeColor(LAYER_COLORS[layer]);
  if (style === 'dashed') doc.dash(1.6 * MM, { space: 1 * MM });
  else if (style === 'dashdot') doc.dash(4 * MM, { space: 1.2 * MM });
  else doc.undash();
}

function text(doc: Doc, value: string, at: P, height: number, anchor: 'start' | 'middle' | 'end', color: string, bold = false, rotation = 0): void {
  const size = height * MM;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  const width = doc.widthOfString(value);
  const [x, y] = pt(at);
  const dx = anchor === 'start' ? 0 : anchor === 'middle' ? -width / 2 : -width;
  doc.save();
  if (rotation) doc.rotate((rotation * 180) / Math.PI, { origin: [x, y] });
  // pdfkit coloca el texto por arriba de la línea: se sube para que `at` sea la línea base.
  doc.text(value, x + dx, y - size * 0.78, { lineBreak: false });
  doc.restore();
}

function drawSheet(doc: Doc, sheet: Sheet): void {
  walk(sheet.entities, (e, t) => {
    const k = t.scale;
    switch (e.kind) {
      case 'line': {
        stroke(doc, e.layer, e.style);
        doc.moveTo(...pt(apply(e.a, t))).lineTo(...pt(apply(e.b, t))).stroke();
        break;
      }
      case 'polyline': {
        const ps = e.points.map((p) => pt(apply(p, t)));
        stroke(doc, e.layer, e.style);
        doc.moveTo(...ps[0]!);
        for (const p of ps.slice(1)) doc.lineTo(...p);
        if (e.closed) doc.closePath();
        doc.stroke();
        break;
      }
      case 'arc': {
        const c = apply(e.center, t);
        const r = e.radius * k;
        const a = { x: c.x + r * Math.cos(e.start), y: c.y + r * Math.sin(e.start) };
        const b = { x: c.x + r * Math.cos(e.end), y: c.y + r * Math.sin(e.end) };
        let sweep = e.end - e.start;
        while (sweep < 0) sweep += Math.PI * 2;
        stroke(doc, e.layer, e.style, 0.8);
        doc.path(`M${a.x * MM} ${a.y * MM} A${r * MM} ${r * MM} 0 ${sweep > Math.PI ? 1 : 0} 1 ${b.x * MM} ${b.y * MM}`).stroke();
        break;
      }
      case 'circle': {
        const [x, y] = pt(apply(e.center, t));
        stroke(doc, e.layer, e.style);
        doc.circle(x, y, e.radius * k * MM);
        if (e.filled) doc.fillAndStroke(LAYER_COLORS[e.layer], LAYER_COLORS[e.layer]);
        else doc.stroke();
        break;
      }
      case 'text':
        text(doc, e.text, apply(e.at, t), e.height * k, e.anchor, LAYER_COLORS[e.layer], e.bold, e.rotation);
        break;
      case 'dimension': {
        const g = dimensionGeometry(e);
        stroke(doc, 'dims');
        for (const [a, b] of [g.extA, g.extB, g.line]) doc.moveTo(...pt(apply(a, t))).lineTo(...pt(apply(b, t))).stroke();
        const tick = e.height * 0.45;
        const ux = Math.cos(g.angle);
        const uy = Math.sin(g.angle);
        const diag = { x: (ux - uy) * Math.SQRT1_2, y: (uy + ux) * Math.SQRT1_2 };
        stroke(doc, 'dims', undefined, 2.2);
        for (const p of g.line) {
          doc
            .moveTo(...pt(apply({ x: p.x - diag.x * tick, y: p.y - diag.y * tick }, t)))
            .lineTo(...pt(apply({ x: p.x + diag.x * tick, y: p.y + diag.y * tick }, t)))
            .stroke();
        }
        text(doc, e.text, apply(g.textAt, t), e.height * k, 'middle', LAYER_COLORS.dims, false, g.angle);
        break;
      }
      case 'hatch': {
        const outline = e.outline.map((p) => apply(p, t));
        if (e.pattern === 'solid') {
          const ps = outline.map(pt);
          doc.moveTo(...ps[0]!);
          for (const p of ps.slice(1)) doc.lineTo(...p);
          doc.closePath().fill(LAYER_COLORS[e.layer]);
          break;
        }
        const g = hatchGeometry(outline, e.pattern, e.spacing * k);
        stroke(doc, e.layer);
        for (const [a, b] of g.lines) doc.moveTo(...pt(a)).lineTo(...pt(b));
        if (g.lines.length) doc.stroke();
        for (const p of g.dots) doc.circle(...pt(p), 0.25 * MM).fill(LAYER_COLORS[e.layer]);
        break;
      }
    }
  });
  doc.undash();
}
