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
import { CommandHistory, type SceneCommand, type SceneState } from '../commands';
import { angleTo, gizmoLayout, heightAlongVertical, hitWall, openingAt, rotationFromDrag, sizeFromDrag, HANDLE_GAP_M } from '../mounts/gizmo-math';
import type { Ray } from '../mounts/mount-strategies';
import { GizmoController, ROTATE_STEP, type GizmoStore } from '../scene/gizmo-controller';
import { SelectionActions } from '../scene/selection-actions';
import type { DesignProjectStore } from '../../project/design-project.store';
import { MeasureTool, PaintTool, RoomTool, SelectTool, ToolManager, surfaceUnder, type PaintTarget, type ToolEvent, type ViewportTool } from './tools';

const window: Opening = { id: 'win', type: 'window', wallId: 'w-back', widthM: 1, heightM: 1.2, offsetM: 2.5, sillHeightM: 0.9 };
const room = (): RoomShell => ({ ...createRectangularShell(5, 4, 2.6, { door: false, window: false }), openings: [window] });

/** Rayo desde `from` hacia `to`. */
function ray(from: [number, number, number], to: [number, number, number]): Ray {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const n = Math.hypot(d[0]!, d[1]!, d[2]!);
  return { origin: { x: from[0], y: from[1], z: from[2] }, direction: { x: d[0]! / n, y: d[1]! / n, z: d[2]! / n } };
}
/** Rayo de una cámara alta al frente del cuarto que apunta a ese punto. */
const aim = (x: number, y: number, z: number): Ray => ray([2.5, 6, 9], [x, y, z]);
const at = (r: Ray, x = 0, y = 0): ToolEvent => ({ ray: r, event: { clientX: x, clientY: y, altKey: false } as PointerEvent });

describe('matemática del gizmo', () => {
  const dims = { x: 2, y: 0.8, z: 1 };

  it('coloca el aro y un tirador por cada medida que se puede cambiar', () => {
    const layout = gizmoLayout({ x: 2, y: 0, z: 2 }, dims, 0, { resizable: { x: true, y: false, z: true }, onWall: false });
    expect(layout.ringRadius).toBeCloseTo(Math.hypot(2, 1) / 2 + 0.22);
    expect(layout.handles.map((h) => h.kind)).toEqual(['rotate', 'width', 'depth']);
    const width = layout.handles.find((h) => h.kind === 'width')!.position;
    expect(width).toMatchObject({ x: expect.closeTo(3 + HANDLE_GAP_M), y: 0.4, z: expect.closeTo(2) });
    // Girada 90°, el tirador de ancho gira con ella.
    const turned = gizmoLayout({ x: 2, y: 0, z: 2 }, dims, Math.PI / 2, { resizable: { x: true, y: false, z: false }, onWall: false });
    expect(turned.handles.find((h) => h.kind === 'width')!.position.z).toBeCloseTo(2 - (1 + HANDLE_GAP_M));
  });

  it('lo colgado no tiene aro: sube y baja', () => {
    const layout = gizmoLayout({ x: 2, y: 1.4, z: 0.02 }, { x: 0.8, y: 0.6, z: 0.04 }, 0, { resizable: { x: true, y: true, z: false }, onWall: true });
    expect(layout.ringRadius).toBe(0);
    expect(layout.handles.map((h) => h.kind)).toEqual(['width', 'height', 'elevation']);
  });

  it('girar el aro gira la pieza lo mismo, a pasos de 15° o libre', () => {
    const centre = { x: 2, z: 2 };
    const grab = angleTo(centre, { x: 2, z: 3 }); // delante
    const side = angleTo(centre, { x: 3, z: 2 }); // un cuarto de vuelta
    expect(rotationFromDrag(0, grab, side, ROTATE_STEP)).toBeCloseTo(Math.PI / 2);
    expect(rotationFromDrag(0, grab, grab + 0.2, ROTATE_STEP)).toBeCloseTo(ROTATE_STEP);
    expect(rotationFromDrag(0, grab, grab + 0.2, null)).toBeCloseTo(0.2);
    // Siempre entre 0 y una vuelta.
    expect(rotationFromDrag(0.1, grab, grab - 0.3, null)).toBeCloseTo(Math.PI * 2 - 0.2);
  });

  it('estirar un tirador da la medida que deja el tirador bajo el cursor', () => {
    const position = { x: 2, y: 0, z: 2 };
    expect(sizeFromDrag('width', aim(3.5 + HANDLE_GAP_M, 0.4, 2), position, dims, 0)).toBeCloseTo(3);
    expect(sizeFromDrag('depth', aim(2, 0.4, 1.2 - HANDLE_GAP_M), position, dims, 0)).toBeCloseTo(1.6);
    expect(sizeFromDrag('height', aim(2, 1.2 + HANDLE_GAP_M, 2), position, dims, 0)).toBeCloseTo(1.2);
    expect(heightAlongVertical(ray([2, 5, 2], [2, 0, 2]), { x: 2, z: 2 })).toBeNull();
  });

  it('encuentra la pared y la abertura que hay bajo el cursor', () => {
    const shell = room();
    const onWall = hitWall(aim(1, 1.3, 0), shell)!;
    expect(onWall.wall.id).toBe('w-back');
    expect(onWall.along).toBeCloseTo(1);
    expect(onWall.y).toBeCloseTo(1.3);
    expect(openingAt(shell, onWall)).toBeNull();
    expect(openingAt(shell, hitWall(aim(2.6, 1.5, 0), shell)!)).toBe('win');
    // La pared del frente queda de espaldas a esa cámara: no cuenta.
    expect(hitWall(aim(2, 0, 3), shell)?.wall.id).not.toBe('w-front');
  });

  it('sabe si lo que se toca es el piso o una pared', () => {
    const shell = room();
    expect(surfaceUnder(aim(2, 0, 2), shell)).toEqual({ surface: 'floor' });
    expect(surfaceUnder(aim(1, 1.5, 0), shell)).toEqual({ surface: 'wall', wallId: 'w-back' });
  });
});

