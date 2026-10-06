/**
 * Descarga un modelo CC0 de Poly Haven (glTF 1k) y lo convierte en un GLB optimizado para web:
 * texturas WebP ≤ 512 px, geometría deduplicada, pivote en la base (y = 0) y centrado en X/Z.
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { center, dedup, getBounds, prune, textureCompress, weld } from '@gltf-transform/functions';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

interface PolyHavenFile {
  url: string;
  size: number;
  include?: Record<string, { url: string; size: number }>;
}

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'interiores-ia-seed/0.1 (proyecto academico)';

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} al descargar ${url}`);
  return res;
}

export interface OptimizedModel {
  glb: Uint8Array;
  /** Dimensiones reales medidas del modelo (x ancho, y alto, z profundidad) en metros. */
  dimensions: { x: number; y: number; z: number };
}

export async function downloadPolyHaven(asset: string, workDir: string, yawDeg = 0): Promise<OptimizedModel> {
  const files = (await (await fetchOk(`${API}/files/${encodeURIComponent(asset)}`)).json()) as {
    gltf?: Record<string, { gltf: PolyHavenFile }>;
  };
  const entry = files.gltf?.['1k']?.gltf ?? files.gltf?.['2k']?.gltf;
  if (!entry) throw new Error(`Poly Haven no ofrece glTF para ${asset}`);

  const dir = join(workDir, asset);
  const gltfPath = join(dir, `${asset}.gltf`);
  await mkdir(dir, { recursive: true });
  await writeFile(gltfPath, Buffer.from(await (await fetchOk(entry.url)).arrayBuffer()));
  for (const [relPath, file] of Object.entries(entry.include ?? {})) {
    const target = join(dir, relPath);
    if (!target.startsWith(dir)) throw new Error(`Ruta sospechosa en ${asset}: ${relPath}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await (await fetchOk(file.url)).arrayBuffer()));
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp });
  const doc: Document = await io.read(gltfPath);
  if (yawDeg) {
    // Envuelve la escena en un nodo girado para que el frente del mueble mire a +Z.
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    if (scene) {
      const half = (yawDeg * Math.PI) / 360;
      const pivot = doc.createNode('orientation').setRotation([0, Math.sin(half), 0, Math.cos(half)]);
      for (const child of scene.listChildren()) {
        scene.removeChild(child);
        pivot.addChild(child);
      }
      scene.addChild(pivot);
    }
  }
  await doc.transform(
    dedup(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
    center({ pivot: 'below' }),
    prune(),
  );

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${asset} no tiene escena`);
  const { min, max } = getBounds(scene);
  const dimensions = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
  const largest = Math.max(dimensions.x, dimensions.y, dimensions.z);
  if (!(largest > 0.05 && largest < 5)) {
    throw new Error(`${asset}: dimensiones fuera de escala real (${largest.toFixed(2)} m)`);
  }
  return { glb: await io.writeBinary(doc), dimensions };
}
