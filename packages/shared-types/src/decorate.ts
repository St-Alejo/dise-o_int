/**
 * Pasada de decoración (lógica pura): con los muebles ya distribuidos, añade lo que hace que un
 * cuarto se vea habitado. Cortinas en las ventanas, un cuadro sobre el sofá o la cama, la tele
 * sobre su mueble, alacenas sobre la hilera de la cocina, el espejo del baño y lámparas, plantas
 * y libros sobre las superficies. Nada de esto ocupa piso, así que nunca estorba el paso.
 *
 * Devuelve solo las piezas nuevas. Con la misma entrada y la misma semilla da siempre lo mismo.
 */
import { bodyOf, firstCollision, type Body } from './collision.js';
import type { FurniturePlacement, Mount, ResizeRanges, RoomShell, RoomType, StyleId, Vector3 } from './domain.js';
import { clampDimensions, defaultResizeRanges, effectiveDimensions, footprint, footprintsOverlap, rotateXZ } from './geometry.js';
import { alongOf, distanceFromWall, overlapsOpening, positionOnWall, wallFrames, type WallFrame } from './walls.js';

/** Lo que la decoración necesita saber de un mueble del catálogo. */
export interface DecorItem {
  id: string;
  category: string;
  subcategory?: string | undefined;
  styleTags: readonly StyleId[];
  roomTypes: readonly RoomType[];
  dimensionsM: Vector3;
  mount: Mount;
  elevationDefaultM?: number | undefined;
  resize?: ResizeRanges | undefined;
}

export interface DecorateInput {
  shell: RoomShell;
  roomType: RoomType;
  styleId: StyleId | null;
  /** Lo que ya está en el cuarto (distribuido o fijado por el usuario). */
  placements: readonly FurniturePlacement[];
  /** Catálogo disponible: de aquí salen las piezas nuevas y las medidas de las ya colocadas. */
  items: readonly DecorItem[];
  /** Con semilla, entre piezas igual de adecuadas se elige otra ("otra distribución"). */
  seed?: number | undefined;
}

interface Entry {
  p: FurniturePlacement;
  item: DecorItem;
  dims: Vector3;
}

