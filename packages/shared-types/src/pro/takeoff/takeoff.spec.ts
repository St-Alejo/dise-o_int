import { describe, expect, it } from 'vitest';
import type { Opening, RoomFinishes, RoomShell } from '../../domain.js';
import { createRectangularShell } from '../../geometry.js';
import { getMaterial } from '../../materials.js';
import { defaultTechnicalSpec, technicalOf } from '../technical.js';
import { measureRoom } from './quantities.js';
import { activityFor, PATTERN_WASTE, purchasesFor } from './rates.js';
import { computeTakeoff, takeoffCsv } from './takeoff.js';

/** Cuarto de 4 × 3 × 2,5 con una puerta de 0,90 × 2,10 y una ventana de 1,20 × 1,20 (alféizar 0,90). */
const door: Opening = { id: 'door', type: 'door', wallId: 'w-front', widthM: 0.9, heightM: 2.1, offsetM: 1, sillHeightM: 0 };
const window: Opening = { id: 'win', type: 'window', wallId: 'w-back', widthM: 1.2, heightM: 1.2, offsetM: 2, sillHeightM: 0.9 };
const room = (over: Partial<RoomShell> = {}): RoomShell => ({ ...createRectangularShell(4, 3, 2.5, { door: false, window: false }), openings: [door, window], ...over });
const finishes: RoomFinishes = { floor: 'ceramic-grey-tile', walls: { all: 'paint-white' }, ceiling: 'paint-white' };

describe('cómputo métrico', () => {
  it('mide piso, cielo raso, muros netos y guardaescoba de un cuarto conocido', () => {
    const q = measureRoom(room(), finishes);
    expect(q.floorM2).toBe(12);
    expect(q.ceilingM2).toBe(12);
    expect(q.perimeterM).toBe(14);
    expect(q.skirtingM).toBe(13.1);
    const total = q.walls.reduce((s, w) => s + w.netM2, 0);
    expect(total).toBeCloseTo(35 - 1.89 - 1.44, 6);
    expect(q.walls.find((w) => w.wallId === 'w-back')).toMatchObject({ lengthM: 4, grossM2: 10, openingsM2: 1.44, netM2: 8.56 });
    expect(q.doors).toEqual({ existing: 1, new: 0 });
    expect(q.windows).toEqual({ count: 1, areaM2: 1.44 });
    expect(q.surfaces.map((s) => [s.surface, s.materialId, s.areaM2])).toEqual([
      ['floor', 'ceramic-grey-tile', 12],
      ['ceiling', 'paint-white', 12],
      ['wall', 'paint-white', 31.67],
    ]);
  });

  it('el revestimiento llega a su altura y descuenta la parte de los vanos que le toca', () => {
    const q = measureRoom(room(), { ...finishes, wallTiles: { material: 'ceramic-subway-white', heightM: 1.2 } });
    // 14 m × 1,2 m − puerta (0,9 × 1,2) − ventana por encima de 0,9 m (1,2 × 0,3).
    expect(q.walls.reduce((s, w) => s + w.tiledM2, 0)).toBeCloseTo(16.8 - 1.08 - 0.36, 6);
    const tiles = q.surfaces.find((s) => s.materialId === 'ceramic-subway-white')!;
    const paint = q.surfaces.find((s) => s.surface === 'wall' && s.materialId === 'paint-white')!;
    expect(tiles.areaM2 + paint.areaM2).toBeCloseTo(31.67, 2);
  });

  it('un baño privado suma tabiques, una puerta nueva y su propio piso', () => {
    const zone = { id: 'z1', kind: 'bathroom' as const, open: false, outline: [{ x: 0, z: 0 }, { x: 1.5, z: 0 }, { x: 1.5, z: 1.5 }, { x: 0, z: 1.5 }], door: { edge: 1, offsetM: 0.75, widthM: 0.7 } };
    const q = measureRoom(room({ zones: [zone] }), { ...finishes, zones: { z1: { floor: 'ceramic-white', walls: 'paint-sage' } } });
    expect(q.partitionLengthM).toBe(3);
    expect(q.partitionM2).toBeCloseTo(3 * 2.5 - 0.7 * 2.05, 2);
    expect(q.doors.new).toBe(1);
    expect(q.surfaces.find((s) => s.materialId === 'ceramic-white')!.areaM2).toBe(2.25);
    expect(q.surfaces.find((s) => s.materialId === 'ceramic-grey-tile')!.areaM2).toBe(9.75);
    expect(q.surfaces.find((s) => s.materialId === 'paint-sage')!.areaM2).toBeCloseTo(q.partitionM2, 2);
    // El guardaescoba corre por las dos caras de cada tabique, menos la puerta.
    expect(q.skirtingM).toBeCloseTo(13.1 + 6 - 1.4, 6);
  });
});

