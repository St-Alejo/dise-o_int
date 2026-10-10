import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { ThemeService } from './core/ui/theme.service';
import { ToastService } from './core/ui/toast.service';
import { IconComponent } from './shared/ui/icon.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <header class="app-header">
      <div class="container row">
        <a routerLink="/" class="brand" aria-label="Interiores IA, inicio">
          <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="currentColor" />
            <path d="M14 44V30l18-14 18 14v14" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" />
            <rect x="22" y="34" width="20" height="10" rx="3" fill="#fff" />
          </svg>
          <span>Interiores <strong>IA</strong></span>
        </a>
        <span class="spacer"></span>
        <button
          type="button"
          class="icon-btn theme"
          (click)="theme.toggle()"
          [attr.aria-label]="theme.dark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
          [title]="theme.dark() ? 'Tema claro' : 'Tema oscuro'"
        >
          <app-icon [name]="theme.dark() ? 'sun' : 'moon'" />
        </button>
        <nav aria-label="Principal" class="row">
          @if (auth.user(); as user) {
            <a routerLink="/proyectos" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="nav-link">Mis proyectos</a>
            <a routerLink="/proyectos/nuevo" class="btn btn-primary btn-sm">Nuevo proyecto</a>
            <span class="user muted" [title]="user.email">{{ user.displayName }}</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="auth.logout()">Salir</button>
          } @else {
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
      <div class="container row">
        <span>Interiores <strong>IA</strong> · proyecto final de Programación Orientada a Objetos</span>
        <span class="spacer"></span>
        <span class="muted">Tus fotos no se usan para entrenar modelos y se borran a las 24 h si no guardas el proyecto.</span>
      </div>
    </footer>

    <div class="toasts" aria-live="polite" aria-atomic="false">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.kind" role="status">
          <span>{{ t.message }}</span>
          <button type="button" class="icon-btn" aria-label="Cerrar aviso" (click)="toast.dismiss(t.id)">×</button>
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
    .app-footer {
      border-top: 1px solid var(--border);
      padding-block: var(--space-5);
      font-size: 0.88rem;
    }
    .app-footer .row {
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
    }
    main {
      min-height: calc(100vh - var(--header-h) - 90px);
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
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--primary);
      text-decoration: none;
      font-family: var(--font-display);
      font-size: 1.2rem;
    }
    .theme {
      width: 36px;
      height: 36px;
      color: var(--text-muted);
    }
    .brand span {
      color: var(--text);
    }
    .nav-link {
      color: var(--text);
      text-decoration: none;
      font-weight: 500;
      padding: 6px 8px;
      border-radius: 8px;
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
    @media (max-width: 640px) {
      .user {
        display: none;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);
}
