import { CATEGORY_LABELS_ES, wallFrames, type RoomShell, type ShoppingList } from '@interiores/shared-types';
import PDFDocument from 'pdfkit';

const CATEGORY_LABELS: Record<string, string> = CATEGORY_LABELS_ES;

const money = (value: number | null, currency: string) =>
  value === null ? '—' : new Intl.NumberFormat('es', { style: 'currency', currency }).format(value);

type Doc = InstanceType<typeof PDFDocument>;

function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** La tabla de productos con su total, desde donde esté el cursor del documento. */
function drawShoppingList(doc: Doc, list: ShoppingList): void {
  const cols = { name: 48, qty: 330, unit: 370, subtotal: 460 };
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(10);
    const y = doc.y;
    doc.text('Producto', cols.name, y).text('Cant.', cols.qty, y).text('Precio', cols.unit, y).text('Subtotal', cols.subtotal, y);
    doc.moveTo(48, doc.y + 2).lineTo(547, doc.y + 2).strokeColor('#ccc').stroke();
    doc.moveDown(0.6).font('Helvetica');
  };
  header();

  let lastCategory = '';
  for (const line of list.lines) {
    if (doc.y > 740) {
      doc.addPage();
      header();
    }
    if (line.category !== lastCategory) {
      lastCategory = line.category;
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).fillColor('#8a5a44').text(CATEGORY_LABELS[line.category] ?? line.category, cols.name);
      doc.fillColor('#000').font('Helvetica');
    }
    const y = doc.y;
    doc.fontSize(10);
    if (line.productUrl) {
      doc.fillColor('#1a56db').text(line.name, cols.name, y, { width: 270, link: line.productUrl, underline: true });
    } else {
      doc.text(line.name, cols.name, y, { width: 270 });
    }
    const afterName = doc.y;
    doc.fillColor('#000');
    doc.text(String(line.quantity), cols.qty, y);
    doc.text(money(line.unitPrice, line.currency), cols.unit, y);
    doc.text(money(line.subtotal, line.currency), cols.subtotal, y);
    doc.y = Math.max(afterName, doc.y);
    if (line.variant) doc.fontSize(8).fillColor('#444').text(`A medida: ${line.variant}`, cols.name, doc.y, { width: 270 });
    if (line.attribution) doc.fontSize(7).fillColor('#777').text(`Modelo 3D: ${line.attribution} (${line.license.toUpperCase()})`, cols.name);
    doc.fillColor('#000').moveDown(0.4);
  }

  doc.moveDown(0.5).moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#999').stroke();
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).text(`Total estimado: ${money(list.total, list.currency)}`, 48, doc.y, { align: 'right' });
  doc.moveDown(1).font('Helvetica').fontSize(8).fillColor('#666').text(
    'Precios de referencia. Los enlaces llevan a una búsqueda de productos similares; el mueble mostrado en 3D es un modelo genérico de licencia abierta.',
    48,
    doc.y,
    { width: 499 },
  );
}

