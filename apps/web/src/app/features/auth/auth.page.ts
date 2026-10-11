import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';

/** Lo que se cuenta junto al formulario: qué se obtiene con la cuenta y qué pasa con las fotos. */
const PERKS: readonly { icon: IconName; title: string; text: string }[] = [
  { icon: 'cube', title: 'Tu cuarto en 3D', text: 'A partir de una foto o de su forma y sus medidas.' },
  { icon: 'walk', title: 'Recórrelo y cámbialo', text: 'Mueve, gira y pinta mientras caminas por dentro.' },
  { icon: 'cart', title: 'Lista de compras', text: 'Cada mueble con sus medidas y su precio estimado.' },
  { icon: 'shield', title: 'Tus fotos son tuyas', text: 'Sin GPS, sin entrenar modelos y se borran a las 24 h si no guardas.' },
];

@Component({
  selector: 'app-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  template: `
    <section class="wrap">
      <form class="card stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <h1>{{ isRegister() ? 'Crea tu cuenta' : 'Bienvenido de nuevo' }}</h1>
        <p class="muted intro">{{ isRegister() ? 'Gratis y en menos de un minuto.' : 'Tus proyectos te esperan donde los dejaste.' }}</p>
        @if (expired()) {
          <p class="alert alert-warning" role="alert">Tu sesión expiró. Vuelve a entrar para continuar.</p>
        }
        @if (isRegister()) {
          <div class="field">
            <label for="name">Nombre</label>
            <input id="name" class="input" formControlName="displayName" autocomplete="name" />
          </div>
        }
        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="input" type="email" formControlName="email" autocomplete="email" [attr.aria-invalid]="invalid('email')" />
          @if (invalid('email')) {
            <span class="field-error">Escribe un email válido.</span>
          }
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input
            id="password"
            class="input"
            type="password"
            formControlName="password"
            [attr.autocomplete]="isRegister() ? 'new-password' : 'current-password'"
            [attr.aria-invalid]="invalid('password')"
            aria-describedby="password-help"
          />
          @if (isRegister()) {
            <span id="password-help" class="muted fine">Mínimo 8 caracteres.</span>
          }
          @if (invalid('password')) {
            <span class="field-error">{{ isRegister() ? 'La contraseña necesita al menos 8 caracteres.' : 'Escribe tu contraseña.' }}</span>
          }
        </div>
        @if (error()) {
          <p class="alert alert-danger" role="alert">{{ error() }}</p>
        }
        <button class="btn btn-primary btn-lg" type="submit" [disabled]="loading()">
          {{ loading() ? 'Un momento…' : isRegister() ? 'Crear cuenta' : 'Entrar' }}
        </button>
        <p class="muted switch">
          @if (isRegister()) {
            ¿Ya tienes cuenta? <a routerLink="/entrar" [queryParams]="{ volver: returnUrl() }">Entra</a>
          } @else {
            ¿Primera vez? <a routerLink="/registro" [queryParams]="{ volver: returnUrl() }">Crea una cuenta</a>
          }
        </p>
      </form>

      <aside class="side" aria-label="Qué obtienes con tu cuenta">
        <img src="landing/hero-L.webp" width="844" height="675" alt="Una sala en forma de L en 3D con sofá, butaca, librero y lámpara de pie." />
        <ul>
          @for (perk of perks; track perk.title) {
            <li>
              <span class="icon-tile"><app-icon [name]="perk.icon" /></span>
              <div>
                <strong>{{ perk.title }}</strong>
                <span class="muted">{{ perk.text }}</span>
              </div>
            </li>
          }
        </ul>
      </aside>
    </section>
  `,
  styles: `
    :host {
      display: block;
      background: var(--gradient-brand);
      min-height: calc(100vh - var(--header-h));
    }
    .wrap {
      display: grid;
      grid-template-columns: minmax(0, 420px) minmax(0, 460px);
      gap: var(--space-7);
      justify-content: center;
      align-items: center;
      padding: clamp(var(--space-5), 6vw, 72px) var(--space-4);
    }
    form {
      box-shadow: var(--shadow);
    }
    h1 {
      font-size: var(--text-2xl);
      margin: 0;
    }
    .intro {
      margin: calc(var(--space-2) * -1) 0 0;
    }
    .switch {
      text-align: center;
      margin: 0;
    }
    .side {
      display: grid;
      gap: var(--space-5);
    }
    .side img {
      width: 100%;
      height: auto;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
    }
    .side ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
    .side li {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-3);
      align-items: start;
      font-size: var(--text-sm);
    }
    .side li div {
      display: grid;
      gap: 2px;
    }
    @media (max-width: 900px) {
      .wrap {
        grid-template-columns: minmax(0, 460px);
        gap: var(--space-6);
      }
    }
    @media (max-width: 520px) {
      .side ul {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  /** Parámetros de ruta/query enlazados como inputs (withComponentInputBinding). */
  readonly volver = input<string | undefined>();
  readonly expirada = input<string | undefined>();

  protected readonly isRegister = computed(() => this.route.snapshot.data['mode'] === 'register');
  protected readonly expired = computed(() => !!this.expirada());
  protected readonly returnUrl = computed(() => {
    const v = this.volver();
    return v && v.startsWith('/') && !v.startsWith('//') ? v : '/proyectos';
  });
  protected readonly perks = PERKS;
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    displayName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor() {
    if (this.isRegister()) {
      this.form.controls.displayName.addValidators(Validators.required);
      this.form.controls.password.addValidators(Validators.minLength(8));
    }
  }

  protected invalid(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) return;
    this.loading.set(true);
    const { displayName, email, password } = this.form.getRawValue();
    try {
      if (this.isRegister()) await this.auth.register({ displayName: displayName || email.split('@')[0]!, email, password });
      else await this.auth.login({ email, password });
      await this.router.navigateByUrl(this.returnUrl());
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.loading.set(false);
    }
  }
}
