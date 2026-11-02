import { describe, expect, it } from 'vitest';
import type { DesignPiece } from '../../design-check.js';
import type { Opening, RoomShell } from '../../domain.js';
import { createRectangularShell } from '../../geometry.js';
import { drawingSet, availableSheets, viewFor } from '../drawing/sheet.js';
import { parseDxfEntities, renderDxf } from '../drawing/dxf.js';
import { defaultTechnicalSpec, technicalOf, type InstallationsSpec } from '../technical.js';
import { assignCircuits, loadSchedule } from './circuits.js';
import { placePoints } from './points.js';
import { clearProposed, proposeInstallations } from './propose.js';

/** Dormitorio de 4 × 3,5 con la puerta en la pared del frente y una ventana al fondo. */
const door: Opening = { id: 'door', type: 'door', wallId: 'w-front', widthM: 0.9, heightM: 2.1, offsetM: 3.2, sillHeightM: 0 };
const window: Opening = { id: 'win', type: 'window', wallId: 'w-back', widthM: 1.2, heightM: 1.2, offsetM: 2, sillHeightM: 0.9 };
const room = (over: Partial<RoomShell> = {}): RoomShell => ({ ...createRectangularShell(4, 3.5, 2.5, { door: false, window: false }), openings: [door, window], ...over });
const piece = (id: string, x: number, z: number, dims: [number, number, number], extra: Partial<DesignPiece> = {}): DesignPiece => ({
  id,
  name: id,
  mount: 'floor',
  category: 'storage',
  position: { x, y: 0, z },
  rotationY: 0,
  dims: { x: dims[0], y: dims[1], z: dims[2] },
  ...extra,
});
const empty = (): InstallationsSpec => defaultTechnicalSpec().installations;

describe('propuesta de instalaciones', () => {
  it('tomas por el perímetro, interruptor junto a la puerta y una luz al centro si no hay luminarias', () => {
    const spec = proposeInstallations({ shell: room(), pieces: [], roomType: 'bedroom', installations: empty() });
    const kinds = spec.points.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'light')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'switch')).toHaveLength(1);
    // 4 + 3,5 + 4 + 3,5 m de muro: al menos una toma por pared, ninguna en la puerta.
    expect(kinds.filter((k) => k === 'outlet').length).toBeGreaterThanOrEqual(4);
    const sw = spec.points.find((p) => p.kind === 'switch')!;
    expect(sw).toMatchObject({ wallId: 'w-front', heightM: 1.2, auto: true });
    // Del lado de la chapa: el que tiene más muro libre (la puerta está a 0,8 m del rincón).
    expect(Math.abs(sw.offsetM! - 3.2)).toBeCloseTo(0.6, 2);
    expect(sw.controls).toEqual([spec.points.find((p) => p.kind === 'light')!.id]);
    for (const p of spec.points.filter((x) => x.kind === 'outlet' && x.wallId === 'w-front')) expect(Math.abs(p.offsetM! - 3.2)).toBeGreaterThan(0.45 + 0.1);
    // Todo queda en circuitos.
    expect(spec.circuits.map((c) => c.kind).sort()).toEqual(['lighting', 'outlets']);
    expect(spec.points.filter((p) => p.kind !== 'switch').every((p) => p.circuitId)).toBe(true);
  });

  it('tomas junto a las mesas de noche y salida de luz por luminaria de techo', () => {
    const pieces = [
      piece('mesa-izq', 1.1, 0.25, [0.45, 0.55, 0.4], { subcategory: 'nightstand' }),
      piece('mesa-der', 2.9, 0.25, [0.45, 0.55, 0.4], { subcategory: 'nightstand' }),
      piece('plafón', 2, 1.75, [0.4, 0.1, 0.4], { category: 'lighting', subcategory: 'flush-light', mount: 'ceiling', position: { x: 2, y: 2.4, z: 1.75 } }),
    ];
    const spec = proposeInstallations({ shell: room(), pieces, roomType: 'bedroom', installations: empty() });
    const back = spec.points.filter((p) => p.kind === 'outlet' && p.wallId === 'w-back').map((p) => p.offsetM);
    expect(back).toEqual(expect.arrayContaining([1.1, 2.9]));
    expect(spec.points.find((p) => p.kind === 'light')!.at).toEqual({ x: 2, z: 1.75 });
  });

  it('en el baño: GFCI y los puntos de agua de cada aparato a su altura', () => {
    const pieces = [
      piece('inodoro', 0.6, 0.35, [0.4, 0.75, 0.7], { category: 'bathroom', subcategory: 'toilet' }),
      piece('lavamanos', 2, 0.25, [0.6, 0.85, 0.5], { category: 'bathroom', subcategory: 'vanity' }),
      piece('ducha', 3.5, 0.5, [0.9, 2, 0.9], { category: 'bathroom', subcategory: 'shower' }),
    ];
    const spec = proposeInstallations({ shell: room(), pieces, roomType: 'bathroom', installations: empty() });
    expect(spec.points.filter((p) => p.kind === 'outlet')).toEqual([]);
    expect(spec.points.some((p) => p.kind === 'outlet-gfci')).toBe(true);
    const water = spec.points.filter((p) => ['cold-water', 'hot-water', 'drain', 'floor-drain'].includes(p.kind));
    expect(water.filter((p) => p.kind === 'cold-water').map((p) => p.heightM).sort()).toEqual([0.2, 0.55, 1.1]);
    expect(water.filter((p) => p.kind === 'hot-water').map((p) => p.heightM).sort()).toEqual([0.55, 1.1]);
    expect(water.find((p) => p.kind === 'floor-drain')!.at).toEqual({ x: 3.5, z: 0.5 });
    // El desagüe del inodoro va en el piso, a 30 cm del muro.
    expect(water.find((p) => p.kind === 'drain' && p.at)!.at!.z).toBeCloseTo(0.3, 2);
    expect(spec.circuits.some((c) => c.kind === 'wet')).toBe(true);
  });

  it('respeta lo puesto a mano y reemplaza lo propuesto antes', () => {
    const manual = { id: 'mio', kind: 'tv-data' as const, wallId: 'w-left', offsetM: 1, heightM: 1.2 };
    const first = proposeInstallations({ shell: room(), pieces: [], roomType: 'bedroom', installations: { ...empty(), points: [manual] } });
    const second = proposeInstallations({ shell: room(), pieces: [], roomType: 'bedroom', installations: first });
    expect(second.points.length).toBe(first.points.length);
    expect(second.points.filter((p) => p.id === 'mio')).toHaveLength(1);
    expect(clearProposed(second).points).toEqual([manual]);
  });
});

