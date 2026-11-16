// Interiores de la «Casa Mirador — 4 pisos», el proyecto destacado que comparten Plano 3D e
// Interiores. Cada receta es un ambiente de la casa con sus medidas reales (las del fixture
// `casa4.json` de Plano 3D, altura libre 3 m) diseñado a mano como las vitrinas: sin choques ni
// avisos de la revisión.
//
//   node e2e/scripts/make-casa4.mjs [baseUrl] [carpeta-de-salida] [--plano carpeta]
//
// Escribe una escena por ambiente y `casa4.json` con el índice (piso, posición en la planta de la
// casa y escena), que usa `import-casa4.mjs` para subirla a una cuenta como vivienda.
import { mkdir, writeFile } from 'node:fs/promises';
import { FurnishedSceneSchema } from '@interiores/shared-types';
import { compose, planSvg, review } from './make-showcase.mjs';

const args = process.argv.slice(2);
const planIdx = args.indexOf('--plano');
const PLAN_DIR = planIdx >= 0 ? args.splice(planIdx, 2)[1] : null;
const OUT = args[1] ?? 'apps/web/public/escenas/casa4';

const win = (wallId, offsetM, widthM, heightM, sillHeightM, n = 1) => ({ id: `o-window-${n}`, type: 'window', wallId, widthM, heightM, offsetM, sillHeightM });
const door = (wallId, offsetM, widthM = 0.9, n = 1) => ({ id: `o-door-${n}`, type: 'door', wallId, widthM, heightM: 2.1, offsetM, sillHeightM: 0 });

/**
 * `level`: piso de la casa (0 = primero). `at`: esquina del ambiente en la planta de Plano 3D
 * (x, y en metros); en Interiores la y de la planta es la z del cuarto.
 */
