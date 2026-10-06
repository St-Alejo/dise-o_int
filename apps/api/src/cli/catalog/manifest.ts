/**
 * Catálogo curado de muebles de licencia abierta (§6.2 y §8.3 del documento).
 *
 * - `polyhaven`: modelos reales CC0 de https://polyhaven.com (sin atribución obligatoria,
 *   pero la damos igual). Se descargan en el seed y se optimizan (texturas WebP 512 px).
 * - `procedural`: modelos simples generados por código (siempre disponibles sin red).
 *   Cubren huecos del catálogo (camas modernas, alfombras, lámparas de pie) y son el
 *   respaldo si un modelo de Poly Haven no se puede descargar.
 *
 * El "link de compra" es una búsqueda de producto similar (capa de afiliados de la Fase 4).
 */
import type { CatalogCategory, CatalogSpec, Mount, RoomType, StyleId } from '@interiores/shared-types';

export type ProceduralKind =
  | 'bed-platform'
  | 'bed-upholstered'
  | 'rug'
  | 'floor-lamp'
  | 'desk'
  | 'bookshelf'
  | 'sofa-block'
  | 'coffee-table-block'
  | 'dining-table-block'
  | 'chair-block'
  | 'plant';

export interface ManifestEntry {
  id: string;
  name: string;
  category: CatalogCategory;
  subcategory?: string;
  styleTags: StyleId[];
  roomTypes: RoomType[];
  mount?: Mount;
  /** Palabras clave y sinónimos (es/en) para la búsqueda del catálogo. */
  tags?: string[];
  synonyms?: string[];
  description?: string;
  /** Personalización: rangos de tamaño, slots de material, receta, altura de pared... */
  spec?: CatalogSpec;
  price: number;
  searchQuery: string;
  source: { type: 'polyhaven'; asset: string } | { type: 'procedural'; kind: ProceduralKind; size: [number, number, number]; colors: string[] };
  /**
   * Giro (grados, eje Y) para que el frente del modelo mire a +Z como exige la convención.
   * Algunos modelos de Poly Haven vienen con el frente hacia ±X (ancho y profundidad cruzados).
   */
  yawDeg?: number;
  /** Respaldo procedural si la descarga falla. */
  fallback?: { kind: ProceduralKind; size: [number, number, number]; colors: string[] };
}

const ph = (asset: string) => ({ type: 'polyhaven' as const, asset });
const proc = (kind: ProceduralKind, size: [number, number, number], colors: string[]) => ({
  type: 'procedural' as const,
  kind,
  size,
  colors,
});

