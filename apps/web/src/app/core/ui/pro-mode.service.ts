import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ToastService } from './toast.service';

/**
 * Modo profesional: planos técnicos, normativa, cantidades de obra e instalaciones. Es una
 * preferencia de la cuenta (la recuerda el servidor, vale en cualquier equipo); sin cuenta no hay
 * Modo Pro. Quien no lo activa no ve nada de esto.
 */
@Injectable({ providedIn: 'root' })
export class ProModeService {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly enabled = computed(() => this.auth.user()?.proMode ?? false);
  readonly available = computed(() => this.auth.user() !== null);

  async toggle(): Promise<void> {
    const next = !this.enabled();
    try {
      await this.auth.updatePreferences({ proMode: next });
      this.toast.success(next ? 'Modo profesional activado: busca la pestaña Pro en el editor.' : 'Modo profesional desactivado.');
    } catch {
      this.toast.error('No se pudo cambiar el modo. Inténtalo de nuevo.');
    }
  }
}
