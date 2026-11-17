import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { RevealDirective } from '../../shared/ui/reveal.directive';
import { HERO_TEMPLATE } from './cover.component';
import { CasaMiradorComponent } from './casa-mirador.component';
import { FilmComponent } from './film.component';
import { reducedMotion, smoothScroll } from './motion';
import { PiecesComponent } from './pieces.component';
import { RunwayComponent } from './runway.component';
import { VitrinaComponent } from './vitrina.component';
import { WalkComponent } from './walk.component';

/**
 * Página de inicio en cuatro movimientos, cada uno con su propia forma de avanzar con el scroll:
 * la película (de la foto al hogar), la pista (el plano tendido por el que vuela la cámara), el
 * paseo por los seis estilos y las piezas del catálogo flotando. Todo lo que enseña
 * sale de la app: sus renders, sus capturas y su catálogo.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, RevealDirective, FilmComponent, RunwayComponent, WalkComponent, PiecesComponent, VitrinaComponent, CasaMiradorComponent],
  template: `
    <app-film [start]="start()" />

    <div id="editor" class="anchor"></div>
    <app-runway />

    <div id="estilos" class="anchor"></div>
    <app-walk />

    <div id="catalogo" class="anchor"></div>
    <app-pieces />

    <section id="plantillas" class="vitrina-sec" aria-labelledby="templates-title">
      <app-vitrina appReveal />
    </section>

    <section id="casa" class="vitrina-sec casa-sec" aria-labelledby="casa-title">
      <app-casa-mirador appReveal />
    </section>

    <section class="closing" aria-labelledby="closing-title">
      <img
        src="landing/cuarto-noche-1600.webp"
        srcset="landing/cuarto-noche-800.webp 800w, landing/cuarto-noche-1600.webp 1600w"
        sizes="100vw"
        alt="La sala de noche, alumbrada solo por su lámpara colgante."
        width="1600"
        height="1000"
        loading="lazy"
        decoding="async"
      />
      <div class="closing-copy" appReveal>
        <h2 id="closing-title" class="giant">Empieza con el cuarto que tienes.</h2>
        <div class="closing-row">
          <p>Una foto o tres medidas bastan para verlo en 3D. Gratis y sin instalar nada.</p>
          <div class="closing-cta">
            <a class="btn btn-lg brass" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="btn btn-lg outline" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      --ink: #f3eee6;
      --ink-2: #a89f93;
      --brass: #c9a46a;
      --night: #100f0e;
      /* Menos aire entre secciones que en el resto de la app: la portada ya es larga. */
      --section-y: clamp(56px, 7vw, 112px);
      background: var(--night);
    }
    section,
    .anchor {
      scroll-margin-top: var(--header-h);
    }
    .vitrina-sec {
      padding-block: var(--section-y);
      background: var(--bg);
    }
    .casa-sec {
      padding-top: 0;
    }

    /* Cierre: la sala de noche a sangre y una frase que ocupa todo el ancho. */
    .closing {
      position: relative;
      min-height: 100svh;
      display: grid;
      align-items: end;
      color: var(--ink);
      background: var(--night);
      overflow: hidden;
    }
    .closing img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .closing::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(transparent 30%, rgb(16 15 14 / 92%) 88%);
    }
    .closing-copy {
      position: relative;
      z-index: 1;
      padding: 0 clamp(16px, 4vw, 56px) clamp(40px, 8vh, 80px);
    }
    .giant {
      margin: 0 0 32px;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 600;
      font-size: clamp(3rem, 9.6vw, 10.5rem);
      line-height: 0.84;
      text-transform: uppercase;
      color: var(--ink);
      max-width: 12ch;
    }
    .closing-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: end;
      gap: 24px;
      border-top: 1px solid rgb(243 238 230 / 30%);
      padding-top: 24px;
    }
    .closing-row p {
      margin: 0;
      max-width: 36ch;
      font-size: var(--text-lg);
    }
    .closing-cta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn.brass {
      --btn-bg: var(--brass);
      --btn-fg: var(--night);
      --btn-border: var(--brass);
    }
    .btn.brass:hover {
      background: #dcb97f;
      border-color: #dcb97f;
    }
    .btn.outline {
      --btn-bg: transparent;
      --btn-fg: var(--ink);
      --btn-border: var(--ink);
    }
    .btn.outline:hover {
      background: rgb(255 255 255 / 12%);
      border-color: var(--ink);
    }

    @media (max-width: 860px) {
      .closing-cta .btn {
        flex: 1 1 100%;
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly template = HERO_TEMPLATE;
  protected readonly start = computed(() => (this.auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'));

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (reducedMotion()) return;
      let stop: (() => void) | null = null;
      let alive = true;
      destroy.onDestroy(() => {
        alive = false;
        stop?.();
      });
      void smoothScroll().then((off) => (alive ? (stop = off) : off()));
    });
  }
}
