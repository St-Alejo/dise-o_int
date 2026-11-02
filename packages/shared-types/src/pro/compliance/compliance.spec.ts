import { describe, expect, it } from 'vitest';
import type { DesignPiece } from '../../design-check.js';
import type { Opening, RoomShell, RoomType } from '../../domain.js';
import { createRectangularShell } from '../../geometry.js';
import { defaultTechnicalSpec, type ComplianceSpec, type InstallationsSpec } from '../technical.js';
import { proposeInstallations } from '../installations/propose.js';
import { checkCompliance, type ComplianceReport } from './check.js';
import { artificialLighting, daylight, directLux, exteriorLux, lightSources, luxColor, type LightSource } from './lighting-calc.js';
import { convexOverlap } from './rules.js';

/** Cuarto de 5 × 4 × 2,6 con la puerta en la pared del frente (en x ≈ 1) y una ventana al fondo. */
const door: Opening = { id: 'door', type: 'door', wallId: 'w-front', widthM: 0.9, heightM: 2.05, offsetM: 4, sillHeightM: 0 };
const window: Opening = { id: 'win', type: 'window', wallId: 'w-back', widthM: 1.4, heightM: 1.2, offsetM: 2.5, sillHeightM: 0.9 };
const room = (over: Partial<RoomShell> = {}, openings: Opening[] = [door, window]): RoomShell => ({ ...createRectangularShell(5, 4, 2.6, { door: false, window: false }), openings, ...over });

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
const flush = (id: string, x: number, z: number): DesignPiece =>
  piece(id, x, z, [0.4, 0.1, 0.4], { category: 'lighting', subcategory: 'flush-light', mount: 'ceiling', position: { x, y: 2.5, z } });

const neufert: ComplianceSpec = { profile: 'neufert', accessible: false };
const check = (pieces: DesignPiece[], opts: { shell?: RoomShell; roomType?: RoomType; compliance?: Partial<ComplianceSpec> } = {}): ComplianceReport =>
  checkCompliance({ shell: opts.shell ?? room(), pieces, roomType: opts.roomType ?? 'living', compliance: { ...neufert, ...opts.compliance } });
const byId = (r: ComplianceReport, id: string) => r.findings.find((f) => f.id === id);

