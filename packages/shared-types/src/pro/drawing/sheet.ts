/**
 * Láminas (lógica pura): las vistas en metros se colocan a escala sobre un papel en milímetros,
 * con marco, rótulo (cajetín) a la derecha, título y escala gráfica bajo cada vista. Si a la escala
 * de la ficha no caben, se prueba la siguiente escala normalizada. El juego de planos reúne todas
 * las láminas del cuarto numeradas A-01, A-02...
 */
import type { RoomFinishes, RoomShell } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { DRAWING_SCALES, type DrawingScale, type PaperSize, type TechnicalSpec, type TitleBlock } from '../technical.js';
import { elevationLabel, elevationView, sectionView } from './elevation.js';
import { boundsOf, DrawingBuilder, type Bounds, type Drawing, type Entity } from './model.js';
import { planView, PLAN_TITLES, type PlanKind } from './plan-view.js';

/** Medidas del papel apaisado, en mm. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
};

const MARGIN = 10;
/** Margen izquierdo más ancho, para encuadernar. */
const MARGIN_LEFT = 20;
const TITLE_W = 62;
const GAP = 12;
/** Bajo cada vista: título y escala gráfica. */
const CAPTION_H = 14;

export interface Sheet extends Drawing {
  units: 'mm';
  number: string;
  paper: PaperSize;
  scale: DrawingScale;
  /** La escala de la ficha no alcanzaba y se usó una menor. */
  scaleAdjusted: boolean;
}

export interface SheetContext {
  titleBlock: TitleBlock;
  paper: PaperSize;
  /** Nombre del cuarto (contenido del cajetín junto al título de la lámina). */
  roomName: string;
  date: string;
}

interface Placed {
  view: Drawing;
  bounds: Bounds;
  w: number;
  h: number;
}

