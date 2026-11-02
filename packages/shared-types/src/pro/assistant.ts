/**
 * Respuestas del Modo Pro para el chat (lógica pura): cuánto material y cuánto cuesta la obra, qué
 * dice la normativa, qué instalaciones propondría y qué planos hay. Solo leen el proyecto; lo que
 * cambia la ficha técnica se hace con un clic en la pestaña Pro, donde se ve y se deshace.
 */
import type { DesignPiece } from '../design-check.js';
import type { RoomFinishes, RoomShell, RoomType } from '../domain.js';
import { checkCompliance } from './compliance/check.js';
import { elevationLabel } from './drawing/elevation.js';
import { availableSheets, SHEET_TITLES } from './drawing/sheet.js';
import { loadSchedule } from './installations/circuits.js';
import { INSTALLATION_INFO } from './installations/points.js';
import { proposeInstallations } from './installations/propose.js';
import type { TechnicalSpec } from './technical.js';
import { computeTakeoff } from './takeoff/takeoff.js';

export interface ProProject {
  shell: RoomShell;
  finishes: RoomFinishes | null;
  pieces: readonly DesignPiece[];
  roomType: RoomType;
  technical: TechnicalSpec;
}

export interface ProAnswer {
  summary: string;
  data: Record<string, unknown>;
}

const money = (v: number, currency: string) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v).replace(/ /g, ' ');
const n = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
/** Sin tildes ni mayúsculas, para comparar lo que escribe la gente. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Cómputo y presupuesto de obra; con `material` ("baldosa", "pintura") responde solo esas compras. */
export function answerTakeoff(p: ProProject, material?: string): ProAnswer {
  const t = computeTakeoff({ shell: p.shell, finishes: p.finishes, spec: p.technical });
  const wanted = material ? fold(material) : '';
  const buys = wanted ? t.purchases.filter((b) => fold(b.name).includes(wanted)) : t.purchases;
  const list = buys.map((b) => `${b.packs} de ${b.name.toLowerCase()}`);
  const head = `Obra: ${money(t.works, t.currency)} con AIU, unos ${n(t.days)} días de trabajo (piso de ${n(t.quantities.floorM2)} m²).`;
  const summary = wanted
    ? list.length
      ? `Para ${material}: ${list.join('; ')}. ${head}`
      : `En este cuarto no hay compras de ${material}. ${head}`
    : `${head}${list.length ? ` Comprar: ${list.slice(0, 4).join('; ')}${list.length > 4 ? '…' : ''}.` : ''} El detalle y el PDF están en Pro → Cantidades y presupuesto de obra.`;
  return { summary, data: { works: t.works, currency: t.currency, days: t.days, floorM2: t.quantities.floorM2, purchases: buys } };
}

/** Lo más grave de la revisión normativa, en una frase. */
export function answerCompliance(p: ProProject): ProAnswer {
  const r = checkCompliance({ shell: p.shell, pieces: p.pieces, roomType: p.roomType, compliance: p.technical.compliance, installations: p.technical.installations });
  const issues = r.findings.filter((f) => f.status === 'fail' || f.status === 'warn');
  const top = issues.slice(0, 3).map((f) => `${f.title}${f.measured ? ` (${f.measured}, pide ${f.required})` : ''}`);
  const summary = issues.length
    ? `Revisé con el perfil "${r.profile.name}": ${r.summary.fail} por corregir y ${r.summary.warn} avisos. ${top.join('; ')}. Lo ves marcado en Pro → Normativa y ergonomía.`
    : `Revisé con el perfil "${r.profile.name}": ${r.summary.pass} criterios cumplen y no hay nada por corregir.`;
  return { summary, data: { profile: r.profile, summary: r.summary, issues: issues.map((f) => ({ id: f.id, status: f.status, title: f.title, detail: f.detail })) } };
}

/** Qué instalaciones propondría (sin guardarlas): conteo por tipo, circuitos y totalizador. */
export function answerInstallations(p: ProProject): ProAnswer {
  const spec = proposeInstallations({ shell: p.shell, pieces: p.pieces, roomType: p.roomType, installations: p.technical.installations });
  const counts = new Map<string, number>();
  for (const pt of spec.points) counts.set(INSTALLATION_INFO[pt.kind].label, (counts.get(INSTALLATION_INFO[pt.kind].label) ?? 0) + 1);
  const parts = [...counts].map(([label, c]) => `${c} × ${label.toLowerCase()}`);
  const schedule = loadSchedule(spec);
  const summary = `Te propongo ${parts.join(', ')} en ${spec.circuits.length} circuitos (totalizador de ${schedule.mainBreakerA} A). Para guardarlas y ver el plano eléctrico, pulsa "Proponer instalaciones" en Pro → Instalaciones.`;
  return { summary, data: { counts: Object.fromEntries(counts), circuits: spec.circuits.length, mainBreakerA: schedule.mainBreakerA } };
}

const WALL_WORDS: Record<string, string> = { fondo: 'w-back', frente: 'w-front', entrada: 'w-front', izquierda: 'w-left', derecha: 'w-right' };

/** Las láminas que hay; con `wall` ("fondo", "izquierda"), cuál es su alzado. */
export function answerDrawings(p: Pick<ProProject, 'shell' | 'technical'>, wall?: string): ProAnswer {
  const sheets = availableSheets(p.technical).map((id) => SHEET_TITLES[id]);
  const key = wall ? Object.keys(WALL_WORDS).find((w) => fold(wall).includes(w)) : undefined;
  const wallId = key ? WALL_WORDS[key] : undefined;
  const found = wallId ? p.shell.walls.some((w) => w.id === wallId) : false;
  const elevation = found ? elevationLabel(p.shell, wallId!) : null;
  const where = 'Están en Pro → Planos técnicos (vista previa, SVG, DXF y PDF del juego).';
  const summary = elevation
    ? `La pared ${key === 'fondo' || key === 'frente' || key === 'entrada' ? `del ${key}` : `de la ${key}`} es el alzado ${elevation}, en la lámina "Alzados interiores". ${where}`
    : `Este proyecto tiene ${sheets.length} láminas: ${sheets.join(', ')}. ${where}`;
  return { summary, data: { sheets, ...(elevation ? { elevation } : {}) } };
}
