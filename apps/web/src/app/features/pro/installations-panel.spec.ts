import { createRectangularShell, defaultTechnicalSpec, proposeInstallations } from '@interiores/shared-types';
import { describe, expect, it } from 'vitest';
import { addPoint, pointRows, removePoint } from './installations-panel.component';

const shell = createRectangularShell(4, 3, 2.5);
const empty = () => defaultTechnicalSpec().installations;

describe('panel de instalaciones', () => {
  it('separa los puntos por familia y dice dónde va cada uno', () => {
    const spec = addPoint(addPoint(empty(), { kind: 'outlet', wallId: shell.walls[0]!.id, offsetM: 1.5, heightM: 0.3 }), { kind: 'cold-water', wallId: shell.walls[1]!.id, offsetM: 1, heightM: 0.55 });
    const el = pointRows(shell, spec, 'electrical');
    expect(el).toHaveLength(1);
    expect(el[0]).toMatchObject({ label: 'Toma doble', height: '0,30 m', circuit: 'C1', auto: false });
    expect(el[0]!.where).toMatch(/a 1,50 m$/);
    expect(pointRows(shell, spec, 'plumbing').map((r) => r.label)).toEqual(['Agua fría']);
  });

  it('al quitar una luz, el interruptor deja de nombrarla y los circuitos se rehacen', () => {
    const spec = proposeInstallations({ shell, pieces: [], roomType: 'bedroom', installations: empty() });
    const light = spec.points.find((p) => p.kind === 'light')!;
    const next = removePoint(spec, light.id);
    expect(next.points.some((p) => p.id === light.id)).toBe(false);
    expect(next.points.find((p) => p.kind === 'switch')!.controls).toEqual([]);
    expect(next.circuits.some((c) => c.kind === 'lighting')).toBe(false);
  });

  it('los ids de los puntos a mano no se repiten', () => {
    let spec = addPoint(empty(), { kind: 'outlet', wallId: shell.walls[0]!.id, offsetM: 1, heightM: 0.3 });
    spec = addPoint(spec, { kind: 'outlet', wallId: shell.walls[0]!.id, offsetM: 2, heightM: 0.3 });
    expect(new Set(spec.points.map((p) => p.id)).size).toBe(2);
  });
});
