import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plano3dModel } from '@interiores/shared-types';
import { NotFoundError, UnauthorizedError, ValidationError } from '../src/common/errors.js';
import { InProcessSceneEvents } from '../src/infrastructure/realtime/scene-events.js';
import { Plano3dService, type SceneSyncNotifier } from '../src/modules/plano3d/plano3d.service.js';
import type {
  IPlano3dClient,
  IPlano3dLinkRepository,
  Plano3dGrant,
  Plano3dLinkRecord,
  Plano3dLiveMessage,
  Plano3dLiveRoom,
} from '../src/ports/index.js';
import { InMemoryCatalogRepository, InMemoryProjectRepository, catalogItem } from './fakes.js';

const house = (): Plano3dModel => ({
  project_id: 'p3d-casa',
  levels: [
    {
      id: 'L1',
      name: 'Piso 1',
      height: 2.7,
      walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, openings: [{ id: 'v1', kind: 'window', offset: 1, width: 1.2, height: 1.2, sill: 1 }] }],
      rooms: [
        { id: 'sala', label: 'Sala', room_type: 'living', polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] },
        { id: 'garaje', label: 'Garaje', room_type: 'garage', polygon: [{ x: 5, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 5, y: 4 }] },
      ],
      furniture: [],
    },
    {
      id: 'L2',
      name: 'Piso 2',
      rooms: [{ id: 'alcoba', label: 'Alcoba', room_type: 'bedroom', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] }],
    },
  ],
});

/** Plano 3D de mentira: canje, proyecto y una sala en vivo que guarda lo que se le manda. */
class FakePlano3d implements IPlano3dClient {
  model: Plano3dModel = house();
  revoked = false;
  sent: unknown[][] = [];
  rooms: { onMessage: (m: Plano3dLiveMessage) => void; onClose: (code: number, reason: string) => void; closed: boolean }[] = [];

  async claim(code: string): Promise<Plano3dGrant> {
    if (code !== 'K7QM-3XTP') throw new NotFoundError('no existe');
    return { token: 'tok-1', expiresIn: 3600, projectId: 'p3d-casa', projectName: 'Casa de prueba' };
  }
  async project() {
    if (this.revoked) throw new UnauthorizedError('revocado');
    return { id: 'p3d-casa', name: 'Casa de prueba', model: structuredClone(this.model) };
  }
  connect(_id: string, _token: string, opts: { onMessage: (m: Plano3dLiveMessage) => void; onClose: (code: number, reason: string) => void }): Plano3dLiveRoom {
    const room = { onMessage: opts.onMessage, onClose: opts.onClose, closed: false };
    this.rooms.push(room);
    // como Plano 3D: `you` es el par completo y `peers` son los que ya estaban
    queueMicrotask(() =>
      opts.onMessage({ type: 'welcome', you: { id: 'yo', name: 'Interiores 3D', client: 'interiores' }, seq: 0, peers: [{ id: 'ana', name: 'Ana', client: 'web' }] }),
    );
    return {
      send: (ops) => {
        this.sent.push(ops);
        return 'op';
      },
      presence: () => undefined,
      close: () => {
        room.closed = true;
      },
    };
  }
  /** Simula un lote de otra persona en Plano 3D. */
  emit(msg: Plano3dLiveMessage) {
    for (const r of this.rooms.filter((x) => !x.closed)) r.onMessage(msg);
  }
}