describe('cálculo de iluminación', () => {
  const at = (lumens: number, y: number, distribution: LightSource['distribution']): LightSource => ({ id: 'l', name: 'l', lumens, at: { x: 0, y, z: 0 }, distribution });

  it('una luminaria de techo da Φ/(π·h²) justo debajo y la omnidireccional Φ/(4π·h²)', () => {
    expect(directLux(at(1600, 2.6, 'down'), { x: 0, z: 0 }, 0.75)).toBeCloseTo(1600 / (Math.PI * 1.85 ** 2), 6);
    expect(directLux(at(1600, 2.6, 'omni'), { x: 0, z: 0 }, 0.75)).toBeCloseTo(1600 / (4 * Math.PI * 1.85 ** 2), 6);
    // Lejos de la vertical cae con cos³ (Lambertiana sobre un plano horizontal).
    const side = directLux(at(1600, 2.6, 'down'), { x: 1.85, z: 0 }, 0.75);
    expect(side).toBeCloseTo((1600 / Math.PI) * (Math.SQRT1_2 ** 2 / (2 * 1.85 ** 2)), 6);
    // Un foco empotrado concentra más la luz bajo él que una luminaria difusa.
    expect(directLux(at(1600, 2.6, 'spot'), { x: 0, z: 0 }, 0.75)).toBeGreaterThan(directLux(at(1600, 2.6, 'down'), { x: 0, z: 0 }, 0.75));
    // Una lámpara por debajo del plano de trabajo no lo ilumina directamente.
    expect(directLux(at(450, 0.5, 'omni'), { x: 0, z: 0 }, 0.75)).toBe(0);
  });

  it('las lámparas del diseño son fuentes con sus lúmenes y su punto de emisión', () => {
    const sources = lightSources([
      flush('plafón', 2, 2),
      piece('pie', 0.5, 0.5, [0.4, 1.6, 0.4], { category: 'lighting', subcategory: 'floor-lamp' }),
      piece('sofá', 2.5, 3.4, [2, 0.8, 0.9], { category: 'sofa' }),
    ]);
    expect(sources).toMatchObject([
      { id: 'plafón', lumens: 1600, distribution: 'down', at: { y: 2.5 } },
      { id: 'pie', lumens: 800, distribution: 'omni', at: { y: expect.closeTo(1.44, 6) } },
    ]);
  });

  it('más luminarias dan más luz; sin ninguna, el cuarto queda a oscuras', () => {
    expect(artificialLighting(room(), []).avgLux).toBe(0);
    const one = artificialLighting(room(), lightSources([flush('a', 2.5, 2)]));
    const four = artificialLighting(room(), lightSources([flush('a', 1.25, 1), flush('b', 3.75, 1), flush('c', 1.25, 3), flush('d', 3.75, 3)]));
    expect(one.avgLux).toBeGreaterThan(0);
    expect(four.avgLux).toBeGreaterThan(one.avgLux * 3);
    expect(four.uniformity).toBeGreaterThan(one.uniformity);
    expect(one.uniformity).toBeGreaterThan(0);
    expect(one.uniformity).toBeLessThanOrEqual(1);
    // La banda de 0,5 m junto a las paredes no se evalúa.
    expect(Math.min(...one.cells.map((c) => c.x))).toBeGreaterThanOrEqual(0.5);
  });

  it('la luz natural sale de las ventanas y cae con la distancia; de noche no hay', () => {
    expect(exteriorLux(12)).toBeCloseTo(10_000);
    expect(exteriorLux(5)).toBe(0);
    expect(exteriorLux(20)).toBe(0);
    expect(daylight(room({}, [door])).factorPct).toBe(0);
    const day = daylight(room());
    expect(day.windowAreaM2).toBeCloseTo(1.68);
    expect(day.factorPct).toBeGreaterThan(0.5);
    expect(day.factorPct).toBeLessThan(5);
    const near = day.grid.cells.filter((c) => c.z < 1.2);
    const far = day.grid.cells.filter((c) => c.z > 2.8);
    const avg = (cs: typeof near) => cs.reduce((s, c) => s + c.lux, 0) / cs.length;
    expect(avg(near)).toBeGreaterThan(avg(far) * 2);
    // La media de la rejilla coincide con el factor de luz diurna × la luz de fuera.
    expect(day.grid.avgLux).toBeCloseTo((day.factorPct / 100) * 10_000, 3);
    expect(daylight(room(), { hour: 22 }).grid.avgLux).toBe(0);
  });

  it('el color del mapa de calor va de azul oscuro a amarillo al llegar al objetivo', () => {
    expect(luxColor(0, 200)).toBe('#0d1b4c');
    expect(luxColor(200, 200)).toBe('#f2c94c');
    expect(luxColor(9999, 200)).toBe('#fff4c2');
    expect(luxColor(50, 0)).toBe('#0d1b4c');
  });
});

