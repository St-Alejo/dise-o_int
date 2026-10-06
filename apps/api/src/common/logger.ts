import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { loadConfig } from '../config/env.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Logs JSON estructurados (pino). Cada petición tiene un `x-request-id` (se respeta el que
 * llega del proxy si es válido) que se devuelve al cliente y se propaga a jobs e IA.
 * Credenciales y cookies se redactan.
 */
export function loggerModule(service: 'api' | 'worker') {
  return LoggerModule.forRootAsync({
    useFactory: () => {
      const config = loadConfig();
      return {
        pinoHttp: {
          level: config.LOG_LEVEL,
          base: { service },
          autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').includes('/health/') },
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = req.headers['x-request-id'];
            const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          customProps: (req: IncomingMessage) => ({ requestId: (req as IncomingMessage & { id?: string }).id }),
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            censor: '[redactado]',
          },
          serializers: {
            req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: req.url, id: req.id }),
          },
          ...(config.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } } }
            : {}),
        },
      };
    },
  });
}
