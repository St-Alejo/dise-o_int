import { Injectable, inject, signal } from '@angular/core';
import type { ChatAgentKind, ChatTurn } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { DesignProjectStore } from '../project/design-project.store';
import { commandFromOperations, roomFromOperations } from './chat-operations';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  agent?: ChatAgentKind;
  /** Cuántos cambios aplicó este mensaje del asistente. */
  changes?: number;
  error?: boolean;
}

/** Etiqueta del paso de deshacer que deja el asistente (ver chat-operations). */
export const CHAT_UNDO_LABEL = 'Cambios del asistente';

/**
 * Conversación con el asistente de diseño. Vive mientras el editor está abierto (se provee en
 * EditorComponent), así la conversación no se pierde al cambiar de pestaña del panel.
 */
@Injectable()
export class DesignChatService {
  private readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private seq = 0;

  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal(false);

  async send(raw: string): Promise<void> {
    const message = raw.trim().slice(0, 500);
    if (!message || this.busy()) return;
    const history = this.history();
    this.push({ role: 'user', text: message });
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
      const res = await this.api.chat(project.id, { revision: project.revision, message, history });
      const room = roomFromOperations(res.operations);
      if (room) await this.store.updateRoom(room);
      const { command } = commandFromOperations(res.operations, { placements: this.store.placements(), finishes: this.store.finishes() });
      if (command) this.store.execute(command);
      this.push({ role: 'assistant', text: res.reply, agent: res.agent, changes: res.operations.length });
    } catch (err) {
      const e = ApiError.from(err);
      const text = e.status === 409 ? 'El proyecto cambió mientras escribías. Inténtalo de nuevo.' : e.status === 429 ? 'Vas muy rápido: espera un momento y vuelve a intentarlo.' : `No pude hacerlo: ${e.userMessage}`;
      this.push({ role: 'assistant', text, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** ¿El último paso de deshacer es del asistente? (botón "Deshacer" junto a su respuesta). */
  canUndoLast(): boolean {
    return this.store.undoLabel() === CHAT_UNDO_LABEL;
  }

  undoLast(): void {
    if (this.canUndoLast()) this.store.undo();
  }

  clear(): void {
    this.messages.set([]);
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
