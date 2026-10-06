import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Pipe de validación basado en los schemas zod compartidos (`@interiores/shared-types`). */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    // parse lanza ZodError, que el ProblemDetailsFilter convierte en 422.
    return this.schema.parse(value);
  }
}

/** JSON Schema (OpenAPI 3.0) de un schema zod, para documentar cuerpos en Swagger. */
export function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
}
