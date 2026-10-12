#!/usr/bin/env sh
# Crea .env a partir de .env.example con secretos y contraseñas ALEATORIOS.
# La API se niega a arrancar en producción con los valores "dev-only" del ejemplo.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ] && [ "${1:-}" != "--force" ]; then
  echo ".env ya existe (usa --force para regenerarlo)"; exit 0
fi
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-"$1"; }
sed \
  -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(rand 64)|" \
  -e "s|^MEDIA_SIGNING_SECRET=.*|MEDIA_SIGNING_SECRET=$(rand 64)|" \
  -e "s|^AI_INTERNAL_TOKEN=.*|AI_INTERNAL_TOKEN=$(rand 40)|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 32)|" \
  -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=$(rand 40)|" \
  .env.example > .env
echo ".env creado con secretos aleatorios."
