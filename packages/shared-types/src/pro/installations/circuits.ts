/**
 * Circuitos y cuadro de cargas: los puntos eléctricos se agrupan por uso (iluminación, tomas,
 * zonas húmedas) sin pasar del 80 % del interruptor ni de 12 salidas por circuito, y se resume la
 * carga instalada, la demanda y el calibre del cable.
 */
import { isElectrical, type Circuit, type InstallationPoint, type InstallationsSpec } from '../technical.js';
import { INSTALLATION_INFO, isSwitch, loadOf } from './points.js';

/** Uso máximo continuo de un interruptor automático. */
export const BREAKER_USAGE = 0.8;
/** Salidas por circuito, como recomienda la práctica habitual. */
export const MAX_POINTS_PER_CIRCUIT = 12;
/** Calibre de cobre (AWG) para cada interruptor. */
export const WIRE_AWG: Record<Circuit['breakerA'], number> = { 15: 14, 20: 12, 30: 10, 40: 8 };

const KIND_OF = (p: InstallationPoint): Circuit['kind'] | null => {
  if (!isElectrical(p.kind) || isSwitch(p.kind) || p.kind === 'tv-data') return null;
  if (p.kind === 'light') return 'lighting';
  if (p.kind === 'outlet-gfci') return 'wet';
  return (p.watts ?? 0) >= 1000 ? 'dedicated' : 'outlets';
};

const CIRCUIT_SETUP: Record<Circuit['kind'], { breakerA: Circuit['breakerA']; name: string }> = {
  lighting: { breakerA: 15, name: 'Iluminación' },
  outlets: { breakerA: 20, name: 'Tomas' },
  wet: { breakerA: 20, name: 'Tomas GFCI' },
  dedicated: { breakerA: 30, name: 'Dedicado' },
};

/**
 * Reparte los puntos eléctricos en circuitos nuevos (en el orden en que están, que sigue las
 * paredes). Los interruptores van al circuito de la primera luz que encienden.
 */
export function assignCircuits(spec: InstallationsSpec): InstallationsSpec {
  const circuits: Circuit[] = [];
  const load = new Map<string, { va: number; n: number }>();
  const assigned = new Map<string, string>();
  for (const p of spec.points) {
    const kind = KIND_OF(p);
    if (!kind) continue;
    const setup = CIRCUIT_SETUP[kind];
    const capacity = setup.breakerA * spec.voltage * BREAKER_USAGE;
    const va = loadOf(p);
    let circuit = kind === 'dedicated' ? undefined : circuits.find((c) => c.kind === kind && load.get(c.id)!.va + va <= capacity && load.get(c.id)!.n < MAX_POINTS_PER_CIRCUIT);
    if (!circuit) {
      const id = `C${circuits.length + 1}`;
      const same = circuits.filter((c) => c.kind === kind).length;
      circuit = { id, name: `${setup.name}${same ? ` ${same + 1}` : ''}`, breakerA: setup.breakerA, kind };
      circuits.push(circuit);
      load.set(id, { va: 0, n: 0 });
    }
    const l = load.get(circuit.id)!;
    l.va += va;
    l.n++;
    assigned.set(p.id, circuit.id);
  }
  const points = spec.points.map((p) => {
    const { circuitId: _old, ...rest } = p;
    const own = assigned.get(p.id);
    if (own) return { ...rest, circuitId: own };
    if (isSwitch(p.kind)) {
      const light = p.controls?.map((id) => assigned.get(id)).find(Boolean);
      return light ? { ...rest, circuitId: light } : rest;
    }
    return rest;
  });
  return { ...spec, points, circuits };
}

export interface LoadRow {
  circuit: Circuit;
  points: number;
  va: number;
  amps: number;
  /** Corriente / interruptor (0,8 = 80 %). */
  usage: number;
  awg: number;
  ok: boolean;
}

export interface LoadSchedule {
  rows: LoadRow[];
  installedVa: number;
  /** Demanda con factor NTC 2050 220-11: 3 000 VA al 100 % y el resto al 35 %. */
  demandVa: number;
  demandAmps: number;
  /** Totalizador sugerido (A). */
  mainBreakerA: number;
  voltage: number;
}

const MAIN_BREAKERS = [20, 30, 40, 50, 60, 70, 100];

export function loadSchedule(spec: InstallationsSpec): LoadSchedule {
  const rows = spec.circuits.map((circuit): LoadRow => {
    const mine = spec.points.filter((p) => p.circuitId === circuit.id && INSTALLATION_INFO[p.kind].va + (p.watts ?? 0) > 0 && !isSwitch(p.kind));
    const va = mine.reduce((s, p) => s + loadOf(p), 0);
    const amps = va / spec.voltage;
    const usage = amps / circuit.breakerA;
    return { circuit, points: mine.length, va, amps, usage, awg: WIRE_AWG[circuit.breakerA], ok: usage <= BREAKER_USAGE + 1e-9 && mine.length <= MAX_POINTS_PER_CIRCUIT };
  });
  const installedVa = rows.reduce((s, r) => s + r.va, 0);
  const demandVa = Math.min(installedVa, 3000) + Math.max(0, installedVa - 3000) * 0.35;
  const demandAmps = demandVa / spec.voltage;
  const mainBreakerA = MAIN_BREAKERS.find((b) => b >= demandAmps * 1.25) ?? MAIN_BREAKERS[MAIN_BREAKERS.length - 1]!;
  return { rows, installedVa, demandVa, demandAmps, mainBreakerA, voltage: spec.voltage };
}
