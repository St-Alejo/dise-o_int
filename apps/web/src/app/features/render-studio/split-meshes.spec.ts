import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { splitGeometry, splitMultiMaterialMeshes } from './split-meshes';

describe('mallas con varios materiales para el trazador', () => {
  it('parte una caja en una pieza por material, juntando grupos del mismo material', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    // Caja con 6 caras: los grupos 0..5; se remapea para que haya solo tres materiales.
    box.groups.forEach((g, i) => (g.materialIndex = i % 3));
    const pieces = splitGeometry(box);
    expect(pieces.map((p) => p.materialIndex).sort()).toEqual([0, 1, 2]);
    for (const p of pieces) {
      expect(p.geometry.index!.count).toBe(12); // dos caras de dos triángulos
      expect(p.geometry.attributes['position']).toBe(box.attributes['position']);
    }
  });

  it('cuelga las piezas del mismo padre, oculta la original y lo deshace todo', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const mats = [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial());
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mats);
    mesh.position.set(1, 2, 3);
    mesh.updateMatrix();
    group.add(mesh);
    scene.add(group, new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

    const undo = splitMultiMaterialMeshes(scene);
    expect(mesh.visible).toBe(false);
    expect(group.children.length).toBe(7);
    const part = group.children[1] as THREE.Mesh;
    expect(Array.isArray(part.material)).toBe(false);
    expect(part.matrix.elements[12]).toBe(1);

    undo();
    expect(mesh.visible).toBe(true);
    expect(group.children).toEqual([mesh]);
  });
});
