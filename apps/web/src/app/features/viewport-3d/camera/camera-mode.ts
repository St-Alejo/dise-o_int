import type * as THREE from 'three';

export type CameraModeId = 'orbit' | 'walk';

/** Dónde está la cámara, hacia dónde mira y con qué apertura. */
export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/**
 * Una forma de mover la cámara (patrón State). El director de cámara tiene siempre un modo
 * activo y le delega cada frame; cambiar de modo es cambiar de objeto, no un `if` repartido por
 * la escena.
 */
export interface CameraMode {
  readonly id: CameraModeId;
  /** Pose con la que el modo quiere empezar: la transición lleva la cámara hasta ahí. */
  entryPose(): CameraPose;
  /** La cámara ya está en la pose de entrada: el modo toma el control. */
  enter(): void;
  exit(): void;
  /** Avanza `dt` segundos; devuelve true si la cámara se movió (hay que dibujar). */
  update(dt: number): boolean;
}
