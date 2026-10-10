import type { CatalogCategory, Mount } from '@interiores/shared-types';
import type { IconName } from '../../shared/ui/icon.component';

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

export const CATEGORY_ICONS: Record<CatalogCategory, IconName> = {
  sofa: 'sofa',
  table: 'table',
  chair: 'chair',
  bed: 'bed',
  storage: 'storage',
  lighting: 'lamp',
  decor: 'plant',
  kitchen: 'kitchen',
  bathroom: 'bath',
  'wall-decor': 'picture',
  textile: 'curtain',
  electronics: 'tv',
};

export const MOUNT_LABELS: Record<Mount, string> = {
  floor: 'Piso',
  wall: 'Pared',
  surface: 'Sobre muebles',
  ceiling: 'Techo',
};
