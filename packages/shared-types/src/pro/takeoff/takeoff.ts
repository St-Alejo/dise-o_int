/**
 * Presupuesto de obra (lógica pura): del cómputo métrico a las líneas de APU, los materiales a
 * comprar, el AIU, el cronograma por fases y el total de obra más mobiliario contra el tope.
 */
import type { RoomFinishes, RoomShell } from '../../domain.js';
import { budgetStatus, type BudgetStatus } from '../../budget.js';
import { isElectrical, type TechnicalSpec } from '../technical.js';
import { measureRoom, type RoomQuantities } from './quantities.js';
import {
  activityFor,
  activityWithRate,
  PATTERN_WASTE,
  PHASE_LABELS,
  purchasesFor,
  WORK_PHASES,
  type PurchaseLine,
  type WasteStrategy,
  type WorkPhase,
  type WorkUnit,
} from './rates.js';

export interface TakeoffLine {
  code: string;
  name: string;
  /** Detalle (material o elemento) cuando la misma actividad aparece varias veces. */
  detail?: string;
  unit: WorkUnit;
  quantity: number;
  /** Desperdicio aplicado al material (0,1 = 10 %). */
  waste: number;
  unitMaterial: number;
  unitLabor: number;
  material: number;
  labor: number;
  total: number;
  phase: WorkPhase;
  days: number;
}

export interface ScheduleTask {
  phase: WorkPhase;
  label: string;
  startDay: number;
  days: number;
  codes: string[];
}

export interface TakeoffInput {
  shell: RoomShell;
  finishes: RoomFinishes | null | undefined;
  spec: TechnicalSpec;
  /** Mobiliario del cuarto: total de la lista de compras y número de piezas. */
  furniture?: { total: number; pieces: number };
  budgetCap?: number | null;
  waste?: WasteStrategy;
}

export interface Takeoff {
  currency: string;
  quantities: RoomQuantities;
  lines: TakeoffLine[];
  purchases: PurchaseLine[];
  direct: number;
  aiu: { administration: number; contingency: number; profit: number; total: number };
  works: number;
  furniture: number;
  total: number;
  budget: BudgetStatus;
  schedule: ScheduleTask[];
  days: number;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
/** Días de una actividad: de medio en medio día, como se programa en obra. */
const daysFor = (quantity: number, yieldPerDay: number) => (quantity > 0 ? Math.max(0.5, Math.ceil((quantity / yieldPerDay) * 2) / 2) : 0);

export function computeTakeoff(input: TakeoffInput): Takeoff {
  const { spec } = input;
  const waste = input.waste ?? PATTERN_WASTE;
  const q = measureRoom(input.shell, input.finishes);
  const lines: TakeoffLine[] = [];
  const purchases: PurchaseLine[] = [];

  const line = (code: string, quantity: number, opts: { detail?: string; waste?: number } = {}) => {
    if (quantity <= 1e-6) return;
    const act = activityWithRate(code, spec.rates);
    const w = opts.waste ?? 0;
    const material = act.rate.material * quantity * (1 + w);
    const labor = act.rate.labor * quantity;
    lines.push({
      code,
      name: act.name,
      ...(opts.detail ? { detail: opts.detail } : {}),
      unit: act.unit,
      quantity: round(quantity),
      waste: w,
      unitMaterial: act.rate.material,
      unitLabor: act.rate.labor,
      material: Math.round(material),
      labor: Math.round(labor),
      total: Math.round(material + labor),
      phase: act.phase,
      days: daysFor(quantity, act.yieldPerDay),
    });
  };

  // Instalaciones (los puntos que haya en la ficha).
  const points = spec.installations.points;
  line('elec-point', points.filter((p) => isElectrical(p.kind)).length);
  line('plumb-point', points.filter((p) => !isElectrical(p.kind)).length);

  // Tabiques de las zonas y su puerta.
  line('partition-drywall', q.partitionM2);
  line('door', q.doors.new);

  // Estuco bajo todo lo que se pinta.
  const painted = q.surfaces.filter((s) => ['paint', 'ceiling-paint'].includes(activityFor(s.surface, s.material))).reduce((sum, s) => sum + s.areaM2, 0);
  line('skim-coat', painted);

  // Cada acabado con su actividad, su desperdicio y lo que hay que comprar.
  for (const s of q.surfaces) {
    const code = activityFor(s.surface, s.material);
    const w = waste.wasteFor(s.material, s.surface);
    line(code, s.areaM2, { detail: s.material.name, waste: w });
    purchases.push(...purchasesFor(code, s.material, s.areaM2, w));
  }
  line('skirting', q.skirtingM);
  if (input.furniture?.pieces) line('furniture-install', input.furniture.pieces);

  const direct = lines.reduce((sum, l) => sum + l.total, 0);
  const r = spec.rates.aiu;
  const aiu = {
    administration: Math.round(direct * r.administration),
    contingency: Math.round(direct * r.contingency),
    profit: Math.round(direct * r.profit),
    total: 0,
  };
  aiu.total = aiu.administration + aiu.contingency + aiu.profit;
  const works = direct + aiu.total;
  const furniture = Math.round(input.furniture?.total ?? 0);

  // Cronograma: las fases van una tras otra; dentro de una fase, las cuadrillas trabajan a la vez.
  let cursor = 0;
  const schedule: ScheduleTask[] = [];
  for (const phase of WORK_PHASES) {
    const mine = lines.filter((l) => l.phase === phase);
    if (!mine.length) continue;
    const days = Math.max(...mine.map((l) => l.days));
    schedule.push({ phase, label: PHASE_LABELS[phase], startDay: cursor, days, codes: [...new Set(mine.map((l) => l.code))] });
    cursor += days;
  }

  return {
    currency: spec.rates.currency,
    quantities: q,
    lines,
    purchases: purchases.map((p) => ({ ...p, quantity: round(p.quantity) })),
    direct,
    aiu,
    works,
    furniture,
    total: works + furniture,
    budget: budgetStatus(works + furniture, input.budgetCap ?? null),
    schedule,
    days: cursor,
  };
}

const num = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');
const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** El presupuesto en CSV para Excel en español (separador `;`, coma decimal). */
export function takeoffCsv(t: Takeoff): string {
  const rows: string[][] = [['Fase', 'Actividad', 'Detalle', 'Unidad', 'Cantidad', 'Desperdicio %', 'Material unit.', 'Mano de obra unit.', 'Material', 'Mano de obra', 'Total', 'Días']];
  for (const l of t.lines) {
    rows.push([PHASE_LABELS[l.phase], l.name, l.detail ?? '', l.unit, num(l.quantity), num(l.waste * 100), String(l.unitMaterial), String(l.unitLabor), String(l.material), String(l.labor), String(l.total), num(l.days)]);
  }
  rows.push([]);
  rows.push(['', 'Costo directo', '', '', '', '', '', '', '', '', String(t.direct)]);
  rows.push(['', 'Administración', '', '', '', '', '', '', '', '', String(t.aiu.administration)]);
  rows.push(['', 'Imprevistos', '', '', '', '', '', '', '', '', String(t.aiu.contingency)]);
  rows.push(['', 'Utilidad', '', '', '', '', '', '', '', '', String(t.aiu.profit)]);
  rows.push(['', 'Total obra', '', '', '', '', '', '', '', '', String(t.works)]);
  rows.push(['', 'Mobiliario', '', '', '', '', '', '', '', '', String(t.furniture)]);
  rows.push(['', `Total (${t.currency})`, '', '', '', '', '', '', '', '', String(t.total)]);
  return `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