/** Genera la lista de compras en PDF (paso 7: "exportar la lista de compras"). */
export function renderShoppingListPdf(list: ShoppingList, publicUrl?: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Lista de compras — ${list.projectName}` } });
  const done = collect(doc);
  doc.fontSize(20).font('Helvetica-Bold').text('Lista de compras');
  doc.moveDown(0.2).fontSize(12).font('Helvetica').fillColor('#555').text(list.projectName);
  doc.fontSize(9).text(`Generada el ${new Date().toLocaleDateString('es')}`);
  doc.moveDown(1).fillColor('#000');
  drawShoppingList(doc, list);
  if (publicUrl) doc.moveDown(0.5).fillColor('#1a56db').text(publicUrl, { link: publicUrl });
  doc.end();
  return done;
}

/** Lo que hace falta para el dossier de un proyecto: el cuarto, lo que hay en él y lo que cuesta. */
export interface ProjectDossier {
  name: string;
  /** "Sala · Escandinavo", por ejemplo. */
  subtitle: string;
  shell: RoomShell;
  areaM2: number;
  /** Huella en planta de cada mueble de piso, con su nombre. */
  pieces: { name: string; corners: { x: number; z: number }[] }[];
  pieceCount: number;
  list: ShoppingList;
}

const metres = (value: number) => `${value.toFixed(2).replace('.', ',')} m`;

/** Dibuja la planta a escala dentro de la caja dada: paredes, puertas, ventanas, muebles y cotas. */
function drawPlan(doc: Doc, dossier: ProjectDossier, box: { x: number; y: number; width: number; height: number }): void {
  const { shell } = dossier;
  const xs = shell.walls.flatMap((w) => [w.start.x, w.end.x]);
  const zs = shell.walls.flatMap((w) => [w.start.z, w.end.z]);
  const min = { x: Math.min(...xs), z: Math.min(...zs) };
  const span = { x: Math.max(...xs) - min.x || 1, z: Math.max(...zs) - min.z || 1 };
  const pad = 34; // sitio para las cotas alrededor
  const scale = Math.min((box.width - pad * 2) / span.x, (box.height - pad * 2) / span.z);
  const origin = { x: box.x + (box.width - span.x * scale) / 2, y: box.y + (box.height - span.z * scale) / 2 };
  const at = (p: { x: number; z: number }): [number, number] => [origin.x + (p.x - min.x) * scale, origin.y + (p.z - min.z) * scale];

  // Muebles, por debajo de las paredes.
  doc.lineWidth(0.6).strokeColor('#8a8f8e').fillColor('#f1efe9');
  for (const piece of dossier.pieces) {
    const [first, ...rest] = piece.corners.map(at);
    if (!first) continue;
    doc.moveTo(...first);
    for (const point of rest) doc.lineTo(...point);
    doc.closePath().fillAndStroke();
  }
  doc.fontSize(6).fillColor('#444');
  for (const piece of dossier.pieces) {
    const points = piece.corners.map(at);
    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    doc.text(piece.name, cx - 40, cy - 3, { width: 80, align: 'center', lineBreak: false, ellipsis: true });
  }

  // Paredes.
  doc.lineWidth(2.4).strokeColor('#17201f').lineCap('square');
  for (const wall of shell.walls) doc.moveTo(...at(wall.start)).lineTo(...at(wall.end)).stroke();

  // Puertas (hueco) y ventanas (línea clara) sobre su pared.
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  for (const opening of shell.openings) {
    const frame = frames.get(opening.wallId);
    if (!frame) continue;
    const centre = frame.startAtBase ? opening.offsetM : frame.length - opening.offsetM;
    const point = (along: number) => at({ x: frame.base.x + frame.dir.x * along, z: frame.base.z + frame.dir.z * along });
    const from = point(centre - opening.widthM / 2);
    const to = point(centre + opening.widthM / 2);
    doc.lineWidth(3.4).strokeColor('#ffffff').lineCap('butt').moveTo(...from).lineTo(...to).stroke();
    doc.lineWidth(opening.type === 'window' ? 1.2 : 0.6).strokeColor(opening.type === 'window' ? '#4f8fb3' : '#bb4a20').moveTo(...from).lineTo(...to).stroke();
  }

  // Cotas: la medida de cada pared, por fuera.
  doc.fontSize(7.5).fillColor('#0f5e5a');
  for (const frame of frames.values()) {
    const [mx, my] = at({ x: frame.base.x + (frame.dir.x * frame.length) / 2, z: frame.base.z + (frame.dir.z * frame.length) / 2 });
    doc.text(metres(frame.length), mx - frame.normal.x * 16 - 30, my - frame.normal.z * 16 - 4, { width: 60, align: 'center', lineBreak: false });
  }
  doc.fillColor('#000').strokeColor('#000').lineWidth(1);
}

/** Las páginas de un cuarto: su ficha con el plano acotado y, en otra página, su lista de compras. */
function drawRoomPages(doc: Doc, dossier: ProjectDossier): void {
  const { shell, list } = dossier;

  doc.fontSize(9).font('Helvetica').fillColor('#bb4a20').text('INTERIORES IA', 48, 48, { characterSpacing: 1.2 });
  doc.moveDown(0.4).fontSize(24).font('Helvetica-Bold').fillColor('#17201f').text(dossier.name);
  doc.moveDown(0.2).fontSize(11).font('Helvetica').fillColor('#555').text(dossier.subtitle);
  doc.moveDown(0.9);

  const facts: [string, string][] = [
    ['Superficie', `${dossier.areaM2.toFixed(1).replace('.', ',')} m²`],
    ['Medidas', `${metres(shell.widthM)} × ${metres(shell.depthM)}`],
    ['Alto', metres(shell.heightM)],
    ['Muebles', String(dossier.pieceCount)],
    ['Total estimado', money(list.total, list.currency)],
  ];
  const top = doc.y;
  const column = 499 / facts.length;
  facts.forEach(([label, value], i) => {
    const x = 48 + column * i;
    doc.fontSize(8).font('Helvetica').fillColor('#666').text(label.toUpperCase(), x, top, { width: column - 8, characterSpacing: 0.6 });
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#17201f').text(value, x, top + 12, { width: column - 8 });
  });
  doc.moveTo(48, top + 36).lineTo(547, top + 36).strokeColor('#ccc').lineWidth(0.6).stroke();

  drawPlan(doc, dossier, { x: 48, y: top + 52, width: 499, height: 520 });
  doc.fontSize(8).font('Helvetica').fillColor('#666').text(
    'Plano a escala con la medida de cada pared. En azul, las ventanas; en naranja, las puertas. Las medidas que salen de una foto son una estimación hasta que se confirman.',
    48,
    top + 584,
    { width: 499 },
  );

  doc.addPage();
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#17201f').text('Lista de compras', 48, 48);
  doc.moveDown(0.6).fillColor('#000').font('Helvetica');
  drawShoppingList(doc, list);
  doc.fontSize(8).fillColor('#888').text(`Generado el ${new Date().toLocaleDateString('es')} con Interiores IA.`, 48, doc.y + 10);
}

/**
 * Dossier del proyecto en PDF: la ficha del cuarto, su plano acotado con los muebles y, en otra
 * página, la lista de compras. Es lo que se imprime o se envía para enseñar el diseño.
 */
export function renderProjectDossierPdf(dossier: ProjectDossier): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${dossier.name} — Interiores IA` } });
  const done = collect(doc);
  drawRoomPages(doc, dossier);
  doc.end();
  return done;
}

