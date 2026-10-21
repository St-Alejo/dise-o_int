import { Injectable, inject, signal } from '@angular/core';
import type { ChatAgentKind, ChatResponse, ChatTurn } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { RecommendService } from '../brief/recommend.service';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { CHAT_COMMAND_LABEL, briefFromOperations, commandFromOperations, recommendFromOperations, roomFromOperations } from './chat-operations';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  agent?: ChatAgentKind;
  /** Cuántos cambios aplicó este mensaje del asistente. */
  changes?: number;
  error?: boolean;
  /** Miniatura de la imagen de referencia que mandó la persona. */
  imageUrl?: string;
  /** Colores que el asistente leyó de esa imagen. */
  palette?: string[];
}

/** Etiqueta del paso de deshacer que deja el asistente (ver chat-operations). */
export const CHAT_UNDO_LABEL = CHAT_COMMAND_LABEL;

/** Imágenes de referencia aceptadas (el servidor vuelve a validar el tipo real). */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Conversación con el asistente de diseño. Vive mientras el editor está abierto (se provee en
 * EditorComponent), así la conversación no se pierde al cambiar de pestaña del panel.
 */
@Injectable()
export class DesignChatService {
  private readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private readonly recommender = inject(RecommendService, { optional: true });
  private readonly edits = inject(SceneEditsService, { optional: true });
  private seq = 0;

  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal(false);

  async send(raw: string): Promise<void> {
    const message = raw.trim().slice(0, 500);
    if (!message || this.busy()) return;
    const history = this.history();
    this.push({ role: 'user', text: message });
    await this.talk((projectId, revision) => this.api.chat(projectId, { revision, message, history }));
  }

  /** "Hazlo como esta foto": manda la imagen y aplica lo que el asistente leyó de ella. */
  async sendImage(file: Blob): Promise<void> {
    if (this.busy()) return;
    if (!IMAGE_TYPES.has(file.type)) {
      this.push({ role: 'assistant', text: 'Esa imagen no la puedo leer: usa una foto JPG, PNG o WebP.', error: true });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.push({ role: 'assistant', text: 'La imagen pesa demasiado (máximo 15 MB).', error: true });
      return;
    }
    this.push({ role: 'user', text: 'Hazlo como esta imagen', imageUrl: URL.createObjectURL(file) });
    await this.talk((projectId, revision) => this.api.chatReference(projectId, revision, file));
  }

  /** ¿El último paso de deshacer es del asistente? (botón "Deshacer" junto a su respuesta). */
  canUndoLast(): boolean {
    return this.store.undoLabel() === CHAT_UNDO_LABEL;
  }

  undoLast(): void {
    if (this.canUndoLast()) this.store.undo();
  }

  clear(): void {
    for (const m of this.messages()) if (m.imageUrl) URL.revokeObjectURL(m.imageUrl);
    this.messages.set([]);
  }

  private async talk(call: (projectId: string, revision: number) => Promise<ChatResponse>): Promise<void> {
    this.busy.set(true);
    try {
      // Lo pendiente se guarda primero: el asistente trabaja sobre la escena del servidor.
      await this.store.flush();
      if (this.store.saveState() === 'conflict') {
        this.push({ role: 'assistant', text: 'El proyecto cambió en otra pestaña. Carga la versión actual y vuelve a pedírmelo.', error: true });
        return;
      }
      const project = this.store.project();
      if (!project) return;
      const res = await call(project.id, project.revision);
      await this.apply(res);
      this.push({
        role: 'assistant',
        text: res.reply,
        agent: res.agent,
        changes: res.operations.filter((o) => o.op !== 'brief' && o.op !== 'recommend').length,
        ...(res.reference?.palette.length ? { palette: res.reference.palette } : {}),
      });
    } catch (err) {
      const e = ApiError.from(err);
      const text = e.status === 409 ? 'El proyecto cambió mientras escribías. Inténtalo de nuevo.' : e.status === 429 ? 'Vas muy rápido: espera un momento y vuelve a intentarlo.' : `No pude hacerlo: ${e.userMessage}`;
      this.push({ role: 'assistant', text, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Orden: medidas (servidor) → escena (un comando deshacible) → Brief (servidor) → y al final,
   * o la propuesta de Recomendar (que ya redistribuye) o, si cambiaron las zonas, otra distribución.
   */
  private async apply(res: ChatResponse): Promise<void> {
    const room = roomFromOperations(res.operations);
    if (room) await this.store.updateRoom(room);
    const { command, zonesChanged } = commandFromOperations(res.operations, {
      placements: this.store.placements(),
      finishes: this.store.finishes(),
      shell: this.store.shell(),
    });
    if (command) this.store.execute(command);
    const brief = briefFromOperations(res.operations);
    if (brief) await this.store.setBrief(brief);
    const intensity = recommendFromOperations(res.operations);
    if (intensity && this.recommender) await this.recommender.recommend(intensity);
    else if (zonesChanged && this.edits) await this.edits.relayout();
  }

  /** Últimos turnos (sin errores) para dar contexto: "ponla más cerca" sabe de qué se habla. */
  private history(): ChatTurn[] {
    return this.messages()
      .filter((m) => !m.error)
      .slice(-12)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));
  }

  private push(m: Omit<ChatMessage, 'id'>): void {
    this.messages.update((list) => [...list, { ...m, id: ++this.seq }]);
  }
}
