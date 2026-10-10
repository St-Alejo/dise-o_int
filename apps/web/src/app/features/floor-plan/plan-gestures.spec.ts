import {
  createRectangularShell,
  footprint,
  footprintsOverlap,
  isInsideRoom,
  type CatalogItem,
  type FurniturePlacement,
  type Opening,
  type RoomShell,
  type Vector3,
} from '@interiores/shared-types';
import { describe, expect, it } from 'vitest';
import { CommandHistory, type SceneCommand, type SceneState } from '../viewport-3d/commands';
import { clearancesOf } from './floor-plan-model';
import { MeasureGesture, MoveItemGesture, MoveOpeningGesture, MoveVertexGesture, MoveWallGesture, type PlanContext } from './plan-gestures';

const item = (id: string, dims: Vector3, mount: CatalogItem['mount'] = 'floor'): CatalogItem =>
  ({ id, name: id, category: 'sofa', mount, dimensionsM: dims, price: 0 }) as unknown as CatalogItem;

const catalog = new Map<string, CatalogItem>([
  ['sofa', item('sofa', { x: 1.8, y: 0.8, z: 0.9 })],
  ['table', item('table', { x: 1, y: 0.45, z: 0.6 })],
  ['picture', item('picture', { x: 0.8, y: 0.6, z: 0.04 }, 'wall')],
  ['lamp', item('lamp', { x: 0.3, y: 0.4, z: 0.3 }, 'surface')],
]);

const piece = (id: string, catalogItemId: string, x: number, z: number, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId,
  position: { x, y: 0, z },
  rotationY: 0,
  lockedByUser: false,
  ...extra,
});

/** Posición en planta con tolerancia (la rejilla deja restos de coma flotante). */
const near = (x: number, z: number) => ({ x: expect.closeTo(x, 5), z: expect.closeTo(z, 5) });

const window: Opening = { id: 'win', type: 'window', wallId: 'w-back', widthM: 1, heightM: 1.2, offsetM: 2.5, sillHeightM: 0.9 };

/** Un proyecto de mentira con su historial: los gestos lo usan como usarían el store. */
function project(placements: FurniturePlacement[], shell: RoomShell = { ...createRectangularShell(5, 4, 2.6, { door: false, window: false }), openings: [window] }) {
  const history = new CommandHistory();
  let state: SceneState = { placements, finishes: null, shell };
  const executed: SceneCommand[] = [];
  const dims = (p: FurniturePlacement) => catalog.get(p.catalogItemId)!.dimensionsM;
  const ctx: PlanContext = {
    shell: () => state.shell ?? null,
    placements: () => state.placements,
    catalog: () => catalog,
    dependentsOf: (id) => state.placements.filter((p) => p.supportId === id),
    isPoseValid: (id, itemId, position, rotationY, d) => {
      const me = footprint(position, d!, rotationY);
      if (!isInsideRoom(me, state.shell!)) return false;
      // Lo que va sobre un mueble no choca con él (el store real lo decide por capas).
      if (catalog.get(itemId)?.mount === 'surface') return true;
      return !state.placements.some((o) => o.id !== id && !o.supportId && !o.wallId && footprintsOverlap(me, footprint(o.position, dims(o), o.rotationY)));
    },
    execute: (cmd) => {
      executed.push(cmd);
      state = history.execute(cmd, state);
    },
  };
  return {
    ctx,
    executed,
    history,
    get state() {
      return state;
    },
    undo: () => (state = history.undo(state)),
    at: (id: string) => state.placements.find((p) => p.id === id)!,
  };
}

