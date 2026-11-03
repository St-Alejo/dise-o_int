import type { JobProgressEvent, Render, RenderSpec } from '@interiores/shared-types';
import { fileSlug } from '../../core/ui/download';

const TIME_LABELS: Record<RenderSpec['timeOfDay'], string> = { day: 'Día', evening: 'Tarde', night: 'Noche' };
const QUALITY_LABELS: Record<RenderSpec['quality'], string> = { draft: 'Borrador', good: 'Buena', final: 'Final' };
const RESOLUTION_LABELS: Record<RenderSpec['resolution'], string> = { '1080p': '1080p', '2k': '2K', '4k': '4K' };

/** Con qué se hizo cada render, en palabras. */
export function engineLabel(render: Pick<Render, 'kind' | 'provider'>): string {
  if (render.kind === 'video') return 'Recorrido';
  if (render.kind === 'photoreal') return 'Foto con IA';
  switch (render.provider) {
    case 'cycles':
      return 'Blender';
    case 'pathtracer':
      return 'Trazado de rayos';
    default:
      return 'Navegador';
  }
}

/** "Tarde · 2K · Buena": lo que se eligió en el estudio. */
export function specLabel(spec: RenderSpec | null): string {
  if (!spec) return '';
  return [TIME_LABELS[spec.timeOfDay], RESOLUTION_LABELS[spec.resolution], QUALITY_LABELS[spec.quality]].join(' · ');
}

/** Lo que se sabe de un render que todavía se está haciendo en el nodo Blender. */
export interface PendingProgress {
  pct: number;
  /** El último aviso del nodo, para saber si ya empezó o sigue en cola. */
  at: string;
}

/**
 * Lleva el avance de los renders en Blender a partir de los eventos del socket. Devuelve el mapa
 * nuevo (o el mismo si el evento no cambia nada) para usarlo directamente en una señal.
 */
export function applyRenderProgress(map: ReadonlyMap<string, PendingProgress>, event: JobProgressEvent): ReadonlyMap<string, PendingProgress> {
  if (event.kind !== 'blender-render') return map;
  const current = map.get(event.jobId);
  if (current && current.at > event.at) return map;
  const next = new Map(map);
  if (event.status === 'active') next.set(event.jobId, { pct: event.pct, at: event.at });
  else next.delete(event.jobId);
  return next;
}

/** Nombre de archivo para descargar un render: `sala-blender-tarde.png`. */
export function downloadName(project: string, render: Render, ext: string): string {
  const parts = [project, engineLabel(render), render.spec ? TIME_LABELS[render.spec.timeOfDay] : null];
  return `${fileSlug(parts.filter(Boolean).join(' '), 'render')}.${ext}`;
}
