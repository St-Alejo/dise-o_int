import { describe, expect, it } from 'vitest';
import { surfaceTextureSet, TEXTURE_MANIFEST_KEY, TEXTURE_SOURCES, TextureManifestSchema } from '@interiores/shared-types';
import { MemoryFileStorage } from '../src/infrastructure/storage/memory-file-storage.js';
import { buildTextureManifest } from '../src/cli/catalog/textures.js';
import { TexturesController } from '../src/modules/catalog/textures.controller.js';

const keys = (asset: string) => ({
  albedo: `textures/${asset}/albedo.0123456789ab.webp`,
  normal: `textures/${asset}/normal.0123456789ab.webp`,
  arm: `textures/${asset}/arm.0123456789ab.webp`,
});

const fakeRes = () => {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => (headers[k] = v) };
};

describe('texturas PBR', () => {
  const manifest = buildTextureManifest([
    { set: { asset: 'laminate_floor_02', sizeM: 2.2, avgColor: '#a08060' }, keys: keys('laminate_floor_02') },
    { set: { asset: 'painted_plaster_wall', sizeM: 2, avgColor: '#d0d0d0' }, keys: keys('painted_plaster_wall') },
  ]);

  it('solo enlaza materiales con texturas que sí se bajaron', () => {
    expect(TextureManifestSchema.parse(manifest)).toBeTruthy();
    expect(manifest.surfaces['wood-oak']).toBe('laminate_floor_02');
    expect(manifest.surfaces['stone-marble-white']).toBeUndefined();
    expect(surfaceTextureSet(manifest, { id: 'paint-sage', kind: 'paint' })?.asset).toBe('painted_plaster_wall');
    expect(surfaceTextureSet(manifest, { id: 'stone-terrazzo', kind: 'stone' })).toBeNull();
    expect(surfaceTextureSet(null, { id: 'wood-oak', kind: 'wood' })).toBeNull();
  });

  it('cada material de las fuentes existe en la biblioteca', async () => {
    const { getMaterial } = await import('@interiores/shared-types');
    const ids = TEXTURE_SOURCES.flatMap((s) => [...(s.surfaces ?? []), ...(s.furniture ?? [])]).filter((id) => !id.startsWith('@'));
    expect(ids.filter((id) => !getMaterial(id))).toEqual([]);
  });

  it('la API publica el manifiesto con URLs y sirve solo claves de textura', async () => {
    const storage = new MemoryFileStorage();
    const controller = new TexturesController(storage);
    expect((await controller.manifest(fakeRes() as never)).sets).toEqual({});

    await storage.put(TEXTURE_MANIFEST_KEY, Buffer.from(JSON.stringify(manifest)), 'application/json');
    await storage.put(keys('laminate_floor_02').albedo, Buffer.from('webp'), 'image/webp');
    const fresh = new TexturesController(storage);
    const published = await fresh.manifest(fakeRes() as never);
    expect(published.sets['laminate_floor_02']!.maps.albedo).toBe('/api/textures/laminate_floor_02/albedo.0123456789ab.webp');

    await expect(fresh.file('..', 'manifest.json', { headers: {} } as never, {} as never)).rejects.toThrow(/no encontrada/);
    await expect(fresh.file('laminate_floor_02', 'albedo.ffffffffffff.webp', { headers: {} } as never, {} as never)).rejects.toThrow(/no encontrada/);
  });
});
