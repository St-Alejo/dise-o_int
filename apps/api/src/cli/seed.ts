/**
 * Seed idempotente del catálogo: descarga/genera cada modelo, lo sube a S3 con una clave
 * direccionada por contenido y hace upsert en PostgreSQL. Se puede ejecutar N veces.
 * Los modelos descargados se cachean en CATALOG_CACHE_DIR (volumen Docker) para no
 * volver a bajarlos en cada despliegue.
 *
 *   node dist/cli/seed.js            # seed completo
 *   CATALOG_OFFLINE=true node ...    # solo modelos procedurales (sin red)
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { loadConfig } from '../config/env.js';
import { PrismaCatalogRepository } from '../infrastructure/prisma/prisma-catalog.repository.js';
import { PrismaService } from '../infrastructure/prisma/prisma.service.js';
import { S3FileStorage } from '../infrastructure/storage/s3-file-storage.js';
import { CATALOG_MANIFEST, shoppingUrl, type ManifestEntry } from './catalog/manifest.js';
import { downloadPolyHaven } from './catalog/polyhaven.js';
import { buildProceduralGlb } from './catalog/procedural.js';

const log = (msg: string) => process.stdout.write(`[seed] ${msg}\n`);

interface Built {
  glb: Uint8Array;
  dimensions: { x: number; y: number; z: number };
  source: string;
  attribution: string | null;
}

async function measure(glb: Uint8Array) {
  const doc = await new NodeIO().readBinary(glb);
  const scene = doc.getRoot().listScenes()[0]!;
  const { min, max } = getBounds(scene);
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

async function buildEntry(entry: ManifestEntry, cacheDir: string, offline: boolean): Promise<Built | null> {
  // La clave de caché incluye la especificación de origen: si cambia (p. ej. yawDeg), se regenera.
  const spec = createHash('sha256').update(JSON.stringify([entry.source, entry.yawDeg ?? 0])).digest('hex').slice(0, 8);
  const cached = join(cacheDir, `${entry.id}-${spec}.glb`);
  const cachedMeta = join(cacheDir, `${entry.id}-${spec}.json`);
  try {
    const glb = new Uint8Array(await readFile(cached));
    const meta = JSON.parse(await readFile(cachedMeta, 'utf8')) as Omit<Built, 'glb'>;
    return { ...meta, glb };
  } catch {
    /* no está en caché */
  }

  let built: Built | null = null;
  if (entry.source.type === 'polyhaven' && !offline) {
    try {
      const model = await downloadPolyHaven(entry.source.asset, join(cacheDir, 'raw'), entry.yawDeg ?? 0);
      built = { ...model, source: `polyhaven:${entry.source.asset}`, attribution: `Poly Haven — ${entry.source.asset} (CC0)` };
    } catch (err) {
      log(`⚠ ${entry.id}: no se pudo descargar de Poly Haven (${(err as Error).message})`);
    }
  }
  const proc = entry.source.type === 'procedural' ? entry.source : entry.fallback;
  if (!built && proc) {
    const glb = await buildProceduralGlb(entry.name, proc.kind, proc.size, proc.colors);
    built = { glb, dimensions: await measure(glb), source: `procedural:${proc.kind}`, attribution: null };
  }
  if (!built) return null;

  // Solo se cachean resultados definitivos (no los respaldos por falta de red).
  if (!(entry.source.type === 'polyhaven' && built.source.startsWith('procedural'))) {
    await writeFile(cached, built.glb);
    await writeFile(cachedMeta, JSON.stringify({ dimensions: built.dimensions, source: built.source, attribution: built.attribution }));
  }
  return built;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const offline = ['1', 'true', 'yes'].includes((process.env.CATALOG_OFFLINE ?? '').toLowerCase());
  const cacheDir = process.env.CATALOG_CACHE_DIR ?? '/tmp/catalog-cache';
  await mkdir(cacheDir, { recursive: true });

  const prisma = new PrismaService(config);
  await prisma.$connect();
  const storage = new S3FileStorage(config);
  const catalog = new PrismaCatalogRepository(prisma);
  await storage.ensureBucket();

  let ok = 0;
  let skipped = 0;
  for (const entry of CATALOG_MANIFEST) {
    const built = await buildEntry(entry, cacheDir, offline);
    if (!built) {
      skipped++;
      log(`✗ ${entry.id}: sin modelo disponible, se omite`);
      continue;
    }
    const hash = createHash('sha256').update(built.glb).digest('hex').slice(0, 12);
    const modelKey = `catalog/${entry.id}.${hash}.glb`;
    if (!(await storage.exists(modelKey))) await storage.put(modelKey, Buffer.from(built.glb), 'model/gltf-binary');

    const round = (v: number) => Math.round(v * 1000) / 1000;
    await catalog.upsert({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      subcategory: entry.subcategory ?? null,
      styleTags: entry.styleTags,
      roomTypes: entry.roomTypes,
      widthM: round(built.dimensions.x),
      heightM: round(Math.max(built.dimensions.y, 0.005)),
      depthM: round(built.dimensions.z),
      mount: entry.mount ?? 'floor',
      modelKey,
      thumbnailKey: null,
      price: entry.price,
      currency: 'USD',
      productUrl: shoppingUrl(entry.searchQuery),
      license: 'cc0',
      attribution: built.attribution,
      source: built.source,
      tags: entry.tags ?? [],
      synonyms: entry.synonyms ?? [],
      description: entry.description ?? null,
      spec: entry.spec ?? null,
      active: true,
    });
    ok++;
    log(`✓ ${entry.id} (${built.source}, ${(built.glb.byteLength / 1024).toFixed(0)} KB)`);
  }
  log(`Catálogo listo: ${ok} muebles, ${skipped} omitidos.`);
  await prisma.$disconnect();
  storage.onModuleDestroy();
}

main().catch((err: unknown) => {
  process.stderr.write(`[seed] Error: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
