import type { ShoppingList } from '@interiores/shared-types';
import PDFDocument from 'pdfkit';

const CATEGORY_LABELS: Record<string, string> = {
  sofa: 'Sofás',
  table: 'Mesas',
  chair: 'Sillas',
  bed: 'Camas',
  storage: 'Almacenamiento',
  lighting: 'Iluminación',
  decor: 'Decoración',
};

const money = (value: number | null, currency: string) =>
  value === null ? '—' : new Intl.NumberFormat('es', { style: 'currency', currency }).format(value);

/** Genera la lista de compras en PDF (paso 7: "exportar la lista de compras"). */
export function renderShoppingListPdf(list: ShoppingList, publicUrl?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Lista de compras — ${list.projectName}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text('Lista de compras');
    doc.moveDown(0.2).fontSize(12).font('Helvetica').fillColor('#555').text(list.projectName);
    doc.fontSize(9).text(`Generada el ${new Date().toLocaleDateString('es')}`);
    doc.moveDown(1).fillColor('#000');

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
    if (publicUrl) doc.moveDown(0.5).fillColor('#1a56db').text(publicUrl, { link: publicUrl });
    doc.end();
  });
}
