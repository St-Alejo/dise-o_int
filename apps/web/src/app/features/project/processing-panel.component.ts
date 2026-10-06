import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STAGE_MESSAGES, type JobProgressEvent, type ProgressStage } from '@interiores/shared-types';

const VISIBLE: { stage: ProgressStage; icon: string }[] = [
  { stage: 'geometry', icon: '📐' },
  { stage: 'surfaces', icon: '🔍' },
  { stage: 'styles', icon: '🎨' },
  { stage: 'scene', icon: '🧊' },
];
const ORDER: ProgressStage[] = ['queued', 'geometry', 'surfaces', 'styles', 'scene', 'done'];

/**
 * Paso 2 del flujo: nunca un spinner genérico. Estados descriptivos y secuenciales con
 * la barra de progreso REAL del job (reduce el tiempo de espera percibido).
 */
@Component({
  selector: 'app-processing-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card panel" aria-labelledby="proc-title">
      <h2 id="proc-title">{{ title() }}</h2>
      <div class="bar" role="progressbar" aria-label="Progreso" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()">
        <div [style.width.%]="pct()"></div>
      </div>
      <p class="current" aria-live="polite">{{ event()?.message ?? 'En cola…' }}</p>
      @if (showStages()) {
        <ol class="stages">
          @for (s of stages; track s.stage) {
            <li [class.done]="isDone(s.stage)" [class.active]="isActive(s.stage)">
              <span class="icon" aria-hidden="true">{{ isDone(s.stage) ? '✓' : s.icon }}</span>
              <span>{{ messages[s.stage] }}</span>
              @if (isActive(s.stage)) {
                <span class="visually-hidden">(en curso)</span>
              }
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    .panel {
      max-width: 640px;
      margin: 32px auto;
    }
    .bar {
      height: 10px;
      border-radius: 99px;
      background: var(--surface-2);
      overflow: hidden;
    }
    .bar div {
      height: 100%;
      background: linear-gradient(90deg, var(--primary), var(--accent));
      transition: width 0.4s var(--ease);
    }
    .current {
      margin: 12px 0 16px;
      font-weight: 600;
    }
    .stages {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 8px;
    }
    .stages li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      color: var(--text-muted);
    }
    .stages li.active {
      background: var(--primary-soft);
      color: var(--text);
      font-weight: 600;
    }
    .stages li.active .icon {
      animation: pulse 1.2s infinite;
    }
    .stages li.done {
      color: var(--success);
    }
    .icon {
      width: 28px;
      text-align: center;
      font-size: 1.2rem;
    }
    @keyframes pulse {
      50% {
        transform: scale(1.2);
      }
    }
  `,
})
export class ProcessingPanelComponent {
  readonly event = input<JobProgressEvent | null>(null);
  readonly title = input('Estamos preparando tu cuarto');

  protected readonly stages = VISIBLE;
  protected readonly messages = STAGE_MESSAGES;
  protected readonly pct = computed(() => this.event()?.pct ?? 0);
  protected readonly showStages = computed(() => (this.event()?.kind ?? 'analyze-room') === 'analyze-room');
  private readonly index = computed(() => ORDER.indexOf(this.event()?.stage ?? 'queued'));

  isDone(stage: ProgressStage): boolean {
    return ORDER.indexOf(stage) < this.index() || this.event()?.stage === 'done';
  }

  isActive(stage: ProgressStage): boolean {
    return ORDER.indexOf(stage) === this.index();
  }
}
