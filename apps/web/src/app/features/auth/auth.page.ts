import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="wrap">
      <form class="card stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <h1>{{ isRegister() ? 'Crea tu cuenta' : 'Bienvenido de nuevo' }}</h1>
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
            <span id="password-help" class="muted" style="font-size: 0.85rem">Mínimo 8 caracteres.</span>
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
        <p class="muted" style="text-align: center; margin: 0">
          @if (isRegister()) {
            ¿Ya tienes cuenta? <a routerLink="/entrar" [queryParams]="{ volver: returnUrl() }">Entra</a>
          } @else {
            ¿Primera vez? <a routerLink="/registro" [queryParams]="{ volver: returnUrl() }">Crea una cuenta</a>
          }
        </p>
      </form>
    </section>
  `,
  styles: `
    .wrap {
      display: grid;
      place-items: center;
      padding: 48px 16px;
    }
    form {
      width: min(420px, 100%);
    }
    h1 {
      font-size: 1.8rem;
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
