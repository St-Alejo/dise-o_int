# Interiores IA — rediseña tu cuarto en 2D y edítalo en 3D

Sube una foto de tu cuarto y obtén:

- **Track A — propuestas 2D.** Varios estilos a la vez, con un comparador antes/después y un control de intensidad.
- **Track B — escena 3D editable.** Muebles reales a escala (catálogo CC0) que puedes mover, rotar y cambiar, con deshacer y rehacer, realidad aumentada ("ver en mi cuarto"), versiones, un link público y una lista de compras en PDF.
- **Catálogo de 147 muebles con búsqueda.** Sofás, mesas, camas, armarios, cocina, baño, lámparas de mesa, de pie y colgantes, cuadros, espejos, TV, cortinas y más. La búsqueda entiende acentos, plurales, sinónimos ("closet", "velador") y errores de tipeo. Los cuadros se cuelgan solos en la pared y las lámparas se apoyan sobre la mesa de noche.
- **Cuarto a tu medida.** Escribe ancho, largo y alto exactos (al subir la foto o después, en "Medidas del cuarto") y ubica puertas y ventanas; los muebles se reacomodan sin borrarse. Si no tienes metro, calibra con una sola medida conocida.

La arquitectura y las decisiones de producto están en [`docs/README-interiores-ia.md`](docs/README-interiores-ia.md). Las decisiones técnicas tomadas al implementarlo están en [`docs/adr/`](docs/adr).

## Arranque rápido (Docker)

```bash
./scripts/init-env.sh             # crea .env con secretos aleatorios (una sola vez)
./scripts/build-images.sh         # construye las 4 imágenes
docker compose up -d --wait       # levanta todo y espera a que esté sano
```

Después abre **http://localhost:8080** (el puerto se cambia con `WEB_PORT` en `.env`).

- La primera vez, el servicio `seed` descarga unos 35 modelos 3D de Poly Haven (CC0) y los optimiza.
- Si no hay internet, usa modelos procedurales (`CATALOG_OFFLINE=true`).
- Con `make` disponible (Linux, macOS o WSL), `make up` hace todo lo anterior.
- `make help` lista el resto de comandos.

> **Windows y rutas con acentos:** `docker compose build` falla si la ruta del proyecto tiene caracteres no ASCII (por ejemplo, "diseño"). El error es `x-docker-expose-session-sharedkey`. Por eso existe `scripts/build-images.sh`, que usa `docker build` directamente.

### Modo desarrollo (recarga en caliente)

```bash
make dev
# o bien:
./scripts/build-images.sh api-dev web-dev ai-dev migrate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
```

| Servicio | URL / puerto | Recarga |
|---|---|---|
| Web (`ng serve`) | http://localhost:4300 | Angular (polling) |
| API | http://localhost:3300/api/docs (Swagger) | `nest start --watch` |
| IA | http://localhost:8800/docs | `uvicorn --reload` |
| Postgres / Redis / S3 | 15433 / 16380 / 18334 | — |

Todos los puertos se pueden cambiar con `DEV_*_PORT`.

## Arquitectura

