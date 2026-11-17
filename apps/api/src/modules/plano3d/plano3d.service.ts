import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  floorMaterialOp,
  fromPlano3dFurniture,
  furnitureOps,
  houseLevels,
  interioresFurnitureOf,
  linkedRooms,
  touchesArchitecture,
  type FurniturePlacement,
  type HouseLevel,
  type HouseRoom,
  type LinkedRoom,
  type Plano3dFurniture,
  type Plano3dModel,
  type Plano3dOp,
} from '@interiores/shared-types';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../common/errors.js';
import {
  CATALOG_REPOSITORY,
  PLANO3D_CLIENT,
  PLANO3D_LINKS,
  PROJECT_REPOSITORY,
  SCENE_EVENTS,
  type ICatalogRepository,
  type IPlano3dClient,
  type IPlano3dLinkRepository,
  type IProjectRepository,
  type ISceneEvents,
  type Plano3dLinkRecord,
  type Plano3dLiveMessage,
  type Plano3dLivePeer,
  type Plano3dLiveRoom,
  type ProjectPatch,
  type ProjectRecord,
} from '../../ports/index.js';
import type { Actor } from '../projects/project-access.js';

export interface Plano3dLinkSummary {
  id: string;
  homeId: string;
  plano3dProjectId: string;
  projectName: string;
  rooms: { projectId: string; name: string; level: string }[];
  live: boolean;
  /** Quiénes están ahora en la casa desde Plano 3D (sin contar a Interiores). */
  peers: Plano3dPresence[];
  createdAt: string;
}

/** Un ambiente de la casa en 3D; `projectId` es su cuarto de Interiores (null: no se amuebla). */
export interface Plano3dHouseRoom extends HouseRoom {
  projectId: string | null;
}

/** La casa entera por pisos para la vista 3D de Interiores. */
export interface Plano3dHouse {
  linkId: string;
  homeId: string;
  projectName: string;
  levels: (Omit<HouseLevel, 'rooms'> & { rooms: Plano3dHouseRoom[] })[];
}

/** Una persona en Plano 3D, como la ve la web. */
export interface Plano3dPresence {
  name: string;
  client: string;
}

/** Aviso a la web de que un cuarto cambió fuera de ella (lo emite la pasarela de progreso). */
export interface SceneSyncNotifier {
  sceneSync(projectId: string, payload: { revision: number; source: 'plano3d'; architecture?: boolean; revoked?: boolean }): void;
  /** Quién está en Plano 3D (cambia al entrar o salir alguien). */
  plano3dPresence?(projectId: string, peers: Plano3dPresence[]): void;
}
export const SCENE_SYNC = Symbol('SceneSyncNotifier');

interface LiveLink {
  link: Plano3dLinkRecord;
  room: Plano3dLiveRoom | null;
  /** Nuestro id de par en la sala (para no reaccionar a nuestros propios lotes). */
  me: string | null;
  /** Último modelo conocido de la casa: base del diff de muebles. */
  model: Plano3dModel | null;
  retry: number;
  timer: NodeJS.Timeout | null;
  pending: Set<string> | 'all' | null;
  closed: boolean;
  /** Los demás pares de la sala (personas en Plano 3D). */
  peers: Map<string, Plano3dPresence>;
}

const RESYNC_DEBOUNCE_MS = 350;
const MAX_RETRY_MS = 30_000;
const OPS_PER_BATCH = 200;

/**
 * Puente con Plano 3D (ADR-0039). Una casa compartida por código se vuelve una vivienda de
 * Interiores con un cuarto por ambiente diseñable. Plano 3D manda en la arquitectura: sus
 * cambios rehacen los cuartos y se avisan a la web (`scene-sync`). Interiores manda en los
 * muebles y acabados: al guardar una escena se mandan a la sala en vivo de Plano 3D.
 */