export const CASA4 = [
  {
    id: 'casa4-sala',
    name: 'Sala doble altura',
    level: 0,
    at: [0, 0],
    roomType: 'living',
    styleId: 'moderno',
    summary: 'Dos ambientes frente a los ventanales: TV de 65" con sofá en L y un estar de bouclé.',
    room: [12, 7, 3],
    openings: [win('w-back', 3, 3, 2.4, 0.1, 1), win('w-back', 9, 3, 2.4, 0.1, 2), door('w-front', 6, 1.2)],
    finishes: { floor: 'wood-oak', walls: { 'w-back': 'paint-white', 'w-right': 'paint-greige', 'w-front': 'paint-white', 'w-left': 'paint-charcoal' }, ceiling: 'paint-white', lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-mueble-tv-negro', at: [0.22, 3.5], rot: 90, as: 'tv' },
      { id: 'p-tv-65-pie', on: 'tv' },
      { id: 'p-alfombra-grande-crema', at: [2.35, 3.5], rot: 90 },
      { id: 'p-sofa-l-gris', at: [3.95, 3.5], rot: 270, as: 'sofa' },
      { id: 'p-mesa-centro-marmol', at: [2.35, 3.5], rot: 90, as: 'centro' },
      { id: 'p-libros', on: 'centro' },
      { id: 'p-mesa-auxiliar-redonda', at: [4.3, 1.7], as: 'aux' },
      { id: 'p-lampara-mesa-laton', on: 'aux' },
      { id: 'p-butaca-cuero', at: [2.35, 5.75], rot: 180 },
      { id: 'p-planta-grande', at: [0.45, 0.45] },
      { id: 'p-lampara-pie-negra', at: [0.35, 6.6] },
      { id: 'p-alfombra-redonda-gris', at: [9, 4.4] },
      { id: 'p-sofa-bajo-boucle', at: [9, 6.45], rot: 180 },
      { id: 'mesa-centro-redonda', at: [9, 4.4], as: 'mesa2' },
      { id: 'p-jarron-ceramica', on: 'mesa2' },
      { id: 'butaca-moderna', at: [8.3, 2.75] },
      { id: 'butaca-moderna', at: [9.7, 2.75] },
      { id: 'p-estanteria-roble', at: [11.8, 3.6], rot: 270 },
      { id: 'p-planta-grande', at: [11.55, 6.5] },
      { id: 'p-cuadro-mostaza', wall: 'w-right', at: 1.6, y: 1.4 },
      { id: 'p-cortinas-lino', wall: 'w-back', at: 3, y: 0.04, size: [3.4, 2.8] },
      { id: 'p-cortinas-lino', wall: 'w-back', at: 9, y: 0.04, size: [3.4, 2.8] },
      { id: 'lampara-techo-moderna', ceiling: [2.35, 3.5] },
      { id: 'p-colgante-domo-negro', ceiling: [9, 4.4] },
    ],
  },
  {
    id: 'casa4-cocina',
    name: 'Cocina abierta de roble',
    level: 0,
    at: [0, 7],
    roomType: 'kitchen',
    styleId: 'escandinavo',
    summary: 'Hilera completa con nevera de acero, isla de tres puestos y colgantes de latón.',
    room: [5, 5, 3],
    openings: [win('w-left', 2.5, 1.6, 1.1, 1.1), door('w-right', 4.2, 1.0)],
    finishes: { floor: 'stone-terrazzo', walls: { 'w-back': 'paint-white', 'w-right': 'paint-white', 'w-front': 'paint-sage', 'w-left': 'paint-white' }, ceiling: 'paint-white', wallTiles: { material: 'ceramic-subway-white', heightM: 1.5, walls: ['w-back'] }, lighting: { mood: 'neutra', level: 'alta' } },
    pieces: [
      { id: 'p-nevera-inox', at: [0.37, 0.36] },
      { id: 'p-cocina-modulo-roble', at: [1.12, 0.32], as: 'm1' },
      { id: 'p-fregadero', at: [2.02, 0.32] },
      { id: 'p-cocina-modulo-roble', at: [2.92, 0.32], as: 'm2' },
      { id: 'p-estufa-horno', at: [3.62, 0.32] },
      { id: 'p-cocina-modulo-roble', at: [4.32, 0.32] },
      { id: 'p-planta-mesa', on: 'm1' },
      { id: 'p-jarron-ceramica', on: 'm2' },
      { id: 'p-cocina-alacena', wall: 'w-back', at: 4.02, y: 1.5 },
      { id: 'p-repisa-roble', wall: 'w-back', at: 1.12, y: 1.6 },
      { id: 'p-cocina-isla', at: [2.5, 2.35], as: 'isla' },
      { id: 'p-taburete-alto', at: [1.9, 3.1], rot: 180 },
      { id: 'p-taburete-alto', at: [2.5, 3.1], rot: 180 },
      { id: 'p-taburete-alto', at: [3.1, 3.1], rot: 180 },
      { id: 'p-libros', on: 'isla' },
      { id: 'p-planta-grande', at: [0.45, 4.55] },
      { id: 'p-reloj-pared', wall: 'w-front', at: 2.5, y: 1.8 },
      { id: 'p-colgante-laton', ceiling: [2.05, 2.35] },
      { id: 'p-colgante-laton', ceiling: [2.95, 2.35] },
    ],
  },
  {
    id: 'casa4-comedor',
    name: 'Comedor de nogal',
    level: 0,
    at: [7, 7],
    roomType: 'dining',
    styleId: 'minimalista',
    summary: 'Mesa de nogal para seis bajo dos lámparas, aparador lacado y luz del ventanal lateral.',
    room: [5, 4, 3],
    openings: [win('w-right', 2, 2, 1.9, 0.5), door('w-left', 2, 1.2)],
    finishes: { floor: 'wood-walnut', walls: { 'w-back': 'paint-sand', 'w-right': 'paint-sand', 'w-front': 'paint-sand', 'w-left': 'paint-sand' }, ceiling: 'paint-white', lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-alfombra-grande-crema', at: [2.5, 2.1] },
      { id: 'p-mesa-comedor-nogal', at: [2.5, 2.1], as: 'mesa' },
      { id: 'p-silla-nogal-cuero', at: [2.0, 1.33] },
      { id: 'p-silla-nogal-cuero', at: [3.0, 1.33] },
      { id: 'p-silla-nogal-cuero', at: [2.0, 2.87], rot: 180 },
      { id: 'p-silla-nogal-cuero', at: [3.0, 2.87], rot: 180 },
      { id: 'p-silla-nogal-cuero', at: [1.23, 2.1], rot: 90 },
      { id: 'p-silla-nogal-cuero', at: [3.77, 2.1], rot: 270 },
      { id: 'p-jarron-ceramica', on: 'mesa' },
      { id: 'p-aparador-blanco', at: [2.5, 0.24], as: 'aparador' },
      { id: 'p-lampara-mesa-ceramica', on: 'aparador' },
      { id: 'p-cuadro-salvia', wall: 'w-back', at: 2.5, y: 1.3 },
      { id: 'p-planta-grande', at: [4.6, 3.6] },
      { id: 'p-cortinas-lino', wall: 'w-right', at: 2, y: 0.04, size: [2.5, 2.7] },
      { id: 'lampara-techo-moderna', ceiling: [2.0, 2.1] },
      { id: 'lampara-techo-moderna', ceiling: [3.0, 2.1] },
    ],
  },
  {
    id: 'casa4-suite',
    name: 'Suite principal',
    level: 2,
    at: [0, 0],
    roomType: 'bedroom',
    styleId: 'clasico',
    summary: 'Cama king de nogal, TV de 55" frente a la cama y un rincón de lectura junto al ventanal.',
    room: [7, 7, 3],
    openings: [win('w-back', 3.5, 3, 2.2, 0.3), door('w-right', 5.8, 0.9), door('w-front', 6.2, 0.9, 2)],
    finishes: { floor: 'wood-herringbone', walls: { 'w-back': 'paint-pearl', 'w-right': 'paint-pearl', 'w-front': 'paint-pearl', 'w-left': 'paint-navy' }, ceiling: 'paint-white', lighting: { mood: 'calida', level: 'media' } },
    pieces: [
      { id: 'p-alfombra-grande-crema', at: [1.75, 3.5], rot: 90 },
      { id: 'p-cama-king-nogal', at: [1.12, 3.5], rot: 90, as: 'cama' },
      { id: 'p-mesa-noche-nogal', at: [0.23, 2.05], rot: 90, as: 'mn1' },
      { id: 'p-mesa-noche-nogal', at: [0.23, 4.95], rot: 90, as: 'mn2' },
      { id: 'p-lampara-mesa-laton', on: 'mn1' },
      { id: 'p-lampara-mesa-laton', on: 'mn2' },
      { id: 'p-cuadro-salvia', wall: 'w-left', at: 3.5, y: 1.35 },
      { id: 'p-mueble-tv-roble', at: [6.78, 3.5], rot: 270, as: 'tvsuite' },
      { id: 'p-jarron-ceramica', on: 'tvsuite' },
      { id: 'p-tv-55', wall: 'w-right', at: 3.5, y: 1.1 },
      { id: 'p-armario-4p-nogal', at: [1.0, 0.32] },
      { id: 'butaca-clasica', at: [5.6, 1.2], rot: 270 },
      { id: 'p-mesa-auxiliar-redonda', at: [6.5, 0.45], as: 'aux' },
      { id: 'p-libros', on: 'aux' },
      { id: 'p-lampara-pie-lino', at: [4.6, 0.45] },
      { id: 'p-planta-grande', at: [6.5, 6.6] },
      { id: 'p-cortinas-terciopelo', wall: 'w-back', at: 3.5, y: 0.04, size: [3.2, 2.8] },
      { id: 'arana-clasica', ceiling: [3.2, 3.5] },
    ],
  },
  {
    id: 'casa4-cine',
    name: 'Sala de cine',
    level: 2,
    at: [0, 7],
    roomType: 'living',
    styleId: 'moderno',
    summary: 'Pared de carbón con TV de 65", dos filas de sofás, alfombra mullida y luz tenue.',
    room: [5, 11, 3],
    openings: [door('w-right', 9.5, 0.9)],
    finishes: { floor: 'carpet-grey', walls: { 'w-back': 'paint-charcoal', 'w-right': 'paint-charcoal', 'w-front': 'paint-charcoal', 'w-left': 'paint-charcoal' }, ceiling: 'paint-charcoal', lighting: { mood: 'calida', level: 'tenue' } },
    pieces: [
      { id: 'mueble-tv', at: [2.5, 0.27], as: 'tv' },
      { id: 'p-tv-65-pie', on: 'tv' },
      { id: 'p-tira-led', wall: 'w-back', at: 2.5, y: 2.6, size: [3.6, 0.01] },
      { id: 'p-alfombra-shaggy', at: [2.5, 3.6] },
      { id: 'p-sofa-cuero-cognac', at: [2.5, 3.9], rot: 180, as: 'fila1' },
      { id: 'p-cojin-mostaza', on: 'fila1' },
      { id: 'p-sofa-lino-arena', at: [2.5, 6.2], rot: 180, as: 'fila2' },
      { id: 'p-cojin-verde', on: 'fila2' },
      { id: 'p-mesa-auxiliar-redonda', at: [0.9, 3.9], as: 'aux' },
      { id: 'p-planta-mesa', on: 'aux' },
      { id: 'p-estanteria-negra-alta', at: [0.18, 9.4], rot: 90 },
      { id: 'p-aplique-negro', wall: 'w-left', at: 5.5, y: 1.8 },
      { id: 'p-aplique-negro', wall: 'w-right', at: 5.5, y: 1.8 },
      { id: 'p-foco-empotrado', ceiling: [1.2, 3.5] },
      { id: 'p-foco-empotrado', ceiling: [3.8, 3.5] },
      { id: 'p-foco-empotrado', ceiling: [1.2, 7.5] },
      { id: 'p-foco-empotrado', ceiling: [3.8, 7.5] },
    ],
  },
  {
    id: 'casa4-alcoba2',
    name: 'Alcoba con vista a la calle',
    level: 1,
    at: [7, 14],
    roomType: 'bedroom',
    styleId: 'escandinavo',
    summary: 'Cama queen de lino, TV de 43" en la pared y escritorio de roble bajo la ventana.',
    room: [5, 4, 3],
    openings: [win('w-front', 2.5, 2.2, 1.6, 0.6), door('w-left', 3.2, 0.9)],
    finishes: { floor: 'wood-ash-white', walls: { 'w-back': 'paint-sage', 'w-right': 'paint-white', 'w-front': 'paint-white', 'w-left': 'paint-white' }, ceiling: 'paint-white', lighting: { mood: 'neutra', level: 'media' } },
    pieces: [
      { id: 'alfombra-nordica', at: [2.6, 1.45] },
      { id: 'p-cama-doble-lino', at: [2.6, 1.07], as: 'cama' },
      { id: 'p-mesa-noche-roble', at: [1.5, 0.22], as: 'mn1' },
      { id: 'p-mesa-noche-roble', at: [3.7, 0.22], as: 'mn2' },
      { id: 'p-lampara-mesa-ceramica', on: 'mn1' },
      { id: 'p-lampara-mesa-ceramica', on: 'mn2' },
      { id: 'p-cuadro-vertical-azul', wall: 'w-back', at: 2.6, y: 1.3 },
      { id: 'p-tv-43', wall: 'w-right', at: 1.3, y: 1.15 },
      { id: 'p-comoda-roble', at: [4.74, 1.3], rot: 270, as: 'comoda' },
      { id: 'p-planta-mesa', on: 'comoda' },
      { id: 'p-escritorio-roble', at: [3.6, 3.65], rot: 180, as: 'esc' },
      { id: 'p-lampara-escritorio', on: 'esc' },
      { id: 'silla-comedor-escandinava', at: [3.6, 3.05] },
      { id: 'p-armario-3p-blanco', at: [0.3, 2.8], rot: 90 },
      { id: 'p-colgante-tambor-lino', ceiling: [2.6, 1.9] },
    ],
  },
  {
    id: 'casa4-estudio',
    name: 'Estudio principal',
    level: 2,
    at: [7, 7],
    roomType: 'office',
    styleId: 'industrial',
    summary: 'Escritorio de metal frente a la ventana, pared de ladrillo y sillón de cuero para leer.',
    room: [5, 4, 3],
    openings: [win('w-right', 2, 1.8, 1.5, 0.8), door('w-left', 3.3, 0.9)],
    finishes: { floor: 'wood-walnut', walls: { 'w-back': 'paint-brick', 'w-right': 'paint-pearl', 'w-front': 'paint-pearl', 'w-left': 'paint-pearl' }, ceiling: 'paint-white', lighting: { mood: 'neutra', level: 'media' } },
    pieces: [
      { id: 'p-escritorio-metal', at: [4.6, 2], rot: 270, as: 'escritorio' },
      { id: 'p-lampara-escritorio', on: 'escritorio' },
      { id: 'p-silla-oficina', at: [3.8, 2], rot: 90 },
      { id: 'estanteria-industrial', at: [1.4, 0.27], as: 'estante' },
      { id: 'p-estanteria-negra-alta', at: [2.5, 0.18] },
      { id: 'alfombra-industrial', at: [1.6, 2.4] },
      { id: 'p-butaca-cuero', at: [1.0, 2.0], rot: 90 },
      { id: 'p-mesa-auxiliar-redonda', at: [1.0, 3.2], as: 'aux' },
      { id: 'p-libros', on: 'aux' },
      { id: 'p-lampara-pie-negra', at: [2.6, 3.65] },
      { id: 'p-planta-grande', at: [4.55, 3.55] },
      { id: 'p-cuadro-vertical-azul', wall: 'w-left', at: 2.6, y: 1.35 },
      { id: 'lampara-colgante-industrial', ceiling: [3.6, 2] },
    ],
  },
  {
    id: 'casa4-bano-suite',
    name: 'Baño de la suite',
    level: 2,
    at: [7, 0],
    roomType: 'bathroom',
    styleId: 'minimalista',
    summary: 'Bañera exenta bajo la ventana, doble lavabo de roble, ducha de obra y mármol.',
    room: [5, 4, 3],
    openings: [win('w-back', 1.4, 1.4, 1.0, 1.2), door('w-front', 0.7, 0.8)],
    finishes: { floor: 'stone-marble-white', walls: { 'w-back': 'paint-greige', 'w-right': 'paint-greige', 'w-front': 'paint-greige', 'w-left': 'paint-greige' }, ceiling: 'paint-white', wallTiles: { material: 'ceramic-marble-mosaic', heightM: 1.3 }, lighting: { mood: 'neutra', level: 'media' } },
    pieces: [
      { id: 'p-banera', at: [1.4, 0.42] },
      { id: 'p-alfombra-bano', at: [1.4, 1.2] },
      { id: 'p-ducha-obra-pizarra', at: [4.3, 0.45] },
      { id: 'p-lavamanos-roble', at: [0.26, 2.3], rot: 90 },
      { id: 'p-lavamanos-roble', at: [0.26, 3.2], rot: 90 },
      { id: 'p-espejo-led', wall: 'w-left', at: 2.3, y: 1.2 },
      { id: 'p-espejo-led', wall: 'w-left', at: 3.2, y: 1.2 },
      { id: 'p-inodoro', at: [4.65, 2.2], rot: 270 },
      { id: 'p-toallero-doble-negro', wall: 'w-right', at: 1.4, y: 1.1 },
      { id: 'p-jarron-terracota', at: [2.6, 0.25] },
      { id: 'p-plafon-blanco', ceiling: [2.5, 2] },
    ],
  },
];

if (process.argv[1]?.endsWith('make-casa4.mjs')) {
  await mkdir(OUT, { recursive: true });
  if (PLAN_DIR) await mkdir(PLAN_DIR, { recursive: true });
  let failed = false;
  const index = [];
  for (const recipe of CASA4) {
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
    index.push({ id: recipe.id, name: recipe.name, summary: recipe.summary, level: recipe.level, at: { x: recipe.at[0], z: recipe.at[1] } });
  }
  await writeFile(`${OUT}/casa4.json`, `${JSON.stringify({ name: 'Casa Mirador — 4 pisos', rooms: index }, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}
