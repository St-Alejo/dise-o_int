/**
 * Caja de herramientas del chat de diseño (Facade). Los dos agentes —Claude con tool use y el
 * intérprete por reglas— trabajan SOLO a través de ella sobre una copia virtual de la escena:
 * buscan en el catálogo, consultan la escena y piden cambios con relaciones ("junto a la cama").
 * El SpatialResolver hace la geometría; al final `operations()` devuelve la diferencia entre la
 * escena original y la final, lista para que la web la aplique de una vez.
 *
 * Nada aquí toca la base de datos ni la red: es determinista y se prueba sin servidor.
 */
import { z } from 'zod';
import { CATALOG_CATEGORIES, MATERIAL_KINDS, MOUNTS, type CatalogItem, type FurniturePlacement, type RoomFinishes, type RoomShell, type Vector3 } from './domain.js';
import type { DesignOperation } from './design-operations.js';
import { clampDimensions, defaultResizeRanges, effectiveDimensions, fitPlacementsToRoom, resizeRoomShell, rotateXZ, snapAngle } from './geometry.js';
import { DEFAULT_FINISHES, getMaterial, materialsForSurface, materialsOfKinds, wallMaterialId } from './materials.js';
import { searchCatalog } from './catalog-search.js';
import { alongOf, positionOnWall, wallFrames } from './walls.js';
import { RELATIONS, SpatialResolver, type ResolvedPose } from './spatial-resolver.js';

// --------------------------------------------------------------------------- entradas de las herramientas
const Id = z.string().min(1).max(64);
const Cm = z.number().min(1).max(3000);
/** Id de una pared del cuarto: las que lista `get_scene` (un cuarto de forma libre tiene más de cuatro). */
const WallId = z.string().min(1).max(64);

const Placement = {
  relation: z.enum(RELATIONS),
  nearId: Id.optional(),
  wallId: WallId.optional(),
};

export const TOOL_INPUTS = {
  search_catalog: z.object({
    query: z.string().min(1).max(80),
    category: z.enum(CATALOG_CATEGORIES).optional(),
    mount: z.enum(MOUNTS).optional(),
    maxWidthCm: Cm.optional(),
    limit: z.number().int().min(1).max(12).optional(),
  }),
  get_scene: z.object({}),
  list_materials: z.object({
    kind: z.enum(MATERIAL_KINDS).optional(),
    surface: z.enum(['floor', 'wall', 'ceiling']).optional(),
  }),
  add_item: z.object({
    catalogItemId: Id,
    ...Placement,
    widthCm: Cm.optional(),
    heightCm: Cm.optional(),
    depthCm: Cm.optional(),
  }),
  move_item: z.object({ id: Id, ...Placement }),
  rotate_item: z.object({ id: Id, degrees: z.number().min(-360).max(360) }),
  resize_item: z.object({ id: Id, widthCm: Cm.optional(), heightCm: Cm.optional(), depthCm: Cm.optional() }),
  remove_item: z.object({ id: Id }),
  set_material: z.object({ id: Id, slot: z.string().min(1).max(32), materialId: z.string().min(1).max(64) }),
  set_finishes: z.object({
    floor: z.string().min(1).max(64).optional(),
    walls: z.string().min(1).max(64).optional(),
    wallId: WallId.optional(),
    ceiling: z.string().min(1).max(64).optional(),
  }),
  set_room_size: z.object({
    widthM: z.number().min(0.8).max(30),
    depthM: z.number().min(0.8).max(30),
    heightM: z.number().min(2).max(6).optional(),
  }),
} as const;
export type ToolName = keyof typeof TOOL_INPUTS;
export type ToolInput<K extends ToolName> = z.infer<(typeof TOOL_INPUTS)[K]>;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];

