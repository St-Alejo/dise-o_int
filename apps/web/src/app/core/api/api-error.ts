import { HttpErrorResponse } from '@angular/common/http';
import type { ProblemDetails } from '@interiores/shared-types';

/** Error de API normalizado a partir de una respuesta RFC 7807 (problem+json). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly requestId?: string,
    readonly fieldErrors: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static from(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) return new ApiError(0, 'Sin conexión con el servidor. Revisa tu red e intenta de nuevo.');
      const body = err.error as Partial<ProblemDetails> | null;
      const message = body?.detail ?? body?.title ?? `Error ${err.status}`;
      return new ApiError(err.status, message, body?.code, body?.requestId, body?.errors ?? []);
    }
    return new ApiError(-1, err instanceof Error ? err.message : 'Error inesperado');
  }

  /** Mensaje legible, incluyendo el primer error de campo si lo hay. */
  get userMessage(): string {
    const first = this.fieldErrors[0];
    return first ? `${this.message}: ${first.path} — ${first.message}` : this.message;
  }
}
