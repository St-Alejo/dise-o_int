#!/usr/bin/env sh
# Ejecuta un comando dentro de Node 24 (la versión que usan las imágenes) montando el repo.
# Los node_modules viven en volúmenes Docker para no mezclar binarios nativos Linux/Windows.
#   ./scripts/toolbox.sh npm ci
#   ./scripts/toolbox.sh npm test
set -eu
ROOT="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
export MSYS_NO_PATHCONV=1
exec docker run --rm ${TOOLBOX_FLAGS:-} \
  -v "$ROOT:/w" \
  -v interiores_nm_root:/w/node_modules \
  -v interiores_nm_web:/w/apps/web/node_modules \
  -v interiores_nm_api:/w/apps/api/node_modules \
  -v interiores_nm_types:/w/packages/shared-types/node_modules \
  -v interiores_nm_kit:/w/packages/furniture-kit/node_modules 
  -v interiores_npm_cache:/root/.npm \
  -w /w node:24-alpine sh -c "$*"
