import type { JobProgressEvent, Render, RenderSpec } from '@interiores/shared-types';
import { fileSlug } from '../../core/ui/download';

const TIME_LABELS: Record<RenderSpec['timeOfDay'], string> = { day: 'Día', evening: 'Tarde', night: 'Noche' };
const QUALITY_LABELS: Record<RenderSpec['quality'], string> = { draft: 'Borrador', good: 'Buena', final: 'Final' };
const RESOLUTION_LABELS: Record<RenderSpec['resolution'], string> = { '1080p': '1080p', '2k': '2K', '4k': '4K' };

/** Un `.blend` exportado para abrir en Blender (trae solo una miniatura como imagen). */
export function isBlendExport(render: Pick<Render, 'spec'>): boolean {
  return render.spec?.purpose === 'export';
}

/** Con qué se hizo cada render, en palabras. */
export function engineLabel(render: Pick<Render, 'kind' | 'provider'> & Partial<Pick<Render, 'spec'>>): string {
  if (render.kind === 'video') return 'Recorrido';
  if (render.spec && isBlendExport({ spec: render.spec })) return 'Archivo de Blender';
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
  // El .blend exportado sale siempre en calidad final: lo que importa es que está listo para F12.
  const quality = spec.purpose === 'export' ? 'Listo para renderizar' : QUALITY_LABELS[spec.quality];
  return [TIME_LABELS[spec.timeOfDay], RESOLUTION_LABELS[spec.resolution], quality].join(' · ');
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

/** Distancia (m) hasta la que dos cámaras cuentan como la misma vista. */
const SAME_VIEW_M = 0.02;

/** Un antes/después: el render del navegador y el de Blender de la misma vista. */
export interface Comparison {
  browser: Render;
  blender: Render;
}

/**
 * Busca la pareja de un render para compararlos: misma cámara, hora y proporción, uno del navegador
 * y otro de Blender. Si hay varias, la más reciente.
 */
export function comparisonFor(render: Render, all: readonly Render[]): Comparison | null {
  if (!isStill(render)) return null;
  const blender = render.provider === CYCLES;
  const match = all
    .filter((r) => r.id !== render.id && isStill(r) && (r.provider === CYCLES) !== blender && sameView(render.spec!, r.spec!))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!match) return null;
  return blender ? { browser: match, blender: render } : { browser: render, blender: match };
}

const CYCLES = 'cycles';

/** Una imagen terminada con la que comparar (un .blend exportado solo trae una miniatura). */
function isStill(r: Render): boolean {
  return r.status === 'ready' && !!r.url && !!r.spec && r.kind === 'path' && !r.mediaType?.startsWith('video/') && !isBlendExport(r);
}

function sameView(a: RenderSpec, b: RenderSpec): boolean {
  const near = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= SAME_VIEW_M;
  return (
    a.timeOfDay === b.timeOfDay &&
    a.aspect === b.aspect &&
    Math.abs(a.camera.focalMm - b.camera.focalMm) < 0.5 &&
    near(a.camera.position, b.camera.position) &&
    near(a.camera.target, b.camera.target)
  );
}
