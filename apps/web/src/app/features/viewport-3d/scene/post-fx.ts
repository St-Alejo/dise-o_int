import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { Highlighter } from './render-loop';

export interface PostFxSettings {
  /** Oclusión ambiental: oscurece rincones y el piso bajo los muebles. */
  ao: boolean;
  /** Píxeles por punto de pantalla con los que se dibuja. */
  pixelRatio: number;
}

const COLOR = { select: '#35b3a6', invalid: '#e53935', hover: '#ffffff' };
/** Nombres de lo que es ayuda de edición y no geometría del cuarto: no proyecta oclusión. */
const HELPERS = ['gizmo', 'guides'];

/**
 * Los pases que redibujan la escena con su propio material no saben qué es ayuda de edición ni
 * qué pared está en corte: se les esconde mientras trabajan. Devuelve cómo dejarlo como estaba.
 */
function hideExtras(scene: THREE.Scene): () => void {
  const hidden: THREE.Object3D[] = [];
  for (const name of HELPERS) {
    const helper = scene.getObjectByName(name);
    if (helper?.visible) hidden.push(helper);
  }
  for (const part of scene.getObjectByName('room')?.children ?? []) {
    if (part.visible && part.userData['ghost']) hidden.push(part);
  }
  for (const o of hidden) o.visible = false;
  return () => {
    for (const o of hidden) o.visible = true;
  };
}

/** La oclusión se calcula sin las ayudas: un tirador no oscurece la pared de atrás. */
class RoomAoPass extends GTAOPass {
  override render(...args: Parameters<GTAOPass['render']>): void {
    const restore = hideExtras(this.scene);
    super.render(...args);
    restore();
  }
}

/** El contorno se ve a través de una pared en corte, que no tapa nada. */
class RoomOutlinePass extends OutlinePass {
  override render(...args: Parameters<OutlinePass['render']>): void {
    if (!this.selectedObjects.length) return;
    const restore = hideExtras(this.renderScene);
    super.render(...args);
    restore();
  }
}

/**
 * El contorno de three se suma a la imagen, y sobre una pared blanca no se ve. Se cambia a
 * mezcla normal (color premultiplicado), que sí se distingue sobre claro y sobre oscuro.
 */
function outlinePass(size: THREE.Vector2, scene: THREE.Scene, camera: THREE.Camera, color: string, strength: number): OutlinePass {
  const pass = new RoomOutlinePass(size, scene, camera);
  pass.visibleEdgeColor.set(color);
  pass.hiddenEdgeColor.set(color).multiplyScalar(0.35);
  pass.edgeStrength = strength;
  pass.edgeThickness = 1;
  pass.enabled = false;
  const material = pass.overlayMaterial;
  const clamped = material.fragmentShader.replace('gl_FragColor = finalColor;', 'gl_FragColor = clamp(finalColor, 0.0, 1.0);');
  if (clamped !== material.fragmentShader) {
    material.fragmentShader = clamped;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.needsUpdate = true;
  }
  return pass;
}

/**
 * Posprocesado del visor: oclusión ambiental y contorno de lo seleccionado y de lo que está bajo
 * el cursor. Se carga aparte (`import()`), así que el visor pinta sin él hasta que llega.
 */
export class PostFx implements Highlighter {
  private readonly composer: EffectComposer;
  private readonly ao: RoomAoPass;
  private readonly selected: OutlinePass;
  private readonly hovered: OutlinePass;
  private orthographic = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    settings: PostFxSettings,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    // El antialias del canvas no llega a los pases: se pide en el destino del compositor.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new RoomAoPass(scene, camera, size.x, size.y);
    // Radio de un cuarto, no de una maqueta: la penumbra llega a unos 40 cm del rincón.
    this.ao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 0.9;
    this.composer.addPass(this.ao);
    this.hovered = outlinePass(size, scene, camera, COLOR.hover, 2.2);
    this.selected = outlinePass(size, scene, camera, COLOR.select, 4);
    this.composer.addPass(this.hovered);
    this.composer.addPass(this.selected);
    this.composer.addPass(new OutputPass());
    this.configure(settings);
  }

  get aoEnabled(): boolean {
    return this.ao.enabled;
  }

  configure(settings: PostFxSettings): void {
    this.ao.enabled = settings.ao;
    this.composer.setPixelRatio(settings.pixelRatio);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  setSelection(objects: readonly THREE.Object3D[], invalid = false): void {
    this.selected.selectedObjects = [...objects];
    this.selected.enabled = objects.length > 0;
    const color = invalid ? COLOR.invalid : COLOR.select;
    this.selected.visibleEdgeColor.set(color);
    this.selected.hiddenEdgeColor.set(color).multiplyScalar(0.35);
  }

  setHover(objects: readonly THREE.Object3D[]): void {
    this.hovered.selectedObjects = [...objects];
    this.hovered.enabled = objects.length > 0;
  }

  render(): void {
    const orthographic = !!(this.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera;
    if (orthographic !== this.orthographic) this.setProjection(orthographic);
    this.composer.render();
  }

  /**
   * Los pases reconstruyen la profundidad con una fórmula distinta para cada proyección y la
   * eligen al crearse: si la cámara cambia (vista cenital), hay que recompilarlos.
   */
  private setProjection(orthographic: boolean): void {
    this.orthographic = orthographic;
    this.ao.gtaoMaterial.defines['PERSPECTIVE_CAMERA'] = orthographic ? 0 : 1;
    this.ao.gtaoMaterial.needsUpdate = true;
    const [from, to] = orthographic ? ['perspectiveDepthToViewZ', 'orthographicDepthToViewZ'] : ['orthographicDepthToViewZ', 'perspectiveDepthToViewZ'];
    for (const pass of [this.hovered, this.selected]) {
      const material = pass.prepareMaskMaterial;
      material.fragmentShader = material.fragmentShader.split(from).join(to);
      material.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
  }
}