@Injectable()
export class Plano3dService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Plano3dService.name);
  private readonly live = new Map<string, LiveLink>();
  private offScene: (() => void) | null = null;

  constructor(
    @Inject(PLANO3D_CLIENT) private readonly client: IPlano3dClient,
    @Inject(PLANO3D_LINKS) private readonly links: IPlano3dLinkRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: ICatalogRepository,
    @Inject(SCENE_EVENTS) private readonly scenes: ISceneEvents,
    @Inject(SCENE_SYNC) private readonly notifier: SceneSyncNotifier,
  ) {}

  async onModuleInit(): Promise<void> {
    this.offScene = this.scenes.on((projectId) => {
      this.push(projectId).catch((err: unknown) => this.logger.warn({ err, projectId }, 'No se pudo mandar a Plano 3D'));
    });
    try {
      for (const link of await this.links.listActive()) this.open(link);
    } catch (err) {
      this.logger.warn({ err }, 'No se pudieron reabrir los enlaces con Plano 3D');
    }
  }

  onModuleDestroy(): void {
    this.offScene?.();
    for (const live of this.live.values()) this.shut(live);
    this.live.clear();
  }

  // ------------------------------------------------------------------ casos de uso
  /** Canjea el código y crea la vivienda con un cuarto por ambiente diseñable. */
  async link(actor: Actor, code: string): Promise<Plano3dLinkSummary> {
    const grant = await this.client.claim(code.trim());
    const shared = await this.client.project(grant.token);
    const rooms = shared.model ? linkedRooms(shared.model) : [];
    if (!shared.model || rooms.length === 0) {
      throw new ValidationError('Esa casa todavía no tiene ambientes para amueblar (sala, alcobas, cocina, baños…)');
    }
    const expires = new Date(Date.now() + grant.expiresIn * 1000);
    const existing = (await this.links.listByOwner(actor.userId)).find((l) => l.plano3dProjectId === grant.projectId && !l.revokedAt);
    if (existing) {
      // El mismo proyecto otra vez: se renueva el token y se reutiliza la vivienda.
      await this.links.update(existing.id, { linkToken: grant.token, tokenExpiresAt: expires });
      const renewed: Plano3dLinkRecord = { ...existing, linkToken: grant.token, tokenExpiresAt: expires };
      this.reopen(renewed, shared.model);
      await this.resync(renewed, 'all', shared.model);
      return this.summary(renewed);
    }
    const link = await this.links.create({
      id: randomUUID(),
      ownerId: actor.userId,
      homeId: randomUUID(),
      plano3dProjectId: grant.projectId,
      projectName: (shared.name || grant.projectName).slice(0, 120),
      linkToken: grant.token,
      tokenExpiresAt: expires,
    });
    for (const room of rooms) await this.createRoom(link, room, shared.model);
    this.logger.log({ linkId: link.id, rooms: rooms.length, requestId: actor.requestId }, 'Casa de Plano 3D enlazada');
    this.open(link, shared.model);
    return this.summary(link);
  }

  async list(actor: Actor): Promise<Plano3dLinkSummary[]> {
    const links = (await this.links.listByOwner(actor.userId)).filter((l) => !l.revokedAt);
    return Promise.all(links.map((l) => this.summary(l)));
  }

  /** Corta el enlace: los cuartos se quedan como diseño propio (ya no siguen a Plano 3D). */
  async unlink(actor: Actor, linkId: string): Promise<void> {
    const link = await this.owned(actor, linkId);
    await this.links.update(link.id, { revokedAt: new Date() });
    this.drop(link.id);
    for (const p of await this.roomsOf(link)) await this.projects.update(p.id, { plano3d: null });
  }

  /** Vuelve a leer la casa ahora (botón «Sincronizar» de la web). */
  async refresh(actor: Actor, linkId: string): Promise<Plano3dLinkSummary> {
    const link = await this.owned(actor, linkId);
    await this.resync(link, 'all');
    return this.summary(link);
  }

  /**
   * La casa entera para verla en 3D: todos los ambientes de cada piso (también escaleras,
   * halls y garajes) y, en los amueblables, el id de su cuarto de Interiores.
   */
  async house(actor: Actor, linkId: string): Promise<Plano3dHouse> {
    const link = await this.owned(actor, linkId);
    let model = this.live.get(link.id)?.model ?? null;
    if (!model) {
      try {
        model = (await this.client.project(link.linkToken)).model;
      } catch (err) {
        if (err instanceof UnauthorizedError) await this.revokedRemotely(link);
        throw err;
      }
    }
    if (!model) throw new NotFoundError('La casa de Plano 3D todavía no tiene modelo');
    const byRoom = new Map((await this.roomsOf(link)).map((p) => [p.plano3d!.roomId, p.id]));
    return {
      linkId: link.id,
      homeId: link.homeId,
      projectName: link.projectName,
      levels: houseLevels(model).map((level) => ({
        ...level,
        rooms: level.rooms.map((room) => ({ ...room, projectId: byRoom.get(room.roomId) ?? null })),
      })),
    };
  }

  // ------------------------------------------------------------------ Interiores → Plano 3D
  /** Lleva los muebles y el piso de un cuarto enlazado a la sala de Plano 3D; devuelve cuántas ops. */
  async push(projectId: string): Promise<number> {
    const project = await this.projects.findById(projectId);
    const ref = project?.plano3d;
    if (!project || !ref) return 0;
    const live = this.live.get(ref.linkId);
    if (!live?.room || !live.model) return 0;
    const level = live.model.levels.find((l) => l.id === ref.levelId);
    const room = level?.rooms?.find((r) => r.id === ref.roomId);
    if (!level || !room) return 0;

    const ids = [...new Set(project.placements.map((p) => p.catalogItemId))];
    const sizes = new Map((await this.catalog.findByIds(ids)).map((c) => [c.id, { x: c.widthM, y: c.heightM, z: c.depthM }]));
    const ops: Plano3dOp[] = furnitureOps(
      { roomId: ref.roomId, origin: ref.origin, levelId: ref.levelId },
      project.placements,
      (id) => sizes.get(id),
      interioresFurnitureOf(level, ref.roomId),
    );
    const floor = floorMaterialOp(ref.levelId, room, project.finishes?.floor ?? null);
    if (floor) ops.push(floor);
    if (ops.length === 0) return 0;
    for (let i = 0; i < ops.length; i += OPS_PER_BATCH) live.room.send(ops.slice(i, i + OPS_PER_BATCH));
    applyLocally(live.model, ops);
    return ops.length;
  }

  // ------------------------------------------------------------------ Plano 3D → Interiores
  /**
   * Rehace los cuartos con la casa de Plano 3D: la planta y las aberturas siempre (allá se
   * editan); los muebles solo si en Plano 3D movieron alguno de los nuestros (o en una
   * relectura completa de un cuarto vacío). Los ambientes nuevos se vuelven cuartos nuevos.
   */
  async resync(link: Plano3dLinkRecord, touched: Set<string> | 'all', model?: Plano3dModel): Promise<number> {
    let fresh = model;
    if (!fresh) {
      try {
        fresh = (await this.client.project(link.linkToken)).model ?? undefined;
      } catch (err) {
        if (err instanceof UnauthorizedError) await this.revokedRemotely(link);
        throw err;
      }
    }
    if (!fresh) return 0;
    const live = this.live.get(link.id);
    if (live) live.model = fresh;

    const byRoom = new Map((await this.roomsOf(link)).map((p) => [p.plano3d!.roomId, p]));
    let changed = 0;
    for (const room of linkedRooms(fresh)) {
      const project = byRoom.get(room.roomId);
      if (!project) {
        await this.createRoom(link, room, fresh);
        changed += 1;
        continue;
      }
      const patch: ProjectPatch = {};
      const shell = { ...room.shell, id: project.roomShell?.id ?? room.shell.id };
      if (JSON.stringify(project.roomShell) !== JSON.stringify(shell)) patch.roomShell = shell;
      const ref = { ...project.plano3d!, levelIndex: room.levelIndex, levelName: room.levelName, origin: room.origin };
      if (JSON.stringify(ref) !== JSON.stringify(project.plano3d)) {
        patch.plano3d = ref;
        patch.homePosition = room.origin;
      }
      const ours = touched === 'all' ? project.placements.length === 0 : [...touched].some((id) => id.startsWith(`int-${room.roomId}-`));
      if (ours) {
        const placements = mergePlacements(project.placements, placementsFrom(room, fresh.levels[room.levelIndex]!.furniture ?? []));
        if (JSON.stringify(placements) !== JSON.stringify(project.placements)) patch.placements = placements;
      }
      if (Object.keys(patch).length === 0) continue;
      const updated = await this.projects.update(project.id, patch, { bumpRevision: true });
      this.notifier.sceneSync(project.id, { revision: updated.revision, source: 'plano3d', architecture: !!patch.roomShell });
      changed += 1;
    }
    return changed;
  }

  /** ¿Está abierta la sala en vivo de este enlace? (para las pruebas y el resumen). */
  isLive(linkId: string): boolean {
    return !!this.live.get(linkId)?.room;
  }

  // ------------------------------------------------------------------ sala en vivo
  private open(link: Plano3dLinkRecord, model: Plano3dModel | null = null): void {
    if (this.live.has(link.id)) return;
    const live: LiveLink = { link, room: null, me: null, model, retry: 0, timer: null, pending: null, closed: false, peers: new Map() };
    this.live.set(link.id, live);
    this.connect(live);
  }

  private reopen(link: Plano3dLinkRecord, model: Plano3dModel): void {
    this.drop(link.id);
    this.open(link, model);
  }

  private drop(linkId: string): void {
    const live = this.live.get(linkId);
    if (live) this.shut(live);
    this.live.delete(linkId);
  }

  private connect(live: LiveLink): void {
    if (live.closed) return;
    live.room = this.client.connect(live.link.plano3dProjectId, live.link.linkToken, {
      lastSeq: null,
      name: 'Interiores 3D',
      onMessage: (msg) => this.onMessage(live, msg),
      onClose: (code) => {
        live.room = null;
        if (live.closed) return;
        // 4401/4403/1008: el token ya no vale (Plano 3D revocó el código)
        if (code === 4401 || code === 4403 || code === 1008) {
          void this.revokedRemotely(live.link);
          return;
        }
        const wait = Math.min(MAX_RETRY_MS, 1000 * 2 ** live.retry++);
        setTimeout(() => this.connect(live), wait).unref?.();
      },
    });
  }

  private onMessage(live: LiveLink, msg: Plano3dLiveMessage): void {
    switch (msg.type) {
      case 'welcome':
        live.retry = 0;
        live.me = typeof msg.you === 'string' ? msg.you : msg.you.id;
        live.peers = new Map((msg.peers ?? []).filter((p) => p.id !== live.me && p.client !== 'interiores').map((p) => [p.id, presenceOf(p)]));
        this.announce(live);
        this.schedule(live, 'all'); // al entrar (o volver) se parte de lo último
        break;
      case 'peer_joined':
        if (msg.peer.id === live.me || msg.peer.client === 'interiores') break;
        live.peers.set(msg.peer.id, presenceOf(msg.peer));
        this.announce(live);
        break;
      case 'peer_left':
        if (live.peers.delete(msg.peer_id)) this.announce(live);
        break;
      case 'applied': {
        void this.links.update(live.link.id, { lastSeq: msg.seq }).catch(() => undefined);
        if (msg.author && msg.author === live.me) break;
        const furniture = msg.ops.filter((o) => o.k === 'furniture').map((o) => o.id ?? '');
        if (touchesArchitecture(msg.ops) || furniture.some((id) => id.startsWith('int-'))) this.schedule(live, new Set(furniture));
        break;
      }
      case 'snapshot':
        this.schedule(live, 'all');
        break;
      case 'reject':
        this.logger.warn({ linkId: live.link.id, reason: msg.reason }, 'Plano 3D rechazó un lote de Interiores');
        break;
      case 'closed':
        break;
    }
  }

  /** Avisa a cada cuarto de la casa quién está ahora en Plano 3D. */
  private announce(live: LiveLink): void {
    const send = this.notifier.plano3dPresence?.bind(this.notifier);
    if (!send) return;
    const peers = [...live.peers.values()];
    void this.roomsOf(live.link)
      .then((rooms) => rooms.forEach((r) => send(r.id, peers)))
      .catch(() => undefined);
  }

  /** Junta ráfagas de cambios (arrastrar un muro manda muchos lotes) en una sola relectura. */
  private schedule(live: LiveLink, touched: Set<string> | 'all'): void {
    live.pending = touched === 'all' || live.pending === 'all' ? 'all' : new Set([...(live.pending ?? []), ...touched]);
    if (live.timer) clearTimeout(live.timer);
    live.timer = setTimeout(() => {
      const pending = live.pending ?? 'all';
      live.pending = null;
      live.timer = null;
      this.resync(live.link, pending).catch((err: unknown) => this.logger.warn({ err, linkId: live.link.id }, 'No se pudo releer la casa de Plano 3D'));
    }, RESYNC_DEBOUNCE_MS);
  }

  private shut(live: LiveLink): void {
    live.closed = true;
    if (live.timer) clearTimeout(live.timer);
    live.room?.close();
    live.room = null;
  }

  private async revokedRemotely(link: Plano3dLinkRecord): Promise<void> {
    this.drop(link.id);
    await this.links.update(link.id, { revokedAt: new Date() }).catch(() => undefined);
    for (const p of await this.roomsOf(link)) this.notifier.sceneSync(p.id, { revision: p.revision, source: 'plano3d', revoked: true });
    this.logger.log({ linkId: link.id }, 'Plano 3D revocó el código: el enlace queda cortado');
  }

  // ------------------------------------------------------------------ apoyo
  private async owned(actor: Actor, linkId: string): Promise<Plano3dLinkRecord> {
    const link = await this.links.findById(linkId);
    if (!link || link.ownerId !== actor.userId || link.revokedAt) throw new NotFoundError('Enlace no encontrado');
    return link;
  }

  private async createRoom(link: Plano3dLinkRecord, room: LinkedRoom, model: Plano3dModel): Promise<ProjectRecord> {
    const level = model.levels[room.levelIndex]!;
    return this.projects.create({
      id: randomUUID(),
      ownerId: link.ownerId,
      name: `${room.name} · ${room.levelName}`.slice(0, 80),
      roomType: room.roomType,
      status: 'ready',
      photoKey: null,
      photoHash: null,
      thumbKey: null,
      roomShell: room.shell,
      placements: placementsFrom(room, level.furniture ?? []),
      finishes: null,
      requestedRoom: null,
      selectedStyleId: null,
      requestedStyles: [],
      // guardado: los cuartos de una casa enlazada no caducan como un borrador
      saved: true,
      homeId: link.homeId,
      homeName: link.projectName.slice(0, 80),
      homePosition: room.origin,
      plano3d: { linkId: link.id, levelId: room.levelId, levelIndex: room.levelIndex, levelName: room.levelName, roomId: room.roomId, origin: room.origin },
    });
  }

  private async roomsOf(link: Plano3dLinkRecord): Promise<ProjectRecord[]> {
    return (await this.projects.listByOwner(link.ownerId)).filter((p) => p.plano3d?.linkId === link.id);
  }

  private async summary(link: Plano3dLinkRecord): Promise<Plano3dLinkSummary> {
    const rooms = (await this.roomsOf(link)).sort((a, b) => a.plano3d!.levelIndex - b.plano3d!.levelIndex || a.name.localeCompare(b.name));
    return {
      id: link.id,
      homeId: link.homeId,
      plano3dProjectId: link.plano3dProjectId,
      projectName: link.projectName,
      rooms: rooms.map((p) => ({ projectId: p.id, name: p.name, level: p.plano3d!.levelName })),
      live: this.isLive(link.id),
      peers: [...(this.live.get(link.id)?.peers.values() ?? [])],
      createdAt: link.createdAt.toISOString(),
    };
  }
}

