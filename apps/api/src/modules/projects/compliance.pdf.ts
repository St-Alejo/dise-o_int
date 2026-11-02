import {
  COMPLIANCE_GROUPS,
  GROUP_TITLES,
  luxColor,
  polygonBounds,
  roomPolygon,
  type ComplianceReport,
  type ComplianceStatus,
  type RoomShell,
} from '@interiores/shared-types';
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

const STATUS: Record<ComplianceStatus, { label: string; color: string }> = {
  fail: { label: 'NO CUMPLE', color: '#b42318' },
  warn: { label: 'AVISO', color: '#b54708' },
  pass: { label: 'CUMPLE', color: '#067647' },
  na: { label: 'NO APLICA', color: '#667085' },
};

const LEFT = 48;
const RIGHT = 547;

/** Mapa de calor de la luz artificial sobre la planta del cuarto. */
function drawHeatmap(doc: Doc, shell: RoomShell, report: ComplianceReport, target: number, box: { x: number; y: number; width: number; height: number }): void {
  const room = roomPolygon(shell);
  const b = polygonBounds(room);
  const k = Math.min(box.width / (b.maxX - b.minX), box.height / (b.maxZ - b.minZ));
  const ox = box.x + (box.width - (b.maxX - b.minX) * k) / 2;
  const oy = box.y + (box.height - (b.maxZ - b.minZ) * k) / 2;
  const at = (x: number, z: number): [number, number] => [ox + (x - b.minX) * k, oy + (z - b.minZ) * k];
  const step = report.lighting.stepM * k;
  for (const c of report.lighting.cells) {
    const [x, y] = at(c.x, c.z);
    doc.rect(x - step / 2, y - step / 2, step, step).fill(luxColor(c.lux, target));
  }
  doc.moveTo(...at(room[0]!.x, room[0]!.z));
  for (const p of room.slice(1)) doc.lineTo(...at(p.x, p.z));
  doc.closePath().lineWidth(1.5).strokeColor('#111').stroke();
  // Leyenda: de 0 a 1,5 veces el objetivo.
  const lx = box.x + box.width + 16;
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  for (let i = 0; i <= 6; i++) {
    const lux = (target * 1.5 * (6 - i)) / 6;
    const y = box.y + i * 18;
    doc.rect(lx, y, 12, 12).fill(luxColor(lux, target));
    doc.fillColor('#333').text(`${Math.round(lux)} lx`, lx + 16, y + 2, { lineBreak: false });
  }
}

/** Informe de la revisión normativa: resumen, mapa de luz y cada hallazgo con lo medido y lo exigido. */
export function renderCompliancePdf(report: ComplianceReport, shell: RoomShell, opts: { roomName: string; date: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Revisión normativa — ${opts.roomName}`, Creator: 'Interiores IA' } });
  const done = collect(doc);

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text(`Revisión normativa — ${opts.roomName}`);
  doc.font('Helvetica').fontSize(10).fillColor('#444').text(`${report.profile.name}${report.accessible ? ' · con accesibilidad' : ''} · ${opts.date}`);
  doc.moveDown(0.6);
  const s = report.summary;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(`${s.fail} no cumplen · ${s.warn} avisos · ${s.pass} cumplen · ${s.na} no aplican`);
  doc.moveDown(0.4);
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#555').text(report.disclaimer, { width: RIGHT - LEFT });
  doc.moveDown(0.8);

  // Luz.
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text('Iluminación artificial en el plano de trabajo');
  const l = report.lighting;
  doc.font('Helvetica').fontSize(9).fillColor('#333').text(
    `Media ${Math.round(l.avgLux)} lx (objetivo ${report.targetLux} lx) · mínima ${Math.round(l.minLux)} lx · uniformidad ${l.uniformity.toFixed(2).replace('.', ',')} · luz natural: factor de luz diurna ${report.daylight.factorPct.toFixed(1).replace('.', ',')} %`,
  );
  const top = doc.y + 8;
  drawHeatmap(doc, shell, report, report.targetLux, { x: LEFT, y: top, width: 360, height: 200 });
  doc.y = top + 216;
  doc.x = LEFT;

  for (const group of COMPLIANCE_GROUPS) {
    const items = report.findings.filter((f) => f.group === group);
    if (!items.length) continue;
    if (doc.y > 720) doc.addPage();
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor('#8a5a44').text(GROUP_TITLES[group], LEFT);
    doc.moveDown(0.2);
    for (const f of items) {
      if (doc.y > 740) doc.addPage();
      const y = doc.y;
      const st = STATUS[f.status];
      doc.font('Helvetica-Bold').fontSize(8).fillColor(st.color).text(st.label, LEFT, y, { width: 62 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(f.title, LEFT + 66, y, { width: RIGHT - LEFT - 66 });
      const values = [f.measured && `Medido: ${f.measured}`, f.required && `Exigido: ${f.required}`].filter(Boolean).join('   ');
      if (values) doc.font('Helvetica').fontSize(9).fillColor('#333').text(values, LEFT + 66, doc.y, { width: RIGHT - LEFT - 66 });
      doc.font('Helvetica').fontSize(9).fillColor('#333').text(f.detail, LEFT + 66, doc.y, { width: RIGHT - LEFT - 66 });
      doc.font('Helvetica').fontSize(7.5).fillColor('#777').text(f.reference, LEFT + 66, doc.y, { width: RIGHT - LEFT - 66 });
      doc.moveDown(0.5);
    }
  }
  doc.end();
  return done;
}
