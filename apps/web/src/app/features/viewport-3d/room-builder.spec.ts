import { buildRoomShape, createRectangularShell, DEFAULT_FINISHES, getMaterial } from '@interiores/shared-types';
import * as THREE from 'three';
import { applyFinishes, buildRoom, disposeObject, metricBoxUVs, wallPieces } from './room-builder';
import { floorTextureSpec, tintFor } from './scene/texture-library';

describe('wallPieces', () => {
  it('pared sin aberturas = un solo tramo', () => {
    expect(wallPieces(4, 2.5, [])).toEqual([{ x0: 0, x1: 4, y0: 0, y1: 2.5 }]);
  });

  it('una ventana parte la pared en izquierda, bajo, sobre y derecha', () => {
    const pieces = wallPieces(4, 2.5, [{ offsetM: 2, widthM: 1, heightM: 1, sillHeightM: 0.9 }]);
    expect(pieces).toEqual([
      { x0: 0, x1: 1.5, y0: 0, y1: 2.5 },
      { x0: 1.5, x1: 2.5, y0: 0, y1: 0.9 },
      { x0: 1.5, x1: 2.5, y0: 1.9, y1: 2.5 },
      { x0: 2.5, x1: 4, y0: 0, y1: 2.5 },
    ]);
  });

  it('una puerta (sin alféizar) no genera tramo inferior', () => {
    const pieces = wallPieces(3, 2.5, [{ offsetM: 1, widthM: 0.8, heightM: 2, sillHeightM: 0 }]);
    expect(pieces.some((p) => p.x0 === 0.6 && p.y0 === 0)).toBe(false);
    expect(pieces).toContainEqual({ x0: 0.6, x1: 1.4, y0: 2, y1: 2.5 });
  });

  it('el área maciza = área total − área de aberturas', () => {
    const openings = [
      { offsetM: 1, widthM: 0.8, heightM: 2, sillHeightM: 0 },
      { offsetM: 3, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
    ];
    const area = wallPieces(4.5, 2.6, openings).reduce((a, p) => a + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
    expect(area).toBeCloseTo(4.5 * 2.6 - 0.8 * 2 - 1.2 * 1.2);
  });
});

describe('buildRoom', () => {
  it('construye piso y 4 paredes con normales hacia el interior', () => {
    const shell = createRectangularShell(4, 3, 2.5);
    const room = buildRoom(shell);
    expect(room.walls).toHaveLength(4);
    const back = room.walls.find((w) => w.wallId === 'w-back')!;
    expect(back.normal.y).toBeCloseTo(1); // la pared del fondo (z=0) mira hacia +z
    const left = room.walls.find((w) => w.wallId === 'w-left')!;
    expect(left.normal.x).toBeCloseTo(1);
    const box = new THREE.Box3().setFromObject(room.group);
    expect(box.max.y).toBeCloseTo(2.5);
    expect(box.min.x).toBeLessThan(0); // el grosor de pared queda por fuera del cuarto
  });

  it('la cara interior de las paredes coincide con el borde del cuarto (los muebles caben)', () => {
    const shell = createRectangularShell(4, 3, 2.5, { window: false, door: false });
    const room = buildRoom(shell);
    const back = room.group.getObjectByName('wall-w-back')!;
    const box = new THREE.Box3().setFromObject(back);
    expect(box.max.z).toBeCloseTo(0);
  });

  it('el piso mira hacia arriba y el techo hacia abajo, a la altura del cuarto', () => {
    const room = buildRoom(createRectangularShell(4, 3, 2.5));
    const normalY = (mesh: THREE.Mesh) => mesh.geometry.getAttribute('normal').getY(0);
    expect(normalY(room.floor)).toBeCloseTo(1);
    expect(normalY(room.ceiling)).toBeCloseTo(-1);
    expect(room.ceiling.position.y).toBe(2.5);
    expect(room.group.getObjectByName('ceiling')).toBe(room.ceiling);
  });

  it('una puerta tiene hoja y manija; las paredes llevan zócalo salvo en el vano', () => {
    const room = buildRoom(createRectangularShell(4, 3, 2.5, { window: false }));
    expect(room.group.getObjectByName('door-leaf')).toBeDefined();
    expect(room.group.getObjectByName('door-handle')).toBeDefined();
    const baseboards = (id: string) => room.group.getObjectByName(`trim-${id}`)!.children.filter((c) => c.name === 'baseboard').length;
    expect(baseboards('w-back')).toBe(1);
    expect(baseboards('w-front')).toBe(2); // a cada lado de la puerta
  });

  describe('cuarto en L', () => {
    // 5 × 4 sin la esquina del frente a la derecha (2 × 1,5): la esquina entrante está en (3, 2,5).
    const shell = buildRoomShape('L', { widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 });
    const room = buildRoom(shell);

    it('tiene 6 paredes y un piso con la forma y el área de la planta', () => {
      expect(room.walls).toHaveLength(6);
      const pos = room.floor.geometry.getAttribute('position');
      const index = room.floor.geometry.getIndex()!;
      let area = 0;
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((k) => new THREE.Vector3().fromBufferAttribute(pos, k));
        area += new THREE.Triangle(a!, b!, c!).getArea();
      }
      expect(area).toBeCloseTo(17);
      const box = new THREE.Box3().setFromObject(room.floor);
      expect([box.min.x, box.max.x, box.min.z, box.max.z].map((v) => Math.round(v * 100) / 100)).toEqual([0, 5, 0, 4]);
    });

    it('las normales de las paredes de la muesca apuntan al cuarto', () => {
      const normal = (id: string) => room.walls.find((w) => w.wallId === id)!.normal;
      expect(normal('w-3').y).toBeCloseTo(-1); // mira hacia el fondo
      expect(normal('w-4').x).toBeCloseTo(-1); // mira hacia la izquierda
    });

    it('ninguna pared invade el cuarto junto a la esquina entrante', () => {
      const inside = [new THREE.Vector3(2.95, 1, 2.55), new THREE.Vector3(3.05, 1, 2.45), new THREE.Vector3(2.95, 1, 2.45)];
      for (const info of room.walls) {
        const box = new THREE.Box3().setFromObject(room.group.getObjectByName(`wall-${info.wallId}`)!);
        for (const p of inside) expect(box.containsPoint(p), info.wallId).toBe(false);
      }
    });

    it('las esquinas salientes siguen cerradas por fuera', () => {
      const back = new THREE.Box3().setFromObject(room.group.getObjectByName('wall-w-back')!);
      expect(back.min.x).toBeCloseTo(-0.12);
      expect(back.max.x).toBeCloseTo(5.12);
    });
  });

  it('disposeObject libera geometrías y materiales', () => {
    const room = buildRoom(createRectangularShell(4, 3, 2.5));
    let disposed = 0;
    room.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.addEventListener('dispose', () => disposed++);
    });
    disposeObject(room.group);
    expect(disposed).toBeGreaterThan(5);
  });
});

