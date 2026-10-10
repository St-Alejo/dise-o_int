import { buildRoomFromSpec, createRectangularShell, footprint } from '@interiores/shared-types';
import { describe, expect, it } from 'vitest';
import { captionFor, floorPlanOf, metres, planSvg } from './floor-plan-model';

describe('floorPlanOf', () => {
  it('un rectángulo: contorno, cuatro paredes con su cota por fuera y margen alrededor', () => {
    const plan = floorPlanOf(createRectangularShell(4, 3, 2.6, { door: false, window: false }));
    expect(plan.viewBox).toBe('-1.1 -1.1 6.2 5.2');
    expect(plan.outline).toBe('0,0 4,0 4,3 0,3');
    expect(plan.walls.map((w) => [w.id, w.label.text])).toEqual([
      ['w-back', '4,00 m'],
      ['w-right', '3,00 m'],
      ['w-front', '4,00 m'],
      ['w-left', '3,00 m'],
    ]);
    // La cota del fondo va por encima del cuarto y la de la izquierda, a su izquierda.
    expect(plan.walls[0]!.label).toMatchObject({ x: 2, y: -0.34, anchor: 'middle' });
    // A los lados el texto se ancla hacia fuera para no montarse sobre la pared.
    expect(plan.walls[3]!.label).toMatchObject({ x: -0.18, y: 1.5, anchor: 'end' });
    expect(plan.walls[1]!.label).toMatchObject({ x: 4.18, y: 1.5, anchor: 'start' });
    expect(plan.summary).toBe('Plano del cuarto rectangular: 4,00 m de ancho por 3,00 m de fondo, 4 paredes, 0 puertas y 0 ventanas.');
  });

  it('una L: seis paredes y las cotas de la muesca quedan del lado de fuera', () => {
    const shell = buildRoomFromSpec({ shape: 'L', widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 });
    const plan = floorPlanOf(shell);
    expect(plan.outline).toBe('0,0 5,0 5,2.5 3,2.5 3,4 0,4');
    expect(plan.walls).toHaveLength(6);
    // w-3 es el fondo de la muesca (z = 2,5) y mira hacia atrás: su cota cae dentro de la muesca.
    expect(plan.walls[2]!.label).toMatchObject({ x: 4, y: 2.84, text: '2,00 m' });
    expect(plan.summary).toContain('en L');
    expect(plan.summary).toContain('6 paredes, 1 puerta y 1 ventana');
  });

  it('en una muesca angosta las cotas de sus dos paredes no se enciman', () => {
    const shell = buildRoomFromSpec({ shape: 'U', widthM: 6, depthM: 4.5, heightM: 2.5, notchWidthM: 1.36, notchDepthM: 1.58 });
    const plan = floorPlanOf(shell);
    // Las dos paredes laterales del hueco miden lo mismo y sus cotas caen dentro de él.
    const sides = plan.walls.filter((w) => w.label.text === '1,58 m').map((w) => w.label);
    expect(sides).toHaveLength(2);
    expect(Math.abs(sides[0]!.y - sides[1]!.y)).toBeCloseTo(0.28);
  });

  it('las aberturas van sobre su pared: la ventana centrada y la puerta con su arco hacia dentro', () => {
    const plan = floorPlanOf(createRectangularShell(4, 3, 2.6));
    const window = plan.openings.find((o) => o.type === 'window')!;
    expect(window.from).toEqual({ x: 1.2, y: 0 });
    expect(window.to).toEqual({ x: 2.8, y: 0 });
    expect(window.swing).toBe('');
    // La puerta está en la pared del frente (y = 3), que se recorre de derecha a izquierda.
    const door = plan.openings.find((o) => o.type === 'door')!;
    expect(door.from.y).toBe(3);
    expect(door.from.x - door.to.x).toBeCloseTo(0.9);
    // El arco parte de la bisagra, sube 0,9 m hacia dentro del cuarto y vuelve al otro marco.
    expect(door.swing).toMatch(new RegExp(`^M ${door.from.x} 3 L ${door.from.x} 2.1 A 0.9 0.9 0 0 [01] ${door.to.x} 3$`));
  });

  it('dibuja las huellas de los muebles que recibe', () => {
    const sofa = footprint({ x: 2, y: 0, z: 0.5 }, { x: 2, y: 0.8, z: 1 }, 0);
    const plan = floorPlanOf(createRectangularShell(4, 3, 2.6), [{ id: 's1', corners: sofa.corners }]);
    expect(plan.items).toEqual([expect.objectContaining({ id: 's1', points: '1,0 3,0 3,1 1,1' })]);
  });

  it('escribe los metros con coma decimal', () => {
    expect(metres(3.2)).toBe('3,20 m');
    expect(metres(12)).toBe('12,00 m');
  });
});

describe('plano para imprimir', () => {
  const shell = createRectangularShell(4, 3, 2.6);
  const sofa = { id: 's', name: 'Sofá <gris> & co', corners: footprint({ x: 2, y: 0, z: 0.5 }, { x: 2, y: 0.8, z: 0.9 }, 0).corners };

  it('es un SVG suelto con título, cotas y el nombre de cada mueble', () => {
    const svg = planSvg(shell, [sofa], 'Sala "principal"');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Sala &quot;principal&quot;</title>');
    expect(svg.match(/4,00 m/g)).toHaveLength(2);
    // Los nombres se escapan: un mueble no puede romper el archivo.
    expect(svg).toContain('Sofá &lt;gris&gt; &amp; co');
    expect(svg).not.toContain('var(--');
    // Encima del plano queda la franja del título.
    expect(svg).toMatch(/viewBox="-1\.1 -1\.58\d* 6\.2 5\.68\d*"/);
  });

  it('el nombre se recorta para caber y desaparece si no hay sitio', () => {
    expect(captionFor('Sofá de tres plazas', 2, 0.9, 0.2)).toBe('Sofá de tres plazas');
    expect(captionFor('Sofá de tres plazas', 1, 0.9, 0.2)).toBe('Sofá de tr…');
    expect(captionFor('Sofá', 0.2, 0.9, 0.2)).toBe('');
    expect(captionFor('Sofá', 2, 0.1, 0.2)).toBe('');
  });

  it('cada mueble lleva su nombre y su centro', () => {
    expect(floorPlanOf(shell, [sofa]).items[0]).toMatchObject({ name: sofa.name, centre: { x: 2, y: 0.5 }, widthM: 2 });
  });
});
