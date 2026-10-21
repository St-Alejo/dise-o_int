import {
  type AutoLayoutRequest,
  bestProposal,
  candidateProposals,
  describeProposal,
  type JobAccepted,
  preferenceScore,
  priorScore,
  type Proposal,
  type RankRecommendationsRequest,
  type RankRecommendationsResponse,
  type RecommendationFeedbackRequest,
  type RecommendRequest,
  type RecommendResponse,
} from '@interiores/shared-types';
import { randomInt } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NotFoundError } from '../../common/errors.js';
import type { IProjectRepository } from '../../ports/index.js';
import type { ProjectAccess, Actor } from './project-access.js';

/** Candidatas por petición: baratas (funciones puras), y con 6 ya hay de dónde elegir. */
export const RECOMMEND_CANDIDATES = 6;
/** Estilos recientes que no se repiten al sortear. */
export const RECENT_STYLES = 3;
/** Gestos de la persona que se usan para aprender qué le gusta. */
export const FEEDBACK_HISTORY = 200;

/**
 * "Recomendar": una propuesta entera (estilo, paleta, acabados, luz y, con intensidad total,
 * otra distribución) que respeta lo fijado en el Brief. Cada propuesta y lo que la persona hizo
 * con ella (👍, 👎, quedársela, deshacerla) queda en el historial del que se aprende.
 */
export class RecommendationsService {
  constructor(
    private readonly projects: IProjectRepository,
    private readonly access: ProjectAccess,
    private readonly layout: (actor: Actor, id: string, req: AutoLayoutRequest) => Promise<JobAccepted>,
    /** Modelo de preferencias del servicio de IA; sin él (o si falla) se puntúa aquí mismo. */
    private readonly rank?: (req: RankRecommendationsRequest) => Promise<RankRecommendationsResponse>,
  ) {}

  private readonly logger = new Logger(RecommendationsService.name);

  /** La candidata que más le gustaría a la persona según lo aprendido de sus gestos. */
  private async choose(candidates: Proposal[], history: { features: Record<string, number>; action: RankRecommendationsRequest['history'][number]['action'] }[]): Promise<Proposal> {
    const local = () => bestProposal(candidates, preferenceScore(history));
    if (!this.rank || history.length === 0) return local();
    try {
      const out = await this.rank({
        candidates: candidates.map((c, i) => ({ id: String(i), features: c.features, prior: priorScore(c) })),
        history: history.map((h) => ({ features: h.features, action: h.action })),
      });
      // Con pocos gestos el servicio solo devuelve la nota de oficio: aquí ya se aprovechan.
      if (out.model !== 'logreg') return local();
      const score = (i: number) => out.scores[String(i)] ?? -Infinity;
      return candidates[candidates.reduce((best, _c, i) => (score(i) > score(best) ? i : best), 0)]!;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Modelo de preferencias no disponible: puntúo en local');
      return local();
    }
  }

  async recommend(actor: Actor, id: string, req: RecommendRequest): Promise<RecommendResponse> {
    const project = await this.access.own(actor, id);
    const shell = this.access.requireShell(project);
    const intensity = req.intensity ?? 'total';
    const seed = req.seed ?? randomInt(0, 2_147_483_647);
    const [recent, history] = await Promise.all([
      this.projects.listRecommendations({ projectId: id, actions: ['shown'], limit: RECENT_STYLES }),
      this.projects.listRecommendations({ ownerId: actor.userId, actions: ['like', 'dislike', 'kept', 'undone'], limit: FEEDBACK_HISTORY }),
    ]);
    const candidates = candidateProposals(
      {
        brief: project.brief ?? null,
        finishes: project.finishes,
        styleId: project.selectedStyleId,
        shell,
        seed,
        recentStyles: recent.map((r) => r.styleId),
        intensity,
      },
      RECOMMEND_CANDIDATES,
    );
    const best = await this.choose(candidates, history);
    const updated = await this.projects.update(id, { finishes: best.finishes, selectedStyleId: best.styleId }, { bumpRevision: true });
    const shown = await this.projects.addRecommendation({
      projectId: id,
      ownerId: actor.userId,
      parentId: null,
      styleId: best.styleId,
      features: best.features,
      action: 'shown',
    });
    // Con intensidad total también cambian los muebles: la distribución va a la cola con el estilo
    // y la semilla de la propuesta (las piezas fijadas a mano se quedan donde están).
    const job = intensity === 'total' ? await this.layout(actor, id, { styleId: best.styleId, seed: best.seed, keepLocked: true }) : null;
    return {
      recommendationId: shown.id,
      projectId: id,
      jobId: job?.jobId ?? null,
      styleId: best.styleId,
      seed: best.seed,
      palette: best.palette.colors,
      summary: describeProposal(best),
      revision: updated.revision,
    };
  }

  /** Un gesto sobre una propuesta enseñada: copia sus rasgos para aprender sin unir tablas. */
  async feedback(actor: Actor, id: string, recommendationId: string, req: RecommendationFeedbackRequest): Promise<void> {
    await this.access.own(actor, id);
    const shown = await this.projects.findRecommendation(id, recommendationId);
    if (!shown || shown.parentId) throw new NotFoundError('La recomendación no existe');
    await this.projects.addRecommendation({
      projectId: id,
      ownerId: actor.userId,
      parentId: shown.id,
      styleId: shown.styleId,
      features: shown.features,
      action: req.action,
    });
  }
}
