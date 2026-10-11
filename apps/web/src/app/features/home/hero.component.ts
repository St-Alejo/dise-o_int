import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ROOM_SHAPE_IDS, ROOM_TEMPLATES, buildRoomFromSpec, type RoomShapeId } from '@interiores/shared-types';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { FloorPlanComponent } from '../floor-plan/floor-plan.component';

/** Medidas del cuarto de muestra del plano interactivo, por forma. */
const DEMO_ROOM = { widthM: 5.5, depthM: 4.5, heightM: 2.6 };

/** Un cuarto real de cada forma, creado y amueblado con la app. */
const RENDERS: Record<RoomShapeId, { src: string; alt: string }> = {
  rect: { src: 'landing/hero-rect.webp', alt: 'Una sala rectangular en 3D con una pared azul, sofá, butaca de cuero y mesa de centro.' },
  L: { src: 'landing/hero-L.webp', alt: 'Una sala en forma de L en 3D con sofá en L, butaca, librero y lámpara de pie.' },
  T: { src: 'landing/hero-T.webp', alt: 'Un comedor en forma de T en 3D con una pared terracota, mesa para seis y un aparador.' },
  U: { src: 'landing/hero-U.webp', alt: 'Un dormitorio en forma de U en 3D con cama, mesitas, un sillón y un armario.' },
};

const PERKS: readonly { icon: IconName; text: string }[] = [
  { icon: 'camera', text: 'Con una foto o con tres medidas' },
  { icon: 'cube', text: 'Todo se edita sobre el 3D' },
  { icon: 'shield', text: 'Tus fotos no entrenan modelos' },
];

/**
 * Encabezado de la página de inicio. El plano es el mismo componente del asistente y, a su lado,
 * se ve un cuarto de esa forma ya amueblado: el punto de partida y el resultado.
 */
@Component({
  selector: 'app-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FloorPlanComponent, IconComponent],
  template: `
    <div class="container grid">
      <div class="copy">
        <p class="eyebrow">Diseño de interiores con IA</p>
        <h1>De una foto de tu cuarto a un <span class="mark">3D que puedes recorrer</span> y cambiar.</h1>
        <p class="lead">
          La app reconoce puertas, ventanas, muebles y colores, arma tu cuarto con su forma real y te deja amueblarlo, caminarlo y llevarte
          la lista de compras.
        </p>
        <div class="row cta">
          <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto <app-icon name="arrowRight" /></a>
          @if (!signedIn()) {
            <a class="btn btn-lg" routerLink="/entrar">Ya tengo cuenta</a>
          }
        </div>
        <ul class="perks">
          @for (perk of perks; track perk.text) {
            <li><app-icon [name]="perk.icon" /> {{ perk.text }}</li>
          }
        </ul>
      </div>

      <figure class="demo card">
        <div class="demo-head">
          <span class="label" id="demo-label">Pruébalo: elige una forma</span>
          <div class="row shapes" role="group" aria-labelledby="demo-label">
            @for (s of shapes; track s.id) {
              <button type="button" class="chip" [attr.aria-pressed]="shape() === s.id" (click)="shape.set(s.id)">{{ s.label }}</button>
            }
          </div>
        </div>
        <div class="panes">
          <div class="pane">
            <span class="tag">El plano</span>
            <app-floor-plan class="plan" [shell]="room()" />
          </div>
          <div class="pane">
            <span class="tag accent">Ya amueblado</span>
            <img [src]="render().src" [alt]="render().alt" width="844" height="675" fetchpriority="high" />
          </div>
        </div>
        <figcaption class="muted fine">
          Cada proyecto empieza con un plano a medida y termina en un cuarto en 3D. Los dos son de la app, no un montaje.
        </figcaption>
      </figure>
    </div>
  `,
  styles: `
    :host {
      display: block;
      background: var(--gradient-brand);
      border-bottom: 1px solid var(--border);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1.1fr;
      gap: var(--space-7);
      align-items: center;
      padding-block: clamp(var(--space-6), 6vw, 80px);
    }
    .copy {
      display: grid;
      gap: var(--space-4);
      justify-items: start;
    }
    h1 {
      margin: 0;
      font-size: var(--text-3xl);
      line-height: 1.05;
    }
    /* Un subrayado grueso bajo la frase, del color de resalte: no cambia el color del texto. */
    .mark {
      background: linear-gradient(transparent 68%, color-mix(in srgb, var(--highlight) 55%, transparent) 68%);
    }
    .lead {
      margin: 0;
      max-width: 52ch;
    }
    .cta {
      gap: var(--space-3);
    }
    .perks {
      list-style: none;
      margin: var(--space-2) 0 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .perks li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .perks app-icon {
      color: var(--primary);
    }
    .demo {
      margin: 0;
      display: grid;
      gap: var(--space-3);
      box-shadow: var(--shadow);
    }
    .demo-head {
      display: grid;
      gap: var(--space-2);
    }
    .shapes {
      gap: var(--space-2);
    }
    .panes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
    }
    .pane {
      position: relative;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-2);
      overflow: hidden;
      aspect-ratio: 5 / 4;
    }
    .plan,
    .pane img {
      width: 100%;
      height: 100%;
    }
    .plan {
      padding: var(--space-5) var(--space-2) var(--space-2);
    }
    .pane img {
      object-fit: cover;
    }
    .tag {
      position: absolute;
      top: var(--space-2);
      left: var(--space-2);
      z-index: 1;
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--primary-soft);
      color: var(--primary-strong);
      font-size: var(--text-xs);
      font-weight: 700;
    }
    .tag.accent {
      background: var(--accent-soft);
      color: var(--accent-strong);
    }
    figcaption {
      margin: 0;
    }
    @media (max-width: 980px) {
      .grid {
        grid-template-columns: 1fr;
        gap: var(--space-6);
      }
    }
    @media (max-width: 520px) {
      .panes {
        grid-template-columns: 1fr;
      }
      .cta .btn {
        width: 100%;
      }
    }
  `,
})
export class HeroComponent {
  /** A dónde lleva el botón principal (depende de si hay sesión). */
  readonly start = input.required<string>();
  readonly signedIn = input(false);

  protected readonly perks = PERKS;
  protected readonly shapes = ROOM_SHAPE_IDS.map((id) => ({ id, label: ROOM_TEMPLATES[id].label }));
  protected readonly shape = signal<RoomShapeId>('L');
  /** El cuarto de muestra con la forma elegida: lo construye el mismo código que crea los proyectos. */
  protected readonly room = computed(() => buildRoomFromSpec({ shape: this.shape(), ...DEMO_ROOM }));
  protected readonly render = computed(() => RENDERS[this.shape()]);
}
