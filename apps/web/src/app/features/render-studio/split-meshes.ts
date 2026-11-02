import * as THREE from 'three';

/**
 * Parte en mallas de un solo material las que tienen varios (un `material` en array con grupos).
 *
 * three-gpu-pathtracer 0.0.24 junta toda la escena en una geometría y numera los materiales en
 * orden, pero asigna a cada malla un único índice: una malla con seis materiales ocupa seis
 * posiciones y desplaza el material de todas las que vienen detrás (que además cambian de orden en
 * cada render). Con una malla por material la numeración vuelve a cuadrar.
 *
 * Las piezas comparten los atributos de la geometría original (solo llevan su propio índice), se
 * cuelgan del mismo padre con la misma transformación y la original se oculta. Devuelve la función
 * que lo deshace. Las piezas no se liberan con dispose(): el renderer nunca las dibujó y liberar una
 * geometría que comparte atributos borraría los búferes de la original.
 */
export function splitMultiMaterialMeshes(root: THREE.Object3D): () => void {
  const originals: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && Array.isArray(mesh.material) && mesh.parent && !(mesh as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) originals.push(mesh);
  });

  const parts: THREE.Mesh[] = [];
  for (const mesh of originals) {
    const materials = mesh.material as THREE.Material[];
    for (const piece of splitGeometry(mesh.geometry)) {
      const material = materials[piece.materialIndex];
      if (!material || !material.visible) continue;
      const part = new THREE.Mesh(piece.geometry, material);
      part.name = `${mesh.name}#${piece.materialIndex}`;
      part.matrixAutoUpdate = false;
      part.matrix.copy(mesh.matrix);
      part.castShadow = mesh.castShadow;
      part.receiveShadow = mesh.receiveShadow;
      mesh.parent!.add(part);
      part.updateMatrixWorld(true);
      parts.push(part);
    }
    mesh.visible = false;
  }

  return () => {
    for (const part of parts) part.removeFromParent();
    for (const mesh of originals) mesh.visible = true;
  };
}

export interface GeometryPiece {
  geometry: THREE.BufferGeometry;
  materialIndex: number;
}

/** Una geometría por grupo, con los mismos atributos y solo los triángulos de ese grupo. */
export function splitGeometry(geometry: THREE.BufferGeometry): GeometryPiece[] {
  const index = geometry.index;
  const total = index ? index.count : geometry.attributes['position']!.count;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
  // Grupos con el mismo material van juntos: menos piezas y la misma numeración.
  const byMaterial = new Map<number, number[]>();
  for (const group of groups) {
    const list = byMaterial.get(group.materialIndex ?? 0) ?? [];
    const end = Math.min(group.start + group.count, total);
    for (let i = group.start; i < end; i++) list.push(index ? index.getX(i) : i);
    byMaterial.set(group.materialIndex ?? 0, list);
  }
  const pieces: GeometryPiece[] = [];
  for (const [materialIndex, indices] of byMaterial) {
    if (!indices.length) continue;
    const piece = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) piece.setAttribute(name, attribute);
    piece.setIndex(indices);
    pieces.push({ geometry: piece, materialIndex });
  }
  return pieces;
}
