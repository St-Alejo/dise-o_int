import type { RoomFinishes, RoomShell } from '@interiores/shared-types';
import { applyFinishes, buildRoom, disposeObject, type BuiltRoom } from '../room-builder';
import { hidesRoom } from './cutaway';
import type { SceneContext } from './render-loop';
import { TextureLibrary } from './texture-library';

/** El cuarto en la escena: lo reconstruye al cambiar, lo pinta y recorta las paredes que estorban. */
export class RoomView {
  private room: BuiltRoom | null = null;
  /** El recorte solo tiene sentido mirando desde fuera; al recorrer el cuarto las paredes van enteras. */
  private cutaway = true;
  private readonly textures = new TextureLibrary();

  constructor(private readonly ctx: SceneContext) {}

  get wallCount(): number {
    return this.room?.walls.length ?? 0;
  }

  get hasCeiling(): boolean {
    return !!this.room?.group.getObjectByName('ceiling');
  }

  /** Reconstruye el cuarto (o lo quita si `shell` es null). */
  sync(shell: RoomShell | null): void {
    this.clear();
    if (!shell) return;
    this.room = buildRoom(shell);
    this.ctx.scene.add(this.room.group);
    this.updateCutaway();
  }

  applyFinishes(finishes: RoomFinishes): void {
    if (!this.room) return;
    applyFinishes(this.room, finishes, this.textures);
    this.ctx.invalidate();
  }

  /** Activa o desactiva el recorte de paredes y lo aplica de inmediato. */
  setCutaway(enabled: boolean): void {
    this.cutaway = enabled;
    this.updateCutaway();
  }

  /**
   * Dentro del cuarto el techo da sombra, y el sol solo entra por las ventanas. Mirando desde fuera
   * no: el cuarto se ve sin techo y quedaría a oscuras.
   */
  setCeilingShadow(enabled: boolean): void {
    if (!this.room || this.room.ceiling.castShadow === enabled) return;
    this.room.ceiling.castShadow = enabled;
    this.ctx.invalidate();
  }

  /**
   * Corte tipo "casa de muñecas": las paredes entre la cámara y el cuarto se ven cortadas a ras
   * de suelo, con tapa. La pared entera deja de dibujarse pero sigue en la escena, así que su
   * sombra no cambia al girar la cámara.
   */
  updateCutaway(): void {
    if (!this.room) return;
    const cam = this.ctx.camera.position;
    let changed = false;
    for (const wall of this.room.walls) {
      const cut = this.cutaway && hidesRoom(wall, cam);
      if (wall.cut === cut) continue;
      wall.cut = cut;
      wall.stub.visible = cut;
      for (const m of wall.materials) {
        m.colorWrite = !cut;
        m.depthWrite = !cut && m.userData['baseDepthWrite'] !== false;
      }
      // Los pases de posprocesado (oclusión, contorno) ignoran lo que está marcado así.
      for (const g of wall.groups) g.userData['ghost'] = cut;
      changed = true;
    }
    if (changed) this.ctx.invalidate();
  }

  dispose(): void {
    this.clear();
    this.textures.dispose();
  }

  private clear(): void {
    if (!this.room) return;
    this.ctx.scene.remove(this.room.group);
    disposeObject(this.room.group);
    this.room = null;
  }
}
