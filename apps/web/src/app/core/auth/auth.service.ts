import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AuthResponse, AuthUser, LoginRequest, RegisterRequest } from '@interiores/shared-types';
import { firstValueFrom } from 'rxjs';

/**
 * Sesión del usuario.
 * - El access token vive SOLO en memoria (nunca en localStorage: inmune a robo por XSS persistente).
 * - El refresh token es una cookie httpOnly que el navegador envía sola a /api/auth.
 * - Al arrancar se intenta un refresh silencioso para recuperar la sesión.
 * - Los refresh concurrentes se agrupan en una sola petición (single-flight).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly token = signal<string | null>(null);
  private expiresAt = 0;
  private refreshing: Promise<string | null> | null = null;

  readonly user = signal<AuthUser | null>(null);
  readonly isAuthenticated = computed(() => this.user() !== null);

  get accessToken(): string | null {
    return this.token();
  }

  /** Token válido (refresca si está por expirar). Para el WebSocket y el interceptor. */
  async validToken(): Promise<string | null> {
    if (this.token() && Date.now() < this.expiresAt - 30_000) return this.token();
    return this.refresh();
  }

  async restoreSession(): Promise<void> {
    await this.refresh();
  }

  async login(body: LoginRequest): Promise<void> {
    this.apply(await firstValueFrom(this.http.post<AuthResponse>('/api/auth/login', body)));
  }

  async register(body: RegisterRequest): Promise<void> {
    this.apply(await firstValueFrom(this.http.post<AuthResponse>('/api/auth/register', body)));
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } finally {
      this.clear();
      await this.router.navigateByUrl('/');
    }
  }

  refresh(): Promise<string | null> {
    this.refreshing ??= firstValueFrom(this.http.post<AuthResponse>('/api/auth/refresh', {}))
      .then((res) => {
        this.apply(res);
        return res.accessToken;
      })
      .catch(() => {
        this.clear();
        return null;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** Llamado por el interceptor cuando el servidor rechaza definitivamente la sesión. */
  sessionExpired(): void {
    const wasLogged = this.isAuthenticated();
    this.clear();
    if (wasLogged) void this.router.navigate(['/entrar'], { queryParams: { expirada: 1, volver: this.router.url } });
  }

  private apply(res: AuthResponse): void {
    this.token.set(res.accessToken);
    this.expiresAt = Date.now() + res.expiresIn * 1000;
    this.user.set(res.user);
  }

  private clear(): void {
    this.token.set(null);
    this.expiresAt = 0;
    this.user.set(null);
  }
}