class InMemoryLinks implements IPlano3dLinkRepository {
  rows = new Map<string, Plano3dLinkRecord>();
  async create(data: Omit<Plano3dLinkRecord, 'createdAt' | 'lastSeq' | 'revokedAt'>) {
    const rec: Plano3dLinkRecord = { ...data, lastSeq: 0, revokedAt: null, createdAt: new Date('2026-11-16T12:00:00Z') };
    this.rows.set(rec.id, rec);
    return { ...rec };
  }
  async findById(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async listByOwner(ownerId: string) {
    return [...this.rows.values()].filter((r) => r.ownerId === ownerId).map((r) => ({ ...r }));
  }
  async listActive() {
    return [...this.rows.values()].filter((r) => !r.revokedAt);
  }
  async update(id: string, patch: Partial<Plano3dLinkRecord>) {
    Object.assign(this.rows.get(id)!, patch);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 450));
const actor = { userId: 'u1' };

describe('Puente con Plano 3D (ADR-0039)', () => {
  let p3d: FakePlano3d;
  let links: InMemoryLinks;
  let projects: InMemoryProjectRepository;
  let scenes: InProcessSceneEvents;
  let synced: { projectId: string; payload: unknown }[];
  let presence: { projectId: string; peers: { name: string; client: string }[] }[];
  let service: Plano3dService;

  beforeEach(async () => {
    p3d = new FakePlano3d();
    links = new InMemoryLinks();
    projects = new InMemoryProjectRepository();
    scenes = new InProcessSceneEvents();
    synced = [];
    presence = [];
    const notifier: SceneSyncNotifier = {
      sceneSync: (projectId, payload) => synced.push({ projectId, payload }),
      plano3dPresence: (projectId, peers) => presence.push({ projectId, peers }),
    };
    const catalog = new InMemoryCatalogRepository([catalogItem(), catalogItem({ id: 'cama-doble', category: 'bed', widthM: 1.6, depthM: 2, heightM: 0.5 })]);
    service = new Plano3dService(p3d, links, projects, catalog, scenes, notifier);
    await service.onModuleInit();
  });

  const rooms = async () => (await projects.listByOwner('u1')).sort((a, b) => a.name.localeCompare(b.name));

  it('el código crea una vivienda con un cuarto por ambiente diseñable', async () => {
    const summary = await service.link(actor, 'K7QM-3XTP');
    expect(summary.projectName).toBe('Casa de prueba');
    expect(summary.rooms.map((r) => [r.name, r.level])).toEqual([
      ['Sala · Piso 1', 'Piso 1'],
      ['Alcoba · Piso 2', 'Piso 2'],
    ]);
    const [alcoba, sala] = await rooms();
    expect(sala!.homeId).toBe(summary.homeId);
    expect(sala!.saved).toBe(true);
    expect(sala!.status).toBe('ready');
    expect(sala!.roomShell!.heightM).toBe(2.7);
    expect(sala!.roomShell!.openings.map((o) => o.id)).toEqual(['p3d-v1']);
    expect(alcoba!.roomType).toBe('bedroom');
    expect(alcoba!.plano3d).toMatchObject({ levelId: 'L2', roomId: 'alcoba', levelIndex: 1 });
    // el token nunca vuelve al cliente
    expect(JSON.stringify(summary)).not.toContain('tok-1');
  });

  it('un código malo o una casa sin ambientes no crea nada', async () => {
    await expect(service.link(actor, 'ZZZZ-ZZZZ')).rejects.toBeInstanceOf(NotFoundError);
    p3d.model = { levels: [{ id: 'L1', name: 'Piso 1', rooms: [{ id: 'g', label: 'Garaje', room_type: 'garage', polygon: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }] }] }] };
    await expect(service.link(actor, 'K7QM-3XTP')).rejects.toBeInstanceOf(ValidationError);
    expect(await projects.listByOwner('u1')).toEqual([]);
  });

  it('al guardar la escena los muebles viajan a Plano 3D, y solo lo que cambió', async () => {
    await service.link(actor, 'K7QM-3XTP');
    await settle();
    const sala = (await rooms())[1]!;
    await projects.update(sala.id, {
      placements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false }],
      finishes: { floor: 'wood-oak', walls: {}, ceiling: 'paint-white' },
    });
    p3d.sent = [];
    scenes.emit(sala.id);
    await vi.waitFor(() => expect(p3d.sent).toHaveLength(1));
    const ops = p3d.sent[0] as { t: string; k: string; id: string; v: { position?: unknown; floor_material?: string } }[];
    expect(ops.map((o) => [o.t, o.k, o.id])).toEqual([
      ['put', 'furniture', 'int-sala-p1'],
      ['put', 'room', 'sala'],
    ]);
    expect(ops[0]!.v.position).toEqual({ x: 2, y: 1 });
    expect(ops[1]!.v.floor_material).toBe('int_wood-oak');

