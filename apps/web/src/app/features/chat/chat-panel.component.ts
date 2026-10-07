import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DesignProjectStore } from '../project/design-project.store';
import { DesignChatService } from './design-chat.service';

/** Sugerencias según el tipo de cuarto (un clic las envía). */
const SUGGESTIONS: Record<string, string[]> = {
  bedroom: ['Agrega una mesa de noche junto a la cama', 'Pon una lámpara de mesa junto a la cama', 'Pinta las paredes de verde salvia'],
  living: ['Pon una lámpara de pie junto al sofá', 'Agrega una mesa de centro frente al sofá', 'Cuelga un cuadro encima del sofá'],
  office: ['Agrega una silla frente al escritorio', 'Pon una lámpara de escritorio sobre el escritorio', 'Agrega una estantería contra la pared'],
  dining: ['Agrega cuatro sillas junto a la mesa', 'Pon una lámpara colgante encima de la mesa', 'Piso de nogal'],
};
const DEFAULT_SUGGESTIONS = ['Agrega una planta en la esquina', 'Pinta las paredes de greige', 'El cuarto mide 4 x 3,5'];

/** Chat con el asistente de diseño: escribe lo que quieres y lo coloca en el cuarto. */
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat">
      <div class="log" #log role="log" aria-live="polite" aria-label="Conversación con el asistente">
        @if (chat.messages().length === 0) {
          <div class="intro">
            <p>Dime qué quieres cambiar y lo coloco por ti: muebles, lámparas, colores, medidas del cuarto…</p>
            <div class="suggestions" role="group" aria-label="Sugerencias">
              @for (s of suggestions(); track s) {
                <button type="button" class="chip" (click)="send(s)" [disabled]="chat.busy()">{{ s }}</button>
              }
            </div>
          </div>
        }
        @for (m of chat.messages(); track m.id; let last = $last) {
          <div class="msg" [class.user]="m.role === 'user'" [class.error]="m.error">
            <span class="sr-only">{{ m.role === 'user' ? 'Tú' : 'Asistente' }}:</span>
            <p class="text">{{ m.text }}</p>
            @if (m.role === 'assistant' && !m.error) {
              <div class="meta row">
                <span class="badge" [class.badge-primary]="m.agent === 'claude'" [title]="m.agent === 'claude' ? 'Respondió Claude' : 'Respondió el asistente básico (sin IA)'">
                  {{ m.agent === 'claude' ? 'IA' : 'Básico' }}
                </span>
                @if (m.changes) {
                  <span class="muted">{{ m.changes }} {{ m.changes === 1 ? 'cambio' : 'cambios' }}</span>
                }
                <span class="spacer"></span>
                @if (last && m.changes && chat.canUndoLast()) {
                  <button type="button" class="btn btn-sm btn-ghost" (click)="chat.undoLast()">Deshacer</button>
                }
              </div>
            }
          </div>
        }
        @if (chat.busy()) {
          <div class="msg typing" aria-label="El asistente está pensando"><span></span><span></span><span></span></div>
        }
      </div>

      <form class="composer" (submit)="$event.preventDefault(); send(draft())">
        <label class="sr-only" for="chat-input">Mensaje para el asistente</label>
        <textarea
          id="chat-input"
          class="input"
          rows="2"
          maxlength="500"
          placeholder="Ej.: pon una lámpara de pie junto al sofá"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          (keydown.enter)="onEnter($any($event))"
          [disabled]="readOnly()"
        ></textarea>
        <button type="submit" class="btn btn-primary" [disabled]="chat.busy() || !draft().trim() || readOnly()">Enviar</button>
      </form>
      @if (chat.messages().length) {
        <button type="button" class="btn btn-sm btn-ghost clear" (click)="chat.clear()" [disabled]="chat.busy()">Nueva conversación</button>
      }
    </div>
  `,
  styles: `
    .chat {
      display: grid;
      gap: 10px;
    }
    .log {
      display: grid;
      gap: 8px;
      align-content: start;
      max-height: min(52vh, 460px);
      min-height: 160px;
      overflow-y: auto;
      padding: 2px;
    }
    .intro p {
      margin: 0 0 10px;
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .suggestions .chip {
      text-align: left;
    }
    .msg {
      max-width: 92%;
      padding: 8px 12px;
      border-radius: var(--radius);
      background: var(--primary-soft);
      justify-self: start;
    }
    .msg.user {
      justify-self: end;
      background: var(--primary);
      color: var(--on-primary);
    }
    .msg.error {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .text {
      margin: 0;
      white-space: pre-line;
      font-size: 0.9rem;
    }
    .meta {
      gap: 8px;
      margin-top: 6px;
      font-size: 0.78rem;
    }
    .composer {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
    }
    textarea {
      resize: vertical;
      min-height: 44px;
    }
    .clear {
      justify-self: start;
    }
    .typing {
      display: flex;
      gap: 4px;
    }
    .typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      animation: blink 1.2s infinite ease-in-out;
    }
    .typing span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .typing span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes blink {
      0%,
      80%,
      100% {
        opacity: 0.25;
      }
      40% {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .typing span {
        animation: none;
      }
    }
  `,
})
export class ChatPanelComponent {
  protected readonly chat = inject(DesignChatService);
  private readonly store = inject(DesignProjectStore);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  protected readonly draft = signal('');
  protected readonly readOnly = computed(() => !this.store.project());
  protected readonly suggestions = computed(() => SUGGESTIONS[this.store.project()?.roomType ?? ''] ?? DEFAULT_SUGGESTIONS);

  constructor() {
    // Siempre se ve lo último de la conversación.
    effect(() => {
      this.chat.messages();
      this.chat.busy();
      const el = this.log()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  protected send(text: string): void {
    if (!text.trim() || this.chat.busy()) return;
    this.draft.set('');
    void this.chat.send(text);
  }

  /** Enter envía; Shift+Enter hace un salto de línea. */
  protected onEnter(e: KeyboardEvent): void {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.send(this.draft());
  }
}
