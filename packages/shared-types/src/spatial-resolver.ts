/**
 * Resolvedor espacial (determinista): convierte una intención relativa ("junto a la cama",
 * "frente al sofá", "sobre la mesa de noche", "encima del sofá en la pared") en una pose válida
 * dentro del cuarto y sin choques. El chat de IA NUNCA calcula coordenadas: elige la relación y
 * esta función hace la geometría, o explica por qué no cabe.
 */
import { bodiesCollide, bodyOf } from './collision.js';
import type { CatalogItem, FurniturePlacement, RoomShell, Vector3 } from './domain.js';
import { clampToRoom, effectiveDimensions, footprint, isInsideRoom, mountY, rotateXZ, snapAngle } from './geometry.js';
import { overlapsOpening, positionOnWall, wallFrames, type WallFrame } from './walls.js';

export const RELATIONS = [
  'anywhere',
  'center',
  'next-to',
  'left-of',
  'right-of',
  'in-front-of',
  'facing',
  'behind',
  'on-top-of',
  'above',
  'against-wall',
] as const;
export type Relation = (typeof RELATIONS)[number];

export interface SceneModel {
  shell: RoomShell;
  placements: readonly FurniturePlacement[];
  catalog: ReadonlyMap<string, CatalogItem>;
}

export interface PlacementIntent {
  relation: Relation;
  /** Pieza de referencia (obligatoria salvo en anywhere / center / against-wall). */
  nearId?: string | undefined;
  wallId?: string | undefined;
  /** Separación respecto a la referencia (por defecto según la relación). */
  gapM?: number | undefined;
  /** Medidas propias de la pieza (si no, las del catálogo). */
  dimensionsM?: Vector3 | undefined;
}

export interface ResolvedPose {
  position: Vector3;
  rotationY: number;
  wallId?: string;
  supportId?: string;
  elevationM?: number;
}

/** `note`: se resolvió, pero no exactamente como se pidió (y se explica por qué). */
export type ResolveResult = { ok: true; pose: ResolvedPose; note?: string } | { ok: false; reason: string };

/** Soportes apropiados para objetos de superficie, por subcategoría del soporte. */
const SUPPORT_SUBCATEGORIES = new Set([
  'nightstand',
  'side-table',
  'desk',
  'dresser',
  'sideboard',
  'tv-stand',
  'coffee-table',
  'dining-table',
  'kitchen-base',
  'kitchen-island',
  'shelf',
]);

const fail = (reason: string): ResolveResult => ({ ok: false, reason });

export class SpatialResolver {
  constructor(private readonly scene: SceneModel) {}

  private dimsOf(p: FurniturePlacement): Vector3 {
    const item = this.scene.catalog.get(p.catalogItemId);
    return item ? effectiveDimensions(item.dimensionsM, p) : (p.dimensionsM ?? { x: 0.5, y: 0.5, z: 0.5 });
  }

  nameOf(p: FurniturePlacement): string {
    return this.scene.catalog.get(p.catalogItemId)?.name ?? p.catalogItemId;
  }

  /** ¿Cabe esta pose? Dentro del cuarto, bajo el techo y sin chocar con su capa. */
  fits(selfId: string, item: CatalogItem, dims: Vector3, pose: ResolvedPose): boolean {
    const { shell } = this.scene;
    // isInsideRoom además de clamp: una pieza más grande que el cuarto "se centra" al acotarla.
    if (!isInsideRoom(footprint(pose.position, dims, pose.rotationY), shell)) return false;
    if (pose.position.y < -1e-6 || pose.position.y + dims.y > shell.heightM + 1e-3) return false;
    const me = bodyOf(
      { id: selfId, position: pose.position, rotationY: pose.rotationY, dimensionsM: dims, ...(pose.supportId ? { supportId: pose.supportId } : {}) },
      item,
    );
    return !this.scene.placements.some((o) => {
      if (o.id === selfId) return false;
      const oi = this.scene.catalog.get(o.catalogItemId);
      return !!oi && bodiesCollide(me, bodyOf(o, oi));
    });
  }

  /** Prueba cada candidato y, si no cabe, pequeños corrimientos a su alrededor (hasta 60 cm). */
  private firstFit(selfId: string, item: CatalogItem, dims: Vector3, candidates: ResolvedPose[], jitter = true): ResolvedPose | null {
    const offsets: [number, number][] = [[0, 0]];
    if (jitter) {
      for (const r of [0.15, 0.3, 0.45, 0.6]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          offsets.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
      }
    }
    for (const c of candidates) {
      for (const [dx, dz] of offsets) {
        const pose = { ...c, position: { x: c.position.x + dx, y: c.position.y, z: c.position.z + dz } };
        if (this.fits(selfId, item, dims, pose)) return pose;
      }
    }
    return null;
  }

