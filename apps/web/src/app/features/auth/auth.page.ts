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
      <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        @if (isRegister()) {
          <h1 class="title-xl">Crea tu cuenta, <em>es un minuto.</em></h1>
        } @else {
          <h1 class="title-xl">Bienvenido <em>de nuevo.</em></h1>
        }
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
        <img
          src="landing/vida-escandinavo-1200.webp"
          srcset="landing/vida-escandinavo-700.webp 700w, landing/vida-escandinavo-1200.webp 1200w"
          sizes="(max-width: 900px) 100vw, 50vw"
          width="1200"
          height="1500"
          alt="Una sala amueblada por la app en estilo escandinavo, con luz de tarde."
        />
        <ul>
          @for (perk of perks; track perk.title) {
            <li>
              <app-icon [name]="perk.icon" />
              <div>
                <strong>{{ perk.title }}</strong>
                <span>{{ perk.text }}</span>
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
    }
    /* Escenario partido, como la portada: el formulario a la izquierda y un cuarto a la derecha. */
    .wrap {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      min-height: calc(100svh - var(--header-h));
    }
    form {
      align-self: center;
      justify-self: center;
      width: min(100%, 420px);
      padding-block: var(--space-7);
    }
    .title-xl {
      font-size: var(--text-2xl);
    }
    .intro {
      margin: 0;
    }
    .switch {
      text-align: center;
      margin: 0;
    }
    .side {
      position: relative;
      min-height: 520px;
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--surface-2);
    }
    .side img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    /* Lo que trae la cuenta, en una barra de lino sobre el borde de la foto. */
    .side ul {
      position: absolute;
      inset: auto 0 0;
      list-style: none;
      margin: 0;
      padding: var(--space-5);
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4) var(--space-5);
      background: var(--bg);
    }
    .side li {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-3);
      align-items: start;
      font-size: var(--text-sm);
    }
    .side li app-icon {
      color: var(--primary);
      font-size: 1.2rem;
      margin-top: 2px;
    }
    .side li div {
      display: grid;
      gap: 2px;
      color: var(--text-muted);
    }
    .side li strong {
      color: var(--text);
    }
    @media (max-width: 900px) {
      .wrap {
        grid-template-columns: 1fr;
      }
      form {
        padding-block: var(--space-5);
      }
      .side {
        min-height: 0;
        display: grid;
      }
      .side img {
        position: static;
        height: 42svh;
      }
      .side ul {
        position: static;
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
