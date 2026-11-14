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
            <span class="shot"><img [src]="'escenas/' + t.id + '.webp'" alt="" width="960" height="640" loading="lazy" decoding="async" /></span>
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
      height: 100%;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: var(--space-3);
      color: var(--text);
      text-decoration: none;
    }
    .shot {
      overflow: hidden;
      background: var(--surface-2);
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
    /* El nombre va debajo de la imagen, en la tinta de la página. */
    .label {
      display: grid;
      gap: 2px;
    }
    .kind {
      font-size: var(--text-base);
      color: var(--text-muted);
    }
    a:hover .name {
      text-decoration: underline;
      text-underline-offset: 4px;
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
