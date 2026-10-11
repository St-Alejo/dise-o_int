import {
  RoomPlan,
  type DesignProject,
  type DesignProjectVersionSummary,
  type ProjectListItem,
  type PublicProject,
  type StylePreview,
} from '@interiores/shared-types';
import type { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import type { CatalogRecord, PreviewRecord, ProjectRecord, VersionRecord } from '../../ports/index.js';

/** Claves S3: todo lo de un proyecto vive bajo un prefijo → borrado real con una sola operación. */
export const projectKeys = {
  prefix: (projectId: string) => `projects/${projectId}/`,
  photo: (projectId: string) => `projects/${projectId}/source.jpg`,
  thumb: (projectId: string) => `projects/${projectId}/thumb.webp`,
  preview: (projectId: string, previewId: string) => `projects/${projectId}/previews/${previewId}.jpg`,
};

export function toPreviewDto(p: PreviewRecord, signer: MediaUrlSigner): StylePreview {
  return {
    id: p.id,
    styleName: p.styleId,
    imageUrl: p.status === 'ready' && p.imageKey ? signer.sign(p.imageKey) : null,
    promptStrength: p.promptStrength,
    status: p.status,
    ...(p.provider ? { provider: p.provider } : {}),
    createdAt: p.createdAt.toISOString(),
  };
}

export function toVersionSummary(v: VersionRecord): DesignProjectVersionSummary {
  return {
    id: v.id,
    number: v.number,
    note: v.note,
    itemCount: v.placements.length,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Para cada estilo se muestra solo la generación más reciente (las anteriores quedan en historial). */
export function latestPreviewPerStyle(previews: PreviewRecord[]): PreviewRecord[] {
  const byStyle = new Map<string, PreviewRecord>();
  for (const p of previews) {
    const current = byStyle.get(p.styleId);
    if (!current || p.createdAt >= current.createdAt) byStyle.set(p.styleId, p);
  }
  return [...byStyle.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function toDesignProject(
  project: ProjectRecord,
  previews: PreviewRecord[],
  versions: VersionRecord[],
  shared: boolean,
  signer: MediaUrlSigner,
): DesignProject {
  return {
    id: project.id,
    ownerId: project.ownerId,
    name: project.name,
    roomType: project.roomType,
    status: project.status,
    lastError: project.lastError,
    sourcePhotoUrl: project.photoKey ? signer.sign(project.photoKey) : null,
    roomShell: project.roomShell,
    stylePreviews: latestPreviewPerStyle(previews).map((p) => toPreviewDto(p, signer)),
    selectedStyleId: project.selectedStyleId,
    furniturePlacements: project.placements,
    finishes: project.finishes,
    versions: versions.map(toVersionSummary),
    visibility: shared ? 'shared-link' : 'private',
    saved: project.saved,
    revision: project.revision,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toPublicProject(
  project: ProjectRecord,
  previews: PreviewRecord[],
  signer: MediaUrlSigner,
): PublicProject {
  const { ownerId: _o, versions: _v, saved: _s, lastError: _l, ...rest } = toDesignProject(
    project,
    previews.filter((p) => p.status === 'ready'),
    [],
    true,
    signer,
  );
  return rest;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Precio y moneda de cada mueble del catálogo que hace falta para el resumen de la lista. */
export type CatalogPrices = ReadonlyMap<string, Pick<CatalogRecord, 'price' | 'currency'>>;

/** Área, estilo y total estimado de la tarjeta; cada dato se omite si no se puede calcular. */
function listSummary(project: ProjectRecord, prices: CatalogPrices): Pick<ProjectListItem, 'areaM2' | 'outline' | 'styleId' | 'estimatedTotal' | 'currency'> {
  const priced = project.placements.flatMap((p) => {
    const item = prices.get(p.catalogItemId);
    return item && item.price !== null ? [item] : [];
  });
  const plan = project.roomShell ? RoomPlan.from(project.roomShell) : null;
  return {
    ...(plan ? { areaM2: round(plan.area(), 1), outline: plan.polygon.map((p) => ({ x: round(p.x, 2), z: round(p.z, 2) })) } : {}),
    ...(project.selectedStyleId ? { styleId: project.selectedStyleId } : {}),
    ...(priced.length
      ? { estimatedTotal: round(priced.reduce((sum, item) => sum + (item.price ?? 0), 0), 2), currency: priced[0]!.currency }
      : {}),
  };
}

export function toListItem(project: ProjectRecord, signer: MediaUrlSigner, prices: CatalogPrices = new Map()): ProjectListItem {
  return {
    id: project.id,
    name: project.name,
    roomType: project.roomType,
    status: project.status,
    thumbnailUrl: project.thumbKey ? signer.sign(project.thumbKey) : null,
    itemCount: project.placements.length,
    saved: project.saved,
    updatedAt: project.updatedAt.toISOString(),
    ...listSummary(project, prices),
  };
}
