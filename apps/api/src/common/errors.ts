/**
 * Errores de dominio/aplicación. Los casos de uso lanzan estos errores sin saber nada de
 * HTTP; el ProblemDetailsFilter los traduce a respuestas RFC 7807.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  abstract readonly title: string;

  constructor(
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly code = 'not_found';
  readonly title = 'Recurso no encontrado';
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
  readonly code = 'forbidden';
  readonly title = 'Acceso denegado';
}

export class UnauthorizedError extends DomainError {
  readonly status = 401;
  readonly code = 'unauthorized';
  readonly title = 'No autenticado';
}

export class ConflictError extends DomainError {
  readonly status = 409;
  readonly code = 'conflict';
  readonly title = 'Conflicto';
}

/** El recurso cambió desde que el cliente lo leyó (control de concurrencia optimista). */
export class StaleRevisionError extends DomainError {
  readonly status = 409;
  readonly code = 'stale_revision';
  readonly title = 'El proyecto cambió mientras editabas';
}

export class ValidationError extends DomainError {
  readonly status = 422;
  readonly code = 'validation_failed';
  readonly title = 'Datos inválidos';
}

export class UnsupportedMediaError extends DomainError {
  readonly status = 415;
  readonly code = 'unsupported_media';
  readonly title = 'Formato de archivo no soportado';
}

export class PayloadTooLargeError extends DomainError {
  readonly status = 413;
  readonly code = 'payload_too_large';
  readonly title = 'Archivo demasiado grande';
}

export class QuotaExceededError extends DomainError {
  readonly status = 429;
  readonly code = 'quota_exceeded';
  readonly title = 'Límite de generaciones alcanzado';
}

export class DependencyError extends DomainError {
  readonly status = 503;
  readonly code = 'dependency_unavailable';
  readonly title = 'Servicio dependiente no disponible';
}

/**
 * Fallo al hablar con el servicio de IA. No es un DomainError (no llega a HTTP): lo usan el
 * adaptador y el pipeline para decidir reintentos y el mensaje que ve el usuario, sin
 * depender del texto del error.
 */
export type AiFailureKind = 'timeout' | 'unreachable' | 'rejected' | 'upstream';

export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Si es false, reintentar no tiene sentido (p. ej. 422: la entrada es inválida). */
    readonly retryable: boolean,
    readonly kind: AiFailureKind = 'upstream',
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/** Busca un AiServiceError en el error o en su cadena de `cause` (BullMQ envuelve errores). */
export function findAiFailure(err: unknown): AiServiceError | null {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof AiServiceError) return e;
  }
  return null;
}
