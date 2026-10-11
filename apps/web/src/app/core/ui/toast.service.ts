import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  /** Lo que se puede hacer al respecto desde el propio aviso (reintentar, recargar). */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

/** Notificaciones efímeras (región aria-live en el shell de la app). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  show(message: string, kind: Toast['kind'] = 'info', ms = 4500, action?: ToastAction): void {
    const id = ++this.seq;
    this.toasts.update((t) => [...t.slice(-3), { id, kind, message, ...(action ? { action } : {}) }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  /** Ejecuta la acción de un aviso y lo cierra. */
  act(toast: Toast): void {
    this.dismiss(toast.id);
    toast.action?.run();
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  /** Con acción, el aviso dura más: hay que dar tiempo a pulsarla. */
  error(message: string, action?: ToastAction): void {
    this.show(message, 'error', action ? 12_000 : 7000, action);
  }

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
