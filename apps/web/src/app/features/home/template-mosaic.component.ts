import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FURNISHED_TEMPLATES, ROOM_TYPE_LABELS, STYLES } from '@interiores/shared-types';

/** Cuántas plantillas caben en el mosaico: una grande y cuatro pequeñas. */
export const MOSAIC_SIZE = 5;

/**
 * Mosaico de plantillas amuebladas: la primera en grande y las demás alrededor. Cada una abre el
 * editor sin pedir cuenta.
 */
@Component({
  selector: 'app-template-mosaic',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <ul class="mosaic">
      @for (t of templates; track t.id) {
        <li>
          <a [routerLink]="['/demo', t.id]" [attr.aria-label]="'Abrir la plantilla ' + t.name + ' en el editor'">
            <img [src]="'escenas/' + t.id + '.webp'" alt="" width="960" height="640" loading="lazy" decoding="async" />
            <span class="label">
              <span class="kind">{{ roomLabels[t.roomType] }} · {{ styles[t.styleId].label }}</span>
              <span class="name">{{ t.name }}</span>
            </span>
          </a>
        </li>
      }
    </ul>
  `,
  styles: `
    .mosaic {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-auto-rows: minmax(0, 1fr);
      gap: var(--space-4);
    }
    li:first-child {
      grid-column: span 2;
      grid-row: span 2;
    }
    a {
      position: relative;
      display: block;
      height: 100%;
      overflow: hidden;
      border-radius: var(--radius);
      background: var(--surface-2);
      color: #f5f1e8;
      text-decoration: none;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      aspect-ratio: 3 / 2;
      object-fit: cover;
      transition: transform 0.6s var(--ease);
    }
    a:hover img,
    a:focus-visible img {
      transform: scale(1.04);
    }
    .label {
      position: absolute;
      inset: auto 0 0 0;
      display: grid;
      gap: 2px;
      padding: var(--space-6) var(--space-4) var(--space-3);
      background: linear-gradient(to top, rgb(12 28 27 / 78%), rgb(12 28 27 / 0%));
    }
    .kind {
      font-size: var(--text-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.85;
    }
    .name {
      font-family: var(--font-display);
      font-size: var(--text-lg);
    }
    li:first-child .name {
      font-size: var(--text-xl);
    }
    @media (max-width: 860px) {
      .mosaic {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 520px) {
      .mosaic {
        grid-template-columns: 1fr;
      }
      li:first-child {
        grid-column: auto;
        grid-row: auto;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      img {
        transition: none;
      }
    }
  `,
})
export class TemplateMosaicComponent {
  protected readonly templates = FURNISHED_TEMPLATES.slice(0, MOSAIC_SIZE);
  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly styles = STYLES;
}
