import { Inject, Injectable } from '@nestjs/common';
import {
  paginate,
  searchCatalog,
  type CatalogFilters,
  type CatalogItem,
  type CatalogQuery,
  type CatalogSearchResponse,
} from '@interiores/shared-types';
import { ValidationError } from '../../common/errors.js';
import { CATALOG_REPOSITORY, type CatalogRecord, type ICatalogRepository } from '../../ports/index.js';

/** La clave del modelo incluye un hash de contenido → la URL es inmutable y cacheable 1 año. */
function modelVersion(modelKey: string): string {
  return modelKey.match(/\.([0-9a-f]{8,})\.glb$/)?.[1] ?? '0';
}

/** En la base de datos `source` es "polyhaven:asset" o "procedural:kind"; la API expone solo la familia. */
export function catalogSource(source: string): CatalogItem['source'] {
  const family = source.split(':')[0];
  return family === 'polyhaven' || family === 'parametric' ? family : 'procedural';
}

export function toCatalogItem(r: CatalogRecord): CatalogItem {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    ...(r.subcategory ? { subcategory: r.subcategory } : {}),
    styleTags: r.styleTags,
    roomTypes: r.roomTypes,
    dimensionsM: { x: r.widthM, y: r.heightM, z: r.depthM },
    mount: r.mount,
    modelUrl: `/api/catalog/${encodeURIComponent(r.id)}/model.glb?v=${modelVersion(r.modelKey)}`,
    ...(r.thumbnailKey ? { thumbnailUrl: `/api/catalog/${encodeURIComponent(r.id)}/thumbnail?v=${modelVersion(r.modelKey)}` } : {}),
    ...(r.price !== null ? { price: r.price } : {}),
    currency: r.currency,
    ...(r.productUrl ? { productUrl: r.productUrl } : {}),
    license: r.license,
    ...(r.attribution ? { attribution: r.attribution } : {}),
    tags: r.tags,
    synonyms: r.synonyms,
    ...(r.description ? { description: r.description } : {}),
    source: catalogSource(r.source),
    ...r.spec,
  };
}

/**
 * Caso de uso de consulta del catálogo. El catálogo es pequeño (cientos de ítems) y cambia
 * solo con el seed, así que se mantiene en memoria unos segundos y se busca con la misma
 * función que usa el navegador (`searchCatalog`): resultados idénticos en ambos lados y sin
 * depender de extensiones de PostgreSQL.
 */
@Injectable()
export class CatalogService {
  static readonly TTL_MS = 60_000;
  /** Reloj inyectable (las pruebas lo fijan). */
  clock: () => number = () => Date.now();
  private cache: { at: number; items: CatalogItem[] } | null = null;
  private loading: Promise<CatalogItem[]> | null = null;

  constructor(@Inject(CATALOG_REPOSITORY) private readonly repo: ICatalogRepository) {}

  /** Todos los ítems activos (una sola consulta concurrente aunque lleguen muchas peticiones). */
  async all(): Promise<CatalogItem[]> {
    if (this.cache && this.clock() - this.cache.at < CatalogService.TTL_MS) return this.cache.items;
    this.loading ??= this.repo
      .listActive()
      .then((rows) => {
        const items = rows.map(toCatalogItem);
        this.cache = { at: this.clock(), items };
        return items;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  invalidate(): void {
    this.cache = null;
  }

  async list(filters: CatalogFilters): Promise<CatalogItem[]> {
    return searchCatalog(await this.all(), filters).map((r) => r.item);
  }

  async search(query: CatalogQuery): Promise<CatalogSearchResponse> {
    const results = await this.list(query);
    try {
      return paginate(results, query.limit, query.cursor);
    } catch (err) {
      if (err instanceof RangeError) throw new ValidationError(err.message);
      throw err;
    }
  }
}