describe('revisión normativa', () => {
  it('un cuarto vacío y bien dimensionado cumple lo básico', () => {
    const r = check([flush('a', 1.25, 1), flush('b', 3.75, 1), flush('c', 1.25, 3), flush('d', 3.75, 3)]);
    expect(byId(r, 'clear-path')).toMatchObject({ status: 'pass', group: 'circulation' });
    expect(byId(r, 'door-width:door')).toMatchObject({ status: 'pass', measured: '0,90 m', required: '0,80 m' });
    expect(byId(r, 'ceiling-height')).toMatchObject({ status: 'pass', measured: '2,60 m' });
    expect(r.profile.name).toContain('Neufert');
    expect(r.targetLux).toBe(200);
    expect(r.disclaimer).toMatch(/orientativa/);
    expect(r.summary.pass + r.summary.warn + r.summary.fail + r.summary.na).toBe(r.findings.length);
    // Lo grave primero.
    const order = { fail: 0, warn: 1, pass: 2, na: 3 };
    expect(r.findings.map((f) => order[f.status])).toEqual([...r.findings.map((f) => order[f.status])].sort((a, b) => a - b));
  });

  it('el ancho de puerta depende de la accesibilidad', () => {
    const narrow = room({}, [{ ...door, widthM: 0.85 }, window]);
    expect(byId(check([], { shell: narrow }), 'door-width:door')!.status).toBe('pass');
    expect(byId(check([], { shell: narrow, compliance: { accessible: true } }), 'door-width:door')).toMatchObject({ status: 'fail', required: '0,90 m' });
    expect(byId(check([], { shell: room({}, [window]) }), 'door-width')!.status).toBe('na');
  });

  it('la altura libre se mide contra el perfil elegido', () => {
    const low = room({ heightM: 2.3 });
    expect(byId(check([], { shell: low }), 'ceiling-height')!.status).toBe('warn');
    expect(byId(check([], { shell: low, compliance: { profile: 'colombia' } }), 'ceiling-height')!.status).toBe('pass');
    expect(byId(check([], { shell: room({ heightM: 2.0 }) }), 'ceiling-height')!.status).toBe('fail');
  });

  it('iluminación y ventilación natural por área de ventana; en un baño basta un aviso', () => {
    // 1,68 m² de ventana sobre 20 m² de piso = 8,4 %.
    expect(byId(check([]), 'natural-light')).toMatchObject({ status: 'fail', measured: '8,4 %' });
    expect(byId(check([], { compliance: { profile: 'colombia' } }), 'natural-light')!.status).toBe('warn');
    expect(byId(check([], { roomType: 'bathroom' }), 'natural-light')!.status).toBe('warn');
    const big = room({}, [door, { ...window, widthM: 3, heightM: 1.4 }]);
    expect(byId(check([], { shell: big }), 'natural-light')!.status).toBe('pass');
    expect(byId(check([], { shell: big }), 'ventilation')!.status).toBe('pass');
  });

  it('paso libre: un aparador deja 70 cm para llegar al escritorio (aviso) o lo encierra (falla)', () => {
    const desk = piece('escritorio', 2.5, 0.4, [1.2, 0.75, 0.6], { category: 'table', subcategory: 'desk' });
    const gap = piece('aparador', 2.15, 2, [4.3, 0.9, 0.5], { subcategory: 'sideboard' });
    const warn = check([desk, gap]);
    expect(byId(warn, 'clear-path:escritorio')).toMatchObject({ status: 'warn', placementIds: ['escritorio'] });
    expect(byId(warn, 'clear-path:aparador')).toBeUndefined();
    const wall = piece('aparador', 2.5, 2, [5, 0.9, 0.5], { subcategory: 'sideboard' });
    expect(byId(check([desk, wall]), 'clear-path:escritorio')!.status).toBe('fail');
    // Un armario delante de la puerta: no se entra con 90 cm.
    const blocked = check([piece('armario', 1, 3.6, [1.6, 2, 0.6], { subcategory: 'wardrobe' })]);
    expect(byId(blocked, 'clear-path:entry')).toMatchObject({ status: 'fail', placementIds: ['armario'] });
  });

  it('accesibilidad: hace falta un círculo de giro de 1,50 m', () => {
    expect(byId(check([], { compliance: { accessible: true } }), 'turning-circle')!.status).toBe('pass');
    expect(byId(check([]), 'turning-circle')).toBeUndefined();
    // Un pasillo de 1,3 m de fondo: la silla no da la vuelta.
    const corridor = { ...createRectangularShell(5, 1.3, 2.6, { door: false, window: false }), openings: [{ ...door, offsetM: 2.5, widthM: 1 }] };
    expect(byId(check([], { shell: corridor, compliance: { accessible: true } }), 'turning-circle')!.status).toBe('fail');
  });

  it('holguras: delante del inodoro y a los lados de una cama doble', () => {
    const toilet = piece('inodoro', 2.5, 0.35, [0.4, 0.75, 0.7], { category: 'bathroom', subcategory: 'toilet' });
    expect(byId(check([toilet], { roomType: 'bathroom' }), 'clearance:inodoro')).toMatchObject({ status: 'pass', required: '0,60 m' });
    const cabinet = piece('mueble', 2.5, 1.35, [1, 0.8, 0.5]);
    const tight = byId(check([toilet, cabinet], { roomType: 'bathroom' }), 'clearance:inodoro')!;
    expect(tight).toMatchObject({ status: 'fail', measured: '0,40 m' });
    // Una silla no cuenta: se aparta con la mano.
    const chair = piece('silla', 2.5, 1.2, [0.45, 0.9, 0.45], { category: 'chair', subcategory: 'dining-chair' });
    expect(byId(check([toilet, chair], { roomType: 'bathroom' }), 'clearance:inodoro')!.status).toBe('pass');
    // Cama doble pegada a la pared izquierda: un solo lado libre.
    const bed = piece('cama', 0.8, 1.2, [1.6, 0.5, 2], { category: 'bed' });
    expect(byId(check([bed], { roomType: 'bedroom' }), 'clearance:cama')).toMatchObject({ status: 'warn', measured: '1,00 m y 0,00 m' });
    const centred = piece('cama', 2.5, 1.2, [1.6, 0.5, 2], { category: 'bed' });
    expect(byId(check([centred], { roomType: 'bedroom' }), 'clearance:cama')!.status).toBe('pass');
    // Las mesas de noche junto a la cabecera no quitan el sitio para subirse.
    const nightstands = [piece('mesa izq', 1.45, 0.45, [0.5, 0.55, 0.4], { subcategory: 'nightstand' }), piece('mesa der', 3.55, 0.45, [0.5, 0.55, 0.4], { subcategory: 'nightstand' })];
    const withTables = check([{ ...centred, position: { x: 2.5, y: 0, z: 1 } }, ...nightstands], { roomType: 'bedroom' });
    expect(byId(withTables, 'clearance:cama')!.status).toBe('pass');
    // Y a una mesa de noche basta con llegar con el paso mínimo.
    expect(withTables.findings.filter((f) => f.id.startsWith('clear-path:mesa'))).toEqual([]);
    expect(byId(check([piece('clóset', 2.5, 3.6, [1.2, 2, 0.6], { subcategory: 'wardrobe', rotationY: Math.PI })]), 'clearance:clóset')!.title).toBe('Espacio delante del clóset');
  });

  it('cocina: triángulo de trabajo y altura del mesón', () => {
    const k = (id: string, sub: string, x: number, h = 0.9) => piece(id, x, 0.3, [0.6, h, 0.6], { category: 'kitchen', subcategory: sub });
    const stretched = check([k('lavaplatos', 'sink', 0.5), k('estufa', 'stove', 2), k('nevera', 'fridge', 4.5, 1.8)], { roomType: 'kitchen' });
    expect(byId(stretched, 'kitchen-triangle')).toMatchObject({ status: 'warn' });
    expect(byId(stretched, 'kitchen-triangle')!.placementIds).toHaveLength(3);
    const compact = check([k('lavaplatos', 'sink', 1.5), k('estufa', 'stove', 3), piece('nevera', 2.2, 2.2, [0.7, 1.8, 0.7], { category: 'kitchen', subcategory: 'fridge' })], { roomType: 'kitchen' });
    expect(byId(compact, 'kitchen-triangle')!.status).toBe('pass');
    expect(byId(check([k('lavaplatos', 'sink', 1)], { roomType: 'kitchen' }), 'kitchen-triangle')).toMatchObject({ status: 'na' });
    expect(byId(stretched, 'work-height:estufa')).toMatchObject({ status: 'pass', measured: '0,90 m' });
    const high = check([piece('escritorio', 2.5, 2, [1.2, 0.85, 0.6], { category: 'table', subcategory: 'desk' })], { roomType: 'office' });
    expect(byId(high, 'work-height:escritorio')!.status).toBe('warn');
  });

  it('iluminancia media contra el objetivo del tipo de cuarto', () => {
    expect(byId(check([]), 'illuminance')!.status).toBe('fail');
    const one = byId(check([flush('a', 2.5, 2)]), 'illuminance')!;
    expect(one.status).toBe('fail');
    expect(one.required).toBe('200 lx a 0,75 m');
    const grid = [1, 2.5, 4].flatMap((x) => [1, 2, 3].map((z) => flush(`l${x}-${z}`, x, z)));
    expect(byId(check(grid), 'illuminance')!.status).toBe('pass');
    // Un dormitorio pide menos luz que una oficina.
    const bedroom = byId(check(grid.slice(0, 4), { roomType: 'bedroom' }), 'illuminance')!;
    const office = byId(check(grid.slice(0, 4), { roomType: 'office' }), 'illuminance')!;
    expect(bedroom.measured).toBe(office.measured);
    expect(office.status).toBe('fail');
  });

  it('dos rectángulos girados se tocan o no', () => {
    const sq = (x: number, z: number) => [
      { x, z },
      { x: x + 1, z },
      { x: x + 1, z: z + 1 },
      { x, z: z + 1 },
    ];
    expect(convexOverlap(sq(0, 0), sq(0.5, 0.5))).toBe(true);
    expect(convexOverlap(sq(0, 0), sq(1, 0))).toBe(false);
    const diamond = [
      { x: 2, z: 1.2 },
      { x: 2.8, z: 2 },
      { x: 2, z: 2.8 },
      { x: 1.2, z: 2 },
    ];
    expect(convexOverlap(sq(0.3, 0.3), diamond)).toBe(false);
  });
});

