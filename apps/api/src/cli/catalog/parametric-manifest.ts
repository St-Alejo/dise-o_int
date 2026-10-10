/**
 * Catálogo paramétrico: muebles generados por `@interiores/furniture-kit`. Cada entrada elige
 * una receta, sus medidas reales, parámetros de forma y los materiales por slot. El seed
 * construye el GLB (AR, miniaturas, respaldo); la web los dibuja en vivo con la misma receta,
 * así que cambiar sus medidas reconstruye la pieza en lugar de estirarla.
 */
import type { CatalogCategory, Mount, RoomType, StyleId } from '@interiores/shared-types';
import type { ManifestEntry } from './manifest.js';

type ParamValue = string | number | boolean;

interface Opt {
  sub?: string;
  styles: StyleId[];
  rooms: RoomType[];
  price: number;
  q?: string;
  tags?: string[];
  syn?: string[];
  params?: Record<string, ParamValue>;
  mats?: Record<string, string>;
  mount?: Mount;
  elev?: number;
  desc?: string;
}

const pm = (id: string, name: string, category: CatalogCategory, kind: string, size: [number, number, number], o: Opt): ManifestEntry => ({
  id: `p-${id}`,
  name,
  category,
  ...(o.sub ? { subcategory: o.sub } : {}),
  styleTags: o.styles,
  roomTypes: o.rooms,
  ...(o.mount ? { mount: o.mount } : {}),
  price: o.price,
  searchQuery: o.q ?? name,
  ...(o.tags ? { tags: o.tags } : {}),
  ...(o.syn ? { synonyms: o.syn } : {}),
  ...(o.desc ? { description: o.desc } : {}),
  ...(o.elev !== undefined ? { spec: { elevationDefaultM: o.elev } } : {}),
  source: { type: 'parametric', kind, size, params: o.params ?? {}, materials: o.mats ?? {} },
});

const ALL_STYLES: StyleId[] = ['escandinavo', 'minimalista', 'industrial', 'bohemio', 'moderno', 'clasico'];
const LIVING: RoomType[] = ['living'];
const BED: RoomType[] = ['bedroom'];
const DINING: RoomType[] = ['dining'];
const OFFICE: RoomType[] = ['office'];
const KITCHEN: RoomType[] = ['kitchen', 'dining'];
const BATH: RoomType[] = ['bathroom'];
const ANY: RoomType[] = ['living', 'bedroom', 'dining', 'office', 'kitchen'];

