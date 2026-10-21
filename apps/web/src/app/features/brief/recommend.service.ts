import { Injectable, computed, inject, signal } from '@angular/core';
import type { RecommendationFeedbackRequest, RecommendIntensity, RecommendResponse } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';

/** Nombre del paso en el historial: toda la propuesta se deshace con un solo Ctrl+Z. */
export const RECOMMEND_LABEL = 'Recomendación';

/**
 * "Recomendar" en el editor: pide la propuesta, la adopta como un paso de deshacer y recoge lo
 * que la persona opina de ella (👍, 👎, quedársela, deshacerla) para que las siguientes se le
 * parezcan más. Vive con la página del proyecto, igual que el store.
 */
@Injectable()
export class RecommendService {
  private readonly api = inject(ProjectsApi);
  private readonly store = inject(DesignProjectStore);
  private readonly toast = inject(ToastService);

  /** La propuesta enseñada ahora (la tarjeta del editor). */
  readonly current = signal<RecommendResponse | null>(null);
  readonly working = signal(false);
  /** Lo que ya se dijo de la propuesta actual (para no mandar dos veces el mismo gesto). */
  readonly verdict = signal<RecommendationFeedbackRequest['action'] | null>(null);
  /** Job de la distribución que acompaña a la propuesta: su fin se adopta como la recomendación. */
  private readonly pendingJob = signal<string | null>(null);
  /** ¿Sigue llegando la distribución de la propuesta? */
  readonly isPending = computed(() => this.pendingJob() !== null);

  async recommend(intensity: RecommendIntensity = 'total'): Promise<void> {
    const project = this.store.project();
    if (!project || this.working()) return;
    this.working.set(true);
    try {
      // Lo que aún no se guardó entra antes: la propuesta parte del cuarto tal como se ve.
      await this.store.flush();
      const res = await this.api.recommend(project.id, { intensity });
      this.current.set(res);
      this.verdict.set(null);
      if (res.jobId) this.pendingJob.set(res.jobId);
      else await this.store.reload(RECOMMEND_LABEL);
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.working.set(false);
    }
  }

  /**
   * La página lo pregunta al terminar un job: si era la distribución de la propuesta, la recarga
   * va al historial como "Recomendación" (acabados y muebles en un mismo paso).
   */
  claimJob(jobId: string): string | undefined {
    if (jobId !== this.pendingJob()) return undefined;
    this.pendingJob.set(null);
    return RECOMMEND_LABEL;
  }

  async feedback(action: RecommendationFeedbackRequest['action']): Promise<void> {
    const project = this.store.project();
    const rec = this.current();
    if (!project || !rec || this.verdict() === action) return;
    if (action === 'undone' && this.store.undoLabel() === RECOMMEND_LABEL) this.store.undo();
    this.verdict.set(action);
    if (action === 'kept' || action === 'undone') this.current.set(null);
    try {
      await this.api.recommendationFeedback(project.id, rec.recommendationId, { action });
      if (action === 'like') this.toast.success('Anotado: las próximas irán por ahí');
      if (action === 'dislike') this.toast.show('Anotado: probaremos por otro lado');
    } catch {
      // Opinar es opcional: si no llega, la propuesta sigue igual y no hay nada que deshacer.
    }
  }

  dismiss(): void {
    this.current.set(null);
  }
}
