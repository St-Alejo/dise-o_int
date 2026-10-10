import type { FurniturePlacement } from '@interiores/shared-types';
import { DEFAULT_FINISHES, STYLE_FINISHES, createRectangularShell } from '@interiores/shared-types';
import {
  AddCommand,
  CommandHistory,
  DuplicateCommand,
  MacroCommand,
  MoveCommand,
  RemountCommand,
  RemoveCommand,
  ResizeCommand,
  RotateCommand,
  SetElevationCommand,
  SetFinishesCommand,
  SetLockCommand,
  SetMaterialCommand,
  SetRoomCommand,
  SwapCommand,
  newGestureKey,
  type SceneState,
} from './commands';

const p = (id: string, x = 1): FurniturePlacement => ({
  id,
  catalogItemId: 'sofa',
  position: { x, y: 0, z: 1 },
  rotationY: 0,
  lockedByUser: false,
});

const scene = (...placements: FurniturePlacement[]): SceneState => ({ placements, finishes: null });
const ids = (s: SceneState) => s.placements.map((x) => x.id);

describe('CommandHistory', () => {
  it('deshace y rehace una secuencia de comandos en orden', () => {
    const h = new CommandHistory();
    let s = scene(p('a'));
    s = h.execute(new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }), s);
    s = h.execute(new AddCommand(p('b', 3)), s);
    s = h.execute(new RotateCommand('a', 0, Math.PI / 2), s);
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.placements[0]).toMatchObject({ rotationY: Math.PI / 2, lockedByUser: true, position: { x: 2 } });

    s = h.undo(s);
    s = h.undo(s);
    expect(ids(s)).toEqual(['a']);
    expect(s.placements[0]!.rotationY).toBe(0);
    s = h.undo(s);
    expect(s.placements[0]!.position.x).toBe(1);
    expect(h.canUndo).toBe(false);

    s = h.redo(s);
    s = h.redo(s);
    expect(ids(s)).toEqual(['a', 'b']);
    expect(h.nextRedoLabel).toBe('Rotar mueble');
  });

  it('un comando nuevo invalida la pila de rehacer', () => {
    const h = new CommandHistory();
    let s = scene(p('a'));
    s = h.execute(new AddCommand(p('b')), s);
    s = h.undo(s);
    expect(h.canRedo).toBe(true);
    s = h.execute(new AddCommand(p('c')), s);
    expect(h.canRedo).toBe(false);
    expect(ids(s)).toEqual(['a', 'c']);
  });

  it('quitar y deshacer restaura el mueble en su posición original de la lista', () => {
    const h = new CommandHistory();
    let s = scene(p('a'), p('b'), p('c'));
    s = h.execute(new RemoveCommand(s.placements[1]!), s);
    expect(ids(s)).toEqual(['a', 'c']);
    s = h.undo(s);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
  });

  it('cambiar mueble conserva el id, descarta medidas/materiales del anterior y se puede revertir', () => {
    const h = new CommandHistory();
    let s = scene({ ...p('a'), dimensionsM: { x: 3, y: 1, z: 1 }, materials: { tapizado: 'leather-black' } });
    s = h.execute(new SwapCommand('a', 'sofa', 'sofa-2', { x: 1, y: 0, z: 1 }, { x: 1.2, y: 0, z: 1 }), s);
    expect(s.placements[0]).toMatchObject({ id: 'a', catalogItemId: 'sofa-2' });
    expect(s.placements[0]).not.toHaveProperty('dimensionsM');
    s = h.undo(s);
    expect(s.placements[0]).toMatchObject({ catalogItemId: 'sofa', position: { x: 1 }, dimensionsM: { x: 3 } });
  });

  it('deshacer restaura el estado de "fijado por el usuario" original', () => {
    const h = new CommandHistory();
    let s = scene(p('a'));
    s = h.execute(new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }), s);
    expect(s.placements[0]!.lockedByUser).toBe(true);
    s = h.undo(s);
    expect(s.placements[0]!.lockedByUser).toBe(false);
    s = h.redo(s);
    expect(s.placements[0]!.lockedByUser).toBe(true);
  });

  it('respeta el límite del historial', () => {
    const h = new CommandHistory(3);
    let s = scene();
    for (let i = 0; i < 5; i++) s = h.execute(new AddCommand(p(`x${i}`)), s);
    let undos = 0;
    while (h.canUndo) {
      s = h.undo(s);
      undos++;
    }
    expect(undos).toBe(3);
    expect(s.placements).toHaveLength(2);
  });

  it('los comandos no mutan el estado anterior (inmutabilidad)', () => {
    const before = Object.freeze({ placements: Object.freeze([Object.freeze(p('a'))]), finishes: null }) as SceneState;
    const after = new MoveCommand('a', before.placements[0]!.position, { x: 9, y: 0, z: 9 }).apply(before);
    expect(before.placements[0]!.position.x).toBe(1);
    expect(after.placements[0]!.position.x).toBe(9);
  });
});