describe('mover un mueble en el plano', () => {
  it('lo lleva a donde se suelta, en un solo paso de deshacer', () => {
    const p = project([piece('s', 'sofa', 2.5, 2)]);
    const gesture = new MoveItemGesture(p.ctx, p.at('s'), catalog.get('sofa')!, { x: 2.5, z: 2 });
    gesture.move({ x: 3, z: 2.2 });
    const preview = gesture.move({ x: 3.4, z: 2.6 });
    expect(preview.invalid).toBe(false);
    expect(preview.moved?.get('s')?.position).toMatchObject(near(3.4, 2.6));
    // Mientras se arrastra el estado no cambia: solo al soltar.
    expect(p.at('s').position.x).toBe(2.5);
    gesture.end();
    expect(p.at('s')).toMatchObject({ position: near(3.4, 2.6), lockedByUser: true });
    expect(p.executed).toHaveLength(1);
    p.undo();
    expect(p.at('s').position).toMatchObject({ x: 2.5, z: 2 });
  });

  it('no se sale del cuarto y se pega a la pared si queda cerca', () => {
    const p = project([piece('s', 'sofa', 2.5, 2)]);
    const gesture = new MoveItemGesture(p.ctx, p.at('s'), catalog.get('sofa')!, { x: 2.5, z: 2 });
    expect(gesture.move({ x: 9, z: 2 }).moved?.get('s')?.position.x).toBeCloseTo(5 - 0.9);
    // A 10 cm de la pared del fondo: el imán la lleva hasta tocarla.
    expect(gesture.move({ x: 2.5, z: 0.55 }).moved?.get('s')?.position.z).toBeCloseTo(0.45);
  });

  it('se alinea con el borde de otro mueble y devuelve la guía', () => {
    const p = project([piece('s', 'sofa', 1.5, 3), piece('t', 'table', 3.5, 1.5)]);
    const gesture = new MoveItemGesture(p.ctx, p.at('t'), catalog.get('table')!, { x: 3.5, z: 1.5 });
    // El sofá va de x = 0,6 a 2,4. El borde izquierdo de la mesa queda a 3 cm de 2,4.
    const preview = gesture.move({ x: 2.93, z: 1.5 });
    expect(preview.moved?.get('t')?.position.x).toBeCloseTo(2.9);
    expect(preview.guides).toEqual([expect.objectContaining({ axis: 'x', at: 2.4 })]);
  });

  it('encima de otro mueble avisa y, al soltar, vuelve al último sitio válido', () => {
    const p = project([piece('s', 'sofa', 1.5, 3), piece('t', 'table', 3.5, 1.5)]);
    const gesture = new MoveItemGesture(p.ctx, p.at('t'), catalog.get('table')!, { x: 3.5, z: 1.5 });
    gesture.move({ x: 3.5, z: 2 });
    const over = gesture.move({ x: 1.5, z: 3 });
    expect(over).toMatchObject({ invalid: true, message: 'Ahí choca con otro mueble' });
    gesture.end();
    expect(p.at('t').position).toMatchObject(near(3.5, 2));
  });

  it('lo que tiene encima lo acompaña', () => {
    const p = project([piece('t', 'table', 2, 2), piece('l', 'lamp', 2.2, 2.1, { supportId: 't', position: { x: 2.2, y: 0.45, z: 2.1 } })]);
    const gesture = new MoveItemGesture(p.ctx, p.at('t'), catalog.get('table')!, { x: 2, z: 2 });
    const preview = gesture.move({ x: 3, z: 2.5 });
    expect(preview.moved?.get('l')?.position).toMatchObject({ ...near(3.2, 2.6), y: 0.45 });
    gesture.end();
    expect(p.at('l').position).toMatchObject({ ...near(3.2, 2.6), y: 0.45 });
    expect(p.executed).toHaveLength(1);
  });

  it('un cuadro se desliza por la pared más cercana y no puede tapar la ventana', () => {
    const p = project([piece('c', 'picture', 1, 0.021, { wallId: 'w-back', position: { x: 1, y: 1.4, z: 0.021 } })]);
    const gesture = new MoveItemGesture(p.ctx, p.at('c'), catalog.get('picture')!, { x: 1, z: 0.02 });
    expect(gesture.move({ x: 2.4, z: 0.3 })).toMatchObject({ invalid: true, message: 'Ahí taparía una puerta o una ventana' });
    // Cerca de la pared izquierda cambia de pared y gira para mirar al cuarto.
    const onLeft = gesture.move({ x: 0.2, z: 2 }).moved?.get('c');
    expect(onLeft?.position).toMatchObject({ ...near(0.021, 2), y: 1.4 });
    gesture.end();
    expect(p.at('c')).toMatchObject({ wallId: 'w-left', position: { y: 1.4 } });
    expect(p.at('c').rotationY).toBeCloseTo(Math.PI / 2);
  });

  it('una lámpara de mesa se mueve sobre su soporte, salta a otro o baja al piso', () => {
    const p = project([piece('t1', 'table', 1.5, 2), piece('t2', 'table', 3.5, 2), piece('l', 'lamp', 1.5, 2, { supportId: 't1', position: { x: 1.5, y: 0.45, z: 2 } })]);
    const lamp = catalog.get('lamp')!;
    // Dentro de la misma mesa: sigue apoyada en ella.
    const within = new MoveItemGesture(p.ctx, p.at('l'), lamp, { x: 1.5, z: 2 });
    expect(within.move({ x: 1.7, z: 2.1 }).moved?.get('l')?.position).toMatchObject({ ...near(1.7, 2.1), y: 0.45 });
    within.end();
    expect(p.at('l')).toMatchObject({ supportId: 't1' });
    // Sobre la otra mesa: cambia de soporte.
    const jump = new MoveItemGesture(p.ctx, p.at('l'), lamp, { x: 1.7, z: 2.1 });
    jump.move({ x: 3.5, z: 2 });
    jump.end();
    expect(p.at('l')).toMatchObject({ supportId: 't2', position: { y: 0.45 } });
    // Fuera de toda mesa: queda en el piso, sin soporte.
    const down = new MoveItemGesture(p.ctx, p.at('l'), lamp, { x: 3.5, z: 2 });
    down.move({ x: 2.5, z: 3.4 });
    down.end();
    expect(p.at('l').supportId).toBeUndefined();
    expect(p.at('l').position.y).toBe(0);
  });

  it('un clic sin arrastrar no deja nada en el historial', () => {
    const p = project([piece('s', 'sofa', 2.5, 2)]);
    new MoveItemGesture(p.ctx, p.at('s'), catalog.get('sofa')!, { x: 2.5, z: 2 }).end();
    expect(p.executed).toHaveLength(0);
  });
});

