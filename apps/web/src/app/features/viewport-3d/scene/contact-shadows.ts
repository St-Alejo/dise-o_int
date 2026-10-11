import type { Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';

const SIZE = 128;
/** Parte del dibujo que ocupa el borde difuminado, a cada lado. */
const FEATHER = 0.24;
/** Metros que la sombra asoma alrededor del mueble. */
const SPREAD_M = 0.16;
/** Justo encima de donde se apoya (y de una alfombra): evita que parpadee contra el piso. */
const LIFT_M = 0.024;

/** Mancha oscura de bordes suaves, en la huella del mueble. */
function blobTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const inset = SIZE * FEATHER;
  // Varias pasadas, cada una más pequeña y más oscura: el borde se desvanece hacia fuera.
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const pad = inset * k;
    ctx.fillStyle = `rgba(0,0,0,${0.035 + 0.05 * k})`;
    ctx.beginPath();
    ctx.roundRect(pad, pad, SIZE - pad * 2, SIZE - pad * 2, inset * (1.1 - k * 0.6));
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Sombras de contacto: una mancha suave bajo cada mueble apoyado. Es el truco barato de la
 * oclusión ambiental (el piso se oscurece donde algo lo toca) sin posprocesado. Flyweight: una
 * sola textura, una sola geometría y un solo material para todas.
 */
export class ContactShadows {
  private texture: THREE.Texture | null | undefined;
  private material: THREE.MeshBasicMaterial | null = null;
  private readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  /** Mancha para un mueble de esas medidas, en sus coordenadas locales (null si no hay canvas). */
  create(dims: Vector3): THREE.Mesh | null {
    if (this.texture === undefined) this.texture = blobTexture();
    if (!this.texture) return null;
    this.material ??= new THREE.MeshBasicMaterial({ map: this.texture, color: '#1a120b', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = 'contact-shadow';
    mesh.scale.set(dims.x + SPREAD_M * 2, 1, dims.z + SPREAD_M * 2);
    mesh.position.y = LIFT_M;
    mesh.renderOrder = 1;
    // Es un adorno: ni se señala con el cursor ni da sombra.
    mesh.raycast = () => undefined;
    return mesh;
  }

  dispose(): void {
    this.texture?.dispose();
    this.material?.dispose();
    this.geometry.dispose();
    this.texture = undefined;
    this.material = null;
  }
}
