import type * as THREE from 'three';
import type { StudioHost } from '../viewport-3d/scene.service';
import type { StudioView } from './studio-camera';

/** Lo que un motor necesita para dibujar: quién dibuja, qué escena y desde qué cámara. */
export interface EngineContext {
  host: StudioHost;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  view: StudioView;
}

/**
 * Motor de render (patrón Strategy): el estudio no sabe si la imagen sale del trazado de rayos o del
 * raster; solo prepara, pide pasadas hasta llegar a las muestras y recoge la imagen.
 */
export interface RenderEngine {
  /** Prepara lo que haga falta (estructura de aceleración, materiales); puede tardar. */
  prepare(ctx: EngineContext, onProgress?: (fraction: number) => void): Promise<void>;
  /** Una pasada más; devuelve las muestras acumuladas hasta ahora. */
  step(): number;
  /** Deja la imagen final lista (con el filtro de ruido si el motor lo tiene). */
  finish(): void;
  /**
   * La imagen tal como va, en un lienzo 2D propio (se puede leer en cualquier momento). Con `into`
   * reutiliza ese lienzo en vez de crear uno.
   */
  snapshot(into?: HTMLCanvasElement): HTMLCanvasElement;
  /**
   * ¿La imagen va saliendo de verdad? Algunas combinaciones de GPU y navegador compilan el trazador
   * pero acumulan negro; el estudio lo comprueba tras las primeras pasadas y cambia de motor.
   */
  healthy?(): boolean;
  dispose(): void;
}

/** El trazado de rayos no da imagen en esta GPU: el estudio repite el render en raster. */
export class EngineUnsupportedError extends Error {
  constructor() {
    super('el trazado de rayos acumula negro en esta GPU');
    this.name = 'EngineUnsupportedError';
  }
}

/** ¿Hay luz en estos píxeles RGBA? Negro absoluto en todos o algún NaN = el motor no funciona. */
export function hasSignal(values: ArrayLike<number>): boolean {
  let any = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) return false;
    if (i % 4 !== 3 && v > 0) any = true;
  }
  return any;
}

/**
 * Copia lo que acaba de dibujarse en la pantalla del renderer a un lienzo 2D. Se lee el framebuffer
 * con readPixels en el mismo instante: drawImage de un lienzo WebGL sin preserveDrawingBuffer
 * no es fiable en todos los navegadores (en Chrome con D3D11 devuelve la imagen vacía).
 */
export function readScreen(renderer: THREE.WebGLRenderer, into?: HTMLCanvasElement): HTMLCanvasElement {
  renderer.setRenderTarget(null);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const pixels = new Uint8ClampedArray(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // WebGL lee de abajo arriba y la imagen va de arriba abajo; además es opaca (el alfa no cuenta).
  const out = new Uint8ClampedArray(w * h * 4);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const canvas = into ?? document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  canvas.getContext('2d')?.putImageData(new ImageData(out, w, h), 0, 0);
  return canvas;
}

/** Secuencia de Halton (base 2 y 3): desplazamientos de subpíxel que reparten bien las muestras. */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * Raster de alta calidad (respaldo sin WebGL2 o con poca GPU, y motor del vídeo): la mejor calidad
 * del visor, con cada cuadro desplazado una fracción de píxel y promediado. Suaviza bordes y la
 * oclusión ambiental sin necesidad de trazar rayos.
 */
export class RasterEngine implements RenderEngine {
  private ctx: EngineContext | null = null;
  private accum: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private frame: HTMLCanvasElement | null = null;
  private samples = 0;

  async prepare(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    ctx.host.prepare(ctx.view.width, ctx.view.height, true);
    this.accum = document.createElement('canvas');
    this.accum.width = ctx.view.width;
    this.accum.height = ctx.view.height;
    this.g = this.accum.getContext('2d');
    this.samples = 0;
  }

  step(): number {
    const ctx = this.ctx;
    if (!ctx || !this.g) return this.samples;
    const { view, camera } = ctx;
    const n = this.samples + 1;
    const jx = halton(n, 2) - 0.5;
    const jy = halton(n, 3) - 0.5;
    camera.setViewOffset(view.width, view.height, jx, (-view.shiftY * view.height) / 2 + jy, view.width, view.height);
    ctx.host.paint();
    this.frame = readScreen(ctx.host.renderer, this.frame ?? undefined);
    // Media móvil: el cuadro n pesa 1/n, así la imagen siempre es el promedio de lo dibujado.
    this.g.globalAlpha = 1 / n;
    this.g.drawImage(this.frame, 0, 0);
    this.samples = n;
    return n;
  }

  finish(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { view, camera } = ctx;
    if (view.shiftY) camera.setViewOffset(view.width, view.height, 0, (-view.shiftY * view.height) / 2, view.width, view.height);
    else camera.clearViewOffset();
  }

  snapshot(into?: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = into ?? document.createElement('canvas');
    if (!this.accum) return canvas;
    if (canvas.width !== this.accum.width || canvas.height !== this.accum.height) Object.assign(canvas, { width: this.accum.width, height: this.accum.height });
    canvas.getContext('2d')?.drawImage(this.accum, 0, 0);
    return canvas;
  }

  dispose(): void {
    this.finish();
    this.accum = null;
    this.frame = null;
    this.g = null;
    this.ctx = null;
  }
}

/** ¿Puede este navegador trazar rayos? Hace falta WebGL2 con texturas de coma flotante renderizables. */
export function supportsPathTracing(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  return isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
}

/** El motor pedido; el trazado de rayos va en un chunk aparte que solo se baja al usarlo. */
export async function createEngine(id: 'pathtracer' | 'raster'): Promise<RenderEngine> {
  if (id === 'raster') return new RasterEngine();
  const { PathTracerEngine } = await import('./pathtracer-engine');
  return new PathTracerEngine();
}