/** Un cuarto en la portada de la vivienda: dónde va en la planta conjunta y lo que suma. */
export interface HomeDossierRoom {
  dossier: ProjectDossier;
  /** Contorno del cuarto ya colocado en la planta conjunta (metros). */
  outline: { x: number; z: number }[];
  /** Tope de gasto del cuarto, si tiene. */
  budgetCap: number | null;
}

export interface HomeDossier {
  name: string;
  rooms: HomeDossierRoom[];
}

/** La planta conjunta dentro de la caja dada: cada cuarto en su sitio, con su nombre y su superficie. */
function drawHomePlan(doc: Doc, rooms: readonly HomeDossierRoom[], box: { x: number; y: number; width: number; height: number }): void {
  const points = rooms.flatMap((r) => r.outline);
  if (!points.length) return;
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const span = { x: Math.max(...points.map((p) => p.x)) - min.x || 1, z: Math.max(...points.map((p) => p.z)) - min.z || 1 };
  const scale = Math.min(box.width / span.x, box.height / span.z);
  const origin = { x: box.x + (box.width - span.x * scale) / 2, y: box.y + (box.height - span.z * scale) / 2 };
  const at = (p: { x: number; z: number }): [number, number] => [origin.x + (p.x - min.x) * scale, origin.y + (p.z - min.z) * scale];

  for (const room of rooms) {
    const [first, ...rest] = room.outline.map(at);
    if (!first) continue;
    doc.lineWidth(1.6).strokeColor('#0f5e5a').fillColor('#dcefec').moveTo(...first);
    for (const point of rest) doc.lineTo(...point);
    doc.closePath().fillAndStroke();
    const corners = room.outline.map(at);
    const left = Math.min(...corners.map((c) => c[0]));
    const right = Math.max(...corners.map((c) => c[0]));
    const cy = (Math.min(...corners.map((c) => c[1])) + Math.max(...corners.map((c) => c[1]))) / 2;
    const width = Math.max(right - left - 6, 20);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#17201f').text(room.dossier.name, left + 3, cy - 9, { width, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(`${room.dossier.areaM2.toFixed(1).replace('.', ',')} m²`, left + 3, cy + 2, { width, align: 'center', lineBreak: false });
  }
  doc.fillColor('#000').strokeColor('#000').lineWidth(1);
}