export const CATALOG_MANIFEST: ManifestEntry[] = [
  // ------------------------------------------------------------------ sofás
  { id: 'sofa-moderno-gris', name: 'Sofá moderno gris', category: 'sofa', styleTags: ['moderno', 'minimalista'], roomTypes: ['living'], price: 749, searchQuery: 'sofá moderno gris 3 puestos', source: ph('Sofa_01'), fallback: { kind: 'sofa-block', size: [1.6, 0.8, 0.8], colors: ['#8a8a8a'] } },
  { id: 'sofa-escandinavo', name: 'Sofá Chesterfield de cuero', category: 'sofa', styleTags: ['clasico', 'industrial'], roomTypes: ['living'], price: 899, searchQuery: 'sofá chesterfield cuero negro', source: ph('sofa_02'), fallback: { kind: 'sofa-block', size: [1.8, 0.7, 0.82], colors: ['#d8d2c4'] } },
  { id: 'sofa-grande-seccional', name: 'Sofá grande de 3 cuerpos', category: 'sofa', styleTags: ['moderno', 'clasico'], roomTypes: ['living'], price: 1290, searchQuery: 'sofá grande 3 cuerpos tapizado', source: ph('sofa_03'), fallback: { kind: 'sofa-block', size: [2.7, 1.1, 0.95], colors: ['#6b6258'] } },
  { id: 'sofa-madera-pintada', name: 'Sofá de madera pintada', category: 'sofa', styleTags: ['bohemio', 'clasico'], roomTypes: ['living'], price: 680, searchQuery: 'sofá banco madera rústico cojines', source: ph('painted_wooden_sofa'), fallback: { kind: 'sofa-block', size: [2.4, 1.2, 0.8], colors: ['#a0522d'] } },
  { id: 'sofa-nordico-claro', name: 'Sofá nórdico tela clara', category: 'sofa', styleTags: ['escandinavo', 'minimalista'], roomTypes: ['living'], price: 820, searchQuery: 'sofá nórdico tela beige patas madera', source: proc('sofa-block', [1.9, 0.8, 0.88], ['#e3dccf', '#c8a97e']) },
  { id: 'sofa-bloque-industrial', name: 'Sofá de cuero industrial', category: 'sofa', styleTags: ['industrial'], roomTypes: ['living'], price: 1150, searchQuery: 'sofá cuero marrón industrial', source: proc('sofa-block', [2.0, 0.78, 0.9], ['#5a3a26', '#1f1f1f']) },

  // ------------------------------------------------------------------ sillas y butacas
  { id: 'butaca-clasica', name: 'Butaca clásica tapizada', category: 'chair', subcategory: 'armchair', styleTags: ['clasico'], roomTypes: ['living', 'bedroom'], price: 420, searchQuery: 'butaca clásica tapizada', source: ph('ArmChair_01') },
  { id: 'butaca-verde', name: 'Butaca verde retro', category: 'chair', subcategory: 'armchair', styleTags: ['bohemio', 'moderno'], roomTypes: ['living', 'bedroom'], price: 310, searchQuery: 'butaca verde terciopelo retro', source: ph('GreenChair_01') },
  { id: 'butaca-mid-century', name: 'Butaca lounge mid-century', category: 'chair', subcategory: 'armchair', styleTags: ['moderno', 'escandinavo'], roomTypes: ['living', 'office'], price: 890, searchQuery: 'butaca lounge mid century cuero', source: ph('mid_century_lounge_chair') },
  { id: 'butaca-moderna', name: 'Butaca moderna minimal', category: 'chair', subcategory: 'armchair', styleTags: ['minimalista', 'moderno'], roomTypes: ['living', 'office'], price: 360, searchQuery: 'butaca moderna minimalista', source: ph('modern_arm_chair_01') },
  { id: 'mecedora', name: 'Mecedora de madera', category: 'chair', subcategory: 'armchair', styleTags: ['bohemio', 'clasico'], roomTypes: ['living', 'bedroom'], price: 260, searchQuery: 'mecedora madera', source: ph('Rockingchair_01') },
  { id: 'silla-comedor-escandinava', name: 'Silla de comedor escandinava', category: 'chair', subcategory: 'dining-chair', styleTags: ['escandinavo', 'minimalista', 'moderno'], roomTypes: ['dining', 'office'], price: 95, searchQuery: 'silla comedor madera escandinava', source: ph('dining_chair_02'), fallback: { kind: 'chair-block', size: [0.45, 0.95, 0.52], colors: ['#c8a97e'] } },
  { id: 'silla-madera-pintada', name: 'Silla de madera pintada', category: 'chair', subcategory: 'dining-chair', styleTags: ['bohemio', 'clasico'], roomTypes: ['dining'], price: 80, searchQuery: 'silla madera pintada vintage', source: ph('painted_wooden_chair_01'), fallback: { kind: 'chair-block', size: [0.45, 0.95, 0.52], colors: ['#7d8c7a'] } },
  { id: 'silla-industrial-metal', name: 'Silla industrial de metal', category: 'chair', subcategory: 'dining-chair', styleTags: ['industrial'], roomTypes: ['dining', 'office'], price: 70, searchQuery: 'silla metal industrial negra', source: proc('chair-block', [0.44, 0.86, 0.5], ['#2b2b2b', '#6b4f3a']) },
  { id: 'puf', name: 'Puf tapizado', category: 'chair', subcategory: 'ottoman', styleTags: ['bohemio', 'clasico', 'moderno'], roomTypes: ['living', 'bedroom'], price: 120, searchQuery: 'puf tapizado', source: ph('Ottoman_01') },

  // ------------------------------------------------------------------ mesas
  { id: 'mesa-centro-clasica', name: 'Mesa de centro clásica', category: 'table', subcategory: 'coffee-table', styleTags: ['clasico'], roomTypes: ['living'], price: 290, searchQuery: 'mesa de centro madera clásica', source: ph('CoffeeTable_01'), fallback: { kind: 'coffee-table-block', size: [1.4, 0.45, 0.8], colors: ['#6f4e37'] } },
  { id: 'mesa-centro-minimal', name: 'Mesa de centro minimalista', category: 'table', subcategory: 'coffee-table', styleTags: ['minimalista', 'moderno'], roomTypes: ['living'], price: 240, searchQuery: 'mesa de centro minimalista rectangular', source: ph('modern_coffee_table_01'), yawDeg: 90, fallback: { kind: 'coffee-table-block', size: [1.2, 0.39, 0.6], colors: ['#e0ddd6'] } },
  { id: 'mesa-centro-cuadrada', name: 'Mesa de centro cuadrada', category: 'table', subcategory: 'coffee-table', styleTags: ['escandinavo', 'moderno'], roomTypes: ['living'], price: 260, searchQuery: 'mesa de centro cuadrada madera clara', source: ph('modern_coffee_table_02'), fallback: { kind: 'coffee-table-block', size: [1.0, 0.37, 1.0], colors: ['#c8a97e'] } },
  { id: 'mesa-centro-industrial', name: 'Mesa de centro industrial', category: 'table', subcategory: 'coffee-table', styleTags: ['industrial'], roomTypes: ['living'], price: 210, searchQuery: 'mesa de centro industrial metal madera', source: ph('industrial_coffee_table'), fallback: { kind: 'coffee-table-block', size: [0.8, 0.64, 0.76], colors: ['#3b3533', '#8a5a44'] } },
  { id: 'mesa-centro-redonda', name: 'Mesa de centro redonda', category: 'table', subcategory: 'coffee-table', styleTags: ['escandinavo', 'bohemio'], roomTypes: ['living'], price: 230, searchQuery: 'mesa de centro redonda madera', source: ph('coffee_table_round_01') },
  { id: 'mesa-comedor-redonda', name: 'Mesa de comedor redonda', category: 'table', subcategory: 'dining-table', styleTags: ['escandinavo', 'bohemio', 'minimalista'], roomTypes: ['dining'], price: 420, searchQuery: 'mesa comedor redonda 4 personas madera', source: ph('round_wooden_table_02'), fallback: { kind: 'dining-table-block', size: [0.9, 0.75, 0.9], colors: ['#c8a97e'] } },
  { id: 'mesa-comedor-grande', name: 'Mesa de comedor grande', category: 'table', subcategory: 'dining-table', styleTags: ['clasico', 'industrial', 'moderno'], roomTypes: ['dining'], price: 780, searchQuery: 'mesa comedor rectangular 6 personas', source: ph('dining_table'), fallback: { kind: 'dining-table-block', size: [1.8, 0.76, 0.9], colors: ['#6f4e37'] } },
  { id: 'mesa-auxiliar', name: 'Mesa auxiliar', category: 'table', subcategory: 'side-table', styleTags: ['moderno', 'minimalista', 'escandinavo'], roomTypes: ['living', 'bedroom'], price: 85, searchQuery: 'mesa auxiliar pequeña', source: ph('side_table_01') },
  { id: 'mesa-noche-pintada', name: 'Mesita de noche pintada', category: 'table', subcategory: 'nightstand', styleTags: ['bohemio', 'escandinavo'], roomTypes: ['bedroom'], price: 110, searchQuery: 'mesita de noche madera pintada', source: ph('painted_wooden_nightstand') },
  { id: 'mesa-noche-clasica', name: 'Mesita de noche clásica', category: 'table', subcategory: 'nightstand', styleTags: ['clasico'], roomTypes: ['bedroom'], price: 180, searchQuery: 'mesita de noche clásica cajón', source: ph('ClassicNightstand_01') },
  { id: 'escritorio-metal', name: 'Escritorio de metal', category: 'table', subcategory: 'desk', styleTags: ['industrial', 'moderno'], roomTypes: ['office'], price: 390, searchQuery: 'escritorio metal oficina', source: ph('metal_office_desk'), fallback: { kind: 'desk', size: [1.6, 0.76, 0.75], colors: ['#8c8c8c'] } },
  { id: 'escritorio-madera', name: 'Escritorio de madera clara', category: 'table', subcategory: 'desk', styleTags: ['escandinavo', 'minimalista', 'moderno'], roomTypes: ['office', 'bedroom'], price: 260, searchQuery: 'escritorio madera clara nórdico', source: proc('desk', [1.2, 0.75, 0.6], ['#d9c3a0', '#ffffff']) },

  // ------------------------------------------------------------------ camas
  { id: 'cama-hierro', name: 'Cama de hierro vintage', category: 'bed', styleTags: ['industrial', 'clasico'], roomTypes: ['bedroom'], price: 520, searchQuery: 'cama hierro forjado vintage', source: ph('old_bed_frame'), fallback: { kind: 'bed-platform', size: [1.2, 1.1, 2.0], colors: ['#2b2b2b', '#f2efe8'] } },
  { id: 'cama-divan-vintage', name: 'Diván cama vintage', category: 'bed', styleTags: ['bohemio'], roomTypes: ['bedroom', 'living'], price: 610, searchQuery: 'diván cama vintage', source: ph('vintage_day_bed') },
  { id: 'cama-plataforma-nordica', name: 'Cama plataforma nórdica', category: 'bed', styleTags: ['escandinavo', 'minimalista'], roomTypes: ['bedroom'], price: 690, searchQuery: 'cama plataforma madera clara 150', source: proc('bed-platform', [1.6, 0.9, 2.1], ['#d9c3a0', '#f4efe6', '#b7c4b0']) },
  { id: 'cama-tapizada-moderna', name: 'Cama tapizada moderna', category: 'bed', styleTags: ['moderno', 'clasico'], roomTypes: ['bedroom'], price: 840, searchQuery: 'cama tapizada cabecero 160', source: proc('bed-upholstered', [1.7, 1.15, 2.15], ['#2f4858', '#efeae2', '#f26419']) },
  { id: 'cama-minimal-baja', name: 'Cama baja minimalista', category: 'bed', styleTags: ['minimalista', 'moderno'], roomTypes: ['bedroom'], price: 560, searchQuery: 'cama baja minimalista', source: proc('bed-platform', [1.5, 0.6, 2.05], ['#3c3c3c', '#f2f2f0', '#bfbcb6']) },

  // ------------------------------------------------------------------ almacenamiento
  { id: 'estanteria-escandinava', name: 'Estantería de pared', category: 'storage', subcategory: 'shelf', styleTags: ['escandinavo', 'minimalista'], roomTypes: ['living', 'office', 'bedroom'], price: 190, searchQuery: 'estantería madera clara', source: ph('Shelf_01'), fallback: { kind: 'bookshelf', size: [1.0, 2.0, 0.3], colors: ['#d9c3a0'] } },
  { id: 'estanteria-industrial', name: 'Estantería industrial de acero', category: 'storage', subcategory: 'shelf', styleTags: ['industrial'], roomTypes: ['living', 'office', 'dining'], price: 240, searchQuery: 'estantería industrial metal madera', source: ph('steel_frame_shelves_01'), fallback: { kind: 'bookshelf', size: [1.1, 2.1, 0.5], colors: ['#2b2b2b', '#8a5a44'] } },
  { id: 'vitrina-bohemia', name: 'Vitrina de madera', category: 'storage', subcategory: 'shelf', styleTags: ['bohemio', 'clasico'], roomTypes: ['living', 'dining'], price: 330, searchQuery: 'vitrina madera vintage', source: ph('wooden_display_shelves_01'), yawDeg: 90 },
  { id: 'cajonera', name: 'Cajonera alta', category: 'storage', subcategory: 'dresser', styleTags: ['moderno', 'industrial'], roomTypes: ['bedroom', 'office'], price: 280, searchQuery: 'cajonera alta', source: ph('drawer_cabinet') },
  { id: 'mueble-tv', name: 'Mueble de TV largo', category: 'storage', subcategory: 'tv-stand', styleTags: ['minimalista', 'moderno', 'escandinavo'], roomTypes: ['living'], price: 450, searchQuery: 'mueble tv madera largo', source: ph('modern_wooden_cabinet') },
  { id: 'aparador-pintado', name: 'Aparador pintado', category: 'storage', subcategory: 'dresser', styleTags: ['bohemio', 'clasico'], roomTypes: ['dining', 'bedroom', 'living'], price: 380, searchQuery: 'aparador madera pintada', source: ph('painted_wooden_cabinet') },
  { id: 'librero-blanco', name: 'Librero blanco', category: 'storage', subcategory: 'shelf', styleTags: ['minimalista', 'moderno'], roomTypes: ['living', 'office', 'bedroom'], price: 150, searchQuery: 'librero blanco', source: proc('bookshelf', [0.8, 1.8, 0.3], ['#f2f2f0']) },

  // ------------------------------------------------------------------ iluminación
  { id: 'lampara-colgante-industrial', name: 'Lámpara colgante industrial', category: 'lighting', subcategory: 'pendant', styleTags: ['industrial'], roomTypes: ['living', 'dining', 'office'], mount: 'ceiling', price: 95, searchQuery: 'lámpara colgante industrial metal', source: ph('hanging_industrial_lamp') },
  { id: 'lampara-techo-moderna', name: 'Lámpara de techo moderna', category: 'lighting', subcategory: 'pendant', styleTags: ['moderno', 'minimalista', 'escandinavo'], roomTypes: ['living', 'dining', 'bedroom', 'office'], mount: 'ceiling', price: 120, searchQuery: 'lámpara de techo moderna', source: ph('modern_ceiling_lamp_01') },
  { id: 'arana-clasica', name: 'Araña clásica', category: 'lighting', subcategory: 'pendant', styleTags: ['clasico'], roomTypes: ['living', 'dining', 'bedroom'], mount: 'ceiling', price: 260, searchQuery: 'lámpara araña clásica', source: ph('Chandelier_01') },
  { id: 'lampara-pie-arco', name: 'Lámpara de pie', category: 'lighting', subcategory: 'floor-lamp', styleTags: ['moderno', 'escandinavo', 'minimalista', 'bohemio'], roomTypes: ['living', 'bedroom', 'office'], price: 110, searchQuery: 'lámpara de pie', source: proc('floor-lamp', [0.4, 1.6, 0.4], ['#1f1f1f', '#f4efe6']) },
  { id: 'lampara-pie-industrial', name: 'Lámpara de pie industrial', category: 'lighting', subcategory: 'floor-lamp', styleTags: ['industrial', 'clasico'], roomTypes: ['living', 'office'], price: 130, searchQuery: 'lámpara de pie industrial', source: proc('floor-lamp', [0.4, 1.7, 0.4], ['#3b3533', '#b58a4c']) },

  // ------------------------------------------------------------------ decoración
  { id: 'planta-maceta', name: 'Planta en maceta', category: 'decor', subcategory: 'plant', styleTags: ['bohemio', 'escandinavo', 'moderno', 'minimalista', 'industrial', 'clasico'], roomTypes: ['living', 'bedroom', 'office', 'dining'], price: 45, searchQuery: 'planta interior maceta grande', source: ph('potted_plant_01'), fallback: { kind: 'plant', size: [0.5, 1.2, 0.5], colors: ['#b5651d', '#3a6b35'] } },
  { id: 'alfombra-nordica', name: 'Alfombra nórdica', category: 'decor', subcategory: 'rug', styleTags: ['escandinavo', 'minimalista'], roomTypes: ['living', 'bedroom'], price: 140, searchQuery: 'alfombra nórdica beige 160x230', source: proc('rug', [2.3, 0.01, 1.6], ['#e8e1d3']) },
  { id: 'alfombra-bohemia', name: 'Alfombra bohemia terracota', category: 'decor', subcategory: 'rug', styleTags: ['bohemio', 'clasico'], roomTypes: ['living', 'bedroom', 'dining'], price: 160, searchQuery: 'alfombra bohemia terracota', source: proc('rug', [2.3, 0.01, 1.6], ['#b5562d']) },
  { id: 'alfombra-industrial', name: 'Alfombra gris oscuro', category: 'decor', subcategory: 'rug', styleTags: ['industrial', 'moderno'], roomTypes: ['living', 'office', 'bedroom'], price: 120, searchQuery: 'alfombra gris oscuro', source: proc('rug', [2.0, 0.01, 1.4], ['#4a4a4a']) },
  { id: 'alfombra-moderna', name: 'Alfombra azul petróleo', category: 'decor', subcategory: 'rug', styleTags: ['moderno'], roomTypes: ['living', 'bedroom', 'dining'], price: 150, searchQuery: 'alfombra azul petróleo', source: proc('rug', [2.3, 0.01, 1.6], ['#2f4858']) },
];

export const shoppingUrl = (q: string) => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;
