# ADR-0005 — Despliegue: Docker Compose como contrato, imágenes inmutables en GHCR

**Estado:** aceptada · **Fecha:** 2026-09-29

## Decisión
- Un `docker-compose.yml` base (prod-like, local), overrides `dev` (recarga en caliente) y `prod`
  (imágenes publicadas, sin build).
- nginx es el **único origen** público (SPA + `/api` + `/api/ws`): sin CORS, cookies SameSite estrictas.
- Migraciones y seed son **jobs one-shot**; la API nunca migra al arrancar (evita carreras al escalar).
- Todo por variables de entorno: pasar de SeaweedFS/Postgres/Redis locales a S3/R2 y bases
  gestionadas es cambiar `S3_*`, `DATABASE_URL`, `REDIS_URL`.
- nginx resuelve el upstream por DNS dinámico (sobrevive a que la API se recree o escale).

## Lecciones del proyecto hermano aplicadas
`.env.example` y `docs/` versionados; healthcheck de readiness real; worker con healthcheck;
imágenes con versión fijada; logs con correlación; auth y rate limiting.
