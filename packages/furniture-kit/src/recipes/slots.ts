/** Slots de material reutilizados por las recetas (nombre visible + familias permitidas). */
import type { MaterialKind, MaterialSlot } from '@interiores/shared-types';

const slot = (id: string, label: string, def: string, kinds: MaterialKind[]): MaterialSlot => ({
  slot: id,
  label,
  default: def,
  allowedKinds: kinds,
});

export const SLOTS = {
  upholstery: slot('tapizado', 'Tapizado', 'fabric-linen-sand', ['fabric', 'leather']),
  legs: slot('patas', 'Patas', 'wood-oak', ['wood', 'metal']),
  frame: slot('estructura', 'Estructura', 'wood-oak', ['wood', 'metal']),
  seat: slot('asiento', 'Asiento', 'wood-oak', ['wood', 'fabric', 'leather', 'plastic']),
  body: slot('cuerpo', 'Cuerpo', 'wood-oak', ['wood', 'plastic', 'metal']),
  fronts: slot('frentes', 'Frentes', 'wood-oak', ['wood', 'plastic', 'metal', 'glass']),
  handles: slot('tiradores', 'Tiradores', 'metal-black', ['metal', 'wood']),
  top: slot('cubierta', 'Cubierta', 'wood-oak', ['wood', 'stone', 'glass', 'ceramic']),
  countertop: slot('encimera', 'Encimera', 'stone-marble-white', ['stone', 'wood', 'ceramic']),
  bedding: slot('ropa-cama', 'Ropa de cama', 'fabric-linen-white', ['fabric']),
  headboard: slot('cabecero', 'Cabecero', 'fabric-linen-sand', ['fabric', 'leather', 'wood']),
  metal: slot('metal', 'Metal', 'metal-chrome', ['metal']),
  ceramic: slot('ceramica', 'Cerámica', 'ceramic-white', ['ceramic', 'stone']),
  glass: slot('vidrio', 'Vidrio', 'glass-clear', ['glass']),
  shade: slot('pantalla', 'Pantalla', 'fabric-linen-white', ['fabric', 'glass', 'metal', 'plastic']),
  base: slot('base', 'Base', 'metal-black', ['metal', 'wood', 'ceramic', 'stone']),
  textile: slot('tejido', 'Tejido', 'fabric-wool-grey', ['fabric']),
  pot: slot('maceta', 'Maceta', 'ceramic-terracotta', ['ceramic', 'stone', 'plastic']),
  foliage: slot('follaje', 'Follaje', 'plant-green', ['plant']),
  screen: slot('pantalla-tv', 'Pantalla', 'plastic-black', ['plastic', 'glass']),
  canvas: slot('lienzo', 'Lienzo', 'fabric-mustard', ['fabric', 'paint']),
  appliance: slot('acabado', 'Acabado', 'metal-white', ['metal', 'plastic']),
} as const;
