import type { CatalogCategory, Mount } from '@interiores/shared-types';

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  sofa: 'Sofás',
  table: 'Mesas',
  chair: 'Sillas',
  bed: 'Camas',
  storage: 'Almacenaje',
  lighting: 'Luz',
  decor: 'Deco',
  kitchen: 'Cocina',
  bathroom: 'Baño',
  'wall-decor': 'Pared',
  textile: 'Textiles',
  electronics: 'Electrónica',
};

export const CATEGORY_ICONS: Record<CatalogCategory, string> = {
  sofa: '🛋️',
  table: '🪵',
  chair: '🪑',
  bed: '🛏️',
  storage: '🗄️',
  lighting: '💡',
  decor: '🪴',
  kitchen: '🍳',
  bathroom: '🛁',
  'wall-decor': '🖼️',
  textile: '🧶',
  electronics: '📺',
};

export const MOUNT_LABELS: Record<Mount, string> = {
  floor: 'Piso',
  wall: 'Pared',
  surface: 'Sobre muebles',
  ceiling: 'Techo',
};