describe('reglas eléctricas (RETIE / NTC 2050)', () => {
  const withInst = (pieces: DesignPiece[], installations: InstallationsSpec, roomType: RoomType = 'bedroom') =>
    checkCompliance({ shell: room(), pieces, roomType, compliance: neufert, installations });
  const none = (): InstallationsSpec => defaultTechnicalSpec().installations;

  it('sin puntos las reglas eléctricas no aplican y piden proponerlos', () => {
    const r = withInst([], none());
    expect(byId(r, 'outlet-spacing')!.status).toBe('na');
    expect(byId(r, 'switch-door')!.status).toBe('na');
  });

  it('la propuesta automática cumple tomas, interruptor y circuitos', () => {
    const lav = piece('lav', 2.5, 0.25, [0.6, 0.85, 0.5], { category: 'kitchen', subcategory: 'sink' });
    const inst = proposeInstallations({ shell: room(), pieces: [lav], roomType: 'kitchen', installations: none() });
    const r = withInst([lav], inst, 'kitchen');
    const electrical = r.findings.filter((f) => f.group === 'electrical');
    expect(electrical.length).toBeGreaterThan(3);
    expect(electrical.filter((f) => f.status !== 'pass')).toEqual([]);
    expect(electrical[0]!.reference).toMatch(/NTC 2050/);
  });

  it('avisa una pared sin tomas, la toma común junto al agua y el interruptor lejos de la puerta', () => {
    const lav = piece('lav', 2.5, 0.25, [0.6, 0.85, 0.5], { category: 'bathroom', subcategory: 'vanity' });
    const inst: InstallationsSpec = {
      ...none(),
      points: [
        { id: 't1', kind: 'outlet', wallId: 'w-back', offsetM: 2.5, heightM: 0.3 },
        { id: 's1', kind: 'switch', wallId: 'w-back', offsetM: 0.3, heightM: 1.2 },
      ],
    };
    const r = withInst([lav], inst);
    expect(byId(r, 'outlet-spacing')!.status).toBe('warn');
    expect(byId(r, 'gfci:t1')!.status).toBe('fail');
    expect(byId(r, 'switch-door:door')!.status).toBe('warn');
  });

  it('un circuito por encima del 80 % falla', () => {
    const inst: InstallationsSpec = {
      ...none(),
      points: [{ id: 'h', kind: 'outlet', wallId: 'w-back', offsetM: 1, heightM: 0.3, watts: 2000, circuitId: 'C1' }],
      circuits: [{ id: 'C1', name: 'Tomas', breakerA: 20, kind: 'outlets' }],
    };
    const f = byId(withInst([], inst), 'circuit-load:C1')!;
    expect(f.status).toBe('fail');
    expect(f.measured).toMatch(/2000 VA · 83 %/);
  });
});
