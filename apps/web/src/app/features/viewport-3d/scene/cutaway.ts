/** Lo que hace falta saber de una pared para decidir si estorba: por dónde mira y dónde está. */
export interface WallFace {
  /** Normal hacia el interior del cuarto, en planta (`y` es la Z del mundo). */
  normal: { x: number; y: number };
  midpoint: { x: number; z: number };
}

/**
 * Una pared estorba cuando la cámara la ve por su cara de fuera: queda entre el ojo y el cuarto.
 * Esas paredes se dibujan en corte (un murete con tapa), como en una maqueta.
 */
export function hidesRoom(wall: WallFace, camera: { x: number; z: number }): boolean {
  return wall.normal.x * (camera.x - wall.midpoint.x) + wall.normal.y * (camera.z - wall.midpoint.z) < 0;
}
