import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FURNISHED_TEMPLATES, ROOM_TYPE_LABELS, STYLES } from '@interiores/shared-types';
import { IconComponent } from '../../shared/ui/icon.component';

/** Los diseños destacados de la vitrina, en el orden en que se publican. */
export const SHOWCASE = FURNISHED_TEMPLATES.filter((t) => t.featured);

/** El siguiente cuadro del marco (vuelve al primero después del último). */
export function nextFrame(index: number, count: number): number {
  return count ? (index + 1) % count : 0;
}

/**
 * La vitrina, en un solo marco: los seis diseños destacados se suceden dentro de él, todos desde la
 * misma altura y con la misma luz. A la izquierda, sus nombres: pasar por encima de uno lo enseña y
 * hacer clic lo abre en el editor, sin cuenta.
 */
@Component({
  selector: 'app-vitrina',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  host: { '(document:visibilitychange)': 'onVisibility()' },
  template: `
    <div class="container vitrina">
      <div class="index">
        <h2 id="templates-title">Empieza por uno ya hecho.</h2>
        <p class="sub">Cada diseño abre el editor sin pedir cuenta. Lo que cambies se queda en tu navegador hasta que decidas guardarlo.</p>
        <ul class="names">
          @for (t of items; track t.id; let i = $index) {
            <li>
              <a
                [routerLink]="['/demo', t.id]"
                [class.on]="index() === i"
                (mouseenter)="show(i)"
                (focus)="show(i)"
                (mouseleave)="hover.set(false)"
                (blur)="hover.set(false)"
              >
                <span class="name">{{ t.name }}</span>
                <span class="kind">{{ rooms[t.roomType] }} · {{ styles[t.styleId].label }}</span>
              </a>
            </li>
          }
        </ul>
        <a class="arrow-link" routerLink="/plantillas">Ver todas las plantillas <app-icon name="arrowRight" /></a>
      </div>
      <figure class="frame">
        <button type="button" class="shots" aria-label="Ver el siguiente diseño" (click)="advance()">
          @for (t of items; track t.id; let i = $index) {
            <img
              [class.on]="index() === i"
              [src]="'escenas/' + t.id + '.webp'"
              [alt]="index() === i ? t.name + ': ' + t.summary : ''"
              [attr.aria-hidden]="index() === i ? null : 'true'"
              width="960"
              height="640"
              loading="lazy"
              decoding="async"
            />
          }
        </button>
        <figcaption>{{ current().summary }}</figcaption>
      </figure>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .vitrina {
      display: grid;
      grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
      gap: clamp(32px, 6vw, 96px);
      align-items: center;
    }
    h2 {
      margin: 0 0 var(--space-4);
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 300;
      font-size: clamp(2.6rem, 5.4vw, 5rem);
      line-height: 0.9;
      text-transform: uppercase;
    }
    .sub {
      margin: 0 0 var(--space-6);
      max-width: 40ch;
    }
    .names {
      list-style: none;
      margin: 0 0 var(--space-6);
      padding: 0;
      display: grid;
    }
    .names a {
      display: grid;
      gap: 2px;
      padding: 10px 0;
      color: var(--text);
      text-decoration: none;
    }
    .name {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      line-height: 1.1;
      transition:
        color 0.3s var(--ease),
        transform 0.3s var(--ease);
    }
    .kind {
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .names a.on .name {
      color: var(--primary);
      transform: translateX(8px);
    }
    .frame {
      margin: 0;
      display: grid;
      gap: var(--space-3);
    }
    .shots {
      position: relative;
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      aspect-ratio: 3 / 2;
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--surface-2);
      cursor: pointer;
    }
    .shots img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.7s var(--ease);
    }
    .shots img.on {
      opacity: 1;
    }
    figcaption {
      min-height: 3em;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    @media (max-width: 860px) {
      .vitrina {
        grid-template-columns: 1fr;
      }
      .frame {
        order: -1;
      }
    }
  `,
})
export class VitrinaComponent {
  protected readonly items = SHOWCASE;
  protected readonly rooms = ROOM_TYPE_LABELS;
  protected readonly styles = STYLES;
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.items[this.index()]!);
  /** Mientras el cursor o el foco están en un nombre, el marco no avanza solo. */
  protected readonly hover = signal(false);
  protected readonly paused = signal(false);

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const timer = window.setInterval(() => {
        if (!this.hover() && !this.paused()) this.index.set(nextFrame(this.index(), this.items.length));
      }, 3200);
      destroy.onDestroy(() => window.clearInterval(timer));
    });
  }

  /** Con la pestaña oculta el marco no avanza. */
  protected onVisibility(): void {
    this.paused.set(document.hidden);
  }

  protected show(i: number): void {
    this.hover.set(true);
    this.index.set(i);
  }

  protected advance(): void {
    this.index.set(nextFrame(this.index(), this.items.length));
  }
}