```
                         ┌──────────────── red "edge" ────────────────┐
  navegador ──HTTPS──▶   │  web: nginx (SPA Angular + proxy /api, CSP)  │
                         └───────────────┬─────────────────────────────┘
                                         │ /api  y  /api/ws (WebSocket)
┌──────────────────────────── red "internal" (sin puertos publicados) ───────────────────────────┐
│  api (NestJS) ──encola──▶ Redis/BullMQ ──▶ worker (NestJS, misma imagen) ──HTTP──▶ ai (FastAPI) │
│     │   ▲ progreso pub/sub ◀──────────────────────┘                                  │           │
│     ▼   │                                                                            ▼           │
│  PostgreSQL (Prisma)                      S3 (SeaweedFS local · AWS S3 / R2 en la nube) ◀────────┘│
│  migrate (one-shot) · seed (one-shot, catálogo CC0)                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Carpeta | Qué es |
|---|---|
| `packages/furniture-kit` | Muebles **paramétricos**: recetas que generan geometría pura por slot de material (Builder + Composite + Factory + Flyweight). La web la dibuja en vivo y el seed la exporta a GLB. |
| `packages/shared-types` | Modelo canónico (§7 del doc) con schemas **zod**, DTOs, contrato con la IA y geometría compartida (colisiones, calibración). Es la fuente única de tipos. |
| `apps/api` | NestJS 12 **hexagonal**. Casos de uso contra *puertos* (`src/ports`); los adaptadores (Prisma, S3, BullMQ, Redis, HTTP a la IA) se enlazan en `CoreModule`. Incluye auth JWT, subida segura, versiones, compartir, PDF, progreso por WebSocket y el **worker** (`src/worker.ts`). |
| `apps/web` | Angular 22 (standalone, signals, zoneless). `ThreeViewportComponent` aísla el render loop; `SceneService` es la **Facade** de Three.js; `DesignProjectStore` es la única fuente de verdad; edición con el patrón **Command** (deshacer/rehacer); AR con `<model-viewer>`. |
| `services/ai` | FastAPI. Tiene proveedores **Strategy** (`mock` sin GPU ↔ `replicate`) para el análisis del cuarto y los estilos, más un **motor de layout por reglas** (minimización greedy de costo) listo para cambiarlo por ATISS. |
| `infra/nginx` | Origen único, CSP estricta, caché de assets y resolución DNS dinámica del upstream. |
| `e2e` | Prueba de humo del backend, Playwright + axe (UI y accesibilidad) y prueba de resiliencia. |

### Patrones del documento (§9) y dónde están

| Patrón | Implementación |
|---|---|
| Strategy | `services/ai/.../providers/*` (mock / Replicate) y `layout/rules_engine.py` (`LayoutEngine`) |
| Facade | `apps/web/.../viewport-3d/scene.service.ts` |
| Command | `apps/web/.../viewport-3d/commands.ts` + `CommandHistory` |
| Repository | `apps/api/src/ports` → `infrastructure/prisma/*.repository.ts` (y dobles en memoria en `test/fakes.ts`) |
| Adapter | `HttpAiClient`, `S3FileStorage`, `BullMqJobQueue`, `ReplicateClient` |
| Factory | `FurnitureFactory` (receta o GLB → Object3D), `RecipeRegistry` (`kind → receta`) y `cli/catalog/procedural.ts` |
| Builder + Composite | `packages/furniture-kit/src/builder.ts` (piezas y grupos anidados por slot de material) |
| Flyweight | caché de modelos por medidas (`buildCached`) y de geometrías/materiales en GPU (`ParametricRenderer`) |

## Robustez (más allá del documento)

- **Configuración que falla rápido.** Todo se valida con zod al arrancar. En producción se rechazan los secretos de ejemplo.
- **Seguridad:**
  - Access JWT de 15 minutos, guardado solo en memoria.
  - Refresh token rotativo en una cookie httpOnly con SameSite estricto. Si alguien reutiliza un refresh ya rotado, se revoca toda la familia de tokens.
  - argon2id con tiempo constante al hacer login.
  - Helmet, CSP estricta (`script-src 'self'`) y rate limiting compartido en Redis.
  - Cuota diaria de generaciones por usuario.
  - URLs de medios firmadas con HMAC, así el bucket nunca se expone.
  - Validación por *magic bytes* (un `.exe` renombrado a `.jpg` → 415) y límite de píxeles.
- **Privacidad (§8.4):**
  - Se eliminan el EXIF y el GPS de todas las fotos.
  - Los proyectos que no se guardan se borran a las 24 horas (job repetible).
  - Borrar un proyecto es un **borrado real** en S3, no solo en la base de datos.
- **Concurrencia.** Control optimista por revisión: si dos pestañas o el worker editan a la vez, responde 409 y la UI ofrece recargar.
- **Jobs:**
  - Ids idempotentes, reintentos con backoff exponencial y errores no reintentables (`UnrecoverableError`).
  - Auditoría de cada job en `job_audit`.
  - Mensajes de error entendibles para el usuario y endpoint `/retry` para reintentar.
  - Cierre ordenado: el worker espera a que terminen los jobs en curso.
- **Progreso real.** Se envía por WebSocket con historial al conectarse. Si el socket falla, pasa automáticamente a polling. Cada instancia escala sin sticky sessions.
- **Observabilidad:**
  - Logs JSON estructurados (pino / structlog) con `x-request-id`, propagado de nginx a la API, luego al job y a la IA.
  - `/api/health/live` (liveness) y `/api/health/ready` (readiness con el detalle de cada dependencia).
  - Healthchecks en **todos** los contenedores, incluido el worker.
- **Contenedores:**
  - Builds multi-stage con versiones fijadas y usuarios no-root; nginx sin privilegios y con sistema de archivos de solo lectura.
  - Migraciones y seed como jobs one-shot, fuera del arranque de la API.
  - Redis con AOF y `noeviction` (lo que exige BullMQ).
  - Límites de CPU y memoria, rotación de logs y redes separadas: solo `web` publica un puerto.
- **3D:**
  - Render bajo demanda, fuera de la detección de cambios de Angular.
  - Liberación completa de la GPU al salir, incluido `forceContextLoss`.
  - Paredes que se vuelven translúcidas para ver el interior.
  - Colisiones y límites del cuarto calculados con la **misma** geometría que valida el servidor.

## Pruebas

| Suite | Comando | Qué cubre |
|---|---|---|
| Tipos compartidos | `npm test -w @interiores/shared-types` | Geometría (SAT, clamp, calibración) y DTOs |
| API | `npm test -w api` | Casos de uso con adaptadores en memoria: EXIF, cuotas, 409, borrado real, caché, retención, pipeline |
| Web | `npm test -w web` | Command/undo, construcción del cuarto sin WebGL, shell |
| IA | `pytest` (`services/ai`) | Layout con **Hypothesis** (sin solapes, todo dentro, nunca bloquea puertas), API, Replicate simulado, **contrato zod ↔ Pydantic** |
| Humo | `node e2e/smoke.mjs <url>` | Flujo completo del backend por nginx (17 comprobaciones) |
| UI + a11y | `make e2e` | Playwright: flujo completo, sesión persistente, link público y **axe** (WCAG 2.1 AA) en desktop y móvil |
| Resiliencia | `node e2e/resilience.mjs <url> "<parar ia>" "<arrancar ia>"` | IA caída → 503 + reintentos + error claro → recuperación con "Reintentar" |

Las herramientas de Node corren en Docker con `./scripts/toolbox.sh <comando>` (Node 24, igual que las imágenes). CI (`.github/workflows/ci.yml`) ejecuta todas las suites, incluido el E2E sobre Docker Compose.

## Proveedores de IA

Por defecto todo corre **sin GPU ni costo**:

- **Análisis del cuarto:** heurísticas de OpenCV. La escala queda marcada como aproximada y el usuario la calibra con un gesto (§8.1).
- **Estilos:** gradación de color por paleta, marcada como "vista previa simulada".

Para usar difusión real:

```env
REPLICATE_API_TOKEN=r8_...
ROOM_ANALYZER=replicate      # Depth-Anything-V2
STYLE_GENERATOR=replicate    # ControlNet de interiores (img2img)
```

Los modelos se configuran con `REPLICATE_DEPTH_MODEL` y `REPLICATE_STYLE_MODEL`. El cliente tiene timeout, polling, cancelación y un *circuit breaker*.

## Desplegar en la nube

Consulta [`docs/deploy.md`](docs/deploy.md). En resumen:

1. Un tag `vX.Y.Z` publica las imágenes en GHCR, escaneadas con Trivy y construidas para amd64 y arm64.
2. En el servidor: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --wait`.
3. Para usar Postgres, Redis y S3 gestionados solo hay que cambiar variables de entorno (`DATABASE_URL`, `REDIS_URL`, `S3_*`).

## Licencias de contenido

Los muebles 3D vienen de [Poly Haven](https://polyhaven.com) (CC0) o se generan proceduralmente. Los enlaces de compra son búsquedas de productos similares (Fase 4 del roadmap: afiliados).