/** Descripciones para el modelo (qué hace cada herramienta y cuándo usarla). */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  search_catalog:
    'Busca muebles y objetos en el catálogo por texto (español o inglés: "lámpara de pie", "sofá gris", "mesa de noche"). Devuelve ids, medidas en cm, montaje (floor/wall/ceiling/surface) y materiales. Úsala antes de add_item: el catalogItemId debe salir de aquí.',
  get_scene:
    'Devuelve el cuarto (medidas, puertas y ventanas por pared, acabados) y cada pieza colocada con su id, nombre, medidas, posición y a qué pared o soporte está unida. Úsala para saber qué hay y los ids de las piezas antes de mover, quitar o colocar algo junto a otra pieza.',
  list_materials:
    'Lista materiales disponibles (id y nombre), filtrando por tipo (fabric, wood, metal...) o por superficie del cuarto (floor, wall, ceiling).',
  add_item:
    'Agrega una pieza del catálogo con una relación espacial respecto a otra pieza (nearId) o al cuarto. Tú NO das coordenadas: el sistema calcula una posición válida sin choques o te explica por qué no cabe. Relaciones: anywhere (cualquier hueco), center (centro del cuarto), next-to / left-of / right-of (al lado, alineada con la referencia), in-front-of (delante y mirándola: mesa de centro frente al sofá, silla frente al escritorio), facing (enfrente, al otro lado del cuarto: TV frente al sofá), behind, on-top-of (apoyada sobre un mueble), above (colgada en la pared encima de la referencia, o lámpara de techo sobre ella), against-wall (contra la pared wallId o la primera libre). Los objetos de superficie (lámparas de mesa, jarrones) se apoyan solos sobre el mueble adecuado más cercano. Medidas opcionales en cm.',
  move_item: 'Mueve una pieza existente usando las mismas relaciones que add_item. Lo que esté apoyado encima se mueve con ella.',
  rotate_item: 'Gira una pieza en el sitio (grados; positivo = antihorario visto desde arriba). Si ya no cabe, se corre lo mínimo.',
  resize_item: 'Cambia ancho, alto o fondo de una pieza (cm). Se limita al rango que admite el mueble; si choca, se corre.',
  remove_item: 'Quita una pieza del cuarto (y lo que tenga apoyado encima).',
  set_material: 'Cambia el material de una parte (slot) de una pieza: tapizado, patas, cubierta... Los slots válidos salen en get_scene y search_catalog.',
  set_finishes:
    'Cambia los acabados del cuarto: floor (material de piso), walls (pintura de las paredes; con wallId solo esa pared) y ceiling. Usa ids de list_materials con la superficie correspondiente.',
  set_room_size:
    'Cambia las medidas del cuarto en metros (ancho = eje X, largo = fondo, alto opcional). Los muebles se re-encajan dentro.',
};

export interface ToolOutcome {
  ok: boolean;
  /** JSON (o texto) para el modelo. */
  content: string;
  /** Frase corta en español de lo que pasó (la usa el agente por reglas para responder). */
  summary: string;
}

export interface ToolboxInit {
  shell: RoomShell;
  placements: readonly FurniturePlacement[];
  finishes: RoomFinishes | null;
  catalog: readonly CatalogItem[];
  newId: () => string;
}