describe('APU, desperdicio y compras', () => {
  it('cada material va con su actividad y su desperdicio según el dibujo', () => {
    expect(activityFor('floor', getMaterial('wood-oak')!)).toBe('wood-floor');
    expect(activityFor('floor', getMaterial('stone-microcement')!)).toBe('microcement');
    expect(activityFor('floor', getMaterial('carpet-grey')!)).toBe('carpet');
    expect(activityFor('wall', getMaterial('ceramic-subway-white')!)).toBe('tile-wall');
    expect(activityFor('wall', getMaterial('paint-sage')!)).toBe('paint');
    expect(PATTERN_WASTE.wasteFor(getMaterial('wood-herringbone')!, 'floor')).toBe(0.15);
    expect(PATTERN_WASTE.wasteFor(getMaterial('ceramic-grey-tile')!, 'floor')).toBe(0.1);
    expect(PATTERN_WASTE.wasteFor(getMaterial('paint-white')!, 'wall')).toBe(0);
  });

  it('cajas de baldosa, bultos de pegante y galones de pintura', () => {
    const tile = purchasesFor('tile-floor', getMaterial('ceramic-grey-tile')!, 12, 0.1);
    expect(tile[0]).toMatchObject({ quantity: expect.closeTo(13.2, 6), packs: '10 cajas de 1,44 m²' });
    expect(tile[1]!.packs).toBe('3 bultos de 25 kg');
    const paint = purchasesFor('paint', getMaterial('paint-white')!, 31.67, 0);
    expect(paint[0]).toMatchObject({ unit: 'L', packs: '2 galones' });
    expect(paint[0]!.quantity).toBeCloseTo(6.334, 3);
  });
});

describe('presupuesto de obra', () => {
  it('suma APU, AIU y mobiliario, y arma el cronograma por fases', () => {
    const t = computeTakeoff({ shell: room(), finishes, spec: defaultTechnicalSpec(), furniture: { total: 2_000_000, pieces: 6 }, budgetCap: 5_000_000 });
    const byCode = (code: string) => t.lines.find((l) => l.code === code)!;
    expect(byCode('tile-floor')).toMatchObject({ quantity: 12, waste: 0.1, material: 765_600, labor: 360_000, total: 1_125_600 });
    expect(byCode('skim-coat').quantity).toBeCloseTo(43.67, 2);
    expect(byCode('skirting')).toMatchObject({ unit: 'ml', quantity: 13.1, total: 235_800 });
    expect(byCode('furniture-install')).toMatchObject({ quantity: 6, total: 150_000 });
    expect(t.direct).toBe(t.lines.reduce((s, l) => s + l.total, 0));
    expect(t.aiu.total).toBe(t.aiu.administration + t.aiu.contingency + t.aiu.profit);
    expect(t.aiu.administration).toBe(Math.round(t.direct * 0.1));
    expect(t.works).toBe(t.direct + t.aiu.total);
    expect(t.total).toBe(t.works + 2_000_000);
    expect(t.budget.level).toBe(t.total > 5_000_000 ? 'over' : t.total >= 4_500_000 ? 'near' : 'ok');
    expect(t.schedule.map((s) => [s.label, s.startDay, s.days])).toEqual([
      ['Estuco', 0, 2],
      ['Pisos', 2, 1],
      ['Pintura', 3, 1],
      ['Mobiliario', 4, 0.5],
    ]);
    expect(t.days).toBe(4.5);
    expect(t.purchases.some((p) => p.packs === '10 cajas de 1,44 m²')).toBe(true);
  });

  it('las tarifas propias del proyecto mandan sobre la lista base, y los puntos de instalación cuentan', () => {
    const spec = technicalOf({
      rates: { overrides: { paint: { material: 10_000, labor: 10_000 } }, aiu: { administration: 0, contingency: 0, profit: 0 } },
      installations: { points: [{ id: 'p1', kind: 'outlet', wallId: 'w-left', offsetM: 1, heightM: 0.3 }, { id: 'p2', kind: 'cold-water', wallId: 'w-left', offsetM: 2, heightM: 0.6 }] },
    });
    const t = computeTakeoff({ shell: room(), finishes, spec });
    expect(t.lines.find((l) => l.code === 'paint')).toMatchObject({ unitMaterial: 10_000, total: Math.round(31.67 * 20_000) });
    expect(t.lines.find((l) => l.code === 'elec-point')!.quantity).toBe(1);
    expect(t.lines.find((l) => l.code === 'plumb-point')!.quantity).toBe(1);
    expect(t.schedule[0]!.label).toBe('Instalaciones');
    expect(t.works).toBe(t.direct);
    expect(t.budget.level).toBe('none');
  });

  it('el mobiliario en dólares se pasa a pesos con la tasa de la ficha; sin tasa no se suma', () => {
    const usd = computeTakeoff({ shell: room(), finishes, spec: defaultTechnicalSpec(), furniture: { total: 500, pieces: 2, currency: 'USD' }, budgetCap: 2_000 });
    expect(usd.fx).toEqual({ from: 'USD', rate: 4000 });
    expect(usd.furniture).toBe(2_000_000);
    expect(usd.budget.remaining).toBe(8_000_000 - usd.total);
    const eur = computeTakeoff({ shell: room(), finishes, spec: defaultTechnicalSpec(), furniture: { total: 500, pieces: 2, currency: 'EUR' } });
    expect(eur.fx).toEqual({ from: 'EUR', rate: null });
    expect(eur.furniture).toBe(0);
  });

  it('exporta un CSV para Excel en español', () => {
    const csv = takeoffCsv(computeTakeoff({ shell: room(), finishes, spec: defaultTechnicalSpec() }));
    expect(csv.startsWith('﻿Fase;Actividad;')).toBe(true);
    expect(csv).toContain('Pisos;Piso en cerámica o porcelanato;Porcelanato gris;m²;12;10;58000;30000;765600;360000;1125600;1');
    expect(csv).toMatch(/Total \(COP\);+\d+/);
  });
});
