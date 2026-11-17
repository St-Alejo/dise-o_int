import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon.component';

export interface CasaRoom {
  id: string;
  name: string;
  summary: string;
  /** piso de la casa, desde 1 */
  floor: number;
}

/** Los interiores de la Casa Mirador (diseñados aquí sobre la casa que se dibujó en Plano 3D). */
export const CASA_MIRADOR: readonly CasaRoom[] = [
  { id: 'casa4-sala', floor: 1, name: 'Sala doble altura', summary: 'Dos ambientes frente a los ventanales: TV de 65" con sofá en L y un estar de bouclé.' },
  { id: 'casa4-cocina', floor: 1, name: 'Cocina abierta de roble', summary: 'Hilera completa con nevera de acero, isla de tres puestos y colgantes de latón.' },
  { id: 'casa4-comedor', floor: 1, name: 'Comedor de nogal', summary: 'Mesa de nogal para seis bajo dos lámparas, aparador lacado y luz del ventanal lateral.' },
  { id: 'casa4-alcoba2', floor: 2, name: 'Alcoba con vista a la calle', summary: 'Cama queen de lino, TV de 43" en la pared y escritorio de roble bajo la ventana.' },
  { id: 'casa4-suite', floor: 3, name: 'Suite principal', summary: 'Cama king de nogal, TV de 55" frente a la cama y un rincón de lectura junto al ventanal.' },
  { id: 'casa4-bano-suite', floor: 3, name: 'Baño de la suite', summary: 'Bañera exenta bajo la ventana, doble lavabo de roble, ducha de obra y mármol.' },
  { id: 'casa4-estudio', floor: 3, name: 'Estudio principal', summary: 'Escritorio de metal frente a la ventana, pared de ladrillo y sillón de cuero para leer.' },
  { id: 'casa4-cine', floor: 3, name: 'Sala de cine', summary: 'Pared de carbón con TV de 65", dos filas de sofás, alfombra mullida y luz tenue.' },
];

/** Pisos con interiores diseñados, de abajo hacia arriba. */
export const CASA_FLOORS = [...new Set(CASA_MIRADOR.map((r) => r.floor))].sort((a, b) => a - b);

/** La casa en Plano 3D: en local, su web de desarrollo; publicada, la de Azure. */
export function plano3dFeaturedUrl(host: string): string {
  const local = host === 'localhost' || host === '127.0.0.1';
  const base = local ? 'http://localhost:5175' : 'https://lively-island-09e124b1e.5.azurestaticapps.net';
  return `${base}/destacados/prj_destacado_casa4`;
}

/**
 * La casa destacada: una de 4 pisos que se dibujó en Plano 3D, se pasó aquí con un código y se
 * amuebló ambiente por ambiente. Se recorre piso por piso: cada pestaña enseña sus cuartos.
 */
@Component({
  selector: 'app-casa-mirador',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="container casa">
      <header class="head">
        <p class="eyebrow">Casa destacada · con Plano 3D</p>
        <h2 id="casa-title">Una casa entera, piso por piso.</h2>
        <p class="sub">
          La Casa Mirador se dibujó en Plano 3D a partir de sus planos, llegó aquí con un código y se amuebló cuarto por cuarto.
          Los muros siguen siendo de Plano 3D; los muebles y acabados, de Interiores, y cada cambio se ve en las dos apps al instante.
        </p>
        <div class="ctas">
          <a class="btn btn-lg btn-primary" [href]="plano3dUrl" target="_blank" rel="noopener">Recorrerla en Plano 3D <app-icon name="arrowRight" /></a>
          <a class="btn btn-lg btn-ghost" routerLink="/conectar">Conectar tu casa</a>
        </div>
      </header>

      <figure class="facade">
        <img src="escenas/casa4/fachada.webp" alt="Fachada de la Casa Mirador al atardecer: cuatro pisos blancos con garaje de madera y terraza cubierta." width="1600" height="900" loading="lazy" decoding="async" />
      </figure>

      <div class="floors" role="tablist" aria-label="Pisos de la casa">
        @for (f of floors; track f) {
          <button type="button" role="tab" aria-controls="casa-piso" [attr.aria-selected]="floor() === f" [class.on]="floor() === f" (click)="pick(f)">
            Piso {{ f }} <span>{{ countOn(f) }} {{ countOn(f) === 1 ? 'ambiente' : 'ambientes' }}</span>
          </button>
        }
      </div>
      <div id="casa-piso" class="panel" role="tabpanel" [attr.aria-label]="'Piso ' + floor()">
        <ul class="rooms">
          @for (r of shown(); track r.id) {
            <li>
              <img [src]="'escenas/casa4/' + r.id + '.webp'" [alt]="r.name + ': ' + r.summary" width="1600" height="900" loading="lazy" decoding="async" />
              <h3>{{ r.name }}</h3>
              <p>{{ r.summary }}</p>
            </li>
          }
        </ul>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .casa {
      display: grid;
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      gap: var(--space-6) clamp(32px, 6vw, 96px);
      align-items: center;
    }
    .eyebrow {
      margin: 0 0 var(--space-3);
      font-size: var(--text-sm);
      color: var(--primary);
      letter-spacing: 0.08em;
      text-transform: uppercase;
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
      max-width: 46ch;
    }
    .ctas {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .facade {
      margin: 0;
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--surface-2);
    }
    .facade img,
    .rooms img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 16 / 9;
      object-fit: cover;
    }
    .floors {
      grid-column: 1 / -1;
      display: flex;
      gap: var(--space-2);
      overflow-x: auto;
      scrollbar-width: none;
      border-bottom: 1px solid var(--border);
    }
    .floors button {
      flex: none;
      white-space: nowrap;
      min-height: 44px;
      padding: 10px 18px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      cursor: pointer;
    }
    .floors button span {
      font-family: var(--font-body, inherit);
      font-size: var(--text-sm);
    }
    .floors button.on {
      color: var(--text);
      border-bottom-color: var(--primary);
    }
    .panel {
      grid-column: 1 / -1;
    }
    .rooms {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
      gap: var(--space-5);
    }
    .rooms img {
      border-radius: var(--radius-md, 12px);
      background: var(--surface-2);
    }
    h3 {
      margin: var(--space-3) 0 4px;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      line-height: 1.1;
    }
    .rooms p {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    @media (max-width: 860px) {
      .casa {
        grid-template-columns: 1fr;
      }
      .floors button {
        padding: 10px 12px;
      }
      .floors button span {
        display: none;
      }
    }
  `,
})
export class CasaMiradorComponent {
  protected readonly floors = CASA_FLOORS;
  protected readonly floor = signal(CASA_FLOORS[0] ?? 1);
  protected readonly shown = computed(() => CASA_MIRADOR.filter((r) => r.floor === this.floor()));
  protected readonly plano3dUrl = plano3dFeaturedUrl(typeof location === 'undefined' ? '' : location.hostname);

  protected pick(floor: number): void {
    this.floor.set(floor);
  }

  protected countOn(floor: number): number {
    return CASA_MIRADOR.filter((r) => r.floor === floor).length;
  }
}
