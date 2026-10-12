import * as THREE from 'three';

/** Campo de visión de la vista de órbita. */
export const ORBIT_FOV = 50;

/** Alto visible (en metros) con el que un cuarto visto desde arriba cabe entero en pantalla. */
export function planViewSpan(widthM: number, depthM: number, aspect: number, margin = 1.25): number {
  return Math.max(depthM, widthM / Math.max(aspect, 0.01)) * margin;
}

/**
 * La cámara del visor. Es una sola para todo (apuntar, etiquetas, controles, posprocesado), pero
 * puede proyectar de dos formas: en perspectiva, como siempre, o en ortográfica para la vista
 * cenital, donde las paredes no convergen y el cuarto se lee como un plano a escala.
 *
 * three decide cómo tratar una cámara por sus banderas `isPerspectiveCamera` e
 * `isOrthographicCamera` (el rayo del cursor, el zoom de los controles, la luz especular): al
 * cambiar de proyección se cambian también ellas, y nadie más necesita saber cuál está en uso.
 */
export class RoomCamera extends THREE.PerspectiveCamera {
  // Los controles de órbita leen estos bordes para desplazar una cámara ortográfica.
  left = -1;
  right = 1;
  top = 1;
  bottom = -1;
  /** Alto visible en metros cuando es ortográfica; null en perspectiva. */
  private span: number | null = null;

  get orthographic(): boolean {
    return !!this.span;
  }

  /** Pasa a ortográfica abarcando `spanM` metros de alto, o vuelve a perspectiva con null. */
  setOrthographic(spanM: number | null): void {
    this.span = spanM && spanM > 0 ? spanM : null;
    Object.assign(this, { isPerspectiveCamera: !this.span, isOrthographicCamera: !!this.span });
    // El zoom es de la vista ortográfica: en perspectiva cambiaría el campo de visión.
    this.zoom = 1;
    this.updateProjectionMatrix();
  }

  override updateProjectionMatrix(): void {
    // `span` aún no existe cuando el constructor de three llama aquí por primera vez.
    if (!this.span) return super.updateProjectionMatrix();
    this.top = this.span / 2;
    this.bottom = -this.top;
    this.right = this.top * this.aspect;
    this.left = -this.right;
    const z = this.zoom || 1;
    this.projectionMatrix.makeOrthographic(this.left / z, this.right / z, this.top / z, this.bottom / z, this.near, this.far, this.coordinateSystem);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  /**
   * A qué distancia vería ese punto, del mismo tamaño, una cámara de órbita. En perspectiva es la
   * distancia real; en ortográfica el tamaño no depende de ella, sino de cuánto abarca la vista.
   */
  apparentDistance(point: THREE.Vector3): number {
    if (!this.span) return this.position.distanceTo(point);
    return this.span / (this.zoom || 1) / (2 * Math.tan((ORBIT_FOV * Math.PI) / 360));
  }
}
