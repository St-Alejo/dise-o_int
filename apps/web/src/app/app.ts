import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { ThemeService } from './core/ui/theme.service';
import { ToastService } from './core/ui/toast.service';
import { IconComponent } from './shared/ui/icon.component';

/** Secciones de la página de inicio a las que se llega desde la cabecera y el pie. */
const SECTIONS = [
  { fragment: 'como-funciona', label: 'Cómo funciona' },
  { fragment: 'que-hace', label: 'Qué hace' },
  { fragment: 'estilos', label: 'Estilos' },
  { fragment: 'preguntas', label: 'Preguntas' },
] as const;

const REPO_URL = 'https://github.com/St-Alejo/dise-o_int';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
  template: `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <header class="app-header">
      <div class="container bar">
        <a routerLink="/" class="brand" aria-label="Interiores IA, inicio">
          <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="currentColor" />
            <path d="M14 44V30l18-14 18 14v14" fill="none" stroke="var(--on-primary)" stroke-width="5" stroke-linejoin="round" />
            <rect x="22" y="34" width="20" height="10" rx="3" fill="var(--on-primary)" />
          </svg>
          <span>Interiores <strong>IA</strong></span>
        </a>
        <span class="spacer"></span>
        <button
          type="button"
          class="icon-btn small"
          (click)="theme.toggle()"
          [attr.aria-label]="theme.dark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
          [title]="theme.dark() ? 'Tema claro' : 'Tema oscuro'"
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
        <nav id="main-nav" aria-label="Principal" class="nav" [class.open]="menuOpen()">
          @if (auth.user(); as user) {
            <a routerLink="/proyectos" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="nav-link">Mis proyectos</a>
            <a routerLink="/proyectos/nuevo" class="btn btn-primary btn-sm">Nuevo proyecto</a>
            <span class="user muted" [title]="user.email">{{ user.displayName }}</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="auth.logout()">Salir</button>
          } @else {
            @for (s of sections; track s.fragment) {
              <a routerLink="/" [fragment]="s.fragment" class="nav-link section-link">{{ s.label }}</a>
            }
            <a routerLink="/entrar" class="nav-link">Entrar</a>
            <a routerLink="/registro" class="btn btn-primary btn-sm">Crear cuenta</a>
          }
        </nav>
      </div>
    </header>

    <main id="main" tabindex="-1">
      <router-outlet />
    </main>

    <footer class="app-footer">
      <div class="container cols">
        <div class="about">
          <p class="foot-brand">Interiores <strong>IA</strong></p>
          <p class="muted">
            De una foto de tu cuarto a un 3D que puedes amueblar, recorrer y compartir. Proyecto final de Programación Orientada a Objetos.
          </p>
        </div>
        <div>
          <h2>Producto</h2>
          <ul>
            @for (s of sections; track s.fragment) {
              <li><a routerLink="/" [fragment]="s.fragment">{{ s.label }}</a></li>
            }
          </ul>
        </div>
        <div>
          <h2>Tus fotos</h2>
          <ul class="plain">
            <li>Se les quita la ubicación GPS al subirlas.</li>
            <li>No se usan para entrenar modelos.</li>
            <li>Se borran a las 24 h si no guardas el proyecto.</li>
          </ul>
        </div>
        <div>
          <h2>Cómo está hecho</h2>
          <ul class="plain">
            <li>Angular y three.js en el navegador.</li>
            <li>NestJS, PostgreSQL y Redis en el servidor.</li>
            <li>FastAPI para analizar la foto y distribuir.</li>
            <li>
              <a [href]="repo" target="_blank" rel="noopener">Código en GitHub <app-icon name="external" /></a>
            </li>
          </ul>
        </div>
      </div>
    </footer>

    <div class="toasts" aria-live="polite" aria-atomic="false">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.kind" role="status">
          <span>{{ t.message }}</span>
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
      border-radius: 8px;
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
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--primary);
      text-decoration: none;
      font-family: var(--font-display);
      font-size: 1.2rem;
    }
    .brand span {
      color: var(--text);
    }
    .icon-btn.small {
      width: 36px;
      height: 36px;
      color: var(--text-muted);
    }
    .menu-toggle {
      display: none;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .nav-link {
      color: var(--text);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.95rem;
      padding: 6px 10px;
      border-radius: 8px;
    }
    .nav-link:hover {
      background: var(--surface-2);
    }
    .nav-link.active {
      color: var(--primary);
    }
    .user {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.9rem;
    }
    main {
      min-height: calc(100vh - var(--header-h));
      outline: none;
    }
    .app-footer {
      border-top: 1px solid var(--border);
      background: var(--tint-1);
      padding-block: var(--space-7) var(--space-6);
      font-size: var(--text-sm);
    }
    .cols {
      display: grid;
      grid-template-columns: 1.4fr repeat(3, 1fr);
      gap: var(--space-6);
    }
    .app-footer h2 {
      font-family: var(--font);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 var(--space-3);
    }
    .app-footer ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .app-footer a {
      color: var(--text);
      text-decoration: none;
    }
    .app-footer a:hover {
      color: var(--primary);
      text-decoration: underline;
    }
    .plain {
      color: var(--text-muted);
    }
    .foot-brand {
      font-family: var(--font-display);
      font-size: 1.2rem;
      margin: 0 0 var(--space-2);
    }
    .about p:last-child {
      margin: 0;
      max-width: 38ch;
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
      border-radius: 12px;
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
      width: 28px;
      height: 28px;
    }
    @keyframes slide-in {
      from {
        transform: translateY(8px);
        opacity: 0;
      }
    }
    @media (max-width: 1000px) {
      .section-link {
        display: none;
      }
    }
    @media (max-width: 760px) {
      .cols {
        grid-template-columns: 1fr 1fr;
      }
      .about {
        grid-column: 1 / -1;
      }
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
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-1);
        padding: var(--space-3) var(--space-4) var(--space-4);
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        box-shadow: var(--shadow);
      }
      .nav.open {
        display: flex;
      }
      .nav .section-link {
        display: block;
      }
      .nav-link {
        padding: 10px;
      }
      .user {
        max-width: none;
        padding: 6px 10px;
      }
    }
    @media (max-width: 460px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  protected readonly sections = SECTIONS;
  protected readonly repo = REPO_URL;
  /** El menú de la cabecera en pantallas angostas. */
  protected readonly menuOpen = signal(false);

  constructor() {
    // Elegir un destino cierra el menú.
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.menuOpen.set(false);
    });
  }
}
