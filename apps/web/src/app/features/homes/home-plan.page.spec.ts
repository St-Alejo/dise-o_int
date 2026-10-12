import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PlanPoint, ProjectListItem } from '@interiores/shared-types';
import { ProjectsApi } from '../../core/api/projects.api';
import { HomePlanPage, planRooms } from './home-plan.page';

const HOME = '11111111-1111-4111-8111-111111111111';
const rect = (w: number, d: number) => [
  { x: 0, z: 0 },
  { x: w, z: 0 },
  { x: w, z: d },
  { x: 0, z: d },
];
const room = (id: string, name: string, w: number, d: number, extra: Partial<ProjectListItem> = {}): ProjectListItem => ({
  id,
  name,
  roomType: 'living',
  status: 'ready',
  thumbnailUrl: null,
  itemCount: 3,
  saved: true,
  updatedAt: '2026-10-11T00:00:00.000Z',
  areaM2: w * d,
  outline: rect(w, d),
  homeId: HOME,
  homeName: 'Piso del centro',
  ...extra,
});

describe('planRooms', () => {
  it('coloca cada contorno en su sitio y dice quién comparte pared y quién se pisa', () => {
    const rooms = [room('sala', 'Sala', 5, 4), room('cocina', 'Cocina', 3, 3), room('baño', 'Baño', 2, 2)];
    const at = new Map<string, PlanPoint>([
      ['sala', { x: 0, z: 0 }],
      ['cocina', { x: 5, z: 0 }],
      ['baño', { x: 4, z: 1 }],
    ]);
    const [sala, cocina, bano] = planRooms(rooms, at);
    expect(cocina!.points).toBe('5,0 8,0 8,3 5,3');
    expect(sala!.neighbours).toEqual(['Cocina']);
    expect(cocina!.neighbours).toEqual(['Sala']);
    expect(sala!.overlaps).toBe(true);
    expect(bano!.overlaps).toBe(true);
    expect({ x: sala!.cx, z: sala!.cz }).toEqual({ x: 2.5, z: 2 });
  });

  it('un cuarto sin plano todavía no se dibuja', () => {
    const rooms = [room('sala', 'Sala', 5, 4), room('nuevo', 'Nuevo', 1, 1, { outline: undefined, areaM2: undefined })];
    expect(planRooms(rooms, new Map([['sala', { x: 0, z: 0 }]])).map((r) => r.id)).toEqual(['sala']);
  });
});

describe('HomePlanPage', () => {
  const setup = async (rooms: ProjectListItem[]) => {
    const moved: { id: string; at: PlanPoint }[] = [];
    const api = {
      list: async () => [...rooms, room('otra', 'De otra vivienda', 3, 3, { homeId: 'x' })],
      setHomePosition: async (id: string, at: PlanPoint) => {
        moved.push({ id, at });
        return {};
      },
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ProjectsApi, useValue: api }] });
    const fixture = TestBed.createComponent(HomePlanPage);
    fixture.componentRef.setInput('id', HOME);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, moved };
  };

  it('dibuja solo los cuartos de la vivienda, en fila, con lo que suman', async () => {
    const { el } = await setup([room('sala', 'Sala', 5, 4, { estimatedTotal: 1200, budgetCap: 1000 }), room('cocina', 'Cocina', 3, 3, { estimatedTotal: 300 })]);
    expect(el.querySelector('h1')!.textContent).toContain('Piso del centro');
    expect(el.querySelectorAll('svg .room')).toHaveLength(2);
    const facts = el.querySelector('.facts')!.textContent!.replace(/\s+/g, ' ');
    expect(facts).toContain('Cuartos2');
    expect(facts).toContain('29,0 m²');
    expect(facts).toContain('$1,500');
    // El tope de la vivienda es el de los cuartos que tienen uno, y se compara con lo que suman esos.
    expect(facts).toContain('te pasas $200');
    expect(el.querySelector('.rooms .badge-danger')!.textContent).toContain('tope $1,000');
  });

  it('las flechas mueven el cuarto 10 cm y al soltar se guarda la planta entera', async () => {
    const { fixture, el, moved } = await setup([room('sala', 'Sala', 5, 4), room('cocina', 'Cocina', 3, 3)]);
    const cocina = el.querySelectorAll<SVGGElement>('svg .room')[1]!;
    expect(cocina.querySelector('polygon')!.getAttribute('points')).toBe('5.6,0 8.6,0 8.6,3 5.6,3');
    cocina.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    cocina.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    cocina.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(cocina.querySelector('polygon')!.getAttribute('points')).toBe('4.6,0.1 7.6,0.1 7.6,3.1 4.6,3.1');
    // La primera vez se guarda el sitio de todos, para que la planta no dependa del orden automático.
    expect(moved).toEqual([
      { id: 'sala', at: { x: 0, z: 0 } },
      { id: 'cocina', at: { x: 4.6, z: 0.1 } },
    ]);
    expect(el.textContent).toContain('Hay cuartos que se pisan');
  });

  it('una vivienda sin cuartos se explica en vez de quedar en blanco', async () => {
    const { el } = await setup([]);
    expect(el.textContent).toContain('Esta vivienda no existe');
  });
});
