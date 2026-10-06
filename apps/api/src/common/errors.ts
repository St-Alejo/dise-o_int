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
