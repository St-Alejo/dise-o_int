import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FURNISHED_TEMPLATES, ROOM_TYPE_LABELS, STYLES } from '@interiores/shared-types';
import { IconComponent } from '../../shared/ui/icon.component';
import { RevealDirective } from '../../shared/ui/reveal.directive';

/** Galería de cuartos ya amueblados: cada uno abre el editor sin pedir cuenta. */
@Component({
  selector: 'app-templates-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, RevealDirective],
  template: `
    <section class="container page">
      <header class="section-head">
        <h1>Empieza por un cuarto <em>ya hecho.</em></h1>
        <p class="lead">Ábrelo, mueve lo que quieras y recórrelo. No hace falta cuenta: se guarda en este navegador hasta que decidas quedártelo.</p>
      </header>
      <ul class="grid" appReveal>
        @for (t of templates; track t.id) {
          <li>
            <a class="tile" [routerLink]="['/demo', t.id]">
              <span class="shot">
                <img [src]="'/escenas/' + t.id + '.webp'" [alt]="'Vista 3D de la plantilla ' + t.name" width="960" height="640" loading="lazy" decoding="async" />
              </span>
              <span class="body">
                <span class="kind">{{ roomLabels[t.roomType] }} · {{ styles[t.styleId].label }}@if (t.pro) { <span class="badge badge-accent">Pro</span>}@if (t.featured) { <span class="badge badge-accent">Destacada</span>}</span>
                <span class="name">{{ t.name }}</span>
                <span class="summary">{{ t.summary }}</span>
                <span class="go">Abrir en el editor <app-icon name="arrowRight" /></span>
              </span>
            </a>
          </li>
        }
      </ul>
      <p class="fine after">¿Prefieres tu propio cuarto? <a routerLink="/proyectos/nuevo">Créalo con una foto o con sus medidas</a>.</p>
    </section>
  `,
  styles: `
    .page {
      padding: var(--space-7) 0;
    }
    .page {
      padding-top: clamp(40px, 6vw, 88px);
    }
    h1 {
      margin: 0 0 var(--space-4);
      font-size: var(--text-3xl);
    }
    h1 em {
      color: var(--primary);
    }
    .lead {
      max-width: 52ch;
    }
    /* Las destacadas abren la vitrina en grande, como la portada de una revista. */
    @media (min-width: 900px) {
      .grid li:first-child {
        grid-column: span 2;
        grid-row: span 2;
      }
      .grid li:first-child .shot {
        aspect-ratio: auto;
        height: 100%;
        min-height: 420px;
      }
      .grid li:first-child .tile {
        height: 100%;
        grid-template-rows: minmax(0, 1fr) auto;
      }
    }
    .grid {
      list-style: none;
      margin: var(--space-6) 0 0;
      padding: 0;
      display: grid;
      gap: var(--space-5);
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
    }
    .tile {
      display: grid;
      gap: var(--space-3);
      color: inherit;
      text-decoration: none;
    }
    .shot {
      display: block;
      overflow: hidden;
      border-radius: var(--radius-lg);
      background: var(--surface-2);
      aspect-ratio: 3 / 2;
    }
    .shot img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.5s var(--ease);
    }
    .tile:hover .shot img,
    .tile:focus-visible .shot img {
      transform: scale(1.03);
    }
    .body {
      display: grid;
      gap: 2px;
    }
    .kind {
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .name {
      font-family: var(--font-display);
      font-size: var(--text-xl);
    }
    .summary {
      color: var(--text-muted);
    }
    .go {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      color: var(--primary);
      font-weight: 600;
    }
    .after {
      margin-top: var(--space-6);
    }
    @media (prefers-reduced-motion: reduce) {
      .shot img {
        transition: none;
      }
    }
  `,
})
export class TemplatesPage {
  protected readonly templates = FURNISHED_TEMPLATES;
  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly styles = STYLES;
}
