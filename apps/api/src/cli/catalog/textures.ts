/**
 * Texturas PBR de Poly Haven (CC0) para pisos, paredes y muebles: se bajan en 1k, se pasan a WebP
 * y se suben al almacenamiento junto con un manifiesto (`textures/manifest.json`) que la API
 * publica. Se cachean en disco igual que los modelos.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PAINT_TEXTURE_KEY, TEXTURE_MANIFEST_KEY, TEXTURE_SOURCES, type TextureManifest, type TextureSource } from '@interiores/shared-types';
import type { IFileStorage } from '../../ports/index.js';

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'interiores-ia-seed/0.1 (proyecto academico)';

/** Mapa de Poly Haven → nombre en el manifiesto. `arm` ya trae oclusión, rugosidad y metal juntos. */
const MAPS = { albedo: 'Diffuse', normal: 'nor_gl', arm: 'arm' } as const;
type MapName = keyof typeof MAPS;
const SIZE_PX = 1024;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} al descargar ${url}`);
  return res;
}

interface FileEntry {
  url: string;
}
type FilesResponse = Record<string, Record<string, Record<string, FileEntry>>>;

export interface DownloadedSet {
  asset: string;
  sizeM: number;
  avgColor: string;
  maps: Record<MapName, Buffer>;
}

const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** Baja (o lee de la caché) un juego de texturas y lo deja en WebP de 1024 px. */
export async function downloadTextureSet(asset: string, cacheDir: string): Promise<DownloadedSet> {
  const dir = join(cacheDir, 'textures', asset);
  const metaPath = join(dir, 'meta.json');
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Omit<DownloadedSet, 'maps'>;
    const maps = Object.fromEntries(await Promise.all((Object.keys(MAPS) as MapName[]).map(async (m) => [m, await readFile(join(dir, `${m}.webp`))]))) as Record<MapName, Buffer>;
    return { ...meta, maps };
  } catch {
    /* no está en caché */
  }
  const files = (await (await fetchOk(`${API}/files/${encodeURIComponent(asset)}`)).json()) as FilesResponse;
  const info = (await (await fetchOk(`${API}/info/${encodeURIComponent(asset)}`)).json()) as { dimensions?: [number, number] };
  const maps = {} as Record<MapName, Buffer>;
  for (const [name, key] of Object.entries(MAPS) as [MapName, string][]) {
    const file = files[key]?.['1k']?.['jpg'] ?? files[key]?.['2k']?.['jpg'];
    if (!file) throw new Error(`${asset} no tiene el mapa ${key}`);
    const raw = Buffer.from(await (await fetchOk(file.url)).arrayBuffer());
    // Normal y arm son datos, no color: sin pérdida de más para que no aparezcan bandas en el relieve.
    maps[name] = await sharp(raw).resize(SIZE_PX, SIZE_PX, { fit: 'fill' }).webp({ quality: name === 'albedo' ? 82 : 90 }).toBuffer();
  }
  const stats = await sharp(maps.albedo).stats();
  const avgColor = `#${stats.channels.slice(0, 3).map((c) => hex(c.mean)).join('')}`;
  // Poly Haven da el tamaño real en milímetros; sin dato, 2 m es lo típico de sus texturas de piso.
  const sizeM = Math.round(((info.dimensions?.[0] ?? 2000) / 1000) * 100) / 100;
  await mkdir(dir, { recursive: true });
  await Promise.all((Object.keys(maps) as MapName[]).map((m) => writeFile(join(dir, `${m}.webp`), maps[m])));
  await writeFile(metaPath, JSON.stringify({ asset, sizeM, avgColor }));
  return { asset, sizeM, avgColor, maps };
}

/** Manifiesto con las claves del almacenamiento: la API las convierte en URLs al servirlo. */
export function buildTextureManifest(sets: readonly { set: Omit<DownloadedSet, 'maps'>; keys: Record<MapName, string> }[], sources: readonly TextureSource[] = TEXTURE_SOURCES): TextureManifest {
  const available = new Set(sets.map((s) => s.set.asset));
  const surfaces: Record<string, string> = {};
  const furniture: Record<string, string> = {};
  for (const source of sources) {
    if (!available.has(source.asset)) continue;
    for (const id of source.surfaces ?? []) surfaces[id] = source.asset;
    for (const id of source.furniture ?? []) furniture[id] = source.asset;
  }
  return {
    sets: Object.fromEntries(sets.map(({ set, keys }) => [set.asset, { asset: set.asset, sizeM: set.sizeM, avgColor: set.avgColor, maps: keys }])),
    surfaces,
    furniture,
    credits: `Texturas CC0 de Poly Haven (polyhaven.com): ${[...available].sort().join(', ')}`.slice(0, 400),
  };
}

/** Baja todas las texturas, las sube y publica el manifiesto. Lo que falle se omite (queda el canvas). */
export async function seedTextures(storage: IFileStorage, cacheDir: string, log: (msg: string) => void): Promise<number> {
  const done: { set: Omit<DownloadedSet, 'maps'>; keys: Record<MapName, string> }[] = [];
  for (const source of TEXTURE_SOURCES) {
    try {
      const set = await downloadTextureSet(source.asset, cacheDir);
      const keys = {} as Record<MapName, string>;
      for (const m of Object.keys(set.maps) as MapName[]) {
        const hash = createHash('sha256').update(set.maps[m]).digest('hex').slice(0, 12);
        keys[m] = `textures/${set.asset}/${m}.${hash}.webp`;
        if (!(await storage.exists(keys[m]))) await storage.put(keys[m], set.maps[m], 'image/webp');
      }
      done.push({ set: { asset: set.asset, sizeM: set.sizeM, avgColor: set.avgColor }, keys });
      log(`✓ textura ${source.asset} (${set.sizeM} m)`);
    } catch (err) {
      log(`⚠ textura ${source.asset}: ${(err as Error).message}`);
    }
  }
  const manifest = buildTextureManifest(done);
  await storage.put(TEXTURE_MANIFEST_KEY, Buffer.from(JSON.stringify(manifest)), 'application/json');
  if (!manifest.surfaces[PAINT_TEXTURE_KEY]) log('⚠ sin textura de pintura: las paredes irán lisas');
  return done.length;
}