describe('editar la planta en el plano', () => {
  it('arrastrar una pared cambia el cuarto en vivo y es un solo paso de deshacer', () => {
    const p = project([piece('s', 'sofa', 4, 2)]);
    p.history.clock = () => 0;
    const gesture = new MoveWallGesture(p.ctx, 'w-right', { x: 5, z: 2 });
    gesture.move({ x: 4.6, z: 2.3 });
    expect(p.state.shell?.widthM).toBe(4.6);
    // Aunque el usuario se detenga a mitad del arrastre, sigue siendo el mismo paso.
    p.history.clock = () => 60_000;
    gesture.move({ x: 4.21, z: 1 });
    expect(p.state.shell?.widthM).toBe(4.2);
    // El sofá (de 3,1 a 4,9) ya no cabía: se metió dentro.
    expect(p.at('s').position.x).toBeCloseTo(4.2 - 0.9);
    gesture.end();
    p.undo();
    expect(p.state.shell?.widthM).toBe(5);
    expect(p.at('s').position.x).toBe(4);
    expect(p.history.canUndo).toBe(false);
  });

  it('empujar la pared izquierda corre el origen y lo dice para compensar el dibujo', () => {
    const p = project([piece('s', 'sofa', 2, 2)]);
    const gesture = new MoveWallGesture(p.ctx, 'w-left', { x: 0, z: 2 });
    expect(gesture.move({ x: -0.5, z: 2 }).shift).toEqual({ x: 0.5, z: 0 });
    expect(p.state.shell?.widthM).toBe(5.5);
    expect(p.at('s').position.x).toBe(2.5);
    // La ventana sigue en el mismo sitio del cuarto.
    expect(p.state.shell?.openings[0]?.offsetM).toBeCloseTo(3);
  });

  it('un cuarto imposible no se aplica: se avisa y se queda el último válido', () => {
    const p = project([]);
    const gesture = new MoveWallGesture(p.ctx, 'w-right', { x: 5, z: 2 });
    gesture.move({ x: 4, z: 2 });
    const bad = gesture.move({ x: 0.3, z: 2 });
    expect(bad.invalid).toBe(true);
    expect(bad.message).toMatch(/cuarto|pared/i);
    expect(p.state.shell?.widthM).toBe(4);
  });

  it('volver al punto de partida deja el cuarto como estaba', () => {
    const p = project([]);
    const start = p.state.shell;
    const gesture = new MoveWallGesture(p.ctx, 'w-front', { x: 2, z: 4 });
    gesture.move({ x: 2, z: 4.01 });
    expect(p.executed).toHaveLength(0);
    gesture.move({ x: 2, z: 4.5 });
    gesture.move({ x: 2, z: 4 });
    expect(p.state.shell).toBe(start);
  });

  it('una esquina se mueve libre, pero se cuadra sola con las vecinas', () => {
    const p = project([]);
    const gesture = new MoveVertexGesture(p.ctx, 2, { x: 5, z: 4 });
    gesture.move({ x: 6, z: 4.07 });
    // Casi a escuadra con la esquina del frente a la izquierda (z = 4): se alinea.
    expect(p.state.shell).toMatchObject({ widthM: 6, depthM: 4, shape: 'free' });
    gesture.move({ x: 6, z: 5 });
    expect(p.state.shell?.depthM).toBe(5);
    p.undo();
    expect(p.state.shell).toMatchObject({ widthM: 5, depthM: 4 });
  });

  it('una ventana se desliza por su pared sin salirse', () => {
    const p = project([]);
    const gesture = new MoveOpeningGesture(p.ctx, 'win', { x: 2.5, z: 0 });
    gesture.move({ x: 3.52, z: 0.4 });
    expect(p.state.shell?.openings[0]?.offsetM).toBe(3.5);
    gesture.move({ x: 30, z: 0 });
    expect(p.state.shell?.openings[0]?.offsetM).toBeCloseTo(5 - 0.55);
    expect(p.executed.at(-1)?.label).toBe('Mover ventana');
  });
});

