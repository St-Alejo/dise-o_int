import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { ProModeService } from './core/ui/pro-mode.service';
import { ThemeService } from './core/ui/theme.service';
import { ToastService } from './core/ui/toast.service';
import { IconComponent } from './shared/ui/icon.component';
import { TooltipDirective } from './shared/ui/tooltip.directive';

/** Secciones de la página de inicio a las que se llega desde la cabecera y el pie. */
const SECTIONS = [
  { fragment: 'como-funciona', label: 'Cómo funciona' },
  { fragment: 'editor', label: 'El editor' },
  { fragment: 'estilos', label: 'Estilos' },
  { fragment: 'plantillas', label: 'Plantillas' },
  { fragment: 'preguntas', label: 'Preguntas' },
] as const;

const REPO_URL = 'https://github.com/St-Alejo/dise-o_int';

/**
 * El marco de la app: cabecera de revista (el nombre en la serif, la navegación en la sans), el
 * contenido y un pie de dos líneas. En la página de inicio la cabecera se funde con el lino.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, TooltipDirective],
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
  template: `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <header class="app-header" [class.at-home]="atHome()">
      <div class="container bar">
        <a routerLink="/" class="brand" aria-label="Interiores IA, inicio">
          <!-- Monograma: el vano de una puerta en arco, con el piso a la altura del zócalo. -->
          <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M14 58V28a18 18 0 0 1 36 0v30z" fill="currentColor" />
            <path d="M14 46h36" stroke="var(--bg)" stroke-width="4" />
            <circle cx="40" cy="38" r="2.6" fill="var(--bg)" />
          </svg>
          <span class="word">Interiores <em>IA</em></span>
        </a>
        <span class="spacer"></span>
        <nav id="main-nav" aria-label="Principal" class="nav" [class.open]="menuOpen()">
          @if (auth.user(); as user) {
            <a routerLink="/proyectos" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="nav-link">Mis proyectos</a>
            <button
              type="button"
              class="nav-link pro-toggle"
              [class.on]="pro.enabled()"
              [attr.aria-pressed]="pro.enabled()"
              (click)="pro.toggle()"
              appTooltip="Planos técnicos, normativa, cantidades de obra e instalaciones"
            >
              <app-icon name="pro" /> Modo Pro
            </button>
            <span class="user" [appTooltip]="user.email">{{ user.displayName }}</span>
            <button type="button" class="nav-link" (click)="auth.logout()">Salir</button>
            <a routerLink="/proyectos/nuevo" class="btn btn-primary btn-sm">Nuevo proyecto</a>
          } @else {
            @for (s of sections; track s.fragment) {
              <a routerLink="/" [fragment]="s.fragment" class="nav-link section-link">{{ s.label }}</a>
            }
            <a routerLink="/entrar" class="nav-link">Entrar</a>
            <a routerLink="/registro" class="btn btn-primary btn-sm">Crear cuenta</a>
          }
        </nav>
        <button
          type="button"
          class="icon-btn small"
          (click)="theme.toggle()"
          [attr.aria-label]="theme.dark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
          [appTooltip]="theme.dark() ? 'Tema claro' : 'Tema oscuro'"
        >
          <app-icon [name]="theme.dark() ? 'sun' : 'moon'" />
        </button>
        <button
          type="button"
          class="icon-btn small menu-toggle"
          aria-controls="main-nav"
          [attr.aria-expanded]="menuOpen()"
          [attr.aria-label]="menuOpen() ? 'Cerrar el menú' : 'Abrir el menú'"
          (click)="menuOpen.set(!menuOpen())"
        >
          <app-icon [name]="menuOpen() ? 'close' : 'menu'" />
        </button>
      </div>
    </header>

    <main id="main" tabindex="-1">
      <router-outlet />
    </main>

    <footer class="app-footer">
      <div class="container foot">
        <p class="foot-what">
          <span class="foot-name">Interiores <em>IA</em></span>
          De la foto de tu cuarto a un 3D que puedes amueblar, recorrer y compartir.
        </p>
        <nav aria-label="Pie de página" class="foot-links">
          @for (s of sections; track s.fragment) {
            <a routerLink="/" [fragment]="s.fragment">{{ s.label }}</a>
          }
        </nav>
        <p class="foot-note">
          Tus fotos: sin ubicación GPS, no entrenan modelos y se borran a las 24 h si no guardas el proyecto. Angular y three.js · NestJS,
          PostgreSQL y Redis · FastAPI. Proyecto final de Programación Orientada a Objetos ·
          <a [href]="repo" target="_blank" rel="noopener">Código en GitHub <app-icon name="external" /></a>
        </p>
      </div>
    </footer>

    <div class="toasts" aria-live="polite" aria-atomic="false">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.kind" role="status">
          <span>{{ t.message }}</span>
          @if (t.action; as action) {
            <button type="button" class="btn btn-sm toast-action" (click)="toast.act(t)">{{ action.label }}</button>
          }
          <button type="button" class="icon-btn" aria-label="Cerrar aviso" (click)="toast.dismiss(t.id)"><app-icon name="close" /></button>
        </div>
      }
    </div>
  `,
  styles: `
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 8px;
      z-index: 100;
      background: var(--surface);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
    }
    .skip-link:focus {
      left: 8px;
    }
    .app-header {
      position: sticky;
      top: 0;
      z-index: 20;
      height: var(--header-h);
      display: flex;
      align-items: center;
      background: color-mix(in srgb, var(--bg) 90%, transparent);
      backdrop-filter: blur(12px);
      box-shadow: 0 1px 0 var(--border);
    }
    /* En la home el lino de la cabecera es el mismo de la página: sin separación. */
    .app-header.at-home {
      position: absolute;
      inset: 0 0 auto;
      background: transparent;
      backdrop-filter: none;
      box-shadow: none;
      /* Va sobre la película oscura: tinta clara en toda la cabecera. */
      --text: #f6f1e9;
      --text-muted: #d8d0c4;
      --primary: #f6f1e9;
      --primary-strong: #ffffff;
      --on-primary: #100f0e;
      --border: rgb(246 241 233 / 35%);
      --surface: rgb(246 241 233 / 10%);
      color: var(--text);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      color: var(--primary);
      text-decoration: none;
    }
    .word {
      color: var(--text);
      font-family: var(--font-display);
      font-size: 1.55rem;
      line-height: 1;
      letter-spacing: -0.01em;
    }
    .word em,
    .foot-name em {
      color: var(--primary);
    }
    .icon-btn.small {
      width: 44px;
      height: 44px;
      border-color: transparent;
      background: transparent;
      color: var(--text);
    }
    .icon-btn.small:hover {
      background: var(--surface-2);
    }
    .menu-toggle {
      display: none;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-right: var(--space-2);
    }
    .nav-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 12px;
      border: 0;
      background: none;
      color: var(--text);
      font: inherit;
      font-weight: 500;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
      background-image: linear-gradient(currentColor, currentColor);
      background-size: 0 1px;
      background-repeat: no-repeat;
      background-position: 12px calc(100% - 12px);
      transition: background-size 0.25s var(--ease);
    }
    .nav-link:hover,
    .nav-link.active {
      background-size: calc(100% - 24px) 1px;
    }
    .nav-link.active {
      color: var(--primary);
    }
    .nav .btn {
      margin-left: var(--space-2);
    }
    .pro-toggle.on {
      color: var(--primary);
      font-weight: 650;
    }
    .user {
      max-width: 160px;
      padding: 0 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
      font-size: 0.92rem;
    }
    main {
      min-height: calc(100vh - var(--header-h));
      outline: none;
    }
    .app-footer {
      padding-block: clamp(56px, 8vw, 112px) var(--space-6);
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .foot {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: var(--space-4) var(--space-6);
      align-items: baseline;
    }
    .foot p {
      margin: 0;
    }
    .foot-what {
      max-width: 40ch;
    }
    .foot-name {
      display: block;
      margin-bottom: 4px;
      color: var(--text);
      font-family: var(--font-display);
      font-size: 1.45rem;
      line-height: 1.1;
    }
    .foot-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px 20px;
    }
    .app-footer a {
      color: var(--text);
      text-decoration: none;
    }
    .app-footer a:hover {
      color: var(--primary);
      text-decoration: underline;
    }
    /* Dentro de la nota el enlace va subrayado: no basta con el color para distinguirlo. */
    .foot-note a {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .foot-links a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
    .foot-note {
      justify-self: end;
      max-width: 46ch;
      text-align: right;
    }
    .toasts {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: min(420px, calc(100vw - 32px));
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 10px 10px 16px;
      border-radius: var(--radius);
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      animation: slide-in 0.2s var(--ease);
    }
    .toast span {
      flex: 1;
    }
    .toast-error {
      border-color: var(--danger);
      background: var(--danger-soft);
    }
    .toast-success {
      border-color: var(--success);
    }
    .toast .icon-btn {
      width: 32px;
      height: 32px;
    }
    @keyframes slide-in {
      from {
        transform: translateY(8px);
        opacity: 0;
      }
    }
    @media (max-width: 1080px) {
      .section-link {
        display: none;
      }
    }
    @media (max-width: 900px) {
      .foot {
        grid-template-columns: 1fr;
      }
      .foot-links {
        justify-content: flex-start;
      }
      .foot-note {
        justify-self: start;
        text-align: left;
      }
    }
    @media (max-width: 760px) {
      .menu-toggle {
        display: inline-grid;
      }
      /* En móvil el menú es un panel bajo la cabecera, cerrado hasta que se pide. */
      .nav {
        display: none;
        position: absolute;
        top: var(--header-h);
        left: 0;
        right: 0;
        margin: 0;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        padding: var(--space-3) var(--space-4) var(--space-5);
        background: var(--bg);
        box-shadow: var(--shadow);
      }
      .nav.open {
        display: flex;
      }
      .nav .section-link {
        display: flex;
      }
      .nav .btn {
        margin: var(--space-3) 0 0;
      }
      .user {
        max-width: none;
        padding: 10px 12px;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  protected readonly pro = inject(ProModeService);
  protected readonly sections = SECTIONS;
  protected readonly repo = REPO_URL;
  /** El menú de la cabecera en pantallas angostas. */
  protected readonly menuOpen = signal(false);
  /** En la home la cabecera va sobre el lino de la portada, sin fondo propio. */
  protected readonly atHome = signal(false);

  constructor() {
    // Elegir un destino cierra el menú.
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.menuOpen.set(false);
        this.atHome.set(event.urlAfterRedirects.split(/[?#]/)[0] === '/');
      }
    });
  }
}