// ------------------------------------------------------------------ proyecto de mentira

const item = (id: string, dims: Vector3, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id, name: id, category: 'sofa', mount: 'floor', dimensionsM: dims, price: 0, ...extra }) as unknown as CatalogItem;
const catalog = new Map<string, CatalogItem>([
  ['sofa', item('sofa', { x: 2, y: 0.8, z: 1 }, { resize: { x: [1.4, 3], y: [0.6, 1], z: [0.8, 1.2] } })],
  ['table', item('table', { x: 1, y: 0.45, z: 0.6 })],
  ['lamp', item('lamp', { x: 0.3, y: 0.4, z: 0.3 }, { mount: 'surface' })],
  ['picture', item('picture', { x: 0.8, y: 0.6, z: 0.04 }, { mount: 'wall' })],
]);
const piece = (id: string, catalogItemId: string, x: number, z: number, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId,
  position: { x, y: 0, z },
  rotationY: 0,
  lockedByUser: false,
  ...extra,
});

function project(placements: FurniturePlacement[], selectedId: string | null = placements[0]?.id ?? null) {
  const history = new CommandHistory();
  let state: SceneState = { placements, finishes: null, shell: room() };
  const dimsOf = (p: FurniturePlacement) => p.dimensionsM ?? catalog.get(p.catalogItemId)!.dimensionsM;
  const selected = () => state.placements.find((p) => p.id === selectedId) ?? null;
  const store = {
    shell: () => state.shell ?? null,
    placements: () => state.placements,
    catalog: () => catalog,
    selected,
    selectedItem: () => {
      const p = selected();
      return p ? catalog.get(p.catalogItemId)! : null;
    },
    dependentsOf: (id: string) => state.placements.filter((p) => p.supportId === id),
    supportTopOf: () => null,
    findFreeSpot: () => null,
    isPoseValid: (id: string, _i: string, position: Vector3, rotationY: number, d?: Vector3) => {
      const me = footprint(position, d!, rotationY);
      if (!isInsideRoom(me, state.shell!)) return false;
      return !state.placements.some((o) => o.id !== id && !o.supportId && !o.wallId && footprintsOverlap(me, footprint(o.position, dimsOf(o), o.rotationY)));
    },
    execute: (cmd: SceneCommand) => (state = history.execute(cmd, state)),
  };
  return {
    store,
    history,
    get state() {
      return state;
    },
    undo: () => (state = history.undo(state)),
    at: (id: string) => state.placements.find((p) => p.id === id)!,
  };
}