const cm = (m: number) => Math.round(m * 100);
const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
const r2 = (v: number) => Math.round(v * 100) / 100;
const json = (v: unknown) => JSON.stringify(v);
/** JSON con las claves ordenadas: compara piezas sin depender del orden de sus campos. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

export class DesignToolbox {
  private shell: RoomShell;
  private placements: FurniturePlacement[];
  private finishes: RoomFinishes | null;
  private readonly catalogById: Map<string, CatalogItem>;
  private readonly original: { shell: RoomShell; placements: Map<string, FurniturePlacement>; finishes: RoomFinishes | null };

  constructor(private readonly init: ToolboxInit) {
    this.shell = init.shell;
    this.placements = init.placements.map((p) => structuredClone(p));
    this.finishes = init.finishes;
    this.catalogById = new Map(init.catalog.map((c) => [c.id, c]));
    this.original = { shell: init.shell, placements: new Map(init.placements.map((p) => [p.id, p])), finishes: init.finishes };
  }

  // ------------------------------------------------------------------- consulta (para los agentes)
  get scenePlacements(): readonly FurniturePlacement[] {
    return this.placements;
  }
  get roomShell(): RoomShell {
    return this.shell;
  }
  itemOf(p: FurniturePlacement): CatalogItem | undefined {
    return this.catalogById.get(p.catalogItemId);
  }
  get catalog(): readonly CatalogItem[] {
    return this.init.catalog;
  }

  /** Ejecuta una herramienta con su entrada sin validar (tal como la manda el modelo). */
  run(name: string, rawInput: unknown): ToolOutcome {
    if (!(name in TOOL_INPUTS)) return this.error(`Herramienta desconocida: ${name}`);
    const parsed = TOOL_INPUTS[name as ToolName].safeParse(rawInput ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
      return this.error(`Entrada inválida para ${name}: ${issues}`);
    }
    try {
      return this.dispatch(name as ToolName, parsed.data);
    } catch (e) {
      return this.error(e instanceof Error ? e.message : String(e));
    }
  }

  private dispatch(name: ToolName, input: unknown): ToolOutcome {
    switch (name) {
      case 'search_catalog':
        return this.searchCatalog(input as ToolInput<'search_catalog'>);
      case 'get_scene':
        return this.getScene();
      case 'list_materials':
        return this.listMaterials(input as ToolInput<'list_materials'>);
      case 'add_item':
        return this.addItem(input as ToolInput<'add_item'>);
      case 'move_item':
        return this.moveItem(input as ToolInput<'move_item'>);
      case 'rotate_item':
        return this.rotateItem(input as ToolInput<'rotate_item'>);
      case 'resize_item':
        return this.resizeItem(input as ToolInput<'resize_item'>);
      case 'remove_item':
        return this.removeItem(input as ToolInput<'remove_item'>);
      case 'set_material':
        return this.setMaterial(input as ToolInput<'set_material'>);
      case 'set_finishes':
        return this.setFinishes(input as ToolInput<'set_finishes'>);
      case 'set_room_size':
        return this.setRoomSize(input as ToolInput<'set_room_size'>);
    }
  }

  private error(message: string): ToolOutcome {
    return { ok: false, content: json({ ok: false, error: message }), summary: message };
  }

  private success(data: Record<string, unknown>, summary: string): ToolOutcome {
    return { ok: true, content: json({ ok: true, ...data }), summary };
  }

  private describeItem(c: CatalogItem) {
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      ...(c.subcategory ? { subcategory: c.subcategory } : {}),
      mount: c.mount,
      sizeCm: { width: cm(c.dimensionsM.x), height: cm(c.dimensionsM.y), depth: cm(c.dimensionsM.z) },
      ...(c.price !== undefined ? { price: c.price, currency: c.currency } : {}),
      ...(c.materialSlots?.length ? { materialSlots: c.materialSlots.map((s) => ({ slot: s.slot, label: s.label, kinds: s.allowedKinds })) } : {}),
    };
  }

  private dims(p: FurniturePlacement): Vector3 {
    const item = this.itemOf(p);
    return item ? effectiveDimensions(item.dimensionsM, p) : (p.dimensionsM ?? { x: 0.5, y: 0.5, z: 0.5 });
  }

  private nameOf(p: FurniturePlacement): string {
    return this.itemOf(p)?.name ?? p.catalogItemId;
  }

  private find(id: string): { p: FurniturePlacement; item: CatalogItem } {
    const p = this.placements.find((x) => x.id === id);
    if (!p) throw new Error(`No existe la pieza ${id} en el cuarto (usa get_scene para ver los ids)`);
    const item = this.itemOf(p);
    if (!item) throw new Error(`La pieza ${id} usa un mueble que ya no está en el catálogo`);
    return { p, item };
  }

  private resolver(): SpatialResolver {
    return new SpatialResolver({ shell: this.shell, placements: this.placements, catalog: this.catalogById });
  }

  // ------------------------------------------------------------------- herramientas
  private searchCatalog(input: ToolInput<'search_catalog'>): ToolOutcome {
    const ranked = searchCatalog(this.init.catalog, {
      q: input.query,
      ...(input.category ? { category: input.category } : {}),
      ...(input.mount ? { mount: input.mount } : {}),
      ...(input.maxWidthCm !== undefined ? { maxWidthM: input.maxWidthCm / 100 } : {}),
    });
    const items = ranked.slice(0, input.limit ?? 6).map((r) => this.describeItem(r.item));
    return this.success({ results: items }, items.length ? `Encontré ${items.length} resultados para "${input.query}"` : `No encontré nada para "${input.query}"`);
  }

  private getScene(): ToolOutcome {
    const s = this.shell;
    const finishes = this.finishes ?? DEFAULT_FINISHES;
    const walls = wallFrames(s).map((w) => ({
      id: w.id,
      lengthM: r2(w.length),
      paint: wallMaterialId(finishes, w),
      openings: s.openings.filter((o) => o.wallId === w.id).map((o) => ({ type: o.type, widthCm: cm(o.widthM), heightCm: cm(o.heightM), sillCm: cm(o.sillHeightM) })),
    }));
    const placements = this.placements.map((p) => {
      const d = this.dims(p);
      const item = this.itemOf(p);
      return {
        id: p.id,
        name: this.nameOf(p),
        category: item?.category,
        ...(item?.subcategory ? { subcategory: item.subcategory } : {}),
        mount: item?.mount,
        sizeCm: { width: cm(d.x), height: cm(d.y), depth: cm(d.z) },
        positionM: { x: r2(p.position.x), z: r2(p.position.z), y: r2(p.position.y) },
        facingDeg: deg(p.rotationY),
        ...(p.wallId ? { wallId: p.wallId } : {}),
        ...(p.supportId ? { onTopOf: p.supportId } : {}),
        ...(p.materials ? { materials: p.materials } : {}),
      };
    });
    return this.success(
      {
        room: { widthM: r2(s.widthM), depthM: r2(s.depthM), heightM: r2(s.heightM), floor: finishes.floor, ceiling: finishes.ceiling, walls },
        axes: 'x = ancho (0 = lado izquierdo), z = fondo (0 = pared del fondo w-back, la de la foto), facingDeg 0 = mira hacia el frente (+z)',
        placements,
      },
      `El cuarto tiene ${placements.length} piezas`,
    );
  }

  private listMaterials(input: ToolInput<'list_materials'>): ToolOutcome {
    const list = input.surface ? materialsForSurface(input.surface) : input.kind ? materialsOfKinds([input.kind]) : materialsOfKinds(['fabric', 'leather', 'wood', 'metal', 'stone', 'ceramic', 'glass', 'plastic', 'paint']);
    const filtered = input.kind ? list.filter((m) => m.kind === input.kind) : list;
    return this.success({ materials: filtered.map((m) => ({ id: m.id, name: m.name, kind: m.kind })) }, `${filtered.length} materiales`);
  }

  private dimsFromCm(item: CatalogItem, base: Vector3, input: { widthCm?: number | undefined; heightCm?: number | undefined; depthCm?: number | undefined }): Vector3 {
    const wanted = {
      x: input.widthCm !== undefined ? input.widthCm / 100 : base.x,
      y: input.heightCm !== undefined ? input.heightCm / 100 : base.y,
      z: input.depthCm !== undefined ? input.depthCm / 100 : base.z,
    };
    return clampDimensions(wanted, item.dimensionsM, item.resize ?? defaultResizeRanges(item.dimensionsM));
  }

  /** Aplica una pose resuelta a la pieza (y limpia lo que ya no corresponde a su montaje). */
  private withPose(p: FurniturePlacement, pose: ResolvedPose): FurniturePlacement {
    const next: FurniturePlacement = { ...p, position: pose.position, rotationY: pose.rotationY };
    delete next.wallId;
    delete next.supportId;
    delete next.elevationM;
    if (pose.wallId) next.wallId = pose.wallId;
    if (pose.supportId) next.supportId = pose.supportId;
    if (pose.elevationM !== undefined) next.elevationM = pose.elevationM;
    return next;
  }

  /** Una pared pedida por id tiene que existir en este cuarto. */
  private checkWall(wallId: string | undefined): void {
    if (wallId && !this.shell.walls.some((w) => w.id === wallId)) {
      throw new Error(`No existe la pared ${wallId} (las de este cuarto: ${this.shell.walls.map((w) => w.id).join(', ')})`);
    }
  }

  private sameDims(a: Vector3, b: Vector3): boolean {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
  }

  private addItem(input: ToolInput<'add_item'>): ToolOutcome {
    const item = this.catalogById.get(input.catalogItemId);
    if (!item) return this.error(`No existe el mueble ${input.catalogItemId} en el catálogo (búscalo con search_catalog)`);
    if (this.placements.length >= 200) return this.error('El cuarto ya tiene el máximo de 200 piezas');
    this.checkWall(input.wallId);
    const dims = this.dimsFromCm(item, item.dimensionsM, input);
    const id = this.init.newId();
    const result = this.resolver().resolve(id, item, { relation: input.relation, nearId: input.nearId, wallId: input.wallId, dimensionsM: dims });
    if (!result.ok) return this.error(result.reason);
    const placement = this.withPose(
      {
        id,
        catalogItemId: item.id,
        position: result.pose.position,
        rotationY: result.pose.rotationY,
        lockedByUser: true,
        origin: 'chat',
        ...(this.sameDims(dims, item.dimensionsM) ? {} : { dimensionsM: dims }),
      },
      result.pose,
    );
    this.placements.push(placement);
    return this.success(
      { id, name: item.name, positionM: { x: r2(placement.position.x), z: r2(placement.position.z) }, ...(placement.supportId ? { onTopOf: placement.supportId } : {}), ...(placement.wallId ? { wallId: placement.wallId } : {}), ...(result.note ? { note: result.note } : {}) },
      `Agregué ${item.name}${result.note ? ` (${result.note})` : ''}`,
    );
  }

  private replace(next: FurniturePlacement): void {
    this.placements = this.placements.map((p) => (p.id === next.id ? next : p));
  }

  /** Lo apoyado encima acompaña a su soporte (se traslada y gira con él). */
  private carryDependents(before: FurniturePlacement, after: FurniturePlacement): void {
    const dRot = after.rotationY - before.rotationY;
    const topBefore = before.position.y + this.dims(before).y;
    const topAfter = after.position.y + this.dims(after).y;
    for (const dep of this.placements.filter((p) => p.supportId === before.id)) {
      const local = rotateXZ(dep.position.x - before.position.x, dep.position.z - before.position.z, dRot);
      const moved: FurniturePlacement = {
        ...dep,
        position: { x: after.position.x + local.x, y: dep.position.y - topBefore + topAfter, z: after.position.z + local.z },
        rotationY: dep.rotationY + dRot,
      };
      this.replace(moved);
      this.carryDependents(dep, moved);
    }
  }

  private moveItem(input: ToolInput<'move_item'>): ToolOutcome {
    const { p, item } = this.find(input.id);
    if (input.nearId === p.id) return this.error('Una pieza no se puede mover junto a sí misma');
    this.checkWall(input.wallId);
    const result = this.resolver().resolve(p.id, item, { relation: input.relation, nearId: input.nearId, wallId: input.wallId, dimensionsM: this.dims(p) });
    if (!result.ok) return this.error(result.reason);
    const next = this.withPose(p, result.pose);
    this.replace(next);
    this.carryDependents(p, next);
    return this.success({ id: p.id, positionM: { x: r2(next.position.x), z: r2(next.position.z) }, ...(result.note ? { note: result.note } : {}) }, `Moví ${item.name}`);
  }

  private rotateItem(input: ToolInput<'rotate_item'>): ToolOutcome {
    const { p, item } = this.find(input.id);
    if (item.mount === 'wall') return this.error(`${item.name} está colgado en la pared: muévelo a otra pared en vez de girarlo`);
    const rotationY = snapAngle(p.rotationY + (input.degrees * Math.PI) / 180);
    const pose = this.resolver().settle(p.id, item, this.dims(p), { position: p.position, rotationY, ...(p.supportId ? { supportId: p.supportId } : {}) });
    if (!pose) return this.error(`Girado, ${item.name} no cabe en el cuarto`);
    const next = this.withPose(p, pose);
    this.replace(next);
    this.carryDependents(p, next);
    return this.success({ id: p.id, facingDeg: deg(next.rotationY) }, `Giré ${item.name}`);
  }

  private resizeItem(input: ToolInput<'resize_item'>): ToolOutcome {
    const { p, item } = this.find(input.id);
    if (input.widthCm === undefined && input.heightCm === undefined && input.depthCm === undefined) return this.error('Indica al menos una medida (widthCm, heightCm o depthCm)');
    const before = this.dims(p);
    const dims = this.dimsFromCm(item, before, input);
    let pose: ResolvedPose = { position: p.position, rotationY: p.rotationY, ...(p.supportId ? { supportId: p.supportId } : {}) };
    if (p.wallId) {
      const wall = wallFrames(this.shell).find((w) => w.id === p.wallId);
      if (wall) {
        const along = alongOf(wall, p.position);
        pose = { ...pose, position: positionOnWall(wall, along, p.position.y, dims.z), wallId: p.wallId, elevationM: p.position.y };
      }
    }
    const settled = this.resolver().settle(p.id, item, dims, pose);
    if (!settled) return this.error(`Con ${cm(dims.x)} × ${cm(dims.z)} cm, ${item.name} no cabe en el cuarto`);
    const next = this.withPose({ ...p, ...(this.sameDims(dims, item.dimensionsM) ? {} : { dimensionsM: dims }) }, settled);
    if (this.sameDims(dims, item.dimensionsM)) delete next.dimensionsM;
    this.replace(next);
    this.carryDependents(p, next);
    const clamped = (input.widthCm !== undefined && cm(dims.x) !== Math.round(input.widthCm)) || (input.depthCm !== undefined && cm(dims.z) !== Math.round(input.depthCm)) || (input.heightCm !== undefined && cm(dims.y) !== Math.round(input.heightCm));
    return this.success(
      { id: p.id, sizeCm: { width: cm(dims.x), height: cm(dims.y), depth: cm(dims.z) }, ...(clamped ? { note: 'Se ajustó al rango de medidas que admite este mueble' } : {}) },
      `Cambié el tamaño de ${item.name} a ${cm(dims.x)} × ${cm(dims.y)} × ${cm(dims.z)} cm`,
    );
  }

  private removeItem(input: ToolInput<'remove_item'>): ToolOutcome {
    const { p } = this.find(input.id);
    const doomed = new Set([p.id]);
    // También lo que está encima (y lo que está encima de eso).
    for (let grew = true; grew; ) {
      grew = false;
      for (const o of this.placements) {
        if (o.supportId && doomed.has(o.supportId) && !doomed.has(o.id)) {
          doomed.add(o.id);
          grew = true;
        }
      }
    }
    this.placements = this.placements.filter((o) => !doomed.has(o.id));
    return this.success({ removed: [...doomed] }, `Quité ${this.nameOfItem(p)}${doomed.size > 1 ? ` y lo que tenía encima` : ''}`);
  }

  private nameOfItem(p: FurniturePlacement): string {
    return this.itemOf(p)?.name ?? p.catalogItemId;
  }

  private setMaterial(input: ToolInput<'set_material'>): ToolOutcome {
    const { p, item } = this.find(input.id);
    const slot = item.materialSlots?.find((s) => s.slot === input.slot);
    if (!slot) {
      const slots = item.materialSlots?.map((s) => s.slot).join(', ');
      return this.error(slots ? `${item.name} no tiene la parte "${input.slot}". Partes: ${slots}` : `${item.name} no se puede re-materializar`);
    }
    const mat = getMaterial(input.materialId);
    if (!mat) return this.error(`Material desconocido: ${input.materialId} (usa list_materials)`);
    if (!slot.allowedKinds.includes(mat.kind)) return this.error(`"${mat.name}" no sirve para ${slot.label}: admite ${slot.allowedKinds.join(', ')}`);
    this.replace({ ...p, materials: { ...p.materials, [slot.slot]: mat.id } });
    return this.success({ id: p.id, slot: slot.slot, materialId: mat.id }, `Cambié ${slot.label.toLowerCase()} de ${item.name} a ${mat.name.toLowerCase()}`);
  }

  private setFinishes(input: ToolInput<'set_finishes'>): ToolOutcome {
    if (!input.floor && !input.walls && !input.ceiling) return this.error('Indica floor, walls o ceiling');
    const check = (id: string, surface: 'floor' | 'wall' | 'ceiling') => {
      const mat = getMaterial(id);
      if (!mat) throw new Error(`Material desconocido: ${id} (usa list_materials con surface=${surface})`);
      if (!mat.surfaces?.includes(surface)) throw new Error(`"${mat.name}" no sirve para ${surface === 'floor' ? 'el piso' : surface === 'wall' ? 'las paredes' : 'el techo'}`);
      return mat;
    };
    this.checkWall(input.wallId);
    const cur = this.finishes ?? DEFAULT_FINISHES;
    const next: RoomFinishes = { floor: cur.floor, walls: { ...cur.walls }, ceiling: cur.ceiling };
    const said: string[] = [];
    if (input.floor) {
      said.push(`piso de ${check(input.floor, 'floor').name.toLowerCase()}`);
      next.floor = input.floor;
    }
    if (input.ceiling) {
      said.push(`techo ${check(input.ceiling, 'ceiling').name.toLowerCase()}`);
      next.ceiling = input.ceiling;
    }
    if (input.walls) {
      const mat = check(input.walls, 'wall');
      if (input.wallId) next.walls[input.wallId] = input.walls;
      else next.walls = { all: input.walls };
      said.push(`${input.wallId ? 'una pared' : 'paredes'} en ${mat.name.toLowerCase()}`);
    }
    this.finishes = next;
    return this.success({ finishes: next }, `Listo: ${said.join(', ')}`);
  }

  private setRoomSize(input: ToolInput<'set_room_size'>): ToolOutcome {
    const shell = resizeRoomShell(this.shell, { widthM: input.widthM, depthM: input.depthM, heightM: input.heightM ?? this.shell.heightM });
    const fit = fitPlacementsToRoom(this.placements, (p) => this.dims(p), shell);
    this.shell = shell;
    this.placements = fit.placements;
    return this.success(
      { room: { widthM: shell.widthM, depthM: shell.depthM, heightM: shell.heightM }, moved: fit.moved, tooBig: fit.tooBig },
      `El cuarto ahora mide ${r2(shell.widthM)} × ${r2(shell.depthM)} m${fit.tooBig.length ? ` (${fit.tooBig.length} piezas no caben)` : ''}`,
    );
  }

  // ------------------------------------------------------------------- resultado
  /**
   * Diferencia entre la escena original y la actual: medidas del cuarto primero, luego acabados,
   * quitar, agregar y actualizar (estado final completo de cada pieza que cambió).
   */
  operations(): DesignOperation[] {
    const ops: DesignOperation[] = [];
    const o = this.original;
    if (o.shell.widthM !== this.shell.widthM || o.shell.depthM !== this.shell.depthM || o.shell.heightM !== this.shell.heightM) {
      ops.push({ op: 'room', widthM: this.shell.widthM, depthM: this.shell.depthM, heightM: this.shell.heightM });
    }
    if (this.finishes && stable(this.finishes) !== stable(o.finishes)) ops.push({ op: 'finishes', finishes: this.finishes });
    const now = new Map(this.placements.map((p) => [p.id, p]));
    for (const id of o.placements.keys()) if (!now.has(id)) ops.push({ op: 'remove', id });
    for (const p of this.placements) {
      const before = o.placements.get(p.id);
      if (!before) ops.push({ op: 'add', placement: p });
      else if (stable(before) !== stable(p)) ops.push({ op: 'update', placement: p });
    }
    return ops;
  }
}