export const PARAMETRIC_MANIFEST: ManifestEntry[] = [
  // ------------------------------------------------------------------ sofás y asientos
  pm('sofa-lino-arena', 'Sofá de lino arena 3 puestos', 'sofa', 'sofa', [2.1, 0.84, 0.92], { styles: ['escandinavo', 'minimalista'], rooms: LIVING, price: 890 }),
  pm('sofa-terciopelo-verde', 'Sofá de terciopelo verde', 'sofa', 'sofa', [2.0, 0.8, 0.9], { styles: ['moderno', 'bohemio'], rooms: LIVING, price: 1150, mats: { tapizado: 'fabric-velvet-green', patas: 'metal-brass' } }),
  pm('sofa-cuero-cognac', 'Sofá de cuero coñac', 'sofa', 'sofa', [2.2, 0.82, 0.95], { styles: ['industrial', 'clasico'], rooms: LIVING, price: 1690, mats: { tapizado: 'leather-cognac', patas: 'metal-black' } }),
  pm('sofa-2p-gris', 'Sofá 2 puestos gris sin brazos', 'sofa', 'sofa', [1.5, 0.78, 0.86], { styles: ['minimalista', 'moderno'], rooms: ['living', 'office'], price: 620, params: { arms: false }, mats: { tapizado: 'fabric-wool-grey', patas: 'metal-black' } }),
  pm('sofa-bajo-boucle', 'Sofá bajo de bouclé', 'sofa', 'sofa', [2.3, 0.72, 1.0], { styles: ['minimalista', 'moderno'], rooms: LIVING, price: 1390, params: { legs: 'none' }, mats: { tapizado: 'fabric-boucle-cream' } }),
  pm('sofa-l-gris', 'Sofá en L con chaise gris', 'sofa', 'sofa-l', [2.7, 0.84, 1.65], { styles: ['moderno', 'escandinavo'], rooms: LIVING, price: 1790, mats: { tapizado: 'fabric-wool-grey' }, tags: ['seccional', 'esquinero'], syn: ['sectional', 'corner sofa'] }),
  pm('sofa-l-azul', 'Sofá en L azul (chaise izquierda)', 'sofa', 'sofa-l', [2.9, 0.84, 1.7], { styles: ['moderno', 'clasico'], rooms: LIVING, price: 1990, params: { chaise: 'left' }, mats: { tapizado: 'fabric-velvet-blue', patas: 'wood-walnut' }, tags: ['seccional'] }),
  pm('butaca-lino', 'Butaca de lino con patas de roble', 'chair', 'armchair', [0.8, 0.86, 0.82], { sub: 'armchair', styles: ['escandinavo', 'minimalista'], rooms: ['living', 'bedroom'], price: 420 }),
  pm('butaca-mostaza', 'Butaca mostaza', 'chair', 'armchair', [0.78, 0.82, 0.8], { sub: 'armchair', styles: ['bohemio', 'moderno'], rooms: ['living', 'bedroom'], price: 460, mats: { tapizado: 'fabric-mustard', patas: 'wood-walnut' } }),
  pm('butaca-cuero', 'Butaca de cuero negro', 'chair', 'armchair', [0.85, 0.84, 0.86], { sub: 'armchair', styles: ['industrial', 'clasico'], rooms: ['living', 'office'], price: 690, mats: { tapizado: 'leather-black', patas: 'metal-black' } }),
  pm('puf-redondo-terracota', 'Puf redondo terracota', 'chair', 'ottoman', [0.5, 0.4, 0.5], { sub: 'ottoman', styles: ['bohemio'], rooms: ['living', 'bedroom'], price: 110, mats: { tapizado: 'fabric-terracotta' } }),
  pm('puf-cuadrado-gris', 'Puf cuadrado gris', 'chair', 'ottoman', [0.6, 0.42, 0.6], { sub: 'ottoman', styles: ['minimalista', 'moderno'], rooms: ['living', 'bedroom'], price: 140, params: { shape: 'square' }, mats: { tapizado: 'fabric-wool-grey' } }),
  pm('silla-roble', 'Silla de comedor de roble', 'chair', 'dining-chair', [0.46, 0.84, 0.52], { sub: 'dining-chair', styles: ['escandinavo', 'minimalista'], rooms: ['dining', 'office'], price: 120, mats: { asiento: 'fabric-linen-sand' } }),
  pm('silla-negra', 'Silla de comedor negra', 'chair', 'dining-chair', [0.45, 0.82, 0.5], { sub: 'dining-chair', styles: ['industrial', 'moderno'], rooms: ['dining', 'office'], price: 95, mats: { estructura: 'metal-black', asiento: 'wood-black' } }),
  pm('silla-nogal-cuero', 'Silla de nogal y cuero', 'chair', 'dining-chair', [0.48, 0.88, 0.54], { sub: 'dining-chair', styles: ['clasico', 'moderno'], rooms: DINING, price: 180, mats: { estructura: 'wood-walnut', asiento: 'leather-cognac' } }),
  pm('taburete-alto', 'Taburete alto de barra', 'chair', 'stool', [0.4, 0.75, 0.4], { sub: 'stool', styles: ['industrial', 'moderno'], rooms: KITCHEN, price: 85, mats: { estructura: 'metal-black', asiento: 'wood-oak' }, syn: ['bar stool'] }),
  pm('taburete-bajo', 'Taburete bajo de madera', 'chair', 'stool', [0.36, 0.46, 0.36], { sub: 'stool', styles: ['escandinavo', 'bohemio'], rooms: ANY, price: 60 }),
  pm('silla-oficina', 'Silla de oficina ergonómica', 'chair', 'office-chair', [0.62, 1.05, 0.62], { sub: 'office-chair', styles: ['moderno', 'minimalista'], rooms: OFFICE, price: 240, mats: { tapizado: 'fabric-charcoal' }, syn: ['office chair', 'silla giratoria'] }),

  // ------------------------------------------------------------------ mesas
  pm('mesa-comedor-roble', 'Mesa de comedor de roble 6 puestos', 'table', 'table', [1.8, 0.75, 0.9], { sub: 'dining-table', styles: ['escandinavo', 'minimalista'], rooms: DINING, price: 720 }),
  pm('mesa-comedor-nogal', 'Mesa de comedor de nogal', 'table', 'table', [2.0, 0.76, 1.0], { sub: 'dining-table', styles: ['clasico', 'moderno'], rooms: DINING, price: 980, mats: { cubierta: 'wood-walnut', patas: 'wood-walnut' } }),
  pm('mesa-caballete', 'Mesa de caballetes industrial', 'table', 'table', [1.8, 0.76, 0.9], { sub: 'dining-table', styles: ['industrial'], rooms: ['dining', 'office'], price: 640, params: { legs: 'trestle' }, mats: { cubierta: 'wood-teak', patas: 'metal-black' } }),
  pm('mesa-marmol', 'Mesa de comedor de mármol', 'table', 'table', [1.6, 0.75, 0.9], { sub: 'dining-table', styles: ['moderno', 'clasico'], rooms: DINING, price: 1450, mats: { cubierta: 'stone-marble-white', patas: 'metal-brass' } }),
  pm('mesa-redonda-roble', 'Mesa redonda de roble', 'table', 'table-round', [1.1, 0.75, 1.1], { sub: 'dining-table', styles: ['escandinavo', 'bohemio'], rooms: DINING, price: 560 }),
  pm('mesa-redonda-negra', 'Mesa redonda negra', 'table', 'table-round', [1.2, 0.75, 1.2], { sub: 'dining-table', styles: ['moderno', 'industrial'], rooms: DINING, price: 590, mats: { cubierta: 'wood-black', patas: 'metal-black' } }),
  pm('mesa-ovalada', 'Mesa ovalada de travertino', 'table', 'table-round', [1.8, 0.75, 1.0], { sub: 'dining-table', styles: ['minimalista', 'moderno'], rooms: DINING, price: 1290, mats: { cubierta: 'stone-travertine', patas: 'metal-brass' } }),
  pm('mesa-centro-roble', 'Mesa de centro de roble con balda', 'table', 'coffee-table', [1.1, 0.42, 0.6], { sub: 'coffee-table', styles: ['escandinavo', 'minimalista'], rooms: LIVING, price: 260 }),
  pm('mesa-centro-marmol', 'Mesa de centro de mármol', 'table', 'coffee-table', [1.2, 0.38, 0.65], { sub: 'coffee-table', styles: ['moderno', 'clasico'], rooms: LIVING, price: 540, params: { shelf: false }, mats: { cubierta: 'stone-marble-white', patas: 'metal-brass' } }),
  pm('mesa-centro-vidrio', 'Mesa de centro de vidrio', 'table', 'coffee-table', [1.0, 0.4, 0.55], { sub: 'coffee-table', styles: ['moderno', 'minimalista'], rooms: LIVING, price: 330, mats: { cubierta: 'glass-smoked', patas: 'metal-chrome' } }),
  pm('mesa-auxiliar-redonda', 'Mesa auxiliar redonda', 'table', 'table-round', [0.45, 0.55, 0.45], { sub: 'side-table', styles: ALL_STYLES, rooms: ['living', 'bedroom'], price: 120, params: { legs: 'tripod' }, syn: ['side table', 'mesita'] }),
  pm('mesa-noche-roble', 'Mesa de noche de roble', 'table', 'nightstand', [0.48, 0.55, 0.4], { sub: 'nightstand', styles: ['escandinavo', 'minimalista'], rooms: BED, price: 150, syn: ['velador', 'mesita de luz', 'bedside table'] }),
  pm('mesa-noche-blanca', 'Mesa de noche blanca 2 cajones', 'table', 'nightstand', [0.45, 0.6, 0.38], { sub: 'nightstand', styles: ['minimalista', 'moderno'], rooms: BED, price: 130, mats: { cuerpo: 'plastic-white', frentes: 'plastic-white', patas: 'wood-oak' }, syn: ['velador', 'mesita de luz'] }),
  pm('mesa-noche-nogal', 'Mesa de noche de nogal', 'table', 'nightstand', [0.5, 0.52, 0.42], { sub: 'nightstand', styles: ['clasico', 'moderno'], rooms: BED, price: 190, mats: { cuerpo: 'wood-walnut', frentes: 'wood-walnut', tiradores: 'metal-brass' }, syn: ['velador'] }),
  pm('escritorio-roble', 'Escritorio de roble con cajonera', 'table', 'desk', [1.3, 0.75, 0.65], { sub: 'desk', styles: ['escandinavo', 'minimalista'], rooms: OFFICE, price: 420 }),
  pm('escritorio-metal', 'Escritorio industrial de metal', 'table', 'desk', [1.4, 0.75, 0.7], { sub: 'desk', styles: ['industrial', 'moderno'], rooms: OFFICE, price: 380, params: { legs: 'metal' }, mats: { cubierta: 'wood-teak', patas: 'metal-black' } }),

  // ------------------------------------------------------------------ dormitorio y almacenaje
  pm('cama-doble-lino', 'Cama doble tapizada en lino', 'bed', 'bed', [1.6, 1.05, 2.1], { styles: ['escandinavo', 'minimalista'], rooms: BED, price: 980, syn: ['cama matrimonial', 'double bed'] }),
  pm('cama-queen-terciopelo', 'Cama queen de terciopelo azul', 'bed', 'bed', [1.8, 1.2, 2.15], { styles: ['moderno', 'clasico'], rooms: BED, price: 1350, mats: { cabecero: 'fabric-velvet-blue', estructura: 'fabric-velvet-blue' }, syn: ['queen bed'] }),
  pm('cama-sencilla-roble', 'Cama sencilla de roble', 'bed', 'bed', [1.0, 0.9, 2.05], { styles: ['escandinavo', 'bohemio'], rooms: BED, price: 520, params: { headboard: 'wood' }, mats: { cabecero: 'wood-oak' }, syn: ['cama individual', 'single bed'] }),
  pm('cama-king-nogal', 'Cama king de nogal', 'bed', 'bed', [2.0, 1.1, 2.2], { styles: ['clasico', 'industrial'], rooms: BED, price: 1650, params: { headboard: 'wood' }, mats: { cabecero: 'wood-walnut', estructura: 'wood-walnut' }, syn: ['king bed'] }),
  pm('armario-2p', 'Armario de 2 puertas', 'storage', 'wardrobe', [1.0, 2.0, 0.6], { sub: 'wardrobe', styles: ['escandinavo', 'minimalista'], rooms: BED, price: 560, syn: ['closet', 'ropero', 'wardrobe'] }),
  pm('armario-3p-blanco', 'Armario blanco de 3 puertas con cajones', 'storage', 'wardrobe', [1.5, 2.1, 0.6], { sub: 'wardrobe', styles: ['minimalista', 'moderno'], rooms: BED, price: 790, mats: { cuerpo: 'plastic-white', frentes: 'plastic-white' }, syn: ['closet', 'ropero'] }),
  pm('armario-4p-nogal', 'Armario de nogal de 4 puertas', 'storage', 'wardrobe', [2.0, 2.2, 0.62], { sub: 'wardrobe', styles: ['clasico'], rooms: BED, price: 1190, mats: { cuerpo: 'wood-walnut', frentes: 'wood-walnut', tiradores: 'metal-brass' }, syn: ['closet', 'ropero'] }),
  pm('estanteria-roble', 'Estantería de roble', 'storage', 'bookshelf', [0.9, 1.8, 0.35], { sub: 'shelf', styles: ['escandinavo', 'minimalista'], rooms: ['living', 'office', 'bedroom'], price: 260, syn: ['librero', 'biblioteca', 'bookcase'] }),
  pm('estanteria-negra-alta', 'Estantería alta negra', 'storage', 'bookshelf', [0.8, 2.1, 0.32], { sub: 'shelf', styles: ['industrial', 'moderno'], rooms: ['living', 'office'], price: 290, mats: { cuerpo: 'metal-black' }, syn: ['librero'] }),
  pm('estanteria-baja', 'Estantería baja ancha', 'storage', 'bookshelf', [1.4, 0.9, 0.35], { sub: 'shelf', styles: ['escandinavo', 'bohemio'], rooms: ['living', 'office'], price: 210, syn: ['librero bajo'] }),
  pm('mueble-tv-roble', 'Mueble TV de roble', 'storage', 'tv-stand', [1.6, 0.5, 0.42], { sub: 'tv-stand', styles: ['escandinavo', 'minimalista'], rooms: LIVING, price: 340, syn: ['rack', 'tv stand'] }),
  pm('mueble-tv-negro', 'Mueble TV negro largo', 'storage', 'tv-stand', [2.0, 0.45, 0.4], { sub: 'tv-stand', styles: ['industrial', 'moderno'], rooms: LIVING, price: 380, mats: { cuerpo: 'wood-black', frentes: 'wood-black', patas: 'metal-black' }, syn: ['rack'] }),
  pm('aparador-roble', 'Aparador de roble', 'storage', 'sideboard', [1.6, 0.8, 0.45], { sub: 'sideboard', styles: ['escandinavo', 'clasico'], rooms: ['dining', 'living'], price: 620, syn: ['bufetera', 'credenza', 'sideboard'] }),
  pm('aparador-blanco', 'Aparador blanco lacado', 'storage', 'sideboard', [1.8, 0.75, 0.45], { sub: 'sideboard', styles: ['minimalista', 'moderno'], rooms: ['dining', 'living'], price: 690, mats: { cuerpo: 'plastic-white', frentes: 'plastic-white', tiradores: 'metal-brass' } }),
  pm('comoda-roble', 'Cómoda de 6 cajones', 'storage', 'dresser', [1.2, 0.85, 0.48], { sub: 'dresser', styles: ['escandinavo', 'clasico'], rooms: BED, price: 480, syn: ['cajonera', 'dresser'] }),
  pm('comoda-terracota', 'Cómoda terracota', 'storage', 'dresser', [1.0, 0.9, 0.45], { sub: 'dresser', styles: ['bohemio', 'moderno'], rooms: BED, price: 450, mats: { frentes: 'paint-terracotta', cuerpo: 'wood-oak' }, syn: ['cajonera'] }),

  // ------------------------------------------------------------------ cocina
  pm('cocina-modulo-bajo', 'Mueble bajo de cocina con encimera', 'kitchen', 'kitchen-base', [1.2, 0.9, 0.6], { sub: 'kitchen-base', styles: ['minimalista', 'moderno'], rooms: KITCHEN, price: 520, mats: { cuerpo: 'plastic-white', frentes: 'plastic-white' }, syn: ['gabinete de cocina', 'base cabinet'] }),
  pm('cocina-modulo-roble', 'Módulo de cocina de roble', 'kitchen', 'kitchen-base', [0.8, 0.9, 0.6], { sub: 'kitchen-base', styles: ['escandinavo', 'bohemio'], rooms: KITCHEN, price: 430, mats: { encimera: 'wood-oak' } }),
  pm('cocina-alacena', 'Alacena de pared', 'kitchen', 'kitchen-wall', [1.2, 0.7, 0.35], { sub: 'kitchen-wall', mount: 'wall', elev: 1.45, styles: ['minimalista', 'moderno'], rooms: KITCHEN, price: 360, mats: { cuerpo: 'plastic-white', frentes: 'plastic-white' }, syn: ['gabinete alto', 'wall cabinet'] }),
  pm('cocina-isla', 'Isla de cocina con barra', 'kitchen', 'kitchen-island', [1.8, 0.92, 0.95], { sub: 'kitchen-island', styles: ['moderno', 'minimalista'], rooms: KITCHEN, price: 1450, mats: { frentes: 'wood-black', encimera: 'stone-marble-white' }, syn: ['barra', 'island'] }),
  pm('nevera-inox', 'Nevera de acero inoxidable', 'kitchen', 'fridge', [0.7, 1.85, 0.68], { sub: 'fridge', styles: ALL_STYLES, rooms: KITCHEN, price: 1100, mats: { acabado: 'metal-chrome' }, syn: ['refrigerador', 'heladera', 'fridge'] }),
  pm('nevera-blanca', 'Nevera blanca', 'kitchen', 'fridge', [0.6, 1.7, 0.65], { sub: 'fridge', styles: ALL_STYLES, rooms: KITCHEN, price: 780, syn: ['refrigerador', 'heladera'] }),
  pm('estufa-horno', 'Estufa con horno', 'kitchen', 'stove', [0.6, 0.9, 0.6], { sub: 'stove', styles: ALL_STYLES, rooms: KITCHEN, price: 650, mats: { acabado: 'metal-chrome' }, syn: ['cocina', 'horno', 'stove', 'oven'] }),
  pm('fregadero', 'Fregadero con mueble', 'kitchen', 'sink-cabinet', [1.0, 1.15, 0.6], { sub: 'sink', styles: ALL_STYLES, rooms: KITCHEN, price: 560, mats: { cuerpo: 'plastic-white', frentes: 'plastic-white' }, syn: ['lavaplatos', 'sink'] }),

  // ------------------------------------------------------------------ baño
  pm('inodoro', 'Inodoro', 'bathroom', 'toilet', [0.38, 0.78, 0.66], { sub: 'toilet', styles: ALL_STYLES, rooms: BATH, price: 280, syn: ['sanitario', 'wc', 'toilet'] }),
  pm('lavamanos-roble', 'Lavamanos con mueble de roble', 'bathroom', 'vanity', [0.8, 1.05, 0.48], { sub: 'vanity', styles: ['escandinavo', 'minimalista'], rooms: BATH, price: 420, syn: ['lavabo', 'vanity'] }),
  pm('lavamanos-negro', 'Lavamanos con mueble negro', 'bathroom', 'vanity', [0.6, 1.0, 0.45], { sub: 'vanity', styles: ['industrial', 'moderno'], rooms: BATH, price: 390, mats: { cuerpo: 'wood-black', frentes: 'wood-black', metal: 'metal-black' }, syn: ['lavabo'] }),
  pm('banera', 'Bañera exenta', 'bathroom', 'bathtub', [1.7, 0.58, 0.75], { sub: 'bathtub', styles: ALL_STYLES, rooms: BATH, price: 1200, syn: ['tina', 'bathtub'] }),
  pm('ducha', 'Ducha con mampara', 'bathroom', 'shower', [0.9, 2.0, 0.9], { sub: 'shower', styles: ALL_STYLES, rooms: BATH, price: 680, syn: ['regadera', 'shower'] }),

  // ------------------------------------------------------------------ pared
  pm('espejo-redondo-laton', 'Espejo redondo con marco de latón', 'wall-decor', 'mirror', [0.7, 0.7, 0.03], { sub: 'mirror', mount: 'wall', elev: 1.2, styles: ['moderno', 'clasico', 'bohemio'], rooms: ANY, price: 160, params: { shape: 'round' }, mats: { estructura: 'metal-brass' }, syn: ['mirror'] }),
  pm('espejo-rect-roble', 'Espejo rectangular de roble', 'wall-decor', 'mirror', [0.6, 1.2, 0.03], { sub: 'mirror', mount: 'wall', elev: 0.9, styles: ['escandinavo', 'minimalista'], rooms: ANY, price: 140, syn: ['mirror'] }),
  pm('espejo-cuerpo-entero', 'Espejo de cuerpo entero negro', 'wall-decor', 'mirror', [0.5, 1.6, 0.03], { sub: 'mirror', mount: 'wall', elev: 0.25, styles: ['industrial', 'moderno'], rooms: BED, price: 190, mats: { estructura: 'metal-black' }, syn: ['espejo de pie', 'full length mirror'] }),
  pm('cuadro-mostaza', 'Cuadro abstracto mostaza', 'wall-decor', 'wall-art', [0.8, 0.6, 0.03], { sub: 'wall-art', mount: 'wall', elev: 1.3, styles: ['moderno', 'bohemio'], rooms: ANY, price: 90, syn: ['lamina', 'pintura', 'poster', 'art'] }),
  pm('cuadro-salvia', 'Cuadro grande verde salvia', 'wall-decor', 'wall-art', [1.2, 0.8, 0.035], { sub: 'wall-art', mount: 'wall', elev: 1.2, styles: ['escandinavo', 'minimalista'], rooms: ANY, price: 140, mats: { lienzo: 'paint-sage', estructura: 'wood-ash-white' }, syn: ['lamina', 'pintura'] }),
  pm('cuadro-vertical-azul', 'Cuadro vertical azul marino', 'wall-decor', 'wall-art', [0.5, 0.7, 0.03], { sub: 'wall-art', mount: 'wall', elev: 1.3, styles: ['moderno', 'clasico'], rooms: ANY, price: 80, mats: { lienzo: 'paint-navy', estructura: 'metal-brass' }, syn: ['lamina'] }),
  pm('repisa-roble', 'Repisa flotante de roble', 'wall-decor', 'wall-shelf', [0.8, 0.2, 0.22], { sub: 'wall-shelf', mount: 'wall', elev: 1.4, styles: ['escandinavo', 'minimalista'], rooms: ANY, price: 55, syn: ['estante', 'balda', 'shelf'] }),
  pm('repisa-larga-negra', 'Repisa larga negra', 'wall-decor', 'wall-shelf', [1.2, 0.2, 0.25], { sub: 'wall-shelf', mount: 'wall', elev: 1.5, styles: ['industrial', 'moderno'], rooms: ANY, price: 70, mats: { cuerpo: 'wood-black', metal: 'metal-black' }, syn: ['estante', 'balda'] }),
  pm('reloj-pared', 'Reloj de pared de roble', 'wall-decor', 'clock', [0.35, 0.35, 0.05], { sub: 'clock', mount: 'wall', elev: 1.6, styles: ['escandinavo', 'clasico'], rooms: ANY, price: 45, syn: ['clock'] }),
  pm('cortinas-lino', 'Cortinas de lino blanco', 'textile', 'curtains', [2.2, 2.4, 0.12], { sub: 'curtains', mount: 'wall', elev: 0, styles: ['escandinavo', 'minimalista'], rooms: ANY, price: 120, mats: { tejido: 'fabric-linen-white' }, syn: ['cortina', 'visillo', 'curtains'] }),
  pm('cortinas-terciopelo', 'Cortinas de terciopelo verde', 'textile', 'curtains', [2.6, 2.5, 0.15], { sub: 'curtains', mount: 'wall', elev: 0, styles: ['clasico', 'bohemio'], rooms: ANY, price: 210, params: { open: 0.2 }, mats: { tejido: 'fabric-velvet-green', metal: 'metal-brass' }, syn: ['cortina'] }),

  // ------------------------------------------------------------------ electrónica
  pm('tv-55', 'Televisor 55" de pared', 'electronics', 'tv', [1.23, 0.71, 0.06], { sub: 'tv', mount: 'wall', elev: 1.0, styles: ALL_STYLES, rooms: ['living', 'bedroom'], price: 520, syn: ['tele', 'pantalla', 'television', 'smart tv'] }),
  pm('tv-65-pie', 'Televisor 65" con pie', 'electronics', 'tv', [1.45, 0.9, 0.25], { sub: 'tv', mount: 'surface', styles: ALL_STYLES, rooms: LIVING, price: 790, params: { stand: true }, syn: ['tele', 'pantalla', 'television'] }),
  pm('tv-43', 'Televisor 43" de pared', 'electronics', 'tv', [0.97, 0.57, 0.06], { sub: 'tv', mount: 'wall', elev: 1.1, styles: ALL_STYLES, rooms: ['bedroom', 'office'], price: 330, syn: ['tele', 'pantalla'] }),

  // ------------------------------------------------------------------ iluminación
  pm('lampara-mesa-ceramica', 'Lámpara de mesa de cerámica', 'lighting', 'table-lamp', [0.32, 0.52, 0.32], { sub: 'table-lamp', mount: 'surface', styles: ['escandinavo', 'clasico', 'bohemio'], rooms: ['living', 'bedroom'], price: 75, mats: { base: 'ceramic-white' }, syn: ['velador', 'lampara de noche', 'table lamp', 'bedside lamp'] }),
  pm('lampara-mesa-laton', 'Lámpara de mesa de latón', 'lighting', 'table-lamp', [0.28, 0.48, 0.28], { sub: 'table-lamp', mount: 'surface', styles: ['moderno', 'clasico'], rooms: ['living', 'bedroom', 'office'], price: 95, params: { base: 'disc' }, mats: { base: 'metal-brass', pantalla: 'fabric-linen-sand' }, syn: ['velador', 'table lamp'] }),
  pm('lampara-mesa-terracota', 'Lámpara de mesa terracota', 'lighting', 'table-lamp', [0.34, 0.46, 0.34], { sub: 'table-lamp', mount: 'surface', styles: ['bohemio'], rooms: ['living', 'bedroom'], price: 70, mats: { base: 'ceramic-terracotta' }, syn: ['velador'] }),
  pm('lampara-escritorio', 'Lámpara de escritorio negra', 'lighting', 'desk-lamp', [0.18, 0.45, 0.4], { sub: 'desk-lamp', mount: 'surface', styles: ['industrial', 'moderno'], rooms: OFFICE, price: 60, mats: { pantalla: 'metal-black' }, syn: ['flexo', 'desk lamp'] }),
  pm('lampara-pie-lino', 'Lámpara de pie con pantalla de lino', 'lighting', 'floor-lamp', [0.45, 1.6, 0.45], { sub: 'floor-lamp', styles: ['escandinavo', 'minimalista', 'clasico'], rooms: ANY, price: 140, syn: ['lampara de piso', 'floor lamp'] }),
  pm('lampara-pie-negra', 'Lámpara de pie negra', 'lighting', 'floor-lamp', [0.4, 1.7, 0.4], { sub: 'floor-lamp', styles: ['industrial', 'moderno'], rooms: ANY, price: 160, mats: { pantalla: 'metal-black' }, syn: ['lampara de piso'] }),
  pm('colgante-domo-negro', 'Lámpara colgante domo negra', 'lighting', 'pendant', [0.45, 0.9, 0.45], { sub: 'pendant', mount: 'ceiling', styles: ['industrial', 'moderno'], rooms: ANY, price: 110, mats: { pantalla: 'metal-black' }, syn: ['lampara de techo', 'pendant'] }),
  pm('colgante-tambor-lino', 'Lámpara colgante tambor de lino', 'lighting', 'pendant', [0.5, 0.8, 0.5], { sub: 'pendant', mount: 'ceiling', styles: ['escandinavo', 'clasico'], rooms: ANY, price: 95, params: { shade: 'drum' }, syn: ['lampara de techo'] }),
  pm('colgante-laton', 'Lámpara colgante de latón', 'lighting', 'pendant', [0.35, 0.7, 0.35], { sub: 'pendant', mount: 'ceiling', styles: ['moderno', 'clasico'], rooms: ANY, price: 130, mats: { pantalla: 'metal-brass', base: 'metal-brass' }, syn: ['lampara de techo'] }),
  pm('aplique-negro', 'Aplique de pared negro', 'lighting', 'sconce', [0.2, 0.3, 0.22], { sub: 'sconce', mount: 'wall', elev: 1.6, styles: ['industrial', 'moderno'], rooms: ANY, price: 65, mats: { pantalla: 'metal-black' }, syn: ['lampara de pared', 'sconce'] }),
  pm('aplique-lino', 'Aplique de pared con pantalla de lino', 'lighting', 'sconce', [0.22, 0.32, 0.24], { sub: 'sconce', mount: 'wall', elev: 1.6, styles: ['escandinavo', 'clasico'], rooms: ANY, price: 70, mats: { base: 'metal-brass' }, syn: ['lampara de pared'] }),

  // ------------------------------------------------------------------ textiles y decoración
  pm('alfombra-lana-gris', 'Alfombra de lana gris', 'decor', 'rug', [2.0, 0.012, 1.4], { sub: 'rug', styles: ['escandinavo', 'minimalista'], rooms: ANY, price: 190, syn: ['tapete', 'rug', 'carpet'] }),
  pm('alfombra-redonda-terracota', 'Alfombra redonda terracota', 'decor', 'rug', [1.6, 0.012, 1.6], { sub: 'rug', styles: ['bohemio'], rooms: ANY, price: 160, params: { shape: 'round' }, mats: { tejido: 'fabric-terracotta' }, syn: ['tapete'] }),
  pm('alfombra-grande-crema', 'Alfombra grande crema', 'decor', 'rug', [3.0, 0.015, 2.0], { sub: 'rug', styles: ['minimalista', 'clasico'], rooms: ['living', 'dining'], price: 320, mats: { tejido: 'fabric-boucle-cream' }, syn: ['tapete'] }),
  pm('cojin-mostaza', 'Cojín mostaza', 'textile', 'cushion', [0.45, 0.45, 0.14], { sub: 'cushion', mount: 'surface', styles: ['bohemio', 'moderno'], rooms: ANY, price: 25, mats: { tejido: 'fabric-mustard' }, syn: ['almohadon', 'cushion', 'pillow'] }),
  pm('cojin-verde', 'Cojín de terciopelo verde', 'textile', 'cushion', [0.5, 0.5, 0.15], { sub: 'cushion', mount: 'surface', styles: ['moderno', 'clasico'], rooms: ANY, price: 30, mats: { tejido: 'fabric-velvet-green' }, syn: ['almohadon'] }),
  pm('planta-grande', 'Planta grande en maceta', 'decor', 'plant', [0.6, 1.4, 0.6], { sub: 'plant', styles: ALL_STYLES, rooms: ANY, price: 85, syn: ['monstera', 'plant'] }),
  pm('planta-mesa', 'Planta pequeña de mesa', 'decor', 'plant', [0.25, 0.35, 0.25], { sub: 'plant', mount: 'surface', styles: ALL_STYLES, rooms: ANY, price: 20, mats: { maceta: 'ceramic-white' }, syn: ['suculenta', 'plant'] }),
  pm('jarron-ceramica', 'Jarrón de cerámica', 'decor', 'vase', [0.18, 0.32, 0.18], { sub: 'vase', mount: 'surface', styles: ['escandinavo', 'minimalista', 'bohemio'], rooms: ANY, price: 35, syn: ['florero', 'vase'] }),
  pm('jarron-terracota', 'Jarrón grande terracota', 'decor', 'vase', [0.28, 0.5, 0.28], { sub: 'vase', styles: ['bohemio'], rooms: ANY, price: 55, mats: { ceramica: 'ceramic-terracotta' }, syn: ['florero'] }),
  pm('libros', 'Pila de libros', 'decor', 'books', [0.28, 0.12, 0.2], { sub: 'books', mount: 'surface', styles: ALL_STYLES, rooms: ANY, price: 30, syn: ['books'] }),
];