function gizmoFor(p: ReturnType<typeof project>) {
  const previews: (ReadonlyMap<string, { position: Vector3; rotationY: number }> | null)[] = [];
  const actions = new SelectionActions(p.store as unknown as DesignProjectStore, () => false);
  return { gizmo: new GizmoController(p.store as unknown as GizmoStore, actions, (poses) => previews.push(poses)), previews };
}

describe('gizmo: girar y estirar', () => {
  it('el aro previsualiza el giro y al soltar deja un solo paso de deshacer, con lo que lleva encima', () => {
    const p = project([piece('t', 'table', 2, 2), piece('l', 'lamp', 2.3, 2, { supportId: 't', position: { x: 2.3, y: 0.45, z: 2 } })]);
    const { gizmo, previews } = gizmoFor(p);
    expect(gizmo.begin('rotate', { ray: aim(2, 0, 3), free: false })).toBe(true);
    gizmo.move({ ray: aim(3, 0, 2), free: false });
    // Mientras se arrastra nada cambia en el proyecto: solo la vista previa.
    expect(p.at('t').rotationY).toBe(0);
    expect(previews.at(-1)?.get('t')?.rotationY).toBeCloseTo(Math.PI / 2);
    expect(gizmo.layout()?.handles.find((h) => h.kind === 'rotate')!.position.x).toBeGreaterThan(2.5);
    gizmo.end();
    expect(p.at('t').rotationY).toBeCloseTo(Math.PI / 2);
    // La lámpara giró alrededor del centro de la mesa.
    expect(p.at('l').position).toMatchObject({ x: expect.closeTo(2), z: expect.closeTo(1.7) });
    p.undo();
    expect(p.at('t').rotationY).toBe(0);
    expect(p.history.canUndo).toBe(false);
  });

  it('con Alt gira libre; un clic sin mover no deja nada en el historial', () => {
    const p = project([piece('t', 'table', 2, 2)]);
    const { gizmo } = gizmoFor(p);
    gizmo.begin('rotate', { ray: aim(2, 0, 3), free: true });
    gizmo.move({ ray: aim(2.2, 0, 3), free: true });
    gizmo.end();
    expect(p.at('t').rotationY).toBeCloseTo(Math.atan2(0.2, 1));
    gizmo.begin('rotate', { ray: aim(2, 0, 3), free: false });
    gizmo.end();
    expect(p.history.canUndo).toBe(true);
    p.undo();
    expect(p.history.canUndo).toBe(false);
  });

  it('estirar aplica la medida en vivo, dentro de los rangos, y es un solo paso', () => {
    const p = project([piece('s', 'sofa', 2.5, 2)]);
    p.history.clock = () => 0;
    const { gizmo } = gizmoFor(p);
    gizmo.begin('width', { ray: aim(3.5 + HANDLE_GAP_M, 0.4, 2), free: false });
    gizmo.move({ ray: aim(3.7 + HANDLE_GAP_M, 0.4, 2), free: false });
    expect(p.at('s').dimensionsM?.x).toBeCloseTo(2.4);
    p.history.clock = () => 60_000;
    gizmo.move({ ray: aim(9, 0.4, 2), free: false });
    expect(p.at('s').dimensionsM?.x).toBe(3); // el tope del catálogo
    gizmo.end();
    p.undo();
    expect(p.at('s').dimensionsM).toBeUndefined();
    expect(p.history.canUndo).toBe(false);
  });

  it('si con esa medida choca, avisa y deja la última que cabía', () => {
    const p = project([piece('s', 'sofa', 2, 2), piece('t', 'table', 3.9, 2)]);
    const { gizmo } = gizmoFor(p);
    gizmo.begin('width', { ray: aim(3 + HANDLE_GAP_M, 0.4, 2), free: false });
    gizmo.move({ ray: aim(3.2 + HANDLE_GAP_M, 0.4, 2), free: false });
    expect(p.at('s').dimensionsM?.x).toBeCloseTo(2.4);
    gizmo.move({ ray: aim(3.5 + HANDLE_GAP_M, 0.4, 2), free: false });
    expect(gizmo.message()).toMatch(/choca/);
    expect(p.at('s').dimensionsM?.x).toBeCloseTo(2.4);
    gizmo.end();
    expect(gizmo.message()).toBeNull();
  });

  it('un cuadro sube y baja con su tirador sin atravesar el techo', () => {
    const p = project([piece('c', 'picture', 1, 0.021, { wallId: 'w-back', position: { x: 1, y: 1.2, z: 0.021 }, elevationM: 1.2 })]);
    const { gizmo } = gizmoFor(p);
    expect(gizmo.layout()?.handles.map((h) => h.kind)).toEqual(['elevation']);
    gizmo.begin('elevation', { ray: aim(1, 1.5, 0.021), free: false });
    gizmo.move({ ray: aim(1, 1.9, 0.021), free: false });
    expect(p.at('c')).toMatchObject({ elevationM: 1.6, position: { y: 1.6 } });
    gizmo.move({ ray: aim(1, 9, 0.021), free: false });
    expect(p.at('c').elevationM).toBe(2);
    gizmo.end();
  });

  it('lo apoyado sobre otro mueble no tiene gizmo', () => {
    const p = project([piece('l', 'lamp', 2.3, 2, { supportId: 't' }), piece('t', 'table', 2, 2)]);
    expect(gizmoFor(p).gizmo.layout()).toBeNull();
  });
});

