import { describe, expect, it } from 'vitest';
import { DEFAULT_FINISHES, addPrivateBathroom, createRectangularShell, type DesignOperation, type FurniturePlacement } from '@interiores/shared-types';
import { CommandHistory, type SceneState } from '../viewport-3d/commands';
import { briefFromOperations, commandFromOperations, recommendFromOperations, roomFromOperations } from './chat-operations';

const p = (id: string, x = 1): FurniturePlacement => ({ id, catalogItemId: 'sofa', position: { x, y: 0, z: 1 }, rotationY: 0, lockedByUser: true });
const state: SceneState = { placements: [p('a'), p('b')], finishes: null };

describe('operaciones del asistente', () => {
  const ops: DesignOperation[] = [
    { op: 'room', widthM: 4, depthM: 3, heightM: 2.6 },
    { op: 'finishes', finishes: { floor: 'wood-walnut', walls: { all: 'paint-sage' }, ceiling: 'paint-white' } },
    { op: 'remove', id: 'b' },
    { op: 'add', placement: p('c', 2) },
    { op: 'update', placement: p('a', 3) },
  ];

  it('las medidas del cuarto van aparte (se aplican en el servidor)', () => {
    expect(roomFromOperations(ops)).toEqual({ widthM: 4, depthM: 3, heightM: 2.6 });
    expect(roomFromOperations([])).toBeNull();
  });

  it('todo lo demás es UN paso de deshacer', () => {
    const { command, touched } = commandFromOperations(ops, state);
    expect(touched).toEqual(['c', 'a']);
    const history = new CommandHistory();
    const after = history.execute(command!, state);
    expect(after.placements.map((x) => [x.id, x.position.x])).toEqual([['a', 3], ['c', 2]]);
    expect(after.finishes?.floor).toBe('wood-walnut');
    expect(history.nextUndoLabel).toBe('Cambios del asistente');
    expect(history.undo(after)).toEqual(state);
  });

  it('tolera que la escena haya cambiado: update de algo que no está = agregar; remove de algo ausente se ignora', () => {
    const { command } = commandFromOperations([{ op: 'update', placement: p('z') }, { op: 'remove', id: 'nope' }], state);
    const after = command!.apply(state);
    expect(after.placements.map((x) => x.id)).toEqual(['a', 'b', 'z']);
    expect(commandFromOperations([{ op: 'room', widthM: 4, depthM: 3, heightM: 2.6 }], state).command).toBeNull();
  });

  it('zonas nuevas: cambian la planta en el mismo paso y piden redistribuir', () => {
    const shell = createRectangularShell(4.5, 4, 2.6);
    const { zone, shell: withBath } = addPrivateBathroom(shell, DEFAULT_FINISHES, 'ducha-obra');
    const s0: SceneState = { ...state, shell };
    const plan = commandFromOperations([{ op: 'zones', zones: withBath.zones ?? [] }, { op: 'remove', id: 'b' }], s0);
    expect(plan.zonesChanged).toBe(true);
    const after = plan.command!.apply(s0);
    expect(after.shell?.zones?.map((z) => z.id)).toEqual([zone.id]);
    expect(after.placements.map((x) => x.id)).toEqual(['a']);
    expect(plan.command!.revert(after)).toEqual(s0);
    // Sin planta cargada, la zona no se puede aplicar (y no cuenta como cambio).
    expect(commandFromOperations([{ op: 'zones', zones: [] }], state).zonesChanged).toBe(false);
  });

  it('el Brief y el pedido de Recomendar van aparte (no son parte del deshacer)', () => {
    const brief = { surfaces: { floor: { material: 'wood-walnut', locked: true } }, mustHave: [], avoid: ['rug'], zones: [] };
    const extra: DesignOperation[] = [...ops, { op: 'brief', brief }, { op: 'recommend', intensity: 'suave' }];
    expect(briefFromOperations(extra)).toEqual(brief);
    expect(recommendFromOperations(extra)).toBe('suave');
    expect(briefFromOperations(ops)).toBeNull();
    expect(recommendFromOperations(ops)).toBeNull();
    expect(commandFromOperations([{ op: 'brief', brief }, { op: 'recommend', intensity: 'total' }], state).command).toBeNull();
  });
});