  /**
   * Acomoda una pieza que cambió (de tamaño o de giro) donde está: si ya no cabe, la corre lo
   * mínimo; si ni así, busca otro hueco. null = no cabe en ningún sitio.
   */
  settle(selfId: string, item: CatalogItem, dims: Vector3, pose: ResolvedPose): ResolvedPose | null {
    if (pose.supportId || item.mount === 'wall') return this.fits(selfId, item, dims, pose) ? pose : null;
    const clamped = { ...pose, position: clampToRoom(pose.position, dims, pose.rotationY, this.scene.shell) };
    return this.firstFit(selfId, item, dims, [clamped]) ?? this.anywhere(selfId, item, dims);
  }

  /** Hueco libre en el piso o el techo desde el centro, derecho o girado 90°. */
  private anywhere(selfId: string, item: CatalogItem, dims: Vector3): ResolvedPose | null {
    const { shell } = this.scene;
    const y = mountY(item.mount === 'ceiling' ? 'ceiling' : 'floor', dims, shell);
    for (const rotationY of [0, Math.PI / 2]) {
      for (let r = 0; r <= Math.max(shell.widthM, shell.depthM); r += 0.2) {
        const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.25);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const pos = clampToRoom({ x: shell.widthM / 2 + Math.cos(a) * r, y, z: shell.depthM / 2 + Math.sin(a) * r }, dims, rotationY, shell);
          const pose = { position: pos, rotationY };
          if (this.fits(selfId, item, dims, pose)) return pose;
        }
      }
    }
    return null;
  }

  /** Contra una pared (la pedida o la primera con espacio), mirando al cuarto. */
  private againstWall(selfId: string, item: CatalogItem, dims: Vector3, wallId?: string): ResolvedPose | null {
    const { shell } = this.scene;
    const frames = wallFrames(shell).filter((w) => shell.walls.some((sw) => sw.id === w.id));
    const ordered = wallId ? [...frames.filter((w) => w.id === wallId), ...frames.filter((w) => w.id !== wallId)] : frames;
    for (const wall of ordered) {
      for (const t of this.alongWall(wall, dims.x)) {
        const pose = this.onWall(item, dims, wall, t);
        if (pose && this.fits(selfId, item, dims, pose)) return pose;
      }
    }
    return null;
  }

  /** Posiciones a lo largo de una pared, desde el centro hacia los extremos (cada 25 cm). */
  private *alongWall(wall: WallFrame, width: number): Generator<number> {
    const half = width / 2;
    if (wall.length < width) return;
    const center = wall.length / 2;
    yield center;
    for (let k = 0.25; k <= center - half + 1e-9; k += 0.25) {
      yield Math.min(wall.length - half, center + k);
      yield Math.max(half, center - k);
    }
  }

  /** Pose de una pieza contra `wall` en `along`: colgada (a su altura) o apoyada en el piso. */
  private onWall(item: CatalogItem, dims: Vector3, wall: WallFrame, along: number, elevation?: number): ResolvedPose | null {
    const { shell } = this.scene;
    if (item.mount === 'wall') {
      const y = mountY('wall', dims, shell, { elevationM: elevation, elevationDefaultM: item.elevationDefaultM });
      if (overlapsOpening(shell, wall, along, dims.x, y, dims.y)) return null;
      return { position: positionOnWall(wall, along, y, dims.z), rotationY: wall.rotationY, wallId: wall.id, elevationM: y };
    }
    const y = mountY(item.mount === 'ceiling' ? 'ceiling' : 'floor', dims, shell);
    // Muebles de piso: no tapan una puerta ni una ventana a su altura (un sofá sí cabe bajo la ventana).
    if (overlapsOpening(shell, wall, along, dims.x, y, dims.y)) return null;
    return { position: positionOnWall(wall, along, y, dims.z), rotationY: wall.rotationY };
  }

  /** Pared más cercana al respaldo de la referencia (para colgar algo "encima" de ella). */
  private wallBehind(ref: FurniturePlacement, refDims: Vector3): WallFrame | null {
    const back = rotateXZ(0, -refDims.z / 2, ref.rotationY);
    const bx = ref.position.x + back.x;
    const bz = ref.position.z + back.z;
    let best: { w: WallFrame; d: number } | null = null;
    for (const w of wallFrames(this.scene.shell)) {
      const d = w.along === 'x' ? Math.abs(bz - w.fixed) : Math.abs(bx - w.fixed);
      if (!best || d < best.d) best = { w, d };
    }
    return best?.w ?? null;
  }

  /** El mejor soporte cerca de la referencia (lámpara "junto a la cama" → sobre la mesa de noche). */
  private supportNear(ref: FurniturePlacement, dims: Vector3, selfId: string): FurniturePlacement | null {
    const candidates = this.scene.placements
      .filter((p) => p.id !== selfId && p.id !== ref.id)
      .filter((p) => {
        const it = this.scene.catalog.get(p.catalogItemId);
        if (!it || it.mount !== 'floor' || !SUPPORT_SUBCATEGORIES.has(it.subcategory ?? '')) return false;
        const d = this.dimsOf(p);
        return d.x >= dims.x * 0.9 && d.z >= dims.z * 0.9 && d.y < 1.3;
      })
      .filter((p) => !this.scene.placements.some((o) => o.supportId === p.id && o.id !== selfId))
      .map((p) => ({ p, dist: Math.hypot(p.position.x - ref.position.x, p.position.z - ref.position.z) }))
      .filter((c) => c.dist < 2.5)
      .sort((a, b) => a.dist - b.dist);
    return candidates[0]?.p ?? null;
  }

  private onTopOf(selfId: string, item: CatalogItem, dims: Vector3, support: FurniturePlacement): ResolveResult {
    const sd = this.dimsOf(support);
    if (sd.x < dims.x * 0.9 || sd.z < dims.z * 0.9) return fail(`${this.nameOf(support)} es muy pequeño para apoyar eso encima`);
    if (sd.y > 1.3) return fail(`${this.nameOf(support)} es demasiado alto para apoyar algo encima`);
    const pose: ResolvedPose = {
      position: { x: support.position.x, y: support.position.y + sd.y, z: support.position.z },
      rotationY: support.rotationY,
      supportId: support.id,
    };
    if (!this.fits(selfId, item, dims, pose)) return fail(`Ya hay algo encima de ${this.nameOf(support)}`);
    return { ok: true, pose };
  }

  /**
   * Resuelve la intención. `selfId` es el id de la pieza (nueva o existente, que se ignora a sí
   * misma al validar choques).
   */
  resolve(selfId: string, item: CatalogItem, intent: PlacementIntent): ResolveResult {
    const dims = intent.dimensionsM ?? item.dimensionsM;
    const { shell } = this.scene;
    const ref = intent.nearId ? this.scene.placements.find((p) => p.id === intent.nearId) : undefined;
    if (intent.nearId && !ref) return fail(`No existe la pieza ${intent.nearId} en el cuarto`);
    let relation = intent.relation;

    // Ajustes por montaje: lo de pared va a una pared; lo de superficie, sobre un mueble.
    if (item.mount === 'wall' && !['above', 'against-wall'].includes(relation)) relation = ref ? 'above' : 'against-wall';
    if (item.mount === 'surface' && ref && relation !== 'on-top-of') {
      const refItem = this.scene.catalog.get(ref.catalogItemId);
      const refIsSupport = refItem && SUPPORT_SUBCATEGORIES.has(refItem.subcategory ?? '');
      const support = refIsSupport ? ref : this.supportNear(ref, dims, selfId);
      if (support) return this.onTopOf(selfId, item, dims, support);
    }

    switch (relation) {
      case 'anywhere': {
        const pose = item.mount === 'wall' ? this.againstWall(selfId, item, dims, intent.wallId) : this.anywhere(selfId, item, dims);
        return pose ? { ok: true, pose } : fail('No queda espacio libre en el cuarto para eso');
      }
      case 'center': {
        const y = mountY(item.mount === 'ceiling' ? 'ceiling' : 'floor', dims, shell);
        const pose = this.firstFit(selfId, item, dims, [{ position: { x: shell.widthM / 2, y, z: shell.depthM / 2 }, rotationY: 0 }]);
        return pose ? { ok: true, pose } : fail('El centro del cuarto está ocupado');
      }
      case 'against-wall': {
        const pose = this.againstWall(selfId, item, dims, intent.wallId);
        return pose ? { ok: true, pose } : fail(intent.wallId ? 'No hay espacio libre en esa pared' : 'No hay espacio libre contra las paredes');
      }
    }

    if (!ref) return fail('Falta indicar junto a qué pieza colocarlo');
    const refDims = this.dimsOf(ref);
    const refName = this.nameOf(ref);

    if (relation === 'on-top-of') return this.onTopOf(selfId, item, dims, ref);

    if (relation === 'above') {
      if (item.mount === 'ceiling') {
        const pose = this.firstFit(selfId, item, dims, [{ position: { x: ref.position.x, y: mountY('ceiling', dims, shell), z: ref.position.z }, rotationY: 0 }], false);
        return pose ? { ok: true, pose } : fail(`Ya hay una lámpara de techo sobre ${refName}`);
      }
      const wall = this.wallBehind(ref, refDims);
      if (!wall || item.mount !== 'wall') return fail('Solo se puede poner encima en la pared algo que se cuelga');
      const along = wall.along === 'x' ? ref.position.x : ref.position.z;
      const top = ref.position.y + refDims.y;
      const elevation = Math.max(top + 0.2, item.elevationDefaultM ?? 0);
      const tries: ResolvedPose[] = [];
      for (const d of [0, 0.3, -0.3, 0.6, -0.6]) {
        const half = dims.x / 2;
        const t = Math.min(wall.length - half, Math.max(half, along + d));
        const pose = this.onWall(item, dims, wall, t, elevation);
        if (pose) tries.push(pose);
      }
      const pose = this.firstFit(selfId, item, dims, tries, false);
      if (pose) return { ok: true, pose };
      // Detrás hay una ventana, una puerta u otro cuadro: a otro sitio de esa pared o a otra.
      const elsewhere = this.againstWall(selfId, item, dims, wall.id);
      return elsewhere
        ? { ok: true, pose: elsewhere, note: `La pared detrás de ${refName} estaba ocupada (ventana, puerta u otro objeto); lo colgué en el lugar libre más cercano.` }
        : fail(`No hay espacio en las paredes para colgarlo`);
    }

    const gap = intent.gapM ?? (relation === 'in-front-of' ? 0.45 : 0.08);
    const y = mountY(item.mount === 'ceiling' ? 'ceiling' : 'floor', dims, shell);
    const at = (lx: number, lz: number, rot: number): ResolvedPose => {
      const w = rotateXZ(lx, lz, ref.rotationY);
      return { position: { x: ref.position.x + w.x, y, z: ref.position.z + w.z }, rotationY: snapAngle(rot) };
    };
    // Los de al lado alinean su respaldo con el de la referencia (mesa de noche junto a la cama).
    const sideZ = -refDims.z / 2 + dims.z / 2;
    const sideX = refDims.x / 2 + gap + dims.x / 2;
    const candidates: ResolvedPose[] = [];
    switch (relation) {
      case 'next-to':
        candidates.push(at(sideX, sideZ, ref.rotationY), at(-sideX, sideZ, ref.rotationY));
        break;
      case 'right-of':
        candidates.push(at(sideX, sideZ, ref.rotationY));
        break;
      case 'left-of':
        candidates.push(at(-sideX, sideZ, ref.rotationY));
        break;
      case 'in-front-of':
        // Mirando a la referencia (silla frente al escritorio, mesa de centro frente al sofá).
        candidates.push(at(0, refDims.z / 2 + gap + dims.z / 2, ref.rotationY + Math.PI));
        break;
      case 'behind':
        candidates.push(at(0, -(refDims.z / 2 + gap + dims.z / 2), ref.rotationY));
        break;
      case 'facing': {
        // Enfrente, al otro lado del cuarto (TV frente al sofá): tan lejos como permita el cuarto.
        for (let dist = 4; dist >= refDims.z / 2 + dims.z / 2 + 0.6; dist -= 0.25) {
          const pose = at(0, dist, ref.rotationY + Math.PI);
          const clamped = clampToRoom(pose.position, dims, pose.rotationY, shell);
          if (Math.abs(clamped.x - pose.position.x) < 1e-3 && Math.abs(clamped.z - pose.position.z) < 1e-3) {
            candidates.push(pose);
            break;
          }
        }
        break;
      }
    }
    const pose = this.firstFit(selfId, item, dims, candidates);
    if (pose) return { ok: true, pose };
    const words: Record<string, string> = {
      'next-to': 'junto a',
      'left-of': 'a la izquierda de',
      'right-of': 'a la derecha de',
      'in-front-of': 'frente a',
      facing: 'enfrente de',
      behind: 'detrás de',
    };
    return fail(`No cabe ${words[relation] ?? 'cerca de'} ${refName}: no hay espacio libre (${Math.round(dims.x * 100)} × ${Math.round(dims.z * 100)} cm)`);
  }
}