    // guardar otra vez sin cambios no manda nada
    expect(await service.push(sala.id)).toBe(0);
  });

  it('un muro movido en Plano 3D rehace el cuarto y avisa a la web; los muebles se quedan', async () => {
    await service.link(actor, 'K7QM-3XTP');
    await settle();
    const sala = (await rooms())[1]!;
    await projects.update(sala.id, { placements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: true }] });
    synced = [];

    p3d.model.levels[0]!.rooms![0]!.polygon = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
    p3d.emit({ type: 'applied', seq: 7, author: 'otro', ops: [{ t: 'put', k: 'wall', id: 'w2' }, { t: 'put', k: 'room', id: 'sala' }] });
    await settle();

    const after = (await rooms())[1]!;
    expect(after.roomShell!.widthM).toBe(6);
    expect(after.placements).toHaveLength(1);
    expect(after.placements[0]!.lockedByUser).toBe(true);
    expect(synced).toEqual([{ projectId: sala.id, payload: expect.objectContaining({ source: 'plano3d', architecture: true }) }]);
    expect(links.rows.values().next().value!.lastSeq).toBe(7);
  });

  it('un mueble nuestro movido en Plano 3D vuelve a Interiores; los propios lotes se ignoran', async () => {
    await service.link(actor, 'K7QM-3XTP');
    await settle();
    const sala = (await rooms())[1]!;
    await projects.update(sala.id, { placements: [{ id: 'p1', catalogItemId: 'sofa-test', position: { x: 2, y: 0, z: 1 }, rotationY: 0, lockedByUser: false }] });
    await service.push(sala.id);

    const moved = { id: 'int-sala-p1', catalog_id: 'int_sofa-test', position: { x: 3, y: 2 }, width: 2, depth: 0.9, height: 0.8, rotation: 0 };
    p3d.model.levels[0]!.furniture = [moved];
    p3d.emit({ type: 'applied', seq: 8, author: 'yo', ops: [{ t: 'put', k: 'furniture', id: 'int-sala-p1' }] });
    await settle();
    expect((await rooms())[1]!.placements[0]!.position).toEqual({ x: 2, y: 0, z: 1 });

    p3d.emit({ type: 'applied', seq: 9, author: 'otro', ops: [{ t: 'put', k: 'furniture', id: 'int-sala-p1' }] });
    await settle();
    expect((await rooms())[1]!.placements[0]!.position).toEqual({ x: 3, y: 0, z: 2 });
  });

  it('un ambiente nuevo en Plano 3D aparece como cuarto nuevo de la vivienda', async () => {
    await service.link(actor, 'K7QM-3XTP');
    await settle();
    p3d.model.levels[1]!.rooms!.push({ id: 'bano', label: 'Baño', room_type: 'bathroom', polygon: [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 4, y: 2 }] });
    p3d.emit({ type: 'applied', seq: 3, author: 'otro', ops: [{ t: 'put', k: 'room', id: 'bano' }] });
    await settle();
    expect((await rooms()).map((r) => r.name)).toContain('Baño · Piso 2');
  });

  it('enlazar dos veces la misma casa reutiliza la vivienda; cortar el enlace deja los cuartos', async () => {
    const a = await service.link(actor, 'K7QM-3XTP');
    const b = await service.link(actor, 'K7QM-3XTP');
    expect(b.id).toBe(a.id);
    expect(await rooms()).toHaveLength(2);

    await service.unlink(actor, a.id);
    expect(await service.list(actor)).toEqual([]);
    expect((await rooms()).every((r) => r.plano3d === null)).toBe(true);
    await expect(service.unlink({ userId: 'otra' }, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('si Plano 3D revoca el código el enlace se corta y la web se entera', async () => {
    const summary = await service.link(actor, 'K7QM-3XTP');
    await settle();
    synced = [];
    p3d.revoked = true;
    await expect(service.refresh(actor, summary.id)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(links.rows.get(summary.id)!.revokedAt).not.toBeNull();
    expect(synced).toHaveLength(2);
    expect(synced.every((s) => (s.payload as { revoked?: boolean }).revoked)).toBe(true);
  });

  it('sabe quién está en Plano 3D y avisa a cada cuarto al entrar o salir alguien', async () => {
    const summary = await service.link(actor, 'K7QM-3XTP');
    await settle();
    expect((await service.list(actor))[0]!.peers).toEqual([{ name: 'Ana', client: 'web' }]);
    expect(presence.at(-1)!.peers).toEqual([{ name: 'Ana', client: 'web' }]);

    presence = [];
    p3d.emit({ type: 'peer_joined', peer: { id: 'beto', name: 'Beto', client: 'desktop' } });
    p3d.emit({ type: 'peer_joined', peer: { id: 'otro-int', name: 'Interiores 3D', client: 'interiores' } }); // otra casa enlazada: no cuenta
    await settle();
    expect((await service.list(actor))[0]!.peers.map((p) => p.name)).toEqual(['Ana', 'Beto']);
    expect(new Set(presence.map((p) => p.projectId)).size).toBe(summary.rooms.length);

    p3d.emit({ type: 'peer_left', peer_id: 'ana' });
    await settle();
    expect((await service.list(actor))[0]!.peers).toEqual([{ name: 'Beto', client: 'desktop' }]);
  });
});
