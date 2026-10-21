import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DesignToolbox,
  STYLES,
  type AnalyzeReferenceResponse,
  type ChatRequest,
  type ChatResponse,
  type ChatTurn,
  type DesignOperation,
} from '@interiores/shared-types';
import { randomUUID } from 'node:crypto';
import { AiServiceError, QuotaExceededError, StaleRevisionError, ValidationError } from '../../common/errors.js';
import { PhotoProcessor } from '../../infrastructure/imaging/photo-processor.js';
import { CHAT_QUOTA, type IAiClient, type IFileStorage, type IQuota, type ProjectRecord } from '../../ports/index.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { projectKeys } from '../projects/project.mapper.js';
import { ProjectsService, type Actor } from '../projects/projects.service.js';
import { AgentDeclinedError, AgentUnavailableError, type DesignAgent } from './design-agent.js';

/** Los agentes, en el orden en que se prueban: local → Groq → Claude → reglas. */
export interface ChatAgents {
  local?: DesignAgent;
  groq?: DesignAgent;
  claude?: DesignAgent;
  rules: DesignAgent;
}
export const CHAT_AGENTS = Symbol('ChatAgents');

/** Lo que necesita "hazlo como esta foto": dónde guardarla, cómo normalizarla y quién la lee. */
export interface ReferenceDeps {
  ai: IAiClient;
  storage: IFileStorage;
  photos: PhotoProcessor;
  maxBytes: number;
}
export const REFERENCE_DEPS = Symbol('ReferenceDeps');

const SURFACE_LABEL = { tile: 'baldosa', wood: 'madera', stone: 'piedra', carpet: 'moqueta', concrete: 'cemento' } as const;

