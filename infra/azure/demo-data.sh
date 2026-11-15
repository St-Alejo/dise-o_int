#!/usr/bin/env bash
# Construye las imágenes de datos de la demo en Azure a partir de una base vacía:
#   interiores-pg-demo:local  Postgres con migraciones + catálogo (volcado SQL)
#   interiores-s3-demo:local  SeaweedFS con los modelos y miniaturas del catálogo
# Requiere las imágenes interiores-api:local e interiores-api-migrate:local ya construidas.
# Uso (desde la raíz del repo): bash infra/azure/demo-data.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"
NET=interiores-bake PG=interiores-bake-pg S3=interiores-bake-s3
KEY=bake-key SECRET=bake-secret-bake-secret
DB=postgresql://interiores:bake@$PG:5432/interiores
cleanup() { docker rm -f $PG $S3 >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
rm -rf build && mkdir -p build/s3data

# Imagen de almacenamiento vacía (solo el arranque) para sembrar sobre ella.
docker build -q -f storage.Dockerfile -t interiores-s3-demo:local . >/dev/null
docker network create $NET >/dev/null
docker run -d --name $PG --network $NET -e POSTGRES_USER=interiores -e POSTGRES_PASSWORD=bake -e POSTGRES_DB=interiores postgres:16.15-alpine >/dev/null
docker run -d --name $S3 --network $NET -e S3_ACCESS_KEY_ID=$KEY -e S3_SECRET_ACCESS_KEY=$SECRET interiores-s3-demo:local >/dev/null
until docker exec $PG pg_isready -U interiores -d interiores >/dev/null 2>&1; do sleep 1; done
wait_s3() {
  for _ in $(seq 1 120); do
    [ "$(docker inspect -f "{{.State.Running}}" $S3)" = true ] || { docker logs --tail 20 $S3; echo "el almacén no arrancó" >&2; exit 1; }
    docker exec $S3 sh -c 'wget -qS -O- http://127.0.0.1:8333/ 2>&1 | grep -q HTTP/' && return 0
    sleep 1
  done
  echo "el almacén no respondió" >&2; exit 1
}
wait_s3

docker run --rm --network $NET -e DATABASE_URL=$DB interiores-api-migrate:local
docker run --rm --network $NET \
  -e NODE_ENV=production -e DATABASE_URL=$DB -e REDIS_URL=redis://unused:6379/0 \
  -e S3_ENDPOINT=http://$S3:8333 -e S3_BUCKET=interiores-media -e S3_ACCESS_KEY_ID=$KEY -e S3_SECRET_ACCESS_KEY=$SECRET \
  -e S3_FORCE_PATH_STYLE=true -e JWT_ACCESS_SECRET=bake-bake-bake-bake-bake-bake-bake-bake \
  -e MEDIA_SIGNING_SECRET=bake-bake-bake-bake-bake-bake-bake-bake -e AI_SERVICE_URL=http://unused:8000 \
  -e AI_INTERNAL_TOKEN=bake-bake-bake-bake -e CATALOG_CACHE_DIR=/tmp/catalog-cache \
  -v interiores_catalog-cache:/tmp/catalog-cache interiores-api:local node dist/cli/seed.js

docker exec $PG pg_dump -U interiores -d interiores --no-owner --no-privileges > build/demo.sql
docker stop -t 20 $S3 >/dev/null
docker cp $S3:/seed/. build/s3data/
docker build -q -f postgres.Dockerfile -t interiores-pg-demo:local . >/dev/null
docker build -q -f storage.Dockerfile -t interiores-s3-demo:local . >/dev/null
echo "listo: $(du -sh build/demo.sql | cut -f1) de SQL, $(du -sh build/s3data | cut -f1) de archivos"