function presenceOf(peer: Plano3dLivePeer): Plano3dPresence {
  return { name: peer.name, client: peer.client };
}

function placementsFrom(room: Pick<LinkedRoom, 'roomId' | 'origin'>, furniture: readonly Plano3dFurniture[]): FurniturePlacement[] {
  return furniture.map((f) => fromPlano3dFurniture(room, f)).filter((p): p is FurniturePlacement => p !== null);
}

/**
 * Los muebles que vuelven de Plano 3D mandan en posición y giro; lo que solo sabe Interiores
 * (candado, materiales, variante…) se conserva del mueble que ya estaba.
 */
function mergePlacements(current: readonly FurniturePlacement[], incoming: readonly FurniturePlacement[]): FurniturePlacement[] {
  const before = new Map(current.map((p) => [p.id, p]));
  return incoming.map((p) => {
    const old = before.get(p.id);
    return old ? { ...old, position: p.position, rotationY: p.rotationY } : p;
  });
}

/** Aplica nuestras propias ops al modelo en memoria (para que el próximo diff parta de ahí). */
export function applyLocally(model: Plano3dModel, ops: readonly Plano3dOp[]): void {
  for (const op of ops) {
    const level = model.levels.find((l) => l.id === op.level);
    if (!level) continue;
    if (op.k === 'furniture') {
      const list = (level.furniture ??= []);
      const i = list.findIndex((f) => f.id === op.id);
      if (op.t === 'del') {
        if (i >= 0) list.splice(i, 1);
      } else if (i >= 0) list[i] = op.v;
      else list.push(op.v);
    } else if (op.t === 'put') {
      const rooms = (level.rooms ??= []);
      const i = rooms.findIndex((r) => r.id === op.id);
      if (i >= 0) rooms[i] = op.v;
    }
  }
}
