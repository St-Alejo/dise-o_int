import type { RoomFinishes, RoomShell } from '@interiores/shared-types';
import { applyFinishes, buildRoom, disposeObject, type BuiltRoom } from '../room-builder';
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

  /** Recorte tipo "casa de muñecas": las paredes entre la cámara y el cuarto se vuelven translúcidas. */
  updateCutaway(): void {
    if (!this.room) return;
    const cam = this.ctx.camera.position;
    for (const wall of this.room.walls) {
      const toCamX = cam.x - wall.midpoint.x;
      const toCamZ = cam.z - wall.midpoint.z;
      const facingAway = this.cutaway && wall.normal.x * toCamX + wall.normal.y * toCamZ < 0;
      for (const m of wall.materials) {
        const base = (m.userData['baseOpacity'] as number | undefined) ?? 1;
        const target = facingAway ? Math.min(base, 0.1) : base;
        if (m.opacity !== target) {
          m.opacity = target;
          m.depthWrite = target === 1;
          m.needsUpdate = true;
        }
      }
    }
    this.ctx.invalidate();
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
