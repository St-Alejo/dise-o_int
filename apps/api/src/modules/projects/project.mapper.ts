import type {
  DesignProject,
  DesignProjectVersionSummary,
  ProjectListItem,
  PublicProject,
  StylePreview,
} from '@interiores/shared-types';
import type { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import type { PreviewRecord, ProjectRecord, VersionRecord } from '../../ports/index.js';

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

export function toListItem(project: ProjectRecord, signer: MediaUrlSigner): ProjectListItem {
  return {
    id: project.id,
    name: project.name,
    roomType: project.roomType,
    status: project.status,
    thumbnailUrl: project.thumbKey ? signer.sign(project.thumbKey) : null,
    itemCount: project.placements.length,
    saved: project.saved,
    updatedAt: project.updatedAt.toISOString(),
  };
}
