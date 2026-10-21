import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { ChatAgentKind } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import { DesignChatService } from './design-chat.service';

/** Sugerencias según el tipo de cuarto (un clic las envía). */
const SUGGESTIONS: Record<string, string[]> = {
  bedroom: ['Agrega un tocador junto a la cama', 'Agrega un baño privado con ducha de obra', 'Luz cálida y tenue', 'Pinta las paredes de verde salvia'],
  living: ['Pon una lámpara de pie junto al sofá', 'Piso de madera de roble y luz cálida', 'Recomiéndame algo bohemio', 'Cuelga un cuadro encima del sofá'],
  office: ['Agrega una silla frente al escritorio', 'Luz fría y alta', 'Agrega una estantería contra la pared'],
  dining: ['Agrega cuatro sillas junto a la mesa', 'Pon una lámpara colgante encima de la mesa', 'Piso de nogal'],
  kitchen: ['Revestimiento de azulejo blanco tipo metro hasta 1,2 m', 'Piso de baldosa gris de 60x60 mate', 'Luz neutra y alta'],
  bathroom: ['Piso de baldosa brillante azul claro con verde', 'Pared de la ducha con mármol hasta el techo', 'Agrega un espejo con luz'],
};
const DEFAULT_SUGGESTIONS = ['Piso de baldosa brillante azul claro con verde', 'Recomiéndame algo', 'El cuarto mide 4 x 3,5'];

/** Quién respondió: la etiqueta y su explicación. */
const AGENTS: Record<ChatAgentKind, { label: string; title: string; primary: boolean }> = {
  local: { label: 'Local', title: 'Respondió el modelo propio de la app (sin IA externa)', primary: false },
  groq: { label: 'Groq', title: 'Respondió un modelo de lenguaje en Groq', primary: true },
  claude: { label: 'IA', title: 'Respondió Claude', primary: true },
  rules: { label: 'Básico', title: 'Respondió el asistente básico por reglas', primary: false },
};

/** Chat con el asistente de diseño: escribe lo que quieres y lo coloca en el cuarto. */
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat">
      <div class="log" #log role="log" aria-live="polite" aria-label="Conversación con el asistente">
        @if (chat.messages().length === 0) {
          <div class="intro">
            <p>Dime qué quieres cambiar y lo coloco por ti: muebles, pisos y baldosas, luces, un baño privado… o adjunta una foto que te guste y la replico en tu cuarto. Lo que pidas queda fijado para Recomendar.</p>
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
            @if (m.imageUrl) {
              <img class="ref" [src]="m.imageUrl" alt="Imagen de referencia que enviaste" />
            }
            <p class="text">{{ m.text }}</p>
            @if (m.palette) {
              <div class="palette" role="img" [attr.aria-label]="'Colores leídos: ' + m.palette.join(', ')">
                @for (c of m.palette; track $index) {
                  <span class="sw" [style.background]="c"></span>
                }
              </div>
            }
            @if (m.role === 'assistant' && !m.error && m.agent) {
              <div class="meta row">
                <span class="badge" [class.badge-primary]="agents[m.agent].primary" [title]="agents[m.agent].title">{{ agents[m.agent].label }}</span>
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

      <form class="composer" (submit)="$event.preventDefault(); send(draft())" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
        <input #file type="file" accept="image/jpeg,image/png,image/webp" hidden (change)="onFile($event)" />
        <button
          type="button"
          class="btn btn-ghost attach"
          (click)="file.click()"
          [disabled]="chat.busy() || readOnly()"
          aria-label="Adjuntar una imagen de referencia"
          title="Adjunta (o pega) una foto de un cuarto que te guste y la replico"
        >
          📎
        </button>
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
          (paste)="onPaste($event)"
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
    .ref {
      display: block;
      max-width: 180px;
      max-height: 140px;
      border-radius: calc(var(--radius) - 2px);
      margin-bottom: 6px;
      object-fit: cover;
    }
    .palette {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .sw {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .attach {
      font-size: 1.1rem;
      padding-inline: 10px;
    }
    .composer {
      display: grid;
      grid-template-columns: auto 1fr auto;
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

  protected readonly agents = AGENTS;
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

  protected onFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const image = input.files?.[0];
    input.value = '';
    if (image) void this.chat.sendImage(image);
  }

  /** Una imagen pegada (Ctrl+V) se manda como referencia; el texto se pega como siempre. */
  protected onPaste(e: ClipboardEvent): void {
    const image = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    if (!image || this.readOnly()) return;
    e.preventDefault();
    void this.chat.sendImage(image);
  }

  protected onDrop(e: DragEvent): void {
    const image = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!image || this.readOnly()) return;
    e.preventDefault();
    void this.chat.sendImage(image);
  }

  /** Enter envía; Shift+Enter hace un salto de línea. */
  protected onEnter(e: KeyboardEvent): void {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.send(this.draft());
  }
}
