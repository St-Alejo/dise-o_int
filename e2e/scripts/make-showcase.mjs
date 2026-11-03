// Diseños de vitrina (plan v11): seis cuartos compuestos a mano, uno por ambiente y estilo, que se
// suman a la galería de plantillas. Los muebles principales van con medidas de diseñador (pasos,
// holguras, ejes); lo colgado se ubica con los marcos de pared del dominio y lo que va encima de
// un mueble lo resuelve DesignToolbox. Al final no puede haber choques ni avisos de la revisión.
//
//   node e2e/scripts/make-showcase.mjs [baseUrl] [carpeta-de-salida] [--plano carpeta]
//
// Necesita shared-types compilado y el stack levantado (lee el catálogo de la API).
import { mkdir, writeFile } from 'node:fs/promises';
import {
  DEFAULT_FINISHES,
  DesignToolbox,
  FurnishedSceneSchema,
  bodiesCollide,
  bodyOf,
  checkDesign,
  effectiveDimensions,
  mountY,
  positionOnWall,
  wallFrames,
} from '@interiores/shared-types';

const args = process.argv.slice(2);
const planIdx = args.indexOf('--plano');
const PLAN_DIR = planIdx >= 0 ? args.splice(planIdx, 2)[1] : null;
const BASE = args[0] ?? process.env.BASE_URL ?? 'http://localhost:8088';
const OUT = args[1] ?? 'apps/web/public/escenas';
const DEG = Math.PI / 180;

const catalog = await (await fetch(`${BASE}/api/catalog`)).json();
const byId = new Map(catalog.map((c) => [c.id, c]));

/** Cuarto rectangular con sus paredes (fondo, derecha, frente, izquierda) y sus aberturas. */
function rectShell(widthM, depthM, heightM, openings) {
  const p = (x, z) => ({ x, y: 0, z });
  const walls = [
    { id: 'w-back', start: p(0, 0), end: p(widthM, 0) },
    { id: 'w-right', start: p(widthM, 0), end: p(widthM, depthM) },
    { id: 'w-front', start: p(widthM, depthM), end: p(0, depthM) },
    { id: 'w-left', start: p(0, depthM), end: p(0, 0) },
  ].map((w) => ({ ...w, hasWindow: openings.some((o) => o.type === 'window' && o.wallId === w.id) }));
  return { id: 'room', widthM, depthM, heightM, shape: 'rect', walls, openings, scaleConfidence: 1, needsCalibration: false };
}

/**
 * Compone un cuarto. Cada paso es una pieza:
 * - `{ id, at: [x, z], rot }`: en el piso, con el giro en grados (0 = mira hacia el frente, +z).
 * - `{ id, wall, at, y, size }`: colgada en esa pared, centrada en la coordenada `at` (x en fondo y
 *   frente, z en los laterales) con su base a `y` m; `size` = [ancho, alto] opcional.
 * - `{ id, ceiling: [x, z] }`: del techo.
 * - `{ id, on: alias }`: apoyada encima de otra pieza (la ubica DesignToolbox).
 * `as` le pone un alias para referirse a ella después.
 */
function compose(recipe) {
  const shell = rectShell(...recipe.room, recipe.openings);
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  const aliases = new Map();
  let placements = [];
  let n = 0;
  const newId = () => `${recipe.id}-${String(++n).padStart(2, '0')}`;
  for (const step of recipe.pieces) {
    const item = byId.get(step.id);
    if (!item) throw new Error(`${recipe.id}: no existe ${step.id} en el catálogo`);
    let placement;
    if (step.on) {
      const toolbox = new DesignToolbox({ shell, placements, finishes: null, catalog, newId });
      const out = toolbox.run('add_item', { catalogItemId: step.id, relation: 'on-top-of', nearId: aliases.get(step.on) });
      if (!out.ok) throw new Error(`${recipe.id}: ${step.id} sobre ${step.on}: ${out.content}`);
      placements = [...toolbox.scenePlacements];
      placement = placements.at(-1);
    } else {
      const dims = step.size ? { x: step.size[0], y: step.size[1], z: item.dimensionsM.z } : item.dimensionsM;
      const custom = step.size ? { dimensionsM: dims } : {};
      if (step.wall) {
        const frame = frames.get(step.wall);
        placement = { id: newId(), catalogItemId: item.id, position: positionOnWall(frame, step.at, step.y, dims.z), rotationY: frame.rotationY, wallId: frame.id, elevationM: step.y, ...custom };
      } else if (step.ceiling) {
        const [x, z] = step.ceiling;
        placement = { id: newId(), catalogItemId: item.id, position: { x, y: mountY('ceiling', dims, shell), z }, rotationY: 0, ...custom };
      } else {
        const [x, z] = step.at;
        placement = { id: newId(), catalogItemId: item.id, position: { x, y: 0, z }, rotationY: (step.rot ?? 0) * DEG, ...custom };
      }
      placements.push(placement);
    }
    if (step.as) aliases.set(step.as, placement.id);
  }
  // Una plantilla no trae nada fijado: quien la abre puede pedir otra distribución.
  placements = placements.map(({ origin: _origin, ...p }) => ({ ...p, lockedByUser: false }));
  const finishes = { ...DEFAULT_FINISHES, ...recipe.finishes, walls: { ...recipe.finishes.walls } };
  return { shell, placements, finishes };
}

