import type { FurniturePlacement } from '@interiores/shared-types';
import { AddCommand, CommandHistory, MoveCommand, RemoveCommand, RotateCommand, SwapCommand } from './commands';

const p = (id: string, x = 1): FurniturePlacement => ({
  id,
  catalogItemId: 'sofa',
  position: { x, y: 0, z: 1 },
  rotationY: 0,
  lockedByUser: false,
});

describe('CommandHistory', () => {
  it('deshace y rehace una secuencia de comandos en orden', () => {
    const h = new CommandHistory();
    let s: readonly FurniturePlacement[] = [p('a')];
    s = h.execute(new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }), s);
    s = h.execute(new AddCommand(p('b', 3)), s);
    s = h.execute(new RotateCommand('a', 0, Math.PI / 2), s);
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s[0]).toMatchObject({ rotationY: Math.PI / 2, lockedByUser: true, position: { x: 2 } });

    s = h.undo(s);
    s = h.undo(s);
    expect(s.map((x) => x.id)).toEqual(['a']);
    expect(s[0]!.rotationY).toBe(0);
    s = h.undo(s);
    expect(s[0]!.position.x).toBe(1);
    expect(h.canUndo).toBe(false);

    s = h.redo(s);
    s = h.redo(s);
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
    expect(h.nextRedoLabel).toBe('Rotar mueble');
  });

  it('un comando nuevo invalida la pila de rehacer', () => {
    const h = new CommandHistory();
    let s: readonly FurniturePlacement[] = [p('a')];
    s = h.execute(new AddCommand(p('b')), s);
    s = h.undo(s);
    expect(h.canRedo).toBe(true);
    s = h.execute(new AddCommand(p('c')), s);
    expect(h.canRedo).toBe(false);
    expect(s.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('quitar y deshacer restaura el mueble en su posición original de la lista', () => {
    const h = new CommandHistory();
    let s: readonly FurniturePlacement[] = [p('a'), p('b'), p('c')];
    s = h.execute(new RemoveCommand(s[1]!), s);
    expect(s.map((x) => x.id)).toEqual(['a', 'c']);
    s = h.undo(s);
    expect(s.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('cambiar mueble conserva el id y se puede revertir', () => {
    const h = new CommandHistory();
    let s: readonly FurniturePlacement[] = [p('a')];
    s = h.execute(new SwapCommand('a', 'sofa', 'sofa-2', { x: 1, y: 0, z: 1 }, { x: 1.2, y: 0, z: 1 }), s);
    expect(s[0]).toMatchObject({ id: 'a', catalogItemId: 'sofa-2' });
    s = h.undo(s);
    expect(s[0]).toMatchObject({ catalogItemId: 'sofa', position: { x: 1 } });
  });

  it('deshacer restaura el estado de "fijado por el usuario" original', () => {
    const h = new CommandHistory();
    let s: readonly FurniturePlacement[] = [p('a')];
    s = h.execute(new MoveCommand('a', { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }), s);
    expect(s[0]!.lockedByUser).toBe(true);
    s = h.undo(s);
    expect(s[0]!.lockedByUser).toBe(false);
    s = h.redo(s);
    expect(s[0]!.lockedByUser).toBe(true);
  });

  it('respeta el límite del historial', () => {
    const h = new CommandHistory(3);
    let s: readonly FurniturePlacement[] = [];
    for (let i = 0; i < 5; i++) s = h.execute(new AddCommand(p(`x${i}`)), s);
    let undos = 0;
    while (h.canUndo) {
      s = h.undo(s);
      undos++;
    }
    expect(undos).toBe(3);
    expect(s).toHaveLength(2);
  });

  it('los comandos no mutan el estado anterior (inmutabilidad)', () => {
    const before = Object.freeze([Object.freeze(p('a'))]) as readonly FurniturePlacement[];
    const after = new MoveCommand('a', before[0]!.position, { x: 9, y: 0, z: 9 }).apply(before);
    expect(before[0]!.position.x).toBe(1);
    expect(after[0]!.position.x).toBe(9);
  });
});
