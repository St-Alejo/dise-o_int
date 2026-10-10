import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  input,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneService } from './scene.service';

/**
 * Viewport 3D como "caja negra" aislada (§5 del documento):
 * 1. El render loop corre FUERA de la zona de Angular (runOutsideAngular) y solo dibuja
 *    cuando algo cambió (render bajo demanda): Angular nunca se entera de los frames.
 * 2. Todo el estado sale vía SceneService (signals); este componente solo posee el canvas.
 * 3. En ngOnDestroy se libera TODA la memoria GPU (geometrías, materiales, texturas,
 *    render targets y el contexto WebGL): la causa nº1 de fugas en Angular + Three.js.
 */
@Component({
  selector: 'app-three-viewport',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      #canvas
      tabindex="0"
      role="application"
      aria-label="Vista 3D del cuarto. Arrastra para mover muebles; flechas para desplazar el seleccionado, R para rotar, Supr para quitar."
      (pointerdown)="scene.onPointerDown($event)"
      (pointermove)="scene.onPointerMove($event)"
      (pointerup)="scene.onPointerUp($event)"
      (pointercancel)="scene.onPointerUp($event)"
      (keydown)="onKey($event)"
    ></canvas>
    @if (contextLost()) {
      <div class="overlay" role="alert">
        <p>La vista 3D se detuvo (el navegador liberó la GPU).</p>
        <button class="btn btn-primary" type="button" (click)="reload()">Recargar vista</button>
      </div>
    } @else if (!scene.sceneReady()) {
      <div class="overlay" aria-live="polite">Preparando el modelo 3D…</div>
    }
    @if (scene.invalidDrop()) {
      <div class="hint" role="status">Aquí choca con otro mueble: al soltar volverá a su última posición válida</div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 320px;
      border-radius: var(--radius);
      overflow: hidden;
      background: #e9e3da;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      outline: none;
    }
    canvas:focus-visible {
      box-shadow: inset 0 0 0 3px var(--focus);
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      gap: 12px;
      text-align: center;
      color: var(--text-muted);
      background: color-mix(in srgb, var(--bg) 70%, transparent);
    }
    .hint {
      position: absolute;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      background: var(--danger);
      color: #fff;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.85rem;
      box-shadow: var(--shadow);
    }
  `,
})
export class ThreeViewportComponent implements AfterViewInit, OnDestroy {
  readonly scene = inject(SceneService);
  private readonly store = inject(DesignProjectStore);
  private readonly zone = inject(NgZone);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly readOnly = input(false);
  readonly contextLost = signal(false);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private frameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.scene.readOnly.set(this.readOnly());
    const canvas = this.canvasRef().nativeElement;
    this.scene.canvas = canvas;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      this.contextLost.set(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const controls = new OrbitControls(this.scene.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49; // no atravesar el piso
    controls.minDistance = 1;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => this.scene.invalidate());
    this.controls = controls;
    this.scene.controls = controls;
    this.scene.attachRenderer(renderer);
    this.scene.frameRoom();

    canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height, false);
      this.scene.setSize(width, height);
    });
    this.resizeObserver.observe(this.host.nativeElement);

    if (isDevMode()) {
      // Criterio de la Fase 0: permite comprobar fugas desde la consola (entrar/salir del 3D).
      (window as unknown as { __threeInfo?: THREE.WebGLInfo }).__threeInfo = renderer.info;
    }

    // Resumen de la escena para las pruebas e2e (cuántas paredes, si hay techo…), sin comparar píxeles.
    Object.defineProperty(window, '__scene', { configurable: true, get: () => this.scene.snapshot() });

    // Todo el loop vive fuera de Angular: ningún frame dispara detección de cambios.
    this.zone.runOutsideAngular(() => {
      let last = performance.now();
      const loop = (now: number) => {
        this.frameId = requestAnimationFrame(loop);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        if (this.scene.tick(dt)) renderer.render(this.scene.scene, this.scene.camera);
      };
      loop(last);
    });
  }

  onKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.25 : 0.05;
    const handled: Record<string, () => void> = {
      ArrowLeft: () => this.scene.nudgeSelected(-step, 0),
      ArrowRight: () => this.scene.nudgeSelected(step, 0),
      ArrowUp: () => this.scene.nudgeSelected(0, -step),
      ArrowDown: () => this.scene.nudgeSelected(0, step),
      r: () => this.scene.rotateSelected(Math.PI / 12),
      R: () => this.scene.rotateSelected(-Math.PI / 12),
      Delete: () => this.scene.removeSelected(),
      Backspace: () => this.scene.removeSelected(),
      Escape: () => this.store.select(null),
    };
    const action = handled[event.key];
    if (action && (this.store.selected() || event.key === 'Escape')) {
      event.preventDefault();
      action();
    }
  }

  reload(): void {
    location.reload();
  }

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.zone.run(() => this.contextLost.set(true));
  };

  ngOnDestroy(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    delete (window as { __scene?: unknown }).__scene;
    this.resizeObserver?.disconnect();
    this.canvasRef().nativeElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.controls?.dispose();
    this.scene.controls = null;
    this.scene.canvas = null;
    void this.scene.dispose();
    this.renderer?.renderLists.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
