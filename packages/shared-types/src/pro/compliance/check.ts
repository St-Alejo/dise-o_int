/**
 * Motor de la revisión normativa: arma el contexto del cuarto una sola vez (mundo para caminar,
 * puertas, rejillas de luz con memoria) y pasa por cada regla que aplique. El resultado es un
 * informe con lo medido, lo exigido y la fuente de cada hallazgo.
 */
import type { RoomShell, RoomType } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { roomPolygon } from '../../geometry.js';
import { buildWalkWorld } from '../../walk.js';
import { defaultTechnicalSpec, type ComplianceSpec, type InstallationsSpec } from '../technical.js';
import { artificialLighting, daylight, lightSources, type DaylightResult, type IlluminanceGrid } from './lighting-calc.js';
import { COMPLIANCE_DISCLAIMER, profileOf } from './profiles.js';
import { COMPLIANCE_RULES, cornersOf, doorwaysOf, reachableCells, type ComplianceContext, type ComplianceFinding, type ComplianceRule, type ComplianceStatus } from './rules.js';

export interface ComplianceInput {
  shell: RoomShell;
  pieces: readonly DesignPiece[];
  roomType: RoomType;
  compliance: ComplianceSpec;
  /** Puntos y circuitos de la ficha, para las reglas eléctricas. */
  installations?: InstallationsSpec;
  /** Hora solar para la luz natural (por defecto, mediodía). */
  hour?: number;
}

export interface ComplianceReport {
  profile: { id: ComplianceSpec['profile']; name: string };
  accessible: boolean;
  /** Iluminancia media que pide el perfil para este tipo de cuarto. */
  targetLux: number;
  findings: ComplianceFinding[];
  summary: Record<ComplianceStatus, number>;
  lighting: IlluminanceGrid;
  daylight: DaylightResult;
  disclaimer: string;
}

/** Estorba el paso: pisa el suelo, no es una alfombra y llega a la altura del cuerpo (igual que la revisión del diseño). */
const blocksWalking = (p: DesignPiece) => !p.supportId && p.mount === 'floor' && p.subcategory !== 'rug' && p.dims.y > 0.2;

const ORDER: Record<ComplianceStatus, number> = { fail: 0, warn: 1, pass: 2, na: 3 };

export function complianceContext(input: ComplianceInput): ComplianceContext {
  const obstacles = input.pieces.filter(blocksWalking);
  const world = buildWalkWorld(
    input.shell,
    obstacles.map((p) => ({ corners: cornersOf(p), baseY: p.position.y, heightM: p.dims.y })),
  );
  const doors = doorwaysOf(input.shell);
  const reach = new Map<number, ReturnType<typeof reachableCells>>();
  let lighting: IlluminanceGrid | undefined;
  let day: DaylightResult | undefined;
  return {
    shell: input.shell,
    pieces: input.pieces,
    roomType: input.roomType,
    profile: profileOf(input.compliance.profile),
    accessible: input.compliance.accessible,
    room: roomPolygon(input.shell),
    obstacles,
    world,
    doors,
    reachable(d) {
      const key = Math.round(d * 100);
      if (!reach.has(key)) reach.set(key, reachableCells(world, doors, d));
      return reach.get(key)!;
    },
    lighting: () => (lighting ??= artificialLighting(input.shell, lightSources(input.pieces))),
    daylight: () => (day ??= daylight(input.shell, { hour: input.hour ?? 12 })),
    installations: input.installations ?? defaultTechnicalSpec().installations,
  };
}

/** Revisa el cuarto con el perfil de la ficha técnica. Los hallazgos van de lo más grave a lo que no aplica. */
export function checkCompliance(input: ComplianceInput, rules: readonly ComplianceRule[] = COMPLIANCE_RULES): ComplianceReport {
  const ctx = complianceContext(input);
  const findings = rules
    .filter((r) => r.applies(ctx))
    .flatMap((r) => r.evaluate(ctx))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => ORDER[a.f.status] - ORDER[b.f.status] || a.i - b.i)
    .map(({ f }) => f);
  const summary: Record<ComplianceStatus, number> = { pass: 0, warn: 0, fail: 0, na: 0 };
  for (const f of findings) summary[f.status]++;
  return {
    profile: { id: ctx.profile.id, name: ctx.profile.name },
    accessible: ctx.accessible,
    targetLux: ctx.profile.targetLux[ctx.roomType],
    findings,
    summary,
    lighting: ctx.lighting(),
    daylight: ctx.daylight(),
    disclaimer: COMPLIANCE_DISCLAIMER,
  };
}