describe('comandos de personalización (Fase 3)', () => {
  it('cambiar medidas y volver a las del catálogo', () => {
    const h = new CommandHistory();
    let s = scene(p('a'));
    s = h.execute(new ResizeCommand(s.placements[0]!, { x: 2.4, y: 0.8, z: 0.9 }, { x: 1.4, y: 0, z: 1 }), s);
    expect(s.placements[0]).toMatchObject({ dimensionsM: { x: 2.4 }, position: { x: 1.4 }, lockedByUser: true });
    s = h.execute(new ResizeCommand(s.placements[0]!, undefined), s);
    expect(s.placements[0]).not.toHaveProperty('dimensionsM');
    s = h.undo(s);
    s = h.undo(s);
    expect(s.placements[0]).not.toHaveProperty('dimensionsM');
    expect(s.placements[0]!.position.x).toBe(1);
  });

  it('arrastrar un slider genera UN solo paso de deshacer (fusión en la ventana de tiempo)', () => {
    const h = new CommandHistory();
    let now = 0;
    h.clock = () => now;
    let s = scene(p('a'));
    for (const x of [2.1, 2.2, 2.3, 2.4]) {
      now += 50;
      s = h.execute(new ResizeCommand(s.placements[0]!, { x, y: 0.8, z: 0.9 }), s);
    }
    expect(s.placements[0]!.dimensionsM!.x).toBe(2.4);
    s = h.undo(s);
    expect(h.canUndo).toBe(false);
    expect(s.placements[0]).not.toHaveProperty('dimensionsM');
  });

  it('no fusiona si pasó la ventana, si es otra pieza u otro tipo de edición', () => {
    const h = new CommandHistory();
    let now = 0;
    h.clock = () => now;
    let s = scene(p('a'), p('b'));
    s = h.execute(new ResizeCommand(s.placements[0]!, { x: 2, y: 1, z: 1 }), s);
    now += 50;
    s = h.execute(new ResizeCommand(s.placements[1]!, { x: 2, y: 1, z: 1 }), s);
    now += 50;
    s = h.execute(new SetMaterialCommand(s.placements[1]!, 'tapizado', 'fabric-wool-grey'), s);
    now += CommandHistory.MERGE_WINDOW_MS + 1;
    s = h.execute(new ResizeCommand(s.placements[1]!, { x: 2.5, y: 1, z: 1 }), s);
    let undos = 0;
    while (h.canUndo) {
      s = h.undo(s);
      undos++;
    }
    expect(undos).toBe(4);
  });

  it('material por slot: cambiar, volver al de catálogo y deshacer', () => {
    const h = new CommandHistory();
    let s = scene(p('a'));
    s = h.execute(new SetMaterialCommand(s.placements[0]!, 'tapizado', 'leather-cognac'), s);
    s = h.execute(new SetMaterialCommand(s.placements[0]!, 'patas', 'metal-black'), s);
    expect(s.placements[0]!.materials).toEqual({ tapizado: 'leather-cognac', patas: 'metal-black' });
    s = h.execute(new SetMaterialCommand(s.placements[0]!, 'tapizado', undefined), s);
    expect(s.placements[0]!.materials).toEqual({ patas: 'metal-black' });
    s = h.undo(s);
    expect(s.placements[0]!.materials!['tapizado']).toBe('leather-cognac');
  });

  it('altura de pared, montar en otro soporte, bloquear y duplicar', () => {
    const h = new CommandHistory();
    let s = scene({ ...p('c'), position: { x: 1, y: 1.3, z: 0.02 }, wallId: 'w-back' });
    s = h.execute(new SetElevationCommand(s.placements[0]!, 1.6), s);
    expect(s.placements[0]).toMatchObject({ elevationM: 1.6, position: { y: 1.6 } });
    s = h.execute(new RemountCommand(s.placements[0]!, { position: { x: 0.02, y: 1.6, z: 1 }, rotationY: Math.PI / 2, wallId: 'w-left' }), s);
    expect(s.placements[0]).toMatchObject({ wallId: 'w-left', rotationY: Math.PI / 2 });
    s = h.execute(new SetLockCommand('c', false), s);
    expect(s.placements[0]!.lockedByUser).toBe(false);
    s = h.execute(new DuplicateCommand({ ...s.placements[0]!, id: 'c2' }), s);
    expect(ids(s)).toEqual(['c', 'c2']);
    expect(h.nextUndoLabel).toBe('Duplicar mueble');
    while (h.canUndo) s = h.undo(s);
    expect(s.placements).toEqual([{ ...p('c'), position: { x: 1, y: 1.3, z: 0.02 }, wallId: 'w-back' }]);
  });

  it('acabados del cuarto: se aplican, se fusionan y se deshacen', () => {
    const h = new CommandHistory();
    let s = scene();
    s = h.execute(new SetFinishesCommand(null, DEFAULT_FINISHES), s);
    s = h.execute(new SetFinishesCommand(DEFAULT_FINISHES, STYLE_FINISHES.industrial), s);
    expect(s.finishes).toEqual(STYLE_FINISHES.industrial);
    s = h.undo(s);
    expect(s.finishes).toBeNull();
  });

  it('macro: mover una mesa y lo que tiene encima es un solo paso', () => {
    const h = new CommandHistory();
    let s = scene(p('mesa', 1), { ...p('lampara', 1), supportId: 'mesa', position: { x: 1, y: 0.55, z: 1 } });
    s = h.execute(
      new MacroCommand('Mover mueble', [
        new MoveCommand('mesa', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }),
        new MoveCommand('lampara', { x: 1, y: 0.55, z: 1 }, { x: 2, y: 0.55, z: 1 }),
      ]),
      s,
    );
    expect(s.placements.map((x) => x.position.x)).toEqual([2, 2]);
    s = h.undo(s);
    expect(s.placements.map((x) => x.position.x)).toEqual([1, 1]);
    expect(h.canUndo).toBe(false);
  });
});

