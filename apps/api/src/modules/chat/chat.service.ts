import { Inject, Injectable, Logger } from '@nestjs/common';
import { DesignToolbox, type ChatRequest, type ChatResponse } from '@interiores/shared-types';
import { randomUUID } from 'node:crypto';
import { QuotaExceededError, StaleRevisionError, ValidationError } from '../../common/errors.js';
import { CHAT_QUOTA, type IQuota } from '../../ports/index.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProjectsService, type Actor } from '../projects/projects.service.js';
import { AgentUnavailableError, CLAUDE_AGENT, RULES_AGENT, type DesignAgent } from './design-agent.js';

/**
 * Caso de uso del chat de diseño. Arma una DesignToolbox sobre la escena guardada, deja que el
 * agente trabaje y devuelve las operaciones resultantes. NO guarda nada: la web las aplica como
 * un solo comando deshacible y guarda la escena como cualquier otra edición.
 *
 * Claude si hay API key y cuota; si no, o si Claude falla, el agente por reglas (gratis).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CLAUDE_AGENT) private readonly claude: DesignAgent,
    @Inject(RULES_AGENT) private readonly rules: DesignAgent,
    @Inject(CHAT_QUOTA) private readonly quota: IQuota,
  ) {}

  async chat(actor: Actor, id: string, req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const project = await this.projects.own(actor, id);
    if (project.revision !== req.revision) {
      throw new StaleRevisionError('El proyecto cambió mientras escribías: recarga e inténtalo de nuevo');
    }
    if (!project.roomShell) throw new ValidationError('El cuarto aún se está analizando');
    const shell = project.roomShell;
    const catalog = await this.catalog.all();
    const newToolbox = () =>
      new DesignToolbox({ shell, placements: project.placements, finishes: project.finishes, catalog, newId: randomUUID });
    const input = {
      message: req.message,
      history: req.history,
      context: { roomType: project.roomType, styleId: project.selectedStyleId },
    };

    let note = '';
    if (this.claude.available) {
      let charged = false;
      try {
        await this.quota.consume(actor.userId, 1);
        charged = true;
        const toolbox = newToolbox();
        const { reply } = await this.claude.run({ ...input, toolbox, ...(signal ? { signal } : {}) });
        return { reply, operations: toolbox.operations(), agent: 'claude' };
      } catch (err) {
        if (charged && !(err instanceof QuotaExceededError)) await this.quota.refund(actor.userId, 1).catch(() => undefined);
        if (err instanceof QuotaExceededError) {
          note = `${err.message} Mientras tanto te ayudo con el asistente básico.\n`;
        } else if (err instanceof AgentUnavailableError) {
          this.logger.warn({ err: err.message, projectId: id }, 'Claude no disponible: respondo con el agente por reglas');
          note = 'El asistente con IA no está disponible ahora; usé el asistente básico.\n';
        } else {
          throw err;
        }
      }
    }
    // Toolbox nueva: lo que Claude haya hecho a medias no se mezcla con la respuesta de respaldo.
    const toolbox = newToolbox();
    const { reply } = await this.rules.run({ ...input, toolbox });
    return { reply: `${note}${reply}`, operations: toolbox.operations(), agent: 'rules' };
  }
}
