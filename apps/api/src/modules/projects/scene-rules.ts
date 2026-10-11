import {
  assertValidFinishes,
  clampDimensions,
  clampToRoom,
  defaultResizeRanges,
  effectiveDimensions,
  type FurniturePlacement,
  mountY,
  ROOM_LIMITS,
  type RoomFinishes,
  RoomGeometryError,
  type RoomShell,
  UnknownMaterialError,
  validateRoomShell,
  type Vector3,
} from '@interiores/shared-types';
import { ValidationError } from '../../common/errors.js';
import type { CatalogRecord, ICatalogRepository } from '../../ports/index.js';

/**
 * Lo que el servidor exige de una escena antes de guardarla, venga de donde venga: una planta
 * posible, acabados que existen y muebles del catálogo, con sus medidas en rango y dentro del cuarto.
 */
export class SceneRules {
  constructor(private readonly catalog: ICatalogRepository) {}

  /**
   * Planta editada en el editor: del cliente solo se acepta la geometría (paredes, aberturas, la
   * caja que las envuelve y el alto). El id y la confianza de la escala siguen siendo los guardados.
   */
  editedShell(current: RoomShell, edited: RoomShell): RoomShell {
    const { shape: _shape, ...kept } = current;
    const next: RoomShell = {
      ...kept,
      widthM: edited.widthM,
      depthM: edited.depthM,
      heightM: edited.heightM,
      walls: edited.walls,
      openings: edited.openings,
      ...(edited.shape ? { shape: edited.shape } : {}),
    };
    const { minSideM, maxSideM, minHeightM, maxHeightM } = ROOM_LIMITS;
    if (Math.min(next.widthM, next.depthM) < minSideM || Math.max(next.widthM, next.depthM) > maxSideM) {
      throw new ValidationError(`El cuarto debe medir entre ${minSideM} y ${maxSideM} m de lado`);
    }
    if (next.heightM < minHeightM || next.heightM > maxHeightM) {
      throw new ValidationError(`El alto del cuarto debe estar entre ${minHeightM} y ${maxHeightM} m`);
    }
    try {
      validateRoomShell(next);
    } catch (err) {
      if (err instanceof RoomGeometryError) throw new ValidationError(err.message);
      throw err;
    }
    return next;
  }

  validateFinishes(finishes: RoomFinishes): void {
    try {
      assertValidFinishes(finishes);
    } catch (err) {
      if (err instanceof UnknownMaterialError) throw new ValidationError(err.message);
      throw err;
    }
  }

  /**
   * Defensa en profundidad: aunque el editor ya evita salirse del cuarto, el servidor
   * valida que el catálogo exista, acota las medidas propias a los rangos del catálogo, fija la
   * altura según el montaje (piso, techo, pared o sobre otro mueble) y mete dentro del cuarto
   * cualquier mueble fuera de límites.
   */
  async sanitizePlacements(shell: RoomShell, placements: FurniturePlacement[]): Promise<FurniturePlacement[]> {
    const ids = new Set<string>();
    for (const p of placements) {
      if (ids.has(p.id)) throw new ValidationError(`Id de mueble repetido: ${p.id}`);
      ids.add(p.id);
    }
    const catalog = new Map<string, CatalogRecord>(
      (await this.catalog.findByIds(placements.map((p) => p.catalogItemId))).map((i) => [i.id, i]),
    );
    const unknown = placements.filter((p) => !catalog.has(p.catalogItemId)).map((p) => p.catalogItemId);
    if (unknown.length) throw new ValidationError(`Muebles inexistentes en el catálogo: ${[...new Set(unknown)].join(', ')}`);

    const itemOf = (p: FurniturePlacement) => catalog.get(p.catalogItemId)!;
    const catalogDims = (p: FurniturePlacement): Vector3 => {
      const item = itemOf(p);
      return { x: item.widthM, y: item.heightM, z: item.depthM };
    };
    const twoPi = Math.PI * 2;
    const wallIds = new Set(shell.walls.map((w) => w.id));

    // 1) Medidas, rotación y referencias (no dependen de los demás muebles).
    const sized = placements.map((p): FurniturePlacement => {
      const item = itemOf(p);
      const base = catalogDims(p);
      const { dimensionsM, supportId, wallId, elevationM, ...rest } = p;
      const isWall = item.mount === 'wall';
      return {
        ...rest,
        rotationY: ((p.rotationY % twoPi) + twoPi) % twoPi,
        ...(dimensionsM ? { dimensionsM: clampDimensions(dimensionsM, base, item.spec?.resize ?? defaultResizeRanges(base)) } : {}),
        // Un soporte inexistente (o el propio mueble) no sirve: el objeto cae al piso.
        ...(item.mount === 'surface' && supportId && supportId !== p.id && ids.has(supportId) ? { supportId } : {}),
        ...(isWall && wallId && wallIds.has(wallId) ? { wallId } : {}),
        ...(isWall && elevationM !== undefined ? { elevationM } : {}),
      };
    });

    // 2) Posición y altura: lo que va sobre una superficie necesita el tope de su soporte.
    const byId = new Map(sized.map((p) => [p.id, p]));
    const baseY = (p: FurniturePlacement): number => {
      const item = itemOf(p);
      // Un soporte que a su vez está sobre otro conserva su altura declarada (sin recursión).
      if (item.mount === 'surface') return Math.max(0, p.position.y);
      return mountY(item.mount, effectiveDimensions(catalogDims(p), p), shell, {
        elevationM: p.elevationM,
        elevationDefaultM: item.spec?.elevationDefaultM,
      });
    };
    return sized.map((p) => {
      const item = itemOf(p);
      const dims = effectiveDimensions(catalogDims(p), p);
      const clamped = clampToRoom(p.position, dims, p.rotationY, shell);
      const support = p.supportId ? byId.get(p.supportId) : undefined;
      const supportTopY = support ? baseY(support) + effectiveDimensions(catalogDims(support), support).y : undefined;
      const y = mountY(item.mount, dims, shell, {
        elevationM: p.elevationM,
        elevationDefaultM: item.spec?.elevationDefaultM,
        supportTopY,
      });
      return { ...p, position: { ...clamped, y } };
    });
  }
}
