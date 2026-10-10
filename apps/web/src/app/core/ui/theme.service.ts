import { Injectable, computed, signal } from '@angular/core';

export type ThemeChoice = 'light' | 'dark' | 'auto';

const KEY = 'interiores.tema';

/**
 * Tema claro u oscuro. Por defecto sigue al sistema (`auto`); si el usuario elige uno, se recuerda
 * en este navegador. Los colores viven en `styles.scss` como tokens: aquí solo se marca
 * `data-theme` en la raíz del documento.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly choice = signal<ThemeChoice>(this.stored());
  private readonly systemDark = signal(this.media()?.matches ?? false);
  /** El tema que se está viendo ahora mismo. */
  readonly dark = computed(() => (this.choice() === 'auto' ? this.systemDark() : this.choice() === 'dark'));

  constructor() {
    this.media()?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    this.apply();
  }

  /** Cambia al tema contrario del que se ve; si coincide con el del sistema, vuelve a seguirlo. */
  toggle(): void {
    const next = this.dark() ? 'light' : 'dark';
    this.choice.set(next === (this.systemDark() ? 'dark' : 'light') ? 'auto' : next);
    try {
      if (this.choice() === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, this.choice());
    } catch {
      // Sin almacenamiento (modo privado): el tema vale solo para esta visita.
    }
    this.apply();
  }

  private apply(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (this.choice() === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.choice());
  }

  private stored(): ThemeChoice {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch {
      return 'auto';
    }
  }

  private media(): MediaQueryList | null {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  }
}