/** A menos de esto de la pared, un mueble "está contra" ella. */
const AGAINST_WALL_M = 0.3;
/** Aire entre un mueble y lo que se cuelga encima. */
const ABOVE_GAP_M = 0.22;
const MAX_CURTAINS = 3;
/** Muebles con tapa plana donde se puede apoyar algo. */
const FLAT_TOPS = new Set(['nightstand', 'desk', 'sideboard', 'dresser', 'dining-table', 'tv-stand']);

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function decorate(input: DecorateInput): FurniturePlacement[] {
  const { shell, roomType, styleId } = input;
  const random = mulberry(input.seed ?? 7);
  const varied = input.seed !== undefined;
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const frames = wallFrames(shell);
  const scene: Entry[] = input.placements.flatMap((p) => {
    const item = byId.get(p.catalogItemId);
    return item ? [{ p, item, dims: effectiveDimensions(item.dimensionsM, p) }] : [];
  });
  const bodies: Body[] = scene.map((e) => bodyOf(e.p, e.item));
  const added: FurniturePlacement[] = [];
  const subOf = (e: Entry) => e.item.subcategory ?? '';
  const onFloor = (e: Entry) => e.item.mount === 'floor' && !e.p.supportId && subOf(e) !== 'rug';
  const present = (sub: string) => scene.some((e) => subOf(e) === sub);
  const nextId = () => `deco-${Math.floor(random() * 2 ** 40).toString(16).padStart(10, '0')}`;

  /**
   * La mejor pieza de ese tipo: primero las del estilo. Entre iguales, la mayor (un cuadro grande
   * llena más la pared) o, con `neutral`, la primera por id, que es la más sobria del catálogo.
   * Con semilla, una al azar.
   */
  const pick = (sub: string, mount: Mount, fits: (item: DecorItem) => boolean = () => true, neutral = false): DecorItem | null => {
    const options = input.items.filter((i) => i.subcategory === sub && i.mount === mount && i.roomTypes.includes(roomType) && fits(i));
    if (!options.length) return null;
    const inStyle = (i: DecorItem) => (styleId && i.styleTags.includes(styleId) ? 1 : 0);
    const best = Math.max(...options.map(inStyle));
    const top = options.filter((i) => inStyle(i) === best).sort((a, b) => (neutral ? 0 : b.dimensionsM.x - a.dimensionsM.x) || a.id.localeCompare(b.id));
    return varied ? top[Math.floor(random() * top.length)]! : top[0]!;
  };

  const register = (placement: FurniturePlacement, item: DecorItem): FurniturePlacement => {
    added.push(placement);
    scene.push({ p: placement, item, dims: effectiveDimensions(item.dimensionsM, placement) });
    bodies.push(bodyOf(placement, item));
    return placement;
  };

  /** Cuelga `item` en la pared, centrado en `along` y con la base a `elevation`; null si no cabe. */
  const hang = (item: DecorItem, wall: WallFrame, along: number, elevation: number, opts: { dims?: Vector3; behindFurniture?: boolean } = {}): FurniturePlacement | null => {
    const dims = opts.dims ?? item.dimensionsM;
    if (along - dims.x / 2 < 0.04 || along + dims.x / 2 > wall.length - 0.04) return null;
    if (elevation < 0 || elevation + dims.y > shell.heightM - 0.03) return null;
    // Las cortinas son la excepción: van sobre la ventana y por detrás de los muebles.
    if (!opts.behindFurniture && overlapsOpening(shell, wall, along, dims.x, elevation, dims.y)) return null;
    const position = positionOnWall(wall, along, elevation, dims.z);
    const placement: FurniturePlacement = {
      id: nextId(),
      catalogItemId: item.id,
      position,
      rotationY: wall.rotationY,
      lockedByUser: false,
      wallId: wall.id,
      elevationM: elevation,
      origin: 'layout',
      ...(opts.dims ? { dimensionsM: opts.dims } : {}),
    };
    if (firstCollision(bodyOf(placement, item), bodies)) return null;
    // Un mueble de piso que llega a esa altura lo taparía (o lo atravesaría).
    if (opts.behindFurniture) return register(placement, item);
    const fp = footprint(position, dims, wall.rotationY);
    const buried = scene.some((e) => onFloor(e) && e.dims.y > elevation - 0.02 && footprintsOverlap(fp, footprint(e.p.position, e.dims, e.p.rotationY)));
    return buried ? null : register(placement, item);
  };

  /** Apoya `item` sobre un mueble, desplazado (x, z) en las coordenadas de ese mueble. */
  const rest = (item: DecorItem, support: Entry, localX = 0, localZ = 0): FurniturePlacement | null => {
    if (item.dimensionsM.x > support.dims.x || item.dimensionsM.z > support.dims.z) return null;
    const offset = rotateXZ(localX, localZ, support.p.rotationY);
    const placement: FurniturePlacement = {
      id: nextId(),
      catalogItemId: item.id,
      position: { x: support.p.position.x + offset.x, y: support.p.position.y + support.dims.y, z: support.p.position.z + offset.z },
      rotationY: support.p.rotationY,
      lockedByUser: false,
      supportId: support.p.id,
      origin: 'layout',
    };
    return firstCollision(bodyOf(placement, item), bodies) ? null : register(placement, item);
  };

  /** Pared contra la que está un mueble de piso y dónde queda su centro a lo largo de ella. */
  const wallBehind = (e: Entry): { wall: WallFrame; along: number } | null => {
    const corners = footprint(e.p.position, e.dims, e.p.rotationY).corners;
    let best: { wall: WallFrame; along: number; gap: number } | null = null;
    for (const wall of frames) {
      const gap = Math.min(...corners.map((c) => distanceFromWall(wall, c)));
      const along = alongOf(wall, e.p.position);
      if (gap < -0.05 || gap > AGAINST_WALL_M || along < 0 || along > wall.length) continue;
      if (!best || gap < best.gap) best = { wall, along, gap };
    }
    return best;
  };

  /** Primer sitio libre para colgar `item` a `elevation`: el centro de cada pared, de la más larga a la más corta. */
  const hangAnywhere = (item: DecorItem, elevation: number): FurniturePlacement | null => {
    for (const wall of [...frames].sort((a, b) => b.length - a.length)) {
      for (const t of [0.5, 0.3, 0.7]) {
        const done = hang(item, wall, wall.length * t, elevation);
        if (done) return done;
      }
    }
    return null;
  };

  // 1. Cortinas hasta el piso, de la ventana más grande a la más pequeña y a su medida. Caen por
  // detrás de lo que haya contra esa pared. En la cocina y el baño no: ahí estorban.
  if (!present('curtains') && roomType !== 'kitchen' && roomType !== 'bathroom') {
    const windows = shell.openings.filter((o) => o.type === 'window').sort((a, b) => b.widthM * b.heightM - a.widthM * a.heightM);
    for (const o of windows.slice(0, MAX_CURTAINS)) {
      const wall = frames.find((f) => f.id === o.wallId);
      const item = pick('curtains', 'wall', undefined, true);
      if (!wall || !item) continue;
      const along = wall.startAtBase ? o.offsetM : wall.length - o.offsetM;
      const room = 2 * Math.min(along, wall.length - along) - 0.1;
      const top = Math.min(shell.heightM - 0.06, o.sillHeightM + o.heightM + 0.25);
      const dims = clampDimensions({ x: Math.min(o.widthM + 0.5, room), y: top, z: item.dimensionsM.z }, item.dimensionsM, item.resize ?? defaultResizeRanges(item.dimensionsM));
      if (dims.x <= room) hang(item, wall, along, Math.max(0, top - dims.y), { dims, behindFurniture: true });
    }
  }

  // 2. La tele, sobre su mueble.
  const tvStand = scene.find((e) => subOf(e) === 'tv-stand' && onFloor(e));
  if (tvStand && !present('tv')) {
    const at = wallBehind(tvStand);
    const tv = pick('tv', 'wall', (i) => i.dimensionsM.x <= tvStand.dims.x + 0.3);
    if (at && tv) hang(tv, at.wall, at.along, tvStand.dims.y + 0.18);
  }

  // 3. Alacenas sobre la hilera de la cocina: una junto a otra donde quepan, nunca sobre la
  // estufa (ahí va la campana) ni tapando la ventana.
  if (roomType === 'kitchen' && !present('kitchen-wall')) {
    const cabinet = pick('kitchen-wall', 'wall');
    const row = scene.filter((x) => onFloor(x) && ['kitchen-base', 'sink', 'stove'].includes(subOf(x))).flatMap((e) => {
      const at = wallBehind(e);
      return at ? [{ ...at, half: e.dims.x / 2, stove: subOf(e) === 'stove' }] : [];
    });
    const wall = row[0]?.wall;
    if (cabinet && wall) {
      const onWall = row.filter((r) => r.wall.id === wall.id);
      const half = cabinet.dimensionsM.x / 2;
      const from = Math.min(...onWall.map((r) => r.along - r.half));
      const to = Math.max(...onWall.map((r) => r.along + r.half));
      const overStove = (along: number) => onWall.some((r) => r.stove && Math.abs(along - r.along) < r.half + half - 0.02);
      // Puede asomar un poco más allá de la hilera: junto a una ventana ancha no queda otro sitio.
      const start = Math.max(half + 0.05, from - 0.3);
      const end = Math.min(wall.length - half - 0.05, to + 0.3);
      for (let along = start; along <= end + 1e-6; along += 0.1) {
        if (!overStove(along)) hang(cabinet, wall, along, cabinet.elevationDefaultM ?? 1.45);
      }
    }
  }

  // 4. El espejo del baño, sobre el lavamanos.
  const vanity = scene.find((e) => subOf(e) === 'vanity' && onFloor(e));
  if (vanity && !present('mirror')) {
    const at = wallBehind(vanity);
    const mirror = pick('mirror', 'wall', (i) => i.dimensionsM.y <= 1 && i.dimensionsM.x <= vanity.dims.x + 0.2);
    if (at && mirror) hang(mirror, at.wall, at.along, vanity.dims.y + 0.2);
  }

  // 5. Un cuadro sobre la pieza principal (cama, sofá, aparador) y una repisa sobre el escritorio.
  if (!present('wall-art')) {
    const anchors = [
      ...scene.filter((e) => e.item.category === 'bed'),
      ...scene.filter((e) => e.item.category === 'sofa'),
      ...scene.filter((e) => ['sideboard', 'dresser'].includes(subOf(e))),
    ].filter(onFloor);
    let hung = 0;
    for (const anchor of anchors) {
      if (hung >= 2) break;
      const at = wallBehind(anchor);
      if (!at) continue;
      const art = pick('wall-art', 'wall', (i) => i.dimensionsM.x <= anchor.dims.x * 0.9);
      if (art && hang(art, at.wall, at.along, Math.max(art.elevationDefaultM ?? 1.3, anchor.dims.y + ABOVE_GAP_M))) hung++;
    }
    // Sin pieza principal contra una pared, el cuadro va a la pared más larga que esté libre.
    if (!hung && roomType !== 'kitchen' && roomType !== 'bathroom') {
      const art = pick('wall-art', 'wall');
      if (art) hangAnywhere(art, art.elevationDefaultM ?? 1.3);
    }
  }
  const desk = scene.find((e) => subOf(e) === 'desk' && onFloor(e));
  if (desk && !present('wall-shelf')) {
    const at = wallBehind(desk);
    const shelf = pick('wall-shelf', 'wall', (i) => i.dimensionsM.x <= desk.dims.x);
    if (at && shelf) hang(shelf, at.wall, at.along, desk.dims.y + 0.55);
  }

  // 6. Sobre las superficies: lámpara en la mesita, luz en el escritorio, y plantas, libros y jarrones.
  for (const e of scene.filter((x) => onFloor(x) && FLAT_TOPS.has(subOf(x)))) {
    if (scene.some((other) => other.p.supportId === e.p.id)) continue; // ya tiene algo encima
    const sub = subOf(e);
    const backZ = -e.dims.z / 2;
    if (sub === 'nightstand') {
      const lamp = pick('table-lamp', 'surface');
      if (lamp) rest(lamp, e);
    } else if (sub === 'desk') {
      const lamp = pick('desk-lamp', 'surface') ?? pick('table-lamp', 'surface');
      if (lamp) rest(lamp, e, -e.dims.x / 2 + lamp.dimensionsM.x / 2 + 0.08, backZ + lamp.dimensionsM.z / 2 + 0.05);
      const books = pick('books', 'surface');
      if (books) rest(books, e, e.dims.x / 2 - books.dimensionsM.x / 2 - 0.1, backZ + books.dimensionsM.z / 2 + 0.06);
    } else if (sub === 'dining-table') {
      const vase = pick('vase', 'surface') ?? pick('plant', 'surface');
      if (vase) rest(vase, e);
    } else if (sub === 'tv-stand') {
      const plant = pick('plant', 'surface');
      if (plant) rest(plant, e, e.dims.x / 2 - plant.dimensionsM.x / 2 - 0.08, 0);
    } else {
      const plant = pick('plant', 'surface') ?? pick('vase', 'surface');
      if (plant) rest(plant, e, -e.dims.x / 4, 0);
      const books = pick('books', 'surface');
      if (books) rest(books, e, e.dims.x / 4, 0);
    }
  }

  return added;
}