/**
 * Caso de uso del chat de diseño. Arma una DesignToolbox sobre la escena guardada, deja que el
 * agente trabaje y devuelve las operaciones resultantes. NO guarda nada: la web las aplica como
 * un solo comando deshacible y guarda la escena como cualquier otra edición.
 *
 * Cascada: primero el modelo propio (gratis, sin red externa); si no está seguro, Groq; luego
 * Claude si hay clave; y siempre, al final, el agente por reglas. Los LLM gastan la cuota diaria.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CHAT_AGENTS) private readonly agents: ChatAgents,
    @Inject(CHAT_QUOTA) private readonly quota: IQuota,
    @Optional() @Inject(REFERENCE_DEPS) private readonly reference?: ReferenceDeps,
  ) {}

  async chat(actor: Actor, id: string, req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const project = await this.ownFresh(actor, id, req.revision);
    const newToolbox = await this.toolboxFactory(project);
    const input = {
      message: req.message,
      history: req.history as ChatTurn[],
      context: { roomType: project.roomType, styleId: project.selectedStyleId },
      ...(signal ? { signal } : {}),
    };

    let note = '';
    let quotaLeft = true;
    for (const agent of [this.agents.local, this.agents.groq, this.agents.claude]) {
      if (!agent?.available) continue;
      const external = agent.kind !== 'local';
      if (external && !quotaLeft) continue;
      let charged = false;
      // Toolbox nueva por agente: lo que uno haya hecho a medias no se mezcla con el siguiente.
      const toolbox = newToolbox();
      try {
        if (external) {
          await this.quota.consume(actor.userId, 1);
          charged = true;
        }
        const { reply } = await agent.run({ ...input, toolbox });
        return { reply, operations: toolbox.operations(), agent: agent.kind };
      } catch (err) {
        if (charged && !(err instanceof QuotaExceededError)) await this.quota.refund(actor.userId, 1).catch(() => undefined);
        if (err instanceof AgentDeclinedError) continue;
        if (err instanceof QuotaExceededError) {
          quotaLeft = false;
          note = `${err.message} Mientras tanto te ayudo con el asistente básico.\n`;
        } else if (err instanceof AgentUnavailableError) {
          this.logger.warn({ err: err.message, projectId: id, agent: agent.kind }, 'Agente no disponible: pruebo el siguiente');
          note ||= 'El asistente con IA no está disponible ahora; usé el asistente básico.\n';
        } else {
          throw err;
        }
      }
    }
    const toolbox = newToolbox();
    const { reply } = await this.agents.rules.run({ ...input, toolbox });
    return { reply: `${note}${reply}`, operations: toolbox.operations(), agent: 'rules' };
  }

  /**
   * "Hazlo como esta foto": se lee la imagen (visión de Groq con su cuota, o colores dominantes
   * en local), lo leído se fija en el Brief (piso, paredes, estilo, luz) y se pide una propuesta
   * de Recomendar que adapta eso a la geometría de ESTE cuarto.
   */
  async fromReference(actor: Actor, id: string, revision: number, image: Buffer, signal?: AbortSignal): Promise<ChatResponse> {
    if (!this.reference) throw new ValidationError('Las imágenes de referencia no están disponibles');
    const project = await this.ownFresh(actor, id, revision);
    const { ai, storage, photos, maxBytes } = this.reference;
    const processed = await photos.process(image, maxBytes);
    const key = projectKeys.reference(id, processed.hash);
    if (!(await storage.exists(key))) await storage.put(key, processed.photo, 'image/jpeg');
    let ref: AnalyzeReferenceResponse;
    try {
      ref = await ai.analyzeReference({ imageKey: key }, signal ? { signal } : {});
    } catch (err) {
      if (!(err instanceof AiServiceError)) throw err;
      this.logger.warn({ err: err.message, projectId: id }, 'No se pudo leer la imagen de referencia');
      return { reply: 'No pude leer la imagen ahora. Inténtalo en un momento o descríbeme lo que te gusta de ella.', operations: [], agent: 'local' };
    }
    const toolbox = (await this.toolboxFactory(project))();
    const said = applyReference(toolbox, ref);
    const operations: DesignOperation[] = toolbox.operations();
    const source = ref.source === 'vision' ? 'Leí la imagen' : 'Tomé los colores de la imagen';
    return {
      reply: `${source}: ${said.join(', ')}. Fijé eso y armo una propuesta para tu cuarto con ese aire.`,
      operations,
      agent: ref.source === 'vision' ? 'groq' : 'local',
      reference: { source: ref.source, palette: ref.palette, ...(ref.style ? { style: ref.style } : {}) },
    };
  }

  private async ownFresh(actor: Actor, id: string, revision: number): Promise<ProjectRecord & { roomShell: NonNullable<ProjectRecord['roomShell']> }> {
    const project = await this.projects.own(actor, id);
    if (project.revision !== revision) {
      throw new StaleRevisionError('El proyecto cambió mientras escribías: recarga e inténtalo de nuevo');
    }
    if (!project.roomShell) throw new ValidationError('El cuarto aún se está analizando');
    return project as ProjectRecord & { roomShell: NonNullable<ProjectRecord['roomShell']> };
  }

  private async toolboxFactory(project: ProjectRecord & { roomShell: NonNullable<ProjectRecord['roomShell']> }): Promise<() => DesignToolbox> {
    const catalog = await this.catalog.all();
    return () =>
      new DesignToolbox({
        shell: project.roomShell,
        placements: project.placements,
        finishes: project.finishes,
        brief: project.brief ?? null,
        catalog,
        newId: randomUUID,
      });
  }
}

/** Lo leído de la referencia, como herramientas (las mismas que usaría el chat). Devuelve qué se hizo. */
export function applyReference(tb: DesignToolbox, ref: AnalyzeReferenceResponse): string[] {
  const said: string[] = [];
  if (ref.floor) {
    const out = tb.run('set_finish_spec', {
      surface: 'floor',
      spec: { name: `Piso de ${SURFACE_LABEL[ref.floor.kind]} de la referencia`, kind: ref.floor.kind, colors: ref.floor.colors, pattern: ref.floor.pattern, gloss: ref.floor.gloss },
    });
    if (out.ok) said.push(`piso de ${SURFACE_LABEL[ref.floor.kind]}`);
  }
  if (ref.wallColor && tb.run('set_finish_spec', { surface: 'walls', spec: { name: 'Paredes de la referencia', kind: 'paint', colors: [ref.wallColor], pattern: 'plain', gloss: 0.1 } }).ok) {
    said.push('color de paredes');
  }
  if (ref.style && tb.run('pin', { target: 'style', styleId: ref.style }).ok) said.push(`estilo ${STYLES[ref.style].label.toLowerCase()}`);
  if ((ref.mood || ref.level) && tb.run('set_lighting', { ...(ref.mood ? { mood: ref.mood } : {}), ...(ref.level ? { level: ref.level } : {}), pin: true }).ok) {
    said.push('luz');
  }
  tb.run('recommend', { intensity: 'total' });
  return said.length ? said : ['su paleta'];
}
