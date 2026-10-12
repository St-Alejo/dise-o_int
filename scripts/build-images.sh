#!/usr/bin/env sh
# Construye las imágenes locales con `docker build` (equivalente a `docker compose build`).
# Existe porque `docker compose build` falla en Windows si la ruta del proyecto contiene
# caracteres no ASCII (p. ej. "diseño"): error "x-docker-expose-session-sharedkey".
#   ./scripts/build-images.sh            # todas
#   ./scripts/build-images.sh api web    # algunas
#   ./scripts/build-images.sh api-dev web-dev ai-dev   # imágenes de desarrollo
set -eu
cd "$(dirname "$0")/.."
TARGETS="${*:-api migrate ai web}"
for t in $TARGETS; do
  echo "==> $t"
  case "$t" in
    api)     docker build -f apps/api/Dockerfile --target prod    -t interiores-api:local . ;;
    migrate) docker build -f apps/api/Dockerfile --target migrate -t interiores-api-migrate:local . ;;
    web)     docker build -f apps/web/Dockerfile --target prod    -t interiores-web:local . ;;
    ai)      docker build --target prod -t interiores-ai:local services/ai ;;
    api-dev) docker build -f apps/api/Dockerfile --target dev -t interiores-api:dev . ;;
    web-dev) docker build -f apps/web/Dockerfile --target dev -t interiores-web:dev . ;;
    ai-dev)  docker build --target dev -t interiores-ai:dev services/ai ;;
    *) echo "Destino desconocido: $t" >&2; exit 1 ;;
  esac
done
