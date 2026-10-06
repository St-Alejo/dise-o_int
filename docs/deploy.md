# Despliegue en la nube — runbook

El sistema es 12-factor: imágenes inmutables + configuración por variables de entorno. Hay
tres formas típicas de desplegarlo, de menos a más gestionada.

## 0. Publicar las imágenes

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` construye (amd64 + arm64), escanea con Trivy (falla ante CVE
críticas con parche) y publica en GHCR:

| Imagen | Uso |
|---|---|
| `ghcr.io/<owner>/interiores-web` | nginx + SPA (único servicio público, puerto 8080) |
| `ghcr.io/<owner>/interiores-api` | API (`node dist/main.js`), worker (`node dist/worker.js`) y seed (`node dist/cli/seed.js`) |
| `ghcr.io/<owner>/interiores-api-migrate` | job de migraciones (`prisma migrate deploy`) |
| `ghcr.io/<owner>/interiores-ai` | servicio de IA (FastAPI, puerto 8000, solo red interna) |

## 1. Una VM con Docker (VPS, EC2, Lightsail, DigitalOcean…)

```bash
git clone <repo> && cd interiores-ia
./scripts/init-env.sh
# editar .env: PUBLIC_WEB_URL=https://tu-dominio, COOKIE_SECURE=true, IMAGE_REGISTRY=ghcr.io/<owner>, IMAGE_TAG=0.1.0
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --wait
```

TLS: pon delante un proxy con certificados automáticos (Caddy, Traefik o el balanceador del
proveedor) apuntando a `localhost:${WEB_PORT}`. La API ya confía en `X-Forwarded-*`
(`TRUST_PROXY=1`) para el rate limit por IP.

Copias de seguridad: `make backup-db` (cron diario) + versionado del bucket S3.

## 2. PaaS de contenedores (Railway, Render, Fly.io, Cloud Run + servicios gestionados)

Crea un servicio por imagen y usa bases gestionadas:

| Servicio | Imagen / comando | Público | Variables clave |
|---|---|---|---|
| web | `interiores-web` | **sí** (8080) | `API_UPSTREAM=<host-interno-api>:3000` |
| api | `interiores-api` | no | todas las de `.env` + `DATABASE_URL`, `REDIS_URL`, `S3_*`, `AI_SERVICE_URL` |
| worker | `interiores-api`, comando `node dist/worker.js` | no | igual que api |
| ai | `interiores-ai` | no | `AI_INTERNAL_TOKEN`, `S3_*`, proveedores |
| migrate | `interiores-api-migrate` (job previo a cada deploy) | no | `DATABASE_URL` |
| seed | `interiores-api`, comando `node dist/cli/seed.js` (job) | no | igual que api |

- **PostgreSQL gestionado** → `DATABASE_URL`.
- **Redis gestionado** → `REDIS_URL` (debe permitir `noeviction`; BullMQ lo necesita).
- **S3 / R2** → `S3_ENDPOINT` (vacío para AWS), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_FORCE_PATH_STYLE=false` para AWS.
- Healthchecks: web `/healthz`, api `/api/health/ready` (readiness) y `/api/health/live` (liveness),
  worker `:3001/health`, ai `/health/live`.
- nginx resuelve el upstream por DNS dinámicamente (`NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1`): funciona
  con el DNS interno de cualquier plataforma.

## 3. Escalar

- **api**: sin estado → réplicas horizontales. El rate limit y el progreso viven en Redis; el
  WebSocket usa solo transporte `websocket`, así que no hacen falta sticky sessions.
- **worker**: réplicas horizontales; `WORKER_CONCURRENCY` controla los jobs por réplica. Los jobs
  repetibles (retención de 24 h) se ejecutan una sola vez aunque haya N workers.
- **ai**: CPU-bound en modo mock; con Replicate es I/O-bound. Escalar réplicas según latencia.

## Checklist de producción

- [ ] Secretos generados (`./scripts/init-env.sh`) y guardados en el gestor de secretos del proveedor.
- [ ] `COOKIE_SECURE=true` y HTTPS extremo a extremo.
- [ ] `PUBLIC_WEB_URL` con el dominio real (se usa en los PDF y links compartidos).
- [ ] `SWAGGER_ENABLED=false` si no quieres documentación pública de la API.
- [ ] Backups de Postgres y versionado/lifecycle del bucket.
- [ ] Alertas sobre `/api/health/ready` != 200 y sobre la tabla `job_audit` (jobs `failed`).
- [ ] `GENERATIONS_PER_DAY` acorde al presupuesto de inferencia si usas Replicate.

## Rollback

Las imágenes son inmutables por versión: `IMAGE_TAG=<versión anterior>` y
`docker compose ... up -d --wait`. Las migraciones de Prisma deben ser compatibles hacia atrás
(añadir columnas/tablas antes de usarlas; nunca renombrar en un solo paso).
