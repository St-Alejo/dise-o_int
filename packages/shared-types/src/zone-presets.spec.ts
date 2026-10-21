import { describe, expect, it } from 'vitest';
import { createRectangularShell, validateRoomShell } from './geometry.js';
import { DEFAULT_FINISHES, assertValidFinishes } from './materials.js';
import { moveWall } from './room-edit.js';
import { BATHROOM_PRESETS, addPrivateBathroom, removeZone, setZonePreset } from './zone-presets.js';
import { zoneArea } from './zones.js';

describe('baño privado en un clic', () => {
  const room = createRectangularShell(4.5, 4, 2.6);

  it('cada tipo de baño usa acabados válidos para su superficie', () => {
    for (const preset of BATHROOM_PRESETS) {
      expect(() => assertValidFinishes({ ...DEFAULT_FINISHES, zones: { z: preset.finishes } }, ['z']), preset.id).not.toThrow();
    }
  });

  it('añade la zona en un rincón, con sus acabados, y se puede quitar', () => {
    const { shell, finishes, zone } = addPrivateBathroom(room, DEFAULT_FINISHES, 'spa-marmol');
    expect(() => validateRoomShell(shell)).not.toThrow();
    expect(zone.name).toBe('Baño privado');
    expect(zoneArea(zone)).toBeCloseTo(2.2 * 1.7);
    expect(finishes.zones?.[zone.id]?.floor).toBe('stone-marble-white');
    const again = setZonePreset(finishes, zone.id, 'industrial');
    expect(again.zones?.[zone.id]?.floor).toBe('stone-microcement');
    const gone = removeZone(shell, again, zone.id);
    expect(gone.shell.zones).toBeUndefined();
    expect(gone.finishes.zones).toBeUndefined();
  });

  it('en un cuarto chico prueba un baño menor; si no cabe ni el mínimo, lo explica', () => {
    const small = createRectangularShell(3.2, 3, 2.6);
    const { zone } = addPrivateBathroom(small, DEFAULT_FINISHES);
    expect(zoneArea(zone)).toBeLessThanOrEqual((3.2 * 3) / 2);
    expect(() => addPrivateBathroom(createRectangularShell(2.2, 2, 2.6), DEFAULT_FINISHES)).toThrow(/rincón/);
  });

  it('al mover una pared, la zona se queda en su sitio dentro del cuarto', () => {
    const { shell, zone } = addPrivateBathroom(room, DEFAULT_FINISHES);
    // La pared izquierda (x = 0) hacia fuera corre todo el cuarto: la zona va con él.
    const left = shell.walls.find((w) => Math.abs(w.start.x) < 1e-6 && Math.abs(w.end.x) < 1e-6)!;
    const edit = moveWall(shell, left.id, 0.5);
    const moved = edit.shell.zones![0]!;
    expect(moved.outline[0]!.x).toBeCloseTo(zone.outline[0]!.x + edit.shift.x);
    expect(() => validateRoomShell(edit.shell)).not.toThrow();
  });
});