describe('circuitos y cuadro de cargas', () => {
  it('no pasa del 80 % del interruptor ni de 12 salidas por circuito', () => {
    const points = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, kind: 'outlet' as const, wallId: 'w-back', offsetM: 0.2 + i * 0.25, heightM: 0.3 }));
    const spec = assignCircuits({ ...empty(), points });
    // 20 A × 120 V × 0,8 = 1 920 VA → 10 tomas de 180 VA por circuito.
    expect(spec.circuits).toHaveLength(2);
    const schedule = loadSchedule(spec);
    expect(schedule.rows.map((r) => r.points)).toEqual([10, 4]);
    expect(schedule.rows[0]).toMatchObject({ va: 1800, awg: 12, ok: true });
    expect(schedule.rows[0]!.amps).toBeCloseTo(15, 6);
    expect(schedule.installedVa).toBe(14 * 180);
    expect(schedule.demandVa).toBe(2520);
    expect(schedule.mainBreakerA).toBe(30);
  });

  it('la demanda aplica el 35 % por encima de 3 000 VA', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, kind: 'outlet' as const, wallId: 'w-back', offsetM: 0.1 * i, heightM: 0.3 }));
    const s = loadSchedule(assignCircuits({ ...empty(), points }));
    expect(s.installedVa).toBe(5400);
    expect(s.demandVa).toBeCloseTo(3000 + 2400 * 0.35, 6);
  });
});

describe('planos de instalaciones', () => {
  it('aparecen como láminas cuando hay puntos, con sus capas en el DXF', () => {
    expect(availableSheets(defaultTechnicalSpec())).not.toContain('electrical');
    const installations = proposeInstallations({
      shell: room(),
      pieces: [piece('lavamanos', 2, 0.25, [0.6, 0.85, 0.5], { category: 'bathroom', subcategory: 'vanity' })],
      roomType: 'bedroom',
      installations: empty(),
    });
    const spec = technicalOf({ installations });
    expect(availableSheets(spec)).toEqual(expect.arrayContaining(['electrical', 'plumbing']));
    const input = { shell: room(), spec, pieces: [], roomName: 'Cuarto', date: '2026-11-01' };
    const titles = drawingSet(input).map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(['Plano eléctrico', 'Plano hidrosanitario']));
    const layers = new Set(parseDxfEntities(renderDxf(viewFor('electrical', input), { scale: 50 })).map((e) => e.layer));
    expect(layers).toContain('E-POWR');
    expect(layers).toContain('E-LITE');
    const plumbing = new Set(parseDxfEntities(renderDxf(viewFor('plumbing', input), { scale: 50 })).map((e) => e.layer));
    expect(plumbing).toContain('P-SANR');
    expect(plumbing).not.toContain('E-POWR');
  });

  it('cada punto cae sobre su pared o en su sitio de la planta', () => {
    const placed = placePoints(room(), [
      { id: 'a', kind: 'outlet', wallId: 'w-back', offsetM: 1, heightM: 0.3 },
      { id: 'b', kind: 'light', at: { x: 2, z: 1 }, heightM: 2.5 },
      { id: 'c', kind: 'outlet', wallId: 'nada', offsetM: 1, heightM: 0.3 },
    ]);
    expect(placed.map((p) => p.at)).toEqual([{ x: 1, z: 0 }, { x: 2, z: 1 }]);
    expect(placed[0]!.normal).toEqual({ x: 0, z: 1 });
  });
});