describe('SetRoomCommand', () => {
  const small = createRectangularShell(4, 3, 2.6);
  const big = createRectangularShell(5, 3, 2.6);
  const bigger = createRectangularShell(6, 3, 2.6);

  it('cambia el cuarto y sus muebles, y deshacer restaura los dos', () => {
    const h = new CommandHistory();
    let s: SceneState = { placements: [p('a', 3.5)], finishes: null, shell: big };
    s = h.execute(new SetRoomCommand('Mover pared', { shell: big, placements: s.placements }, { shell: small, placements: [p('a', 3)] }), s);
    expect(s.shell).toBe(small);
    expect(s.placements[0]!.position.x).toBe(3);
    s = h.undo(s);
    expect(s.shell).toBe(big);
    expect(s.placements[0]!.position.x).toBe(3.5);
    expect(h.redo(s).shell).toBe(small);
  });

  it('los comandos de un mismo gesto son un solo paso aunque pase el tiempo; los de otro, no', () => {
    const h = new CommandHistory();
    let now = 0;
    h.clock = () => now;
    const key = newGestureKey();
    const before = { shell: small, placements: [p('a')] };
    let s: SceneState = { ...before, finishes: null };
    s = h.execute(new SetRoomCommand('Mover pared', before, { shell: big, placements: before.placements }, key), s);
    now = 30_000;
    s = h.execute(new SetRoomCommand('Mover pared', before, { shell: bigger, placements: before.placements }, key), s);
    s = h.execute(new SetRoomCommand('Mover pared', { shell: bigger, placements: before.placements }, before, newGestureKey()), s);
    expect(s.shell).toBe(small);
    s = h.undo(s);
    expect(s.shell).toBe(bigger);
    s = h.undo(s);
    expect(s.shell).toBe(small);
    expect(h.canUndo).toBe(false);
  });

  it('los comandos de muebles no tocan el cuarto', () => {
    const s = new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }).apply({ placements: [p('a')], finishes: null, shell: small });
    expect(s.shell).toBe(small);
  });
});

describe('CommandHistory.record', () => {
  it('anota un cambio que ya ocurrió: se puede deshacer y rehacer sin haberlo aplicado', () => {
    const h = new CommandHistory();
    const before = scene(p('a', 1));
    // El servidor ya dejó el mueble en x = 4: el estado local ya es el nuevo.
    let s = scene(p('a', 4));
    h.record(new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }));
    expect(h.nextUndoLabel).toBe('Mover mueble');
    s = h.undo(s);
    expect(s.placements[0]!.position.x).toBe(before.placements[0]!.position.x);
    s = h.redo(s);
    expect(s.placements[0]!.position.x).toBe(4);
  });

  it('conserva lo que había antes en el historial y descarta lo rehacible', () => {
    const h = new CommandHistory();
    let s = h.execute(new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }), scene(p('a', 1)));
    s = h.execute(new MoveCommand('a', { x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 }), s);
    s = h.undo(s);
    expect(h.canRedo).toBe(true);
    h.record(new MoveCommand('a', { x: 2, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }));
    expect(h.canRedo).toBe(false);
    s = h.undo({ ...s, placements: [p('a', 5)] });
    s = h.undo(s);
    expect(s.placements[0]!.position.x).toBe(1);
    expect(h.canUndo).toBe(false);
  });
});