/** Choques entre piezas y avisos de la revisión de diseño: una vitrina no puede tener ninguno. */
function review(recipe, { shell, placements }) {
  const pieces = placements.map((p) => {
    const it = byId.get(p.catalogItemId);
    return { id: p.id, name: it.name, mount: it.mount, category: it.category, ...(it.subcategory ? { subcategory: it.subcategory } : {}), position: p.position, rotationY: p.rotationY, dims: effectiveDimensions(it.dimensionsM, p), ...(p.supportId ? { supportId: p.supportId } : {}) };
  });
  const bodies = placements.map((p) => ({ body: bodyOf(p, byId.get(p.catalogItemId)), name: byId.get(p.catalogItemId).name }));
  const clashes = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) if (bodiesCollide(bodies[i].body, bodies[j].body)) clashes.push(`${bodies[i].name} ↔ ${bodies[j].name}`);
  const issues = checkDesign(shell, pieces).filter((i) => i.severity !== 'tip');
  return { clashes, issues };
}

/** Planta en SVG para revisar la composición a ojo (no se publica). */
function planSvg({ shell, placements }) {
  const s = 100;
  const rects = placements
    .map((p) => {
      const it = byId.get(p.catalogItemId);
      const d = effectiveDimensions(it.dimensionsM, p);
      const fill = it.mount === 'wall' ? '#c33' : it.mount === 'ceiling' ? 'none' : it.subcategory === 'rug' ? '#eadfcf' : it.mount === 'surface' ? '#36c' : '#9a8';
      const label = it.mount === 'floor' ? `<text x="0" y="3" font-size="9" text-anchor="middle">${it.name.slice(0, 18)}</text>` : '';
      return `<g transform="translate(${p.position.x * s} ${p.position.z * s}) rotate(${(-p.rotationY * 180) / Math.PI})"><rect x="${(-d.x / 2) * s}" y="${(-d.z / 2) * s}" width="${d.x * s}" height="${d.z * s}" fill="${fill}" fill-opacity="0.6" stroke="#333" stroke-dasharray="${it.mount === 'ceiling' ? 3 : 0}"/></g><g transform="translate(${p.position.x * s} ${p.position.z * s})">${label}</g>`;
    })
    .join('');
  const ops = shell.openings
    .map((o) => {
      const w = shell.walls.find((x) => x.id === o.wallId);
      const t = o.offsetM / Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      const cx = w.start.x + (w.end.x - w.start.x) * t;
      const cz = w.start.z + (w.end.z - w.start.z) * t;
      return `<circle cx="${cx * s}" cy="${cz * s}" r="${(o.widthM / 2) * s}" fill="none" stroke="${o.type === 'door' ? '#a50' : '#09c'}" stroke-width="3"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 ${shell.widthM * s + 40} ${shell.depthM * s + 40}" width="${shell.widthM * s + 40}"><rect width="${shell.widthM * s}" height="${shell.depthM * s}" fill="#fff" stroke="#000" stroke-width="4"/>${rects}${ops}</svg>`;
}

// --------------------------------------------------------------------------- los seis cuartos
// Coordenadas: x de izquierda a derecha, z del fondo (0) al frente. Giro 0 = de espaldas al fondo;
// 90 = de espaldas a la pared izquierda; 180 = al frente; 270 = a la derecha.
const window = (wallId, offsetM, widthM, heightM, sillHeightM, n = 1) => ({ id: `o-window-${n}`, type: 'window', wallId, widthM, heightM, offsetM, sillHeightM });
const door = (wallId, offsetM, widthM = 0.9) => ({ id: 'o-door-1', type: 'door', wallId, widthM, heightM: 2.05, offsetM, sillHeightM: 0 });

export const SHOWCASE = [
  {
    id: 'sala-nogal-terciopelo',
    name: 'Sala de nogal y terciopelo',
    roomType: 'living',
    styleId: 'moderno',
    summary: 'Sofá de terciopelo verde frente a la tele, mármol y parqué en espiga.',
    room: [4.8, 4.4, 2.7],
    openings: [window('w-back', 2.4, 2.2, 1.7, 0.5), door('w-front', 0.75)],
    finishes: { floor: 'wood-herringbone', walls: { 'w-back': 'paint-greige', 'w-right': 'paint-greige', 'w-front': 'paint-greige', 'w-left': 'paint-forest' }, ceiling: 'paint-white', lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-alfombra-grande-crema', at: [1.95, 2.25], rot: 90 },
      { id: 'p-sofa-terciopelo-verde', at: [0.47, 2.25], rot: 90, as: 'sofa' },
      { id: 'p-mesa-centro-marmol', at: [1.75, 2.25], rot: 90, as: 'centro' },
      { id: 'p-libros', on: 'centro' },
      { id: 'p-butaca-mostaza', at: [2.35, 3.85], rot: 180 },
      { id: 'p-mesa-auxiliar-redonda', at: [0.3, 0.85], as: 'aux' },
      { id: 'p-lampara-mesa-laton', on: 'aux' },
      { id: 'p-lampara-pie-negra', at: [0.3, 3.75] },
      { id: 'p-mueble-tv-negro', at: [4.6, 2.25], rot: 270, as: 'tv' },
      { id: 'p-jarron-ceramica', on: 'tv' },
      { id: 'p-tv-55', wall: 'w-right', at: 2.25, y: 1.05 },
      { id: 'p-planta-grande', at: [4.35, 0.45] },
      { id: 'p-cuadro-mostaza', wall: 'w-left', at: 2.25, y: 1.35 },
      { id: 'p-cortinas-terciopelo', wall: 'w-back', at: 2.4, y: 0.04, size: [2.7, 2.5] },
      { id: 'lampara-techo-moderna', ceiling: [1.85, 2.25] },
    ],
  },
  {
    id: 'suite-clasica-azul',
    name: 'Suite clásica en azul',
    roomType: 'bedroom',
    styleId: 'clasico',
    summary: 'Cama de terciopelo azul, nogal, latón y un rincón de lectura junto a la ventana.',
    room: [4.8, 4.4, 2.8],
    openings: [window('w-right', 2.0, 1.8, 1.6, 0.6), door('w-front', 0.9)],
    finishes: { floor: 'wood-oak', walls: { 'w-back': 'paint-navy', 'w-right': 'paint-pearl', 'w-front': 'paint-pearl', 'w-left': 'paint-pearl' }, ceiling: 'paint-white', lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-alfombra-grande-crema', at: [2.4, 1.75] },
      { id: 'p-cama-queen-terciopelo', at: [2.4, 1.1], as: 'cama' },
      { id: 'p-mesa-noche-nogal', at: [1.2, 0.23], as: 'mn1' },
      { id: 'p-mesa-noche-nogal', at: [3.6, 0.23], as: 'mn2' },
      { id: 'p-lampara-mesa-laton', on: 'mn1' },
      { id: 'p-lampara-mesa-laton', on: 'mn2' },
      { id: 'p-cuadro-vertical-azul', wall: 'w-back', at: 1.2, y: 1.15 },
      { id: 'p-cuadro-vertical-azul', wall: 'w-back', at: 3.6, y: 1.15 },
      { id: 'p-armario-4p-nogal', at: [0.33, 3.25], rot: 90 },
      { id: 'p-comoda-roble', at: [0.25, 1.05], rot: 90, as: 'comoda' },
      { id: 'p-jarron-ceramica', on: 'comoda' },
      { id: 'p-espejo-redondo-laton', wall: 'w-left', at: 1.05, y: 1.2 },
      { id: 'butaca-clasica', at: [4.36, 2.95], rot: 270 },
      { id: 'p-lampara-pie-lino', at: [4.5, 0.45] },
      { id: 'p-cortinas-terciopelo', wall: 'w-right', at: 2.0, y: 0.04, size: [2.3, 2.6] },
      { id: 'arana-clasica', ceiling: [2.4, 2.3] },
    ],
  },
  {
    id: 'cocina-roble-terrazo',
    name: 'Cocina de roble y terrazo',
    roomType: 'kitchen',
    styleId: 'escandinavo',
    summary: 'Hilera completa bajo la ventana, isla con tres taburetes y latón sobre el terrazo.',
    room: [4.8, 4.0, 2.7],
    openings: [window('w-back', 2.02, 1.0, 1.0, 1.15), door('w-front', 0.8)],
    finishes: { floor: 'stone-terrazzo', walls: { 'w-back': 'paint-white', 'w-right': 'paint-white', 'w-front': 'paint-white', 'w-left': 'paint-sage' }, ceiling: 'paint-white', wallTiles: { material: 'ceramic-subway-white', heightM: 1.5, walls: ['w-back'] }, lighting: { mood: 'neutra', level: 'alta' } },
    pieces: [
      { id: 'p-nevera-inox', at: [0.37, 0.36] },
      { id: 'p-cocina-modulo-roble', at: [1.12, 0.32], as: 'm1' },
      { id: 'p-fregadero', at: [2.02, 0.32] },
      { id: 'p-cocina-modulo-roble', at: [2.92, 0.32], as: 'm2' },
      { id: 'p-estufa-horno', at: [3.62, 0.32] },
      { id: 'p-cocina-modulo-roble', at: [4.32, 0.32], as: 'm3' },
      { id: 'p-planta-mesa', on: 'm1' },
      { id: 'p-jarron-ceramica', on: 'm2' },
      { id: 'p-cocina-alacena', wall: 'w-back', at: 4.02, y: 1.45 },
      { id: 'p-repisa-roble', wall: 'w-back', at: 1.12, y: 1.55 },
      { id: 'p-cocina-isla', at: [2.4, 2.15], as: 'isla' },
      { id: 'p-taburete-alto', at: [1.8, 2.9], rot: 180 },
      { id: 'p-taburete-alto', at: [2.4, 2.9], rot: 180 },
      { id: 'p-taburete-alto', at: [3.0, 2.9], rot: 180 },
      { id: 'p-libros', on: 'isla' },
      { id: 'p-reloj-pared', wall: 'w-left', at: 2.2, y: 1.7 },
      { id: 'p-planta-grande', at: [0.4, 3.55] },
      { id: 'p-colgante-laton', ceiling: [1.95, 2.15] },
      { id: 'p-colgante-laton', ceiling: [2.85, 2.15] },
    ],
  },
  {
    id: 'comedor-travertino',
    name: 'Comedor de travertino',
    roomType: 'dining',
    styleId: 'minimalista',
    summary: 'Mesa ovalada para seis bajo dos lámparas, aparador lacado y luz de un ventanal.',
    room: [4.8, 4.2, 2.7],
    openings: [window('w-left', 2.1, 2.0, 1.9, 0.4), door('w-front', 0.8)],
    finishes: { floor: 'wood-ash-white', walls: { 'w-back': 'paint-sand', 'w-right': 'paint-sand', 'w-front': 'paint-sand', 'w-left': 'paint-sand' }, ceiling: 'paint-white', lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-alfombra-grande-crema', at: [2.4, 2.35] },
      { id: 'p-mesa-ovalada', at: [2.4, 2.35], as: 'mesa' },
      { id: 'p-silla-roble', at: [1.95, 1.62] },
      { id: 'p-silla-roble', at: [2.85, 1.62] },
      { id: 'p-silla-roble', at: [1.95, 3.08], rot: 180 },
      { id: 'p-silla-roble', at: [2.85, 3.08], rot: 180 },
      { id: 'p-silla-roble', at: [1.22, 2.35], rot: 90 },
      { id: 'p-silla-roble', at: [3.58, 2.35], rot: 270 },
      { id: 'p-jarron-ceramica', on: 'mesa' },
      { id: 'p-aparador-blanco', at: [2.4, 0.24], as: 'aparador' },
      { id: 'p-lampara-mesa-ceramica', on: 'aparador' },
      { id: 'p-cuadro-salvia', wall: 'w-back', at: 2.4, y: 1.15 },
      { id: 'p-planta-grande', at: [0.4, 3.8] },
      { id: 'p-cortinas-lino', wall: 'w-left', at: 2.1, y: 0.04, size: [2.5, 2.6] },
      { id: 'lampara-techo-moderna', ceiling: [1.95, 2.35] },
      { id: 'lampara-techo-moderna', ceiling: [2.85, 2.35] },
    ],
  },
  {
    id: 'estudio-ladrillo',
    name: 'Estudio de ladrillo',
    roomType: 'office',
    styleId: 'industrial',
    summary: 'Escritorio de metal bajo la ventana, pared de ladrillo y un sillón de cuero para leer.',
    room: [3.8, 3.4, 2.8],
    openings: [window('w-back', 1.9, 1.6, 1.5, 0.8), door('w-front', 3.05)],
    finishes: { floor: 'wood-walnut', walls: { 'w-back': 'paint-brick', 'w-right': 'paint-pearl', 'w-front': 'paint-pearl', 'w-left': 'paint-pearl' }, ceiling: 'paint-white', lighting: { mood: 'neutra', level: 'media' } },
    pieces: [
      { id: 'p-escritorio-metal', at: [1.9, 0.37], as: 'escritorio' },
      { id: 'p-lampara-escritorio', on: 'escritorio' },
      { id: 'p-silla-oficina', at: [1.9, 1.15], rot: 180 },
      { id: 'estanteria-industrial', at: [0.27, 1.75], rot: 90, as: 'estante' },
      { id: 'alfombra-industrial', at: [2.85, 2.35], rot: 90 },
      { id: 'p-butaca-cuero', at: [3.3, 2.35], rot: 270, as: 'butaca' },
      { id: 'p-mesa-auxiliar-redonda', at: [3.5, 1.55], as: 'aux' },
      { id: 'p-libros', on: 'aux' },
      { id: 'p-lampara-pie-negra', at: [3.5, 3.05] },
      { id: 'p-cuadro-vertical-azul', wall: 'w-right', at: 2.35, y: 1.3 },
      { id: 'p-repisa-larga-negra', wall: 'w-left', at: 0.7, y: 1.5 },
      { id: 'lampara-colgante-industrial', ceiling: [1.9, 0.6] },
    ],
  },
  {
    id: 'bano-terracota',
    name: 'Baño bohemio de terracota',
    roomType: 'bathroom',
    styleId: 'bohemio',
    summary: 'Bañera exenta, piso de terracota, verde salvia y madera con espejo de latón.',
    room: [3.0, 2.8, 2.6],
    openings: [window('w-right', 1.3, 0.8, 0.7, 1.45), door('w-front', 2.5, 0.8)],
    finishes: { floor: 'ceramic-terracotta', walls: { 'w-back': 'paint-sage', 'w-right': 'paint-sage', 'w-front': 'paint-sage', 'w-left': 'paint-sage' }, ceiling: 'paint-white', wallTiles: { material: 'ceramic-white', heightM: 1.2 }, lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-banera', at: [2.05, 0.42] },
      { id: 'p-alfombra-bano', at: [2.05, 1.2] },
      { id: 'p-lavamanos-roble', at: [0.26, 1.2], rot: 90 },
      { id: 'p-espejo-redondo-laton', wall: 'w-left', at: 1.2, y: 1.25 },
      { id: 'p-aplique-lino', wall: 'w-left', at: 0.6, y: 1.75 },
      { id: 'p-inodoro', at: [2.65, 2.15], rot: 270 },
      { id: 'p-toallero', wall: 'w-right', at: 0.5, y: 1.0 },
      { id: 'p-jarron-terracota', at: [0.25, 0.25] },
      { id: 'p-plafon-blanco', ceiling: [1.5, 1.4] },
    ],
  },
];

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('make-showcase.mjs')) {
  await mkdir(OUT, { recursive: true });
  if (PLAN_DIR) await mkdir(PLAN_DIR, { recursive: true });
  let failed = false;
  for (const recipe of SHOWCASE) {
    const built = compose(recipe);
    const { clashes, issues } = review(recipe, built);
    const status = clashes.length || issues.length ? '✗' : '✓';
    failed ||= status === '✗';
    console.log(`${status} ${recipe.id}: ${built.placements.length} piezas`);
    for (const c of clashes) console.log(`    choque: ${c}`);
    for (const i of issues) console.log(`    ${i.severity}: ${i.title} — ${i.detail}`);
    if (PLAN_DIR) await writeFile(`${PLAN_DIR}/${recipe.id}.svg`, planSvg(built));
    const scene = FurnishedSceneSchema.parse({ id: recipe.id, name: recipe.name, roomType: recipe.roomType, styleId: recipe.styleId, roomShell: built.shell, furniturePlacements: built.placements, finishes: built.finishes });
    await writeFile(`${OUT}/${recipe.id}.json`, `${JSON.stringify(scene)}\n`);
  }
  if (failed) process.exitCode = 1;
}