describe('texturas del piso', () => {
  it('cada material de piso lleva el dibujo que le corresponde y la pintura va lisa', () => {
    const spec = (id: string) => floorTextureSpec(getMaterial(id)!);
    expect(spec('wood-oak')).toEqual({ pattern: 'planks', tileM: 2.4 });
    expect(spec('ceramic-terracotta')?.pattern).toBe('tiles');
    expect(spec('stone-marble-white')?.pattern).toBe('veins');
    expect(spec('stone-microcement')?.pattern).toBe('speckle');
    expect(spec('paint-white')).toBeNull();
  });

  it('el piso recibe la textura de su material y la suelta al pasar a uno liso', () => {
    const room = buildRoom(createRectangularShell(4, 3, 2.6));
    const texture = new THREE.Texture();
    const asked: string[] = [];
    const none = { map: null, normalMap: null, normalScale: 1, armMap: null, bumpMap: null, tint: null };
    const textures = {
      surface: (m: { id: string; kind: string }, where: string) => (asked.push(`${where}:${m.id}`), m.kind === 'wood' ? { ...none, map: texture, bumpMap: texture } : none),
    };
    applyFinishes(room, { floor: 'wood-oak', walls: { all: 'paint-white' }, ceiling: 'paint-white' }, textures);
    const floor = room.floor.material as THREE.MeshStandardMaterial;
    expect(floor.map).toBe(texture);
    expect(asked).toContain('floor:wood-oak');
    expect(asked).toContain('wall:paint-white');
    applyFinishes(room, { floor: 'stone-microcement', walls: { all: 'paint-white' }, ceiling: 'paint-white' }, textures);
    expect(floor.map).toBeNull();
    // Sin biblioteca de texturas (pruebas, entornos sin canvas) todo sigue funcionando liso.
    applyFinishes(room, { floor: 'wood-oak', walls: { all: 'paint-white' }, ceiling: 'paint-white' });
    expect(floor.map).toBeNull();
  });

  it('una textura PBR lleva normal, oclusión y rugosidad, y se tiñe al color del material', () => {
    const room = buildRoom(createRectangularShell(4, 3, 2.6));
    const [albedo, normal, arm] = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
    const tint = tintFor('#c8a97e', '#a08060');
    applyFinishes(room, DEFAULT_FINISHES, { surface: () => ({ map: albedo, normalMap: normal, normalScale: 1, armMap: arm, bumpMap: null, tint }) });
    const floor = room.floor.material as THREE.MeshStandardMaterial;
    expect([floor.map, floor.normalMap, floor.aoMap, floor.roughnessMap]).toEqual([albedo, normal, arm, arm]);
    expect(floor.color.equals(tint)).toBe(true);
    // Un tinte que lleva el color medio de la textura al del material.
    const avg = new THREE.Color('#a08060');
    const mixed = new THREE.Color(avg.r * tint.r, avg.g * tint.g, avg.b * tint.b);
    expect(`#${mixed.getHexString()}`).toBe('#c8a97e');
  });

  it('el revestimiento de pared sigue los huecos y se quita al volver a pintura', () => {
    const shell = createRectangularShell(4, 3, 2.6);
    const room = buildRoom({ ...shell, openings: [{ id: 'd', type: 'door', wallId: shell.walls[0]!.id, widthM: 0.9, heightM: 2.1, offsetM: 2, sillHeightM: 0 }] });
    const tiles = (r: typeof room) => r.walls.flatMap((w) => w.tiles.children);
    applyFinishes(room, { ...DEFAULT_FINISHES, wallTiles: { material: 'ceramic-subway-white', heightM: 1.2 } });
    // 4 paredes; la de la puerta queda en dos tramos a los lados del hueco.
    expect(tiles(room)).toHaveLength(5);
    applyFinishes(room, { ...DEFAULT_FINISHES, wallTiles: { material: 'ceramic-subway-white', heightM: 1.2, walls: [shell.walls[1]!.id] } });
    expect(tiles(room)).toHaveLength(1);
    applyFinishes(room, DEFAULT_FINISHES);
    expect(tiles(room)).toHaveLength(0);
  });

  it('las paredes llevan coordenadas de textura en metros, continuas entre tramos', () => {
    const geometry = new THREE.BoxGeometry(2, 1, 0.1);
    metricBoxUVs(geometry, new THREE.Vector3(3, 0.5, 0));
    const uv = geometry.getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.min(...us)).toBeCloseTo(-0.05);
    expect(Math.max(...us)).toBeCloseTo(4);
  });
});
