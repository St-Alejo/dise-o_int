import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@interiores/shared-types';
import { ZodError } from 'zod';
import { DomainError } from './errors.js';

type ReqWithId = Request & { id?: string | number };

/** Traduce cualquier excepción a `application/problem+json` (RFC 7807) sin filtrar detalles internos. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<ReqWithId>();
    const res = ctx.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;
    if (req.id !== undefined) problem.requestId = String(req.id);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Error no controlado');
    }
    if (res.headersSent) return;
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      return {
        type: `https://interiores.dev/problems/${exception.code}`,
        title: exception.title,
        status: exception.status,
        detail: exception.message,
        code: exception.code,
        ...(exception.details ? { errors: exception.details } : {}),
      };
    }
    if (exception instanceof ZodError) {
      return {
        type: 'https://interiores.dev/problems/validation_failed',
        title: 'Datos inválidos',
        status: 422,
        code: 'validation_failed',
        errors: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : exception.message;
      return {
        type: 'about:blank',
        title: HttpStatus[status]?.replaceAll('_', ' ').toLowerCase() ?? 'Error',
        status,
        detail: this.translate(status, detail),
      };
    }
    // Errores de Multer (límite de tamaño) llegan como errores planos con `code`.
    const code = (exception as { code?: string } | null)?.code;
    if (code === 'LIMIT_FILE_SIZE') {
      return { type: 'https://interiores.dev/problems/payload_too_large', title: 'Archivo demasiado grande', status: 413, code: 'payload_too_large' };
    }
    if (code === 'P2025') {
      return { type: 'https://interiores.dev/problems/not_found', title: 'Recurso no encontrado', status: 404, code: 'not_found' };
    }
    return {
      type: 'about:blank',
      title: 'Error interno',
      status: 500,
      detail: 'Ocurrió un error inesperado. Si persiste, comparte el requestId con soporte.',
    };
  }

  private translate(status: number, detail: string): string {
    if (status === 429) return 'Demasiadas solicitudes, intenta de nuevo en un momento.';
    if (status === 404 && detail.startsWith('Cannot')) return 'Ruta no encontrada.';
    return detail;
  }
}
