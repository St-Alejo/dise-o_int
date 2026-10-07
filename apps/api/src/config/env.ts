/**
 * Configuración 12-factor: todo llega por variables de entorno y se valida al arrancar.
 * Si falta algo o es inválido el proceso termina con un mensaje claro (fail fast),
 * en vez de fallar a mitad de una petición.
 */
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const INSECURE_DEFAULTS = ['dev-only', 'change-me', 'changeme'];

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    /** '::' escucha IPv4 + IPv6 (red privada de Railway); '0.0.0.0' solo IPv4. */
    LISTEN_HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(true),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    MEDIA_SIGNING_SECRET: z.string().min(32, 'MEDIA_SIGNING_SECRET debe tener al menos 32 caracteres'),
    MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
    COOKIE_SECURE: bool.default(false),

    AI_SERVICE_URL: z.string().url(),
    AI_INTERNAL_TOKEN: z.string().min(16),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),

    UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(15),
    GENERATIONS_PER_DAY: z.coerce.number().int().min(1).default(40),
    RETENTION_HOURS: z.coerce.number().int().min(1).default(24),
    /** Chat de diseño: sin API key responde el agente por reglas (gratis). */
    ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
    CHAT_MODEL: z.string().min(1).default('claude-opus-5-5'),
    CHAT_PER_DAY: z.coerce.number().int().min(1).default(60),
    CHAT_MAX_TOOL_TURNS: z.coerce.number().int().min(1).max(20).default(8),
    THROTTLE_LIMIT_PER_MIN: z.coerce.number().int().min(10).default(240),

    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3001),

    PUBLIC_WEB_URL: z.string().url().default('http://localhost:8080'),
    CORS_ORIGINS: csv,
    SWAGGER_ENABLED: bool.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['JWT_ACCESS_SECRET', 'MEDIA_SIGNING_SECRET', 'AI_INTERNAL_TOKEN'] as const) {
      const value = env[key].toLowerCase();
      if (INSECURE_DEFAULTS.some((d) => value.includes(d))) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Usa un secreto real en producción' });
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return parsed.data;
}
