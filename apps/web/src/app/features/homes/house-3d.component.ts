import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { CatalogItem } from '@interiores/shared-types';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ApiError } from '../../core/api/api-error';
import type { Plano3dHouse } from '../../core/api/plano3d.api';
import { CatalogApi } from '../../core/api/projects.api';
import { HouseView } from '../viewport-3d/scene/house-view';
import { TextureLibrary } from '../viewport-3d/scene/texture-library';
import { HouseData } from './house-data';

interface Label {
  roomId: string;
  name: string;
  furnishable: boolean;
  x: number;
  y: number;
}

/**
 * La casa de Plano 3D en 3D, un piso a la vez: muros, puertas, ventanas, acabados y muebles de
 * cada cuarto, sin techo, para mirarla desde arriba. Tocar un cuarto amueblable lo abre en el
 * editor (con sus vecinos alrededor).
 */
@Component({
  selector: 'app-house-3d',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage" #stage>
      <canvas
        #canvas
        aria-label="Casa en 3D. Arrastra para girarla; toca un cuarto para amueblarlo."
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        (pointerleave)="hover(null)"
      ></canvas>
      @for (l of labels(); track l.roomId) {
        <span class="tag" [class.service]="!l.furnishable" [class.on]="l.roomId === hovered()" [style.left.px]="l.x" [style.top.px]="l.y">{{ l.name }}</span>
      }
      @if (status(); as s) {
        <p class="status" [class.error]="s.error" role="status">{{ s.text }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .stage {
      position: relative;
      height: min(62vh, 620px);
      overflow: hidden;
      background: linear-gradient(#eef1f4, #dfe4e8);
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      cursor: grab;
    }
    canvas.pointing {
      cursor: pointer;
    }
    .tag {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 2px 8px;
      border-radius: 999px;
      background: rgb(255 255 255 / 0.88);
      color: var(--text);
      font-size: var(--text-xs, 12px);
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
    }
    .tag.service {
      background: rgb(255 255 255 / 0.6);
      color: var(--text-muted);
      font-weight: 500;
    }
    .tag.on {
      background: var(--primary);
      color: #fff;
    }
    .status {
      position: absolute;
      inset: auto 0 0 0;
      margin: 0;
      padding: var(--space-2) var(--space-3);
      background: rgb(255 255 255 / 0.9);
      font-size: var(--text-sm);
    }
    .status.error {
      color: var(--danger);
    }
  `,
})
export class House3dComponent {
  /** Vivienda enlazada con Plano 3D. */
  readonly homeId = input.required<string>();
  /** Índice del piso que se muestra. */
  readonly level = input(0);
  /** Se tocó un cuarto amueblable: su proyecto. */
  readonly openRoom = output<string>();

  private readonly data = inject(HouseData);
  private readonly catalogApi = inject(CatalogApi);
  private readonly zone = inject(NgZone);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');

  protected readonly labels = signal<Label[]>([]);
  protected readonly hovered = signal<string | null>(null);
  protected readonly status = signal<{ text: string; error: boolean } | null>({ text: 'Cargando la casa…', error: false });

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private house: HouseView | null = null;
  private textures: TextureLibrary | null = null;
  private sun = new THREE.DirectionalLight('#fff6e8', 2.2);
  private readonly raycaster = new THREE.Raycaster();
  private needsRender = true;
  private frame = 0;
  private press: { x: number; y: number } | null = null;
  private model: Plano3dHouse | null = null;
  private catalog: ReadonlyMap<string, CatalogItem> = new Map();
  private framedLevel: number | null = null;
  private loadToken = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (!this.start()) return;
      void this.load();
    });
    effect(() => {
      const level = this.level();
      untracked(() => void this.showLevel(level));
    });
    destroyRef.onDestroy(() => this.dispose());
  }

  // ------------------------------------------------------------------ escena
  private start(): boolean {
    const canvas = this.canvas().nativeElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      this.status.set({ text: 'Tu navegador no puede mostrar 3D. Usa la planta 2D.', error: true });
      return false;
    }
    const renderer = this.renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#f4f7ff', '#b9ab98', 0.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    const ctx = { scene: this.scene, camera: this.camera, invalidate: () => (this.needsRender = true) };
    this.textures = new TextureLibrary(() => ctx.invalidate());
    void this.textures.load();
    this.house = new HouseView(ctx, this.textures, 'auto');

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.addEventListener('change', () => {
      this.house?.updateCutaway();
      this.needsRender = true;
    });

    const resize = new ResizeObserver(() => this.resize());
    resize.observe(this.stage().nativeElement);
    this.resize();
    this.zone.runOutsideAngular(() => {
      const loop = () => {
        this.frame = requestAnimationFrame(loop);
        const moved = this.controls?.update() ?? false;
        if (!moved && !this.needsRender) return;
        this.needsRender = false;
        this.renderer?.render(this.scene, this.camera);
        this.placeLabels();
      };
      loop();
    });
    this.disposers.push(() => resize.disconnect());
    return true;
  }

  private readonly disposers: (() => void)[] = [];

  private resize(): void {
    const el = this.stage().nativeElement;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private async load(): Promise<void> {
    try {
      const [house, catalog] = await Promise.all([this.data.byHome(this.homeId()), this.catalogApi.all()]);
      if (!house) {
        this.status.set({ text: 'Esta vivienda no está enlazada con Plano 3D.', error: true });
        return;
      }
      this.model = house;
      this.catalog = new Map(catalog.map((c) => [c.id, c]));
      await this.showLevel(this.level());
    } catch (err) {
      this.status.set({ text: `No se pudo cargar la casa. ${ApiError.from(err).userMessage}`, error: true });
    }
  }

  private async showLevel(index: number): Promise<void> {
    const model = this.model;
    if (!model || !this.house) return;
    const level = model.levels.find((l) => l.index === index) ?? model.levels[0];
    if (!level) return;
    const token = ++this.loadToken;
    this.status.set({ text: `Cargando ${level.name}…`, error: false });
    const rooms = await this.data.rooms(level);
    if (token !== this.loadToken || !this.house) return;
    this.house.sync(rooms, this.catalog);
    if (this.framedLevel !== level.index) {
      this.frameHouse();
      this.framedLevel = level.index;
    }
    this.status.set(rooms.length ? null : { text: 'Este piso no tiene ambientes.', error: false });
    this.needsRender = true;
  }

  /** Cámara en diagonal, alta, que abarca todo el piso; el sol cubre la casa entera. */
  private frameHouse(): void {
    const box = this.house!.bounds();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.62 + 1.5;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.9;
    this.camera.position.set(center.x + dist * 0.45, dist * 0.82, center.z + dist * 0.55);
    this.controls?.target.copy(center);
    this.controls?.update();
    const cam = this.sun.shadow.camera;
    const half = Math.max(size.x, size.z) / 2 + 2;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = half * 6;
    cam.updateProjectionMatrix();
    this.sun.position.set(center.x - half * 0.8, half * 2.2, center.z - half * 0.6);
    this.sun.target.position.copy(center);
    this.house!.updateCutaway();
    this.needsRender = true;
  }

  private placeLabels(): void {
    const el = this.stage().nativeElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const v = new THREE.Vector3();
    const labels = (this.house?.labels() ?? []).flatMap((l) => {
      v.copy(l.at).setY(0.2).project(this.camera);
      if (v.z > 1) return [];
      return [{ roomId: l.roomId, name: l.name, furnishable: !!l.projectId, x: Math.round(((v.x + 1) / 2) * w), y: Math.round(((1 - v.y) / 2) * h) }];
    });
    this.zone.run(() => this.labels.set(labels));
  }

  // ------------------------------------------------------------------ puntero
  protected down(e: PointerEvent): void {
    this.press = { x: e.clientX, y: e.clientY };
  }

  protected move(e: PointerEvent): void {
    if (e.buttons) return;
    this.hover(this.pickAt(e.clientX, e.clientY)?.roomId ?? null);
  }

  protected up(e: PointerEvent): void {
    const press = this.press;
    this.press = null;
    // un arrastre gira la casa; solo un toque abre el cuarto
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) return;
    const room = this.pickAt(e.clientX, e.clientY);
    if (room?.projectId) {
      this.data.forget(this.model?.linkId);
      this.openRoom.emit(room.projectId);
    }
  }

  protected hover(roomId: string | null): void {
    const room = roomId ? this.house?.labels().find((l) => l.roomId === roomId) : null;
    const id = room?.projectId ? roomId : null;
    this.hovered.set(id);
    this.house?.setHover(id);
    this.canvas().nativeElement.classList.toggle('pointing', !!id);
  }

  private pickAt(clientX: number, clientY: number) {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    if (!rect.width || !this.house) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.house.pick(this.raycaster);
  }

  private dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const off of this.disposers) off();
    this.controls?.dispose();
    this.house?.dispose();
    this.textures?.dispose();
    this.scene.environment?.dispose();
    this.renderer?.dispose();
  }
}