describe('herramientas del visor', () => {
  it('Paredes: arrastrar una pared la mueve y es un paso de deshacer', () => {
    const p = project([piece('s', 'sofa', 3.8, 2)]);
    const messages: (string | null)[] = [];
    const pans: [number, number][] = [];
    const tool = new RoomTool(p.store, { shell: p.store.shell, panBy: (dx, dz) => pans.push([dx, dz]), message: (m) => messages.push(m) });
    // Se agarra la pared derecha (x = 5) a un metro de alto y se lleva hacia dentro.
    expect(tool.cursor(at(ray([1, 2, 2], [5, 1, 2])))).toBe('move');
    expect(tool.down(at(ray([1, 2, 2], [5, 1, 2])))).toBe(true);
    tool.move(at(ray([1, 6, 2], [4.4, 1, 2])));
    expect(p.state.shell?.widthM).toBe(4.4);
    expect(p.at('s').position.x).toBeCloseTo(3.4);
    tool.move(at(ray([1, 6, 2], [0.2, 1, 2])));
    expect(messages.at(-1)).toMatch(/cuarto/);
    tool.up();
    expect(messages.at(-1)).toBeNull();
    p.undo();
    expect(p.state.shell?.widthM).toBe(5);
    expect(pans).toEqual([]);
  });

  it('Paredes: empujar la del fondo corre el origen y la cámara lo acompaña', () => {
    const p = project([]);
    const pans: [number, number][] = [];
    const tool = new RoomTool(p.store, { shell: p.store.shell, panBy: (dx, dz) => pans.push([dx, dz]), message: () => undefined });
    tool.down(at(aim(1, 1, 0)));
    tool.move(at(aim(1, 1, -0.5)));
    expect(p.state.shell?.depthM).toBe(4.5);
    expect(pans).toEqual([[0, 0.5]]);
    // El cursor no se movió en el mundo: el gesto compensa el corrimiento y el cuarto no sigue creciendo.
    tool.move(at(aim(1, 1, 0)));
    expect(p.state.shell?.depthM).toBe(4.5);
  });

  it('Paredes: sobre una ventana la desliza en vez de mover la pared', () => {
    const p = project([]);
    const tool = new RoomTool(p.store, { shell: p.store.shell, panBy: () => undefined, message: () => undefined });
    expect(tool.cursor(at(aim(2.5, 1.5, 0)))).toBe('ew-resize');
    tool.down(at(aim(2.5, 1.5, 0)));
    tool.move(at(aim(3.5, 1.5, 0)));
    tool.up();
    expect(p.state.shell?.openings[0]?.offsetM).toBe(3.5);
    expect(p.state.shell?.widthM).toBe(5);
  });

  it('Pintar: un clic abre la paleta de lo que se tocó; arrastrar no pinta; un mueble se selecciona', () => {
    const opened: (PaintTarget | null)[] = [];
    const selected: string[] = [];
    let under: string | null = null;
    const tool = new PaintTool({ shell: room, pickItem: () => under, select: (id) => selected.push(id), open: (t) => opened.push(t) });
    expect(tool.down(at(aim(1, 1.5, 0), 100, 100))).toBe(false);
    tool.up(at(aim(1, 1.5, 0), 101, 100));
    expect(opened.at(-1)).toEqual({ surface: 'wall', wallId: 'w-back' });
    tool.down(at(aim(2, 0, 2), 100, 100));
    tool.up(at(aim(2, 0, 2), 160, 100));
    expect(opened).toHaveLength(1);
    under = 's';
    tool.down(at(aim(2, 0, 2), 100, 100));
    tool.up(at(aim(2, 0, 2), 100, 100));
    expect(selected).toEqual(['s']);
    expect(opened.at(-1)).toBeNull();
  });

  it('Medir: la regla va de donde se pulsa a donde se suelta y se queda dibujada', () => {
    const lines: unknown[] = [];
    const tool = new MeasureTool({ measure: (l) => lines.push(l) });
    expect(tool.down(at(aim(1, 0, 1)))).toBe(true);
    tool.move(at(aim(4, 0, 1)));
    tool.up();
    expect(lines.at(-1)).toMatchObject({ from: { x: expect.closeTo(1) }, to: { x: expect.closeTo(4), z: expect.closeTo(1) } });
    tool.leave();
    expect(lines.at(-1)).toBeNull();
  });

  it('Seleccionar: el gizmo tiene prioridad sobre el arrastre de muebles', () => {
    const log: string[] = [];
    let handle: 'rotate' | null = 'rotate';
    const tool = new SelectTool({
      pickHandle: () => handle,
      beginHandle: () => (log.push('begin'), true),
      moveHandle: () => void log.push('handle-move'),
      endHandle: () => void log.push('end'),
      highlight: () => undefined,
      dragDown: () => void log.push('drag-down'),
      dragMove: () => void log.push('drag-move'),
      dragUp: () => void log.push('drag-up'),
      readOnly: () => false,
    });
    expect(tool.down(at(aim(2, 0, 2)))).toBe(true);
    tool.move(at(aim(2, 0, 2)));
    tool.up(at(aim(2, 0, 2)));
    handle = null;
    expect(tool.down(at(aim(2, 0, 2)))).toBe(false);
    tool.move(at(aim(2, 0, 2)));
    tool.up(at(aim(2, 0, 2)));
    expect(log).toEqual(['begin', 'handle-move', 'end', 'drag-down', 'drag-move', 'drag-up']);
  });

  it('el gestor reparte los gestos a la herramienta activa y avisa al cambiar', () => {
    const log: string[] = [];
    const fake = (id: ViewportTool['id'], captures: boolean): ViewportTool => ({
      id,
      down: () => (log.push(`${id}:down`), captures),
      move: () => void log.push(`${id}:move`),
      up: () => void log.push(`${id}:up`),
      cursor: () => `${id}-cursor`,
      leave: () => void log.push(`${id}:leave`),
    });
    const changes: string[] = [];
    const manager = new ToolManager([fake('select', false), fake('room', true)], (id) => changes.push(id));
    const e = at(aim(2, 0, 2));
    expect(manager.active).toBe('select');
    expect(manager.down(e)).toBe(false);
    manager.up(e);
    manager.use('room');
    manager.use('room');
    expect(changes).toEqual(['room']);
    // Sin botón pulsado solo se pregunta el cursor; con el gesto capturado, se mueve.
    expect(manager.move(e, false)).toBe('room-cursor');
    expect(manager.down(e)).toBe(true);
    expect(manager.busy).toBe(true);
    expect(manager.move(e, true)).toBeNull();
    manager.up(e);
    expect(manager.busy).toBe(false);
    expect(log).toEqual(['select:down', 'select:up', 'select:leave', 'room:down', 'room:move', 'room:up']);
  });
});
