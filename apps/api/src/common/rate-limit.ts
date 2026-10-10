/**
 * Límites de frecuencia por IP de las rutas sensibles (registro, login, crear proyectos, chat).
 *
 * `RATE_LIMIT_MULTIPLIER` los deja como están (1, el valor por defecto) o los relaja. Existe para
 * las pruebas de extremo a extremo, que lanzan toda la suite desde una sola IP en menos de un
 * minuto; en producción no se toca.
 *
 * Los decoradores `@Throttle` se evalúan al cargar el módulo, antes de que exista la configuración
 * inyectable: por eso el multiplicador se lee del entorno (su valor ya lo valida `env.ts`).
 */
export const RATE_LIMIT_MULTIPLIER = Math.max(1, Number(process.env['RATE_LIMIT_MULTIPLIER']) || 1);

/** Opciones de `@Throttle` para `limit` solicitudes por minuto y por IP. */
export const perMinute = (limit: number) => ({ default: { limit: Math.round(limit * RATE_LIMIT_MULTIPLIER), ttl: 60_000 } });