/**
 * La vivienda entera en un PDF: una portada con la planta conjunta y lo que suma cada cuarto, y
 * después las páginas de cada uno (ficha con plano y lista de compras).
 */
export function renderHomeDossierPdf(home: HomeDossier): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${home.name} — Interiores IA` } });
  const done = collect(doc);
  const currency = home.rooms[0]?.dossier.list.currency ?? 'USD';
  const total = home.rooms.reduce((sum, r) => sum + r.dossier.list.total, 0);
  const area = home.rooms.reduce((sum, r) => sum + r.dossier.areaM2, 0);
  const caps = home.rooms.reduce((sum, r) => sum + (r.budgetCap ?? 0), 0);

  doc.fontSize(9).font('Helvetica').fillColor('#bb4a20').text('INTERIORES IA · VIVIENDA', { characterSpacing: 1.2 });
  doc.moveDown(0.4).fontSize(24).font('Helvetica-Bold').fillColor('#17201f').text(home.name);
  doc.moveDown(0.9);

  const facts: [string, string][] = [
    ['Cuartos', String(home.rooms.length)],
    ['Superficie', `${area.toFixed(1).replace('.', ',')} m²`],
    ['Muebles', String(home.rooms.reduce((sum, r) => sum + r.dossier.pieceCount, 0))],
    ['Total estimado', money(total, currency)],
    ...(caps ? ([['Presupuesto', money(caps, currency)]] as [string, string][]) : []),
  ];
  const top = doc.y;
  const column = 499 / facts.length;
  facts.forEach(([label, value], i) => {
    const x = 48 + column * i;
    doc.fontSize(8).font('Helvetica').fillColor('#666').text(label.toUpperCase(), x, top, { width: column - 8, characterSpacing: 0.6 });
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#17201f').text(value, x, top + 12, { width: column - 8 });
  });
  doc.moveTo(48, top + 36).lineTo(547, top + 36).strokeColor('#ccc').lineWidth(0.6).stroke();

  drawHomePlan(doc, home.rooms, { x: 64, y: top + 56, width: 467, height: 330 });

  // Lo que suma cada cuarto.
  const cols = { name: 48, area: 250, pieces: 320, total: 380, cap: 470 };
  let y = top + 410;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#17201f');
  doc.text('Cuarto', cols.name, y).text('Superficie', cols.area, y).text('Muebles', cols.pieces, y).text('Total', cols.total, y).text('Tope', cols.cap, y);
  doc.moveTo(48, y + 13).lineTo(547, y + 13).strokeColor('#ccc').stroke();
  y += 19;
  doc.font('Helvetica').fontSize(9.5);
  for (const room of home.rooms) {
    const d = room.dossier;
    const over = room.budgetCap !== null && d.list.total > room.budgetCap;
    doc.fillColor('#17201f').text(d.name, cols.name, y, { width: 195, lineBreak: false, ellipsis: true });
    doc.text(`${d.areaM2.toFixed(1).replace('.', ',')} m²`, cols.area, y);
    doc.text(String(d.pieceCount), cols.pieces, y);
    doc.text(money(d.list.total, d.list.currency), cols.total, y);
    doc.fillColor(over ? '#b3261e' : '#17201f').text(room.budgetCap === null ? '—' : money(room.budgetCap, d.list.currency), cols.cap, y);
    y += 16;
    if (y > 760) break; // una vivienda con decenas de cuartos: el resto está en sus propias páginas
  }
  doc.fontSize(8).fillColor('#666').text(
    'Planta conjunta a escala, con cada cuarto donde se colocó. Un tope en rojo es un cuarto que ya lo supera. A continuación, la ficha y la lista de compras de cada cuarto.',
    48,
    Math.min(y + 8, 780),
    { width: 499 },
  );

  for (const room of home.rooms) {
    doc.addPage();
    drawRoomPages(doc, room.dossier);
  }
  doc.end();
  return done;
}