/** Coloca las vistas por filas en el área de dibujo; null si alguna no cabe. */
function layout(views: readonly Drawing[], scale: number, area: { w: number; h: number }): { placed: Placed; x: number; y: number }[] | null {
  const k = 1000 / scale;
  const out: { placed: Placed; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const view of views) {
    const bounds = boundsOf(view.entities);
    const w = (bounds.maxX - bounds.minX) * k;
    const h = (bounds.maxY - bounds.minY) * k + CAPTION_H;
    if (w > area.w || h > area.h) return null;
    if (x > 0 && x + w > area.w) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    if (y + h > area.h) return null;
    out.push({ placed: { view, bounds, w, h }, x, y });
    x += w + GAP;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/** Escalas normalizadas desde la pedida hacia las más pequeñas (1:50 → 1:75 → 1:100). */
const scalesFrom = (scale: DrawingScale) => DRAWING_SCALES.filter((s) => s >= scale);

/**
 * Una lámina con las vistas que produce `views` a la escala pedida, o a la primera mayor en que
 * quepan. `views` recibe la escala para que el texto y las cotas midan lo mismo en el papel.
 */
export function composeSheet(
  title: string,
  number: string,
  total: number,
  views: (scale: DrawingScale) => Drawing[],
  spec: Pick<TechnicalSpec, 'sheet'>,
  ctx: SheetContext,
): Sheet {
  const paper = PAPER_MM[ctx.paper];
  const area = { x: MARGIN_LEFT + 4, y: MARGIN + 4, w: paper.w - MARGIN_LEFT - MARGIN - TITLE_W - 12, h: paper.h - 2 * MARGIN - 8 };
  let chosen: DrawingScale = spec.sheet.scale;
  let placed = null as ReturnType<typeof layout>;
  for (const s of scalesFrom(spec.sheet.scale)) {
    chosen = s;
    placed = layout(views(s), s, area);
    if (placed) break;
  }
  // Si ni a 1:100 cabe, se dibuja a 1:100 aunque se salga: mejor eso que nada.
  if (!placed) {
    const vs = views(chosen);
    placed = vs.map((view, i) => {
      const bounds = boundsOf(view.entities);
      return { placed: { view, bounds, w: 0, h: 0 }, x: 0, y: i * 10 };
    });
  }
  const k = 1000 / chosen;
  const d = new DrawingBuilder(3);
  frame(d, paper);
  // Centrar el bloque de vistas en el área.
  const usedW = Math.max(...placed.map((p) => p.x + p.placed.w));
  const usedH = Math.max(...placed.map((p) => p.y + p.placed.h));
  const ox = area.x + Math.max(0, (area.w - usedW) / 2);
  const oy = area.y + Math.max(0, (area.h - usedH) / 2);
  for (const { placed: p, x, y } of placed) {
    const left = ox + x;
    const top = oy + y;
    d.group(p.view.entities as Entity[], { x: left - p.bounds.minX * k, y: top - p.bounds.minY * k }, k, p.view.title);
    caption(d, p.view.title, chosen, left, top + p.h - CAPTION_H + 6);
  }
  titleBlock(d, paper, { ...ctx, sheetTitle: title, number, total, scale: chosen });
  return { ...d.build(title, 'mm'), units: 'mm', number, paper: ctx.paper, scale: chosen, scaleAdjusted: chosen !== spec.sheet.scale };
}

function frame(d: DrawingBuilder, paper: { w: number; h: number }): void {
  d.polyline('frame', [
    { x: MARGIN_LEFT, y: MARGIN },
    { x: paper.w - MARGIN, y: MARGIN },
    { x: paper.w - MARGIN, y: paper.h - MARGIN },
    { x: MARGIN_LEFT, y: paper.h - MARGIN },
  ]);
}

/** Título de la vista subrayado, su escala y una escala gráfica de 0 a 2 m (o 5 m). */
function caption(d: DrawingBuilder, title: string, scale: number, x: number, y: number): void {
  d.text('text', { x, y }, title.toUpperCase(), { scale: 1.15, anchor: 'start', bold: true });
  // Ancho aproximado de mayúsculas en negrita (≈ 0,75 del alto por letra).
  const w = title.length * 3 * 1.15 * 0.75;
  d.line('frame', { x, y: y + 1.2 }, { x: x + w, y: y + 1.2 });
  d.text('text', { x: x + w + 3, y }, `ESC. 1:${scale}`, { scale: 0.85, anchor: 'start' });
  const meters = scale >= 75 ? 5 : 2;
  const unit = 1000 / scale;
  const bx = x + w + 30;
  for (let i = 0; i < meters; i++) {
    const cell = [
      { x: bx + i * unit, y: y - 2 },
      { x: bx + (i + 1) * unit, y: y - 2 },
      { x: bx + (i + 1) * unit, y: y - 0.5 },
      { x: bx + i * unit, y: y - 0.5 },
    ];
    if (i % 2 === 0) d.hatch('frame', cell, 'solid', 1);
    d.polyline('frame', cell);
  }
  d.text('text', { x: bx, y: y + 2.5 }, '0', { scale: 0.6 });
  d.text('text', { x: bx + meters * unit, y: y + 2.5 }, `${meters} m`, { scale: 0.6 });
}

/** Rótulo vertical a la derecha de la lámina. */
function titleBlock(
  d: DrawingBuilder,
  paper: { w: number; h: number },
  info: SheetContext & { sheetTitle: string; number: string; total: number; scale: number },
): void {
  const x0 = paper.w - MARGIN - TITLE_W;
  const x1 = paper.w - MARGIN;
  const y0 = MARGIN;
  const y1 = paper.h - MARGIN;
  d.line('frame', { x: x0, y: y0 }, { x: x0, y: y1 });
  const tb = info.titleBlock;
  const rows: [string, string][] = [
    ['PROYECTO', tb.project ?? info.roomName],
    ['CLIENTE', tb.client ?? '—'],
    ['DIRECCIÓN', tb.address ?? '—'],
    ['PROFESIONAL', tb.professional ?? '—'],
    ['MATRÍCULA', tb.license ?? '—'],
    ['CONTENIDO', info.sheetTitle],
    ['ESCALA', `1:${info.scale}`],
    ['FECHA', tb.date ?? info.date],
    ['REVISIÓN', tb.revision],
  ];
  const rowH = 13;
  let y = y1 - rows.length * rowH - 24;
  for (const [label, value] of rows) {
    d.line('frame', { x: x0, y }, { x: x1, y });
    d.text('text', { x: x0 + 2.5, y: y + 4 }, label, { scale: 0.55, anchor: 'start' });
    for (const [i, line] of wrap(value, 30).slice(0, 2).entries()) d.text('text', { x: x0 + 2.5, y: y + 8.2 + i * 3.6 }, line, { scale: 0.85, anchor: 'start' });
    y += rowH;
  }
  d.line('frame', { x: x0, y }, { x: x1, y });
  d.text('text', { x: x0 + 2.5, y: y + 5 }, 'PLANO', { scale: 0.55, anchor: 'start' });
  d.text('text', { x: (x0 + x1) / 2, y: y + 17 }, info.number, { scale: 3.2, bold: true });
  d.text('text', { x: x1 - 2.5, y: y + 22 }, `${info.number.split('-')[1] ?? ''} de ${String(info.total).padStart(2, '0')}`, { scale: 0.6, anchor: 'end' });
  // Encabezado del rótulo.
  d.text('text', { x: (x0 + x1) / 2, y: y0 + 9 }, 'INTERIORES IA', { scale: 1.2, bold: true });
  d.text('text', { x: (x0 + x1) / 2, y: y0 + 14 }, 'Planos de interiores', { scale: 0.7 });
  d.line('frame', { x: x0, y: y0 + 18 }, { x: x1, y: y0 + 18 });
  d.text('text', { x: x0 + 2.5, y: y0 + 25 }, 'Medidas en metros.', { scale: 0.6, anchor: 'start' });
  d.text('text', { x: x0 + 2.5, y: y0 + 29 }, 'Verificar en obra antes de construir.', { scale: 0.6, anchor: 'start' });
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ---------------------------------------------------------------------------
// Juego de planos
// ---------------------------------------------------------------------------

export interface DrawingSetInput {
  shell: RoomShell;
  spec: TechnicalSpec;
  pieces: readonly DesignPiece[];
  finishes?: RoomFinishes | null;
  roomName: string;
  /** Fecha del día (AAAA-MM-DD) para el rótulo si la ficha no fija una. */
  date: string;
}

export const SHEET_IDS = ['architectural', 'furniture', 'ceiling', 'finishes', 'elevations', 'section'] as const;
export type SheetId = (typeof SHEET_IDS)[number];

export const SHEET_TITLES: Record<SheetId, string> = {
  ...PLAN_TITLES,
  elevations: 'Alzados interiores',
  section: "Corte A–A'",
};

const withScale = (spec: TechnicalSpec, scale: DrawingScale): TechnicalSpec => ({ ...spec, sheet: { ...spec.sheet, scale } });

/** Las láminas que tiene este cuarto (el corte, solo si se trazó). */
export function availableSheets(spec: Pick<TechnicalSpec, 'section'>): SheetId[] {
  return SHEET_IDS.filter((id) => id !== 'section' || !!spec.section);
}

/** Vistas de una lámina a una escala dada. */
function sheetViews(id: SheetId, input: DrawingSetInput, scale: DrawingScale): Drawing[] {
  const spec = withScale(input.spec, scale);
  const base = { shell: input.shell, spec, pieces: input.pieces, finishes: input.finishes ?? null };
  if (id === 'elevations') return input.shell.walls.map((w) => elevationView(w.id, base));
  if (id === 'section') return input.spec.section ? [sectionView(input.spec.section, base)] : [];
  return [planView(id as PlanKind, { ...base, roomName: input.roomName })];
}

/**
 * El juego de planos completo. Los alzados se reparten en tantas láminas como hagan falta para
 * que quepan a escala.
 */
export function drawingSet(input: DrawingSetInput): Sheet[] {
  const ctx: SheetContext = { titleBlock: input.spec.titleBlock, paper: input.spec.sheet.paper, roomName: input.roomName, date: input.date };
  const jobs: { title: string; views: (s: DrawingScale) => Drawing[] }[] = [];
  for (const id of availableSheets(input.spec)) {
    if (id !== 'elevations') {
      jobs.push({ title: SHEET_TITLES[id], views: (s) => sheetViews(id, input, s) });
      continue;
    }
    // Alzados: de a dos o de a uno por lámina, según quepan a la escala pedida.
    const walls = input.shell.walls.map((w) => w.id);
    const perSheet = fits(walls.slice(0, 2), input) ? 2 : 1;
    for (let i = 0; i < walls.length; i += perSheet) {
      const ids = walls.slice(i, i + perSheet);
      const label = ids.map((w) => elevationLabel(input.shell, w)).join(' y ');
      jobs.push({ title: `Alzados ${label}`, views: (s) => ids.map((w) => elevationView(w, { shell: input.shell, spec: withScale(input.spec, s), pieces: input.pieces, finishes: input.finishes ?? null })) });
    }
  }
  return jobs.map((job, i) => composeSheet(job.title, `A-${String(i + 1).padStart(2, '0')}`, jobs.length, job.views, input.spec, ctx));
}

function fits(wallIds: string[], input: DrawingSetInput): boolean {
  const paper = PAPER_MM[input.spec.sheet.paper];
  const area = { w: paper.w - MARGIN_LEFT - MARGIN - TITLE_W - 12, h: paper.h - 2 * MARGIN - 8 };
  const views = wallIds.map((w) => elevationView(w, { shell: input.shell, spec: input.spec, pieces: input.pieces, finishes: input.finishes ?? null }));
  return layout(views, input.spec.sheet.scale, area) !== null;
}

/** Una sola lámina del juego (para la vista previa): la primera con ese contenido. */
export function sheetFor(id: SheetId, input: DrawingSetInput): Sheet | null {
  if (!availableSheets(input.spec).includes(id)) return null;
  const ctx: SheetContext = { titleBlock: input.spec.titleBlock, paper: input.spec.sheet.paper, roomName: input.roomName, date: input.date };
  const index = SHEET_IDS.indexOf(id);
  return composeSheet(SHEET_TITLES[id], `A-${String(index + 1).padStart(2, '0')}`, availableSheets(input.spec).length, (s) => sheetViews(id, input, s), input.spec, ctx);
}

/** La vista suelta en metros reales (para DXF): una planta, un alzado o el corte. */
export function viewFor(id: SheetId | `elevation:${string}`, input: DrawingSetInput): Drawing[] {
  if (id.startsWith('elevation:')) {
    const wallId = id.slice('elevation:'.length);
    return [elevationView(wallId, { shell: input.shell, spec: input.spec, pieces: input.pieces, finishes: input.finishes ?? null })];
  }
  return sheetViews(id as SheetId, input, input.spec.sheet.scale);
}
