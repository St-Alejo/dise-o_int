import { PHASE_LABELS, WORK_PHASES, type Takeoff } from '@interiores/shared-types';
import PDFDocument from 'pdfkit';

type Doc = InstanceType<typeof PDFDocument>;

function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

const LEFT = 40;
const RIGHT = 555;
const num = (v: number, d = 2) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d }).format(v);

/** Presupuesto de obra en PDF: APU por fase, AIU, total con mobiliario, cronograma y lista de compras. */
export function renderTakeoffPdf(t: Takeoff, opts: { roomName: string; date: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Presupuesto de obra — ${opts.roomName}`, Creator: 'Interiores IA' } });
  const done = collect(doc);
  const money = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: t.currency, maximumFractionDigits: 0 }).format(v);

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text(`Presupuesto de obra — ${opts.roomName}`);
  doc.font('Helvetica').fontSize(9.5).fillColor('#444').text(`${opts.date} · precios de referencia en ${t.currency}, orientativos · ${num(t.quantities.floorM2)} m² de piso, ${num(t.quantities.walls.reduce((s, w) => s + w.netM2, 0))} m² netos de muro`);
  doc.moveDown(0.8);

  const cols = { act: LEFT, unit: 300, qty: 330, waste: 378, unitPrice: 412, total: 480 };
  const header = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111');
    doc.text('Actividad', cols.act, y).text('Und.', cols.unit, y).text('Cant.', cols.qty, y).text('Desp.', cols.waste, y).text('P. unitario', cols.unitPrice, y).text('Total', cols.total, y, { width: RIGHT - cols.total, align: 'right' });
    doc.moveTo(LEFT, doc.y + 2).lineTo(RIGHT, doc.y + 2).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.5);
  };
  header();
  for (const phase of WORK_PHASES) {
    const lines = t.lines.filter((l) => l.phase === phase);
    if (!lines.length) continue;
    if (doc.y > 760) {
      doc.addPage();
      header();
    }
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#8a5a44').text(PHASE_LABELS[phase], LEFT);
    for (const l of lines) {
      if (doc.y > 770) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      doc.font('Helvetica').fontSize(8.5).fillColor('#111');
      doc.text(l.detail ? `${l.name} — ${l.detail}` : l.name, cols.act, y, { width: cols.unit - cols.act - 6 });
      const after = doc.y;
      doc.text(l.unit, cols.unit, y);
      doc.text(num(l.quantity), cols.qty, y);
      doc.text(l.waste ? `${Math.round(l.waste * 100)} %` : '—', cols.waste, y);
      doc.text(money(l.unitMaterial + l.unitLabor), cols.unitPrice, y);
      doc.text(money(l.total), cols.total, y, { width: RIGHT - cols.total, align: 'right' });
      doc.y = Math.max(after, doc.y) + 2;
    }
    doc.moveDown(0.3);
  }

  // Totales.
  doc.moveDown(0.4);
  const totals: [string, number, boolean?][] = [
    ['Costo directo', t.direct],
    ['Administración', t.aiu.administration],
    ['Imprevistos', t.aiu.contingency],
    ['Utilidad', t.aiu.profit],
    ['Total obra', t.works, true],
    [t.fx?.rate ? `Mobiliario (1 ${t.fx.from} = ${num(t.fx.rate)} ${t.currency})` : t.fx ? `Mobiliario (sin tasa para ${t.fx.from}: no se suma)` : 'Mobiliario', t.furniture],
    ['Total obra y mobiliario', t.total, true],
  ];
  for (const [label, value, bold] of totals) {
    if (doc.y > 780) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9.5).fillColor('#111');
    doc.text(label, 300, y).text(money(value), cols.total - 40, y, { width: RIGHT - cols.total + 40, align: 'right' });
    doc.moveDown(0.15);
  }
  if (t.budget.level !== 'none') {
    const over = t.budget.remaining < 0;
    doc.moveDown(0.2).font('Helvetica-Bold').fontSize(9.5).fillColor(over ? '#b42318' : '#067647').text(over ? `Se pasa del tope en ${money(-t.budget.remaining)}` : `Queda ${money(t.budget.remaining)} del tope`, 300);
  }

  // Cronograma.
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(`Cronograma — ${num(t.days, 1)} días hábiles`);
  doc.moveDown(0.5);
  const barLeft = 150;
  const barWidth = RIGHT - barLeft;
  const k = t.days > 0 ? barWidth / t.days : 0;
  for (const task of t.schedule) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#111').text(task.label, LEFT, y + 2, { width: barLeft - LEFT - 6 });
    const x = barLeft + task.startDay * k;
    const w = Math.max(2, task.days * k);
    doc.rect(x, y, w, 12).fill('#2f6d6a');
    const label = `día ${num(task.startDay + 1, 1)} · ${num(task.days, 1)} d`;
    doc.font('Helvetica').fontSize(7.5);
    // La etiqueta va a la derecha de la barra, o a su izquierda si no cabe en la página.
    const lx = x + w + 4 + doc.widthOfString(label) > RIGHT ? x - 4 - doc.widthOfString(label) : x + w + 4;
    doc.fillColor('#444').text(label, lx, y + 2, { lineBreak: false });
    doc.y = y + 20;
  }

  // Compras.
  doc.moveDown(1).font('Helvetica-Bold').fontSize(13).fillColor('#111').text('Materiales a comprar', LEFT);
  doc.moveDown(0.3);
  for (const p of t.purchases) {
    if (doc.y > 780) doc.addPage();
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#111').text(p.name, LEFT, y, { width: 250 });
    const after = doc.y;
    doc.text(`${num(p.quantity)} ${p.unit}`, 300, y).text(p.packs, 400, y);
    doc.y = Math.max(after, doc.y) + 2;
  }
  doc.moveDown(0.8).font('Helvetica-Oblique').fontSize(8).fillColor('#666').text('Cantidades calculadas desde el modelo, con desperdicio según el dibujo de cada acabado. Precios de referencia: ajústalos en la ficha técnica con los de tu zona y verifica las medidas en obra.', LEFT, doc.y, { width: RIGHT - LEFT });
  doc.end();
  return done;
}