describe('medir', () => {
  it('mide entre dos puntos y los extremos se pegan a las esquinas', () => {
    const p = project([]);
    const gesture = new MeasureGesture(p.ctx, { x: 0.05, z: 0.04 });
    const preview = gesture.move({ x: 4.96, z: 0.03 });
    expect(preview.measure).toEqual({ from: { x: 0, z: 0 }, to: { x: 5, z: 0 } });
    expect(gesture.end()?.measure?.to.x).toBe(5);
    // Un clic sin arrastrar no deja ninguna medida.
    expect(new MeasureGesture(p.ctx, { x: 2, z: 2 }).end()).toBeNull();
  });
});

describe('cotas de un mueble', () => {
  it('da la distancia desde cada lado hasta la pared de enfrente', () => {
    const shell = createRectangularShell(5, 4, 2.6, { door: false, window: false });
    const corners = footprint({ x: 2, y: 0, z: 1.5 }, { x: 1.8, y: 0.8, z: 0.9 }, 0).corners;
    const lengths = clearancesOf(shell, corners).map((c) => Math.round(c.lengthM * 100) / 100);
    // Izquierda, derecha, fondo, frente.
    expect(lengths).toEqual([1.1, 2.1, 1.05, 2.05]);
    expect(clearancesOf(shell, corners)[0]?.label.text).toBe('1,10 m');
  });

  it('pegado a una pared, esa cota desaparece', () => {
    const shell = createRectangularShell(5, 4, 2.6, { door: false, window: false });
    const corners = footprint({ x: 0.9, y: 0, z: 0.45 }, { x: 1.8, y: 0.8, z: 0.9 }, 0).corners;
    expect(clearancesOf(shell, corners)).toHaveLength(2);
  });
});
