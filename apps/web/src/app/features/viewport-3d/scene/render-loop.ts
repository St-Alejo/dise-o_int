import type * as THREE from 'three';

/** Lo que comparten las piezas de la escena: dónde dibujan y cómo piden un frame. */
export interface SceneContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Render bajo demanda: marca que hay algo nuevo que dibujar. */
  invalidate(): void;
}

/**
 * Algo que avanza con el tiempo (una cámara que camina, una transición). El bucle lo llama en
 * cada frame con los segundos transcurridos; devuelve true si cambió algo visible.
 */
export interface FrameSystem {
  update(dt: number): boolean;
}
