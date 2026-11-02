import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { DenoiseMaterial, WebGLPathTracer } from 'three-gpu-pathtracer';
import { hasSignal, readScreen, type EngineContext, type RenderEngine } from './engines';
import { splitMultiMaterialMeshes } from './split-meshes';

/** Rebotes de luz: con seis, un cuarto con ventanas ya se ilumina bien por dentro. */
const BOUNCES = 6;

/**
 * Trazado de rayos en la GPU (three-gpu-pathtracer) sobre la misma escena del visor: luz rebotada,
 * sombras suaves, reflejos y el cielo entrando por las ventanas. Cada pasada suma una muestra por
 * píxel; al final, un filtro bilateral quita el ruido que queda.
 */
export class PathTracerEngine implements RenderEngine {
  private tracer: WebGLPathTracer | null = null;
  private ctx: EngineContext | null = null;
  /** Lo que se enseña: la acumulación tal cual mientras se calcula, con el filtro de ruido al final. */
  private display: FullScreenQuad | null = null;

  async prepare(ctx: EngineContext, onProgress?: (fraction: number) => void): Promise<void> {
    this.ctx = ctx;
    ctx.host.prepare(ctx.view.width, ctx.view.height, false);
    const tracer = new WebGLPathTracer(ctx.host.renderer);
    tracer.renderDelay = 0;
    tracer.fadeDuration = 0;
    tracer.minSamples = 1;
    tracer.rasterizeScene = false;
    // La imagen la pinta este motor (y la lee enseguida): así no depende de cuándo se presenta el lienzo.
    tracer.renderToCanvas = false;
    tracer.dynamicLowRes = false;
    tracer.renderScale = 1;
    tracer.bounces = BOUNCES;
    tracer.transmissiveBounces = 8;
    tracer.filterGlossyFactor = 0.5;
    tracer.multipleImportanceSampling = true;
    // En 4K, dibujar por teselas evita que una sola pasada se coma la GPU (y que el navegador la corte).
    const pixels = ctx.view.width * ctx.view.height;
    const tiles = pixels > 6e6 ? 3 : pixels > 2.5e6 ? 2 : 1;
    tracer.tiles.set(tiles, tiles);
    this.tracer = tracer;
    this.display = new FullScreenQuad(new THREE.MeshBasicMaterial({ map: tracer.target.texture, blending: THREE.NoBlending, depthTest: false, depthWrite: false }));
    // La estructura de aceleración se construye de una vez (un cuarto son pocos cientos de miles de
    // triángulos: menos de un segundo). Antes se cede un cuadro para que se vea "Preparando…".
    onProgress?.(0.1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // La librería da el índice de material por malla: las mallas con varios materiales (paredes,
    // zócalos, algunos muebles) descolocan los de todas las demás. Se parten mientras se lee la escena.
    const unsplit = splitMultiMaterialMeshes(ctx.scene);
    try {
      tracer.setScene(ctx.scene, ctx.camera);
    } finally {
      unsplit();
    }
    onProgress?.(1);
  }

  step(): number {
    const tracer = this.tracer;
    if (!tracer) return 0;
    tracer.renderSample();
    return Math.floor(tracer.samples);
  }

  finish(): void {
    const tracer = this.tracer;
    if (!tracer || !this.display) return;
    const material = new DenoiseMaterial({ map: tracer.target.texture, blending: THREE.NoBlending, premultipliedAlpha: false });
    // Un filtro suave: el ruido de un render largo ya es poco y no conviene borrar texturas finas.
    material.sigma = 2.5;
    material.threshold = 0.08;
    (this.display.material as THREE.Material).dispose();
    this.display.material = material;
  }

  /** Lee cinco bloques pequeños del acumulado (centro y cuatro cuartos): con luz en alguno, va bien. */
  healthy(): boolean {
    const tracer = this.tracer;
    const renderer = this.ctx?.host.renderer;
    if (!tracer || !renderer) return false;
    const t = tracer.target;
    const size = 8;
    const buf = new Float32Array(size * size * 4);
    const spots = [
      [0.5, 0.5],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ] as const;
    let lit = false;
    for (const [fx, fy] of spots) {
      renderer.readRenderTargetPixels(t, Math.floor(t.width * fx) - size / 2, Math.floor(t.height * fy) - size / 2, size, size, buf);
      for (const v of buf) if (Number.isNaN(v)) return false;
      if (hasSignal(buf)) lit = true;
    }
    return lit;
  }

  snapshot(into?: HTMLCanvasElement): HTMLCanvasElement {
    const renderer = this.ctx!.host.renderer;
    // El trazador alterna entre dos destinos en cada pasada: hay que leer el de ahora.
    if (this.display && this.tracer) (this.display.material as THREE.MeshBasicMaterial).map = this.tracer.target.texture;
    renderer.setRenderTarget(null);
    this.display?.render(renderer);
    return readScreen(renderer, into);
  }

  dispose(): void {
    if (this.display) {
      (this.display.material as THREE.Material).dispose();
      this.display.dispose();
    }
    this.tracer?.dispose();
    this.display = null;
    this.tracer = null;
    this.ctx = null;
  }
}
