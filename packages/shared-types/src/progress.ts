import { z } from 'zod';

/** Los tres primeros van a la cola de IA; `blender-render`, a la cola del nodo Blender (ADR-0036). */
export const JOB_KINDS = ['analyze-room', 'generate-styles', 'build-scene', 'blender-render'] as const;
export const JobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof JobKindSchema>;

/** Etapas del pipeline, en el orden en que la UI las muestra (estados de carga descriptivos, §3 paso 2). */
export const PROGRESS_STAGES = [
  'queued',
  'geometry',
  'surfaces',
  'styles',
  'scene',
  'rendering',
  'done',
] as const;
export const ProgressStageSchema = z.enum(PROGRESS_STAGES);
export type ProgressStage = z.infer<typeof ProgressStageSchema>;

export const STAGE_MESSAGES: Record<ProgressStage, string> = {
  queued: 'En cola…',
  geometry: 'Analizando la geometría de tu espacio…',
  surfaces: 'Detectando muebles y superficies…',
  styles: 'Generando propuestas de diseño…',
  scene: 'Preparando el modelo 3D…',
  rendering: 'Renderizando en Blender…',
  done: '¡Listo!',
};

export const JobProgressEventSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  kind: JobKindSchema,
  stage: ProgressStageSchema,
  /** Progreso real 0–100 del job (nunca simulado). */
  pct: z.number().min(0).max(100),
  message: z.string(),
  status: z.enum(['active', 'completed', 'failed']),
  error: z.string().optional(),
  at: z.string(),
});
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;
