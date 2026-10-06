import { describe, expect, it } from 'vitest';
import {
  CalibrationError,
  calibrateRoomShell,
  checkScene,
  clampToRoom,
  createRectangularShell,
  footprint,
  footprintBounds,
  footprintsOverlap,
  isInsideRoom,
  scalePlacements,
  snapAngle,
} from './geometry.js';
import { RoomShellSchema } from './domain.js';
import { CreateProjectFieldsSchema, GenerateStylesRequestSchema } from './api.js';

const dims = { x: 2, y: 0.8, z: 1 };
const at = (x: number, z: number) => ({ x, y: 0, z });

describe('footprint', () => {
  it('sin rotación coincide con la caja alineada', () => {
    const b = footprintBounds(footprint(at(5, 5), dims, 0));
    expect(b).toEqual({ minX: 4, maxX: 6, minZ: 4.5, maxZ: 5.5 });
  });

  it('rotado 90° intercambia ancho y profundidad', () => {
    const b = footprintBounds(footprint(at(5, 5), dims, Math.PI / 2));
    expect(b.maxX - b.minX).toBeCloseTo(1);
    expect(b.maxZ - b.minZ).toBeCloseTo(2);
  });
});

describe('footprintsOverlap (SAT)', () => {
  it('detecta solape y separación', () => {
    const a = footprint(at(0, 0), dims, 0);
    expect(footprintsOverlap(a, footprint(at(1, 0), dims, 0))).toBe(true);
    expect(footprintsOverlap(a, footprint(at(3, 0), dims, 0))).toBe(false);
  });

  it('no confunde cajas rotadas cuyas AABB se tocan pero no se solapan', () => {
    const a = footprint(at(0, 0), { x: 1, y: 1, z: 1 }, Math.PI / 4);
    const b = footprint(at(1.3, 1.3), { x: 1, y: 1, z: 1 }, Math.PI / 4);
    expect(footprintsOverlap(a, b)).toBe(false);
  });

  it('tocarse de canto no cuenta como colisión', () => {
    const a = footprint(at(0, 0), dims, 0);
    expect(footprintsOverlap(a, footprint(at(2, 0), dims, 0))).toBe(false);
  });
});

describe('clampToRoom', () => {
  const shell = createRectangularShell(4, 3, 2.6);

  it('mete dentro un mueble que se sale', () => {
    const p = clampToRoom(at(-3, 10), dims, 0, shell);
    expect(isInsideRoom(footprint(p, dims, 0), shell)).toBe(true);
    expect(p).toEqual({ x: 1, y: 0, z: 2.5 });
  });

  it('no mueve un mueble que ya está dentro', () => {
    expect(clampToRoom(at(2, 1.5), dims, 0, shell)).toEqual(at(2, 1.5));
  });
});

describe('createRectangularShell', () => {
  it('produce un RoomShell válido según el schema', () => {
    const shell = createRectangularShell(4.2, 3.5, 2.6);
    expect(() => RoomShellSchema.parse(shell)).not.toThrow();
    expect(shell.walls).toHaveLength(4);
    expect(shell.openings.map((o) => o.type).sort()).toEqual(['door', 'window']);
  });
});

describe('calibrateRoomShell', () => {
  const shell = createRectangularShell(4, 3, 2.5, { scaleConfidence: 0.3 });

  it('reescala todo con el factor de la referencia y marca la escala como confiable', () => {
    const { shell: out, factor } = calibrateRoomShell(shell, 'ceiling-height', 2.75);
    expect(factor).toBeCloseTo(1.1);
    expect(out.widthM).toBeCloseTo(4.4);
    expect(out.depthM).toBeCloseTo(3.3);
    expect(out.walls[1]!.end.z).toBeCloseTo(3.3);
    expect(out.needsCalibration).toBe(false);
    expect(out.scaleConfidence).toBe(1);
  });

  it('usa la puerta como referencia', () => {
    const door = shell.openings.find((o) => o.type === 'door')!;
    const { factor } = calibrateRoomShell(shell, 'door-height', door.heightM * 2);
    expect(factor).toBeCloseTo(2);
  });

  it('rechaza factores absurdos y cuartos sin puerta', () => {
    expect(() => calibrateRoomShell(shell, 'room-width', 30)).toThrow(CalibrationError);
    const noDoor = createRectangularShell(4, 3, 2.5, { door: false });
    expect(() => calibrateRoomShell(noDoor, 'door-height', 2)).toThrow(CalibrationError);
  });

  it('scalePlacements escala x/z pero no la altura', () => {
    const [p] = scalePlacements(
      [{ id: 'a', catalogItemId: 'c', position: { x: 1, y: 0.5, z: 2 }, rotationY: 0, lockedByUser: false }],
      2,
    );
    expect(p!.position).toEqual({ x: 2, y: 0.5, z: 4 });
  });
});

describe('checkScene', () => {
  it('reporta muebles fuera del cuarto y solapados', () => {
    const shell = createRectangularShell(4, 3, 2.5);
    const mk = (id: string, x: number, z: number) => ({
      id,
      catalogItemId: 'sofa',
      position: at(x, z),
      rotationY: 0,
      lockedByUser: false,
    });
    const report = checkScene(shell, [mk('a', 1.2, 1), mk('b', 1.8, 1), mk('c', 3.9, 1)], () => dims);
    expect(report.outside).toEqual(['c']);
    expect(report.overlapping).toContainEqual(['a', 'b']);
  });
});

describe('snapAngle', () => {
  it('ajusta a 15° y normaliza a [0, 2π)', () => {
    expect(snapAngle(0.27)).toBeCloseTo(Math.PI / 12);
    expect(snapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
  });
});

describe('DTOs', () => {
  it('CreateProjectFields parsea la lista de estilos separada por comas', () => {
    const out = CreateProjectFieldsSchema.parse({ name: 'Sala', roomType: 'living', styles: 'moderno, bohemio' });
    expect(out.styles).toEqual(['moderno', 'bohemio']);
  });

  it('GenerateStyles rechaza estilos repetidos', () => {
    expect(GenerateStylesRequestSchema.safeParse({ styles: ['moderno', 'moderno'], promptStrength: 0.5 }).success).toBe(false);
  });
});
