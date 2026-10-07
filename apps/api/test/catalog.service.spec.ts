import { describe, expect, it } from 'vitest';
import { CatalogQuerySchema } from '@interiores/shared-types';
import { ValidationError } from '../src/common/errors.js';
import { CatalogService, catalogSource, toCatalogItem } from '../src/modules/catalog/catalog.service.js';
import { InMemoryCatalogRepository, catalogItem } from './fakes.js';

class CountingRepo extends InMemoryCatalogRepository {
  loads = 0;
  override async listActive() {
    this.loads++;
    await new Promise((r) => setTimeout(r, 5));
    return super.listActive();
  }
}

const repoWith = () =>
  new CountingRepo([
    catalogItem({ id: 'lampara-mesa', name: 'Lámpara de mesa', category: 'lighting', mount: 'surface', tags: ['velador'] }),
    catalogItem({ id: 'sofa', name: 'Sofá tres puestos', category: 'sofa', synonyms: ['couch'] }),
    catalogItem({ id: 'retirado', name: 'Lámpara vieja', category: 'lighting', active: false }),
    catalogItem({
      id: 'cuadro',
      name: 'Cuadro abstracto',
      category: 'wall-decor',
      mount: 'wall',
      source: 'parametric:wall-art',
      spec: { recipe: { kind: 'wall-art', params: {} }, elevationDefaultM: 1.4, resize: { x: [0.4, 1.6] } },
    }),
  ]);

describe('CatalogService', () => {
  it('busca con la misma función del navegador y oculta los ítems inactivos', async () => {
    const service = new CatalogService(repoWith());
    const list = await service.list({ q: 'lamparas' });
    expect(list.map((i) => i.id)).toEqual(['lampara-mesa']);
    expect((await service.list({ q: 'velador' })).map((i) => i.id)).toEqual(['lampara-mesa']);
    expect((await service.list({ q: 'couch' })).map((i) => i.id)).toEqual(['sofa']);
  });

  it('expone el spec de personalización aplanado en el ítem', async () => {
    const service = new CatalogService(repoWith());
    const cuadro = (await service.all()).find((i) => i.id === 'cuadro')!;
    expect(cuadro).toMatchObject({ source: 'parametric', recipe: { kind: 'wall-art' }, elevationDefaultM: 1.4, mount: 'wall' });
  });

  it('cachea el catálogo y hace una sola carga aunque lleguen peticiones a la vez', async () => {
    const repo = repoWith();
    const service = new CatalogService(repo);
    let now = 0;
    service.clock = () => now;
    await Promise.all([service.all(), service.all(), service.all()]);
    expect(repo.loads).toBe(1);
    now += CatalogService.TTL_MS - 1;
    await service.all();
    expect(repo.loads).toBe(1);
    now += 2;
    await service.all();
    expect(repo.loads).toBe(2);
    service.invalidate();
    await service.all();
    expect(repo.loads).toBe(3);
  });

  it('pagina con cursor y traduce un cursor inválido a 422', async () => {
    const service = new CatalogService(repoWith());
    const first = await service.search(CatalogQuerySchema.parse({ limit: '2' }));
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await service.search(CatalogQuerySchema.parse({ limit: '2', cursor: first.nextCursor }));
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    await expect(service.search(CatalogQuerySchema.parse({ cursor: 'nope' }))).rejects.toThrow(ValidationError);
  });

  it('mapea el origen a su familia', () => {
    expect(catalogSource('polyhaven:Sofa_01')).toBe('polyhaven');
    expect(catalogSource('parametric:sofa')).toBe('parametric');
    expect(catalogSource('procedural:rug')).toBe('procedural');
    expect(toCatalogItem(catalogItem()).dimensionsM).toEqual({ x: 2, y: 0.8, z: 0.9 });
  });
});
