import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { Plano3dApi, type Plano3dLink } from '../../core/api/plano3d.api';
import { IconComponent } from '../../shared/ui/icon.component';

/** «K7QM3XTP», «k7qm-3xtp» o «K7QM 3XTP» → «K7QM-3XTP» (lo que muestra Plano 3D). */
export function formatShareCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/**
 * «Conectar con Plano 3D» (ADR-0039): se pega el código que da Plano 3D (o se llega con
 * `?codigo=` desde su botón «Abrir Interiores 3D») y la casa aparece aquí, piso por piso,
 * para amueblarla. Los muros siguen siendo de Plano 3D; los cambios viajan en vivo.
 */
@Component({
  selector: 'app-connect-plano3d-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <section class="container page connect">
      <a class="back" routerLink="/proyectos"><app-icon name="back" /> Mis proyectos</a>
      <header>
        <p class="eyebrow">Plano 3D → Interiores</p>
        <h1>Amuebla la casa que hiciste en Plano 3D</h1>
        <p class="lead muted">
          En Plano 3D, abre tu casa y pulsa «Continuar en Interiores 3D». Pega aquí el código: cada ambiente se vuelve un cuarto listo para amueblar, y lo
          que pongas se ve allá al instante.
        </p>
      </header>

      <form class="code-form" (ngSubmit)="connect()" aria-describedby="code-help">
        <label for="share-code">Código de Plano 3D</label>
        <div class="row">
          <input
            id="share-code"
            name="code"
            class="input code"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="K7QM-3XTP"
            maxlength="12"
            [ngModel]="code()"
            (ngModelChange)="code.set(format($event))"
            [disabled]="busy()"
          />
          <button type="submit" class="btn btn-primary btn-lg" [disabled]="!ready() || busy()">
            {{ busy() ? 'Conectando…' : 'Conectar' }}
          </button>
        </div>
        <p id="code-help" class="muted fine">Ocho letras o números. El código vale hasta que lo revoques en Plano 3D.</p>
        @if (error(); as message) {
          <p class="alert alert-danger" role="alert">{{ message }}</p>
        }
      </form>

      @if (links().length) {
        <h2 class="eyebrow list-title">Casas conectadas</h2>
        <ul class="links" role="list">
          @for (l of links(); track l.id) {
            <li>
              <div>
                <a class="name" [routerLink]="['/viviendas', l.homeId]">{{ l.projectName }}</a>
                <span class="muted">
                  {{ l.rooms.length }} {{ l.rooms.length === 1 ? 'cuarto' : 'cuartos' }} · {{ levelsOf(l) }}
                  <span class="badge" [class.badge-success]="l.live">{{ l.live ? 'en vivo' : 'sin conexión' }}</span>
                </span>
              </div>
              <div class="row actions">
                <a class="btn btn-sm btn-primary" [routerLink]="['/viviendas', l.homeId]">Abrir</a>
                <button type="button" class="btn btn-sm" (click)="sync(l)" [disabled]="busy()"><app-icon name="rotateRight" /> Sincronizar</button>
                <button type="button" class="btn btn-sm btn-ghost" (click)="unlink(l)" [disabled]="busy()" [attr.aria-label]="'Desconectar ' + l.projectName">
                  Desconectar
                </button>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .connect {
      max-width: 860px;
    }
    .lead {
      max-width: 62ch;
    }
    .code-form {
      margin-top: var(--space-5);
      padding: var(--space-5);
      border: 1px solid var(--rule);
      border-radius: var(--radius-lg, 12px);
      background: var(--surface);
    }
    .code-form label {
      display: block;
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
    }
    .code {
      flex: 1 1 14rem;
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 1.6rem;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }
    .fine {
      font-size: var(--text-sm);
      margin: var(--space-2) 0 0;
    }
    .alert {
      margin-top: var(--space-3);
    }
    .list-title {
      margin: var(--space-6) 0 0;
    }
    .links {
      list-style: none;
      margin: var(--space-2) 0;
      padding: 0;
      border-top: 1px solid var(--rule);
    }
    .links li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--rule);
    }
    .name {
      display: block;
      font-family: var(--font-display);
      font-size: var(--text-lg);
      font-weight: 500;
      color: var(--text);
      text-decoration: none;
    }
    .badge {
      margin-left: var(--space-2);
    }
  `,
})
export class ConnectPlano3dPage implements OnInit {
  private readonly api = inject(Plano3dApi);
  private readonly router = inject(Router);

  /** `?codigo=` del enlace «Abrir Interiores 3D» de Plano 3D. */
  readonly codigo = input<string | undefined>();

  protected readonly format = formatShareCode;
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly links = signal<Plano3dLink[]>([]);
  protected readonly ready = computed(() => this.code().replace('-', '').length === 8);

  ngOnInit(): void {
    const fromLink = this.codigo();
    if (fromLink) this.code.set(formatShareCode(fromLink));
    void this.api
      .list()
      .then((links) => this.links.set(links))
      .catch(() => undefined);
    // Llegar con el código en el enlace es pedir conectar: no hace falta otro clic.
    if (fromLink && this.ready()) void this.connect();
  }

  async connect(): Promise<void> {
    if (!this.ready() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const link = await this.api.link(this.code());
      await this.router.navigate(['/viviendas', link.homeId]);
    } catch (err) {
      this.error.set(ApiError.from(err).userMessage);
    } finally {
      this.busy.set(false);
    }
  }

  protected async sync(link: Plano3dLink): Promise<void> {
    await this.run(async () => {
      const fresh = await this.api.sync(link.id);
      this.links.update((all) => all.map((l) => (l.id === fresh.id ? fresh : l)));
    });
  }

  protected async unlink(link: Plano3dLink): Promise<void> {
    await this.run(async () => {
      await this.api.unlink(link.id);
      this.links.update((all) => all.filter((l) => l.id !== link.id));
    });
  }

  protected levelsOf(link: Plano3dLink): string {
    const levels = [...new Set(link.rooms.map((r) => r.level))];
    return levels.length === 1 ? levels[0]! : `${levels.length} pisos`;
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await task();
    } catch (err) {
      this.error.set(ApiError.from(err).userMessage);
    } finally {
      this.busy.set(false);
    }
  }
}
