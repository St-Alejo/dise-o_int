import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Interiores IA — API')
    .setDescription(
      'API del diseñador de interiores con IA: proyectos, Track A (previews de estilo), Track B (escena 3D), catálogo y enlaces públicos. Errores en formato RFC 7807.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function mountSwagger(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
}
