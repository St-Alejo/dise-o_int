#!/usr/bin/env bash
# Despliega (o actualiza) la demo en Azure Container Apps, plan de consumo y escala a cero.
#   ca-interiores-web  nginx + SPA, ingress público
#   ca-interiores-api  api + worker + ai + postgres + redis + seaweedfs en una réplica (localhost),
#                      ingress interno; los datos vienen sembrados en las imágenes y se reinician
#                      cada vez que la app se apaga por inactividad.
# Requisitos: az login, el entorno $ENV_NAME y el registro $ACR creados, imágenes subidas con $TAG.
# PLANO3D_API_URL: API de Plano 3D para enlazar casas por código (por defecto, su demo en Azure).
# ANTHROPIC_API_KEY (opcional, se lee del entorno; nunca se escribe en el repo): con ella el chat y la
# lectura de fotos usan Claude (secreto anthropic-key, tope CLAUDE_BUDGET_USD); sin ella, solo lo local.
# Uso: ACR=acrinteriores1256 TAG=<sha> bash infra/azure/deploy.sh
set -euo pipefail
RG=${RG:-rg-interiores-demo}
ENV_NAME=${ENV_NAME:-cae-interiores}
ACR=${ACR:?define ACR}
PLANO3D_API_URL=${PLANO3D_API_URL:-https://ca-plano3d-api.bravefield-201b313a.brazilsouth.azurecontainerapps.io}
TAG=${TAG:?define TAG}
R=$ACR.azurecr.io

ENV_ID=$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query id -o tsv)
LOC=$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query location -o tsv)
DOMAIN=$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query properties.defaultDomain -o tsv)
API_FQDN=ca-interiores-api.internal.$DOMAIN
WEB_URL=https://ca-interiores-web.$DOMAIN
ACR_PASS=$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)
rnd() { openssl rand -hex "$1"; }
PG_PASS=$(rnd 16) S3_KEY=$(rnd 10) S3_SECRET=$(rnd 20) JWT=$(rnd 32) MEDIA=$(rnd 32) AI_TOKEN=$(rnd 24)

# IA con Claude solo si hay clave. Groq ya no se usa (su cuota gratuita se agota en una demostración).
CLAUDE_SECRET="" CHAT_ENV='          - { name: CHAT_LLM, value: "off" }' ROOM_ENV='          - { name: ROOM_ANALYZER, value: mock }'
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  CLAUDE_SECRET="      - { name: anthropic-key, value: \"$ANTHROPIC_API_KEY\" }"
  CHAT_ENV='          - { name: CHAT_LLM, value: "claude" }
          - { name: ANTHROPIC_API_KEY, secretRef: anthropic-key }
          - { name: CHAT_MODEL, value: "claude-sonnet-5-5" }
          - { name: CLAUDE_BUDGET_USD, value: "'"${CLAUDE_BUDGET_USD:-1}"'" }'
  ROOM_ENV='          - { name: ROOM_ANALYZER, value: vision }
          - { name: ANTHROPIC_API_KEY, secretRef: anthropic-key }'
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/api.yaml" <<YAML
location: $LOC
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: false
      targetPort: 3000
      transport: auto
      allowInsecure: true
    registries:
      - server: $R
        username: $ACR
        passwordSecretRef: acr-password
    secrets:
      - { name: acr-password, value: "$ACR_PASS" }
      - { name: pg-password, value: "$PG_PASS" }
      - { name: database-url, value: "postgresql://interiores:$PG_PASS@localhost:5432/interiores" }
      - { name: s3-key, value: "$S3_KEY" }
      - { name: s3-secret, value: "$S3_SECRET" }
      - { name: jwt, value: "$JWT" }
      - { name: media, value: "$MEDIA" }
      - { name: ai-token, value: "$AI_TOKEN" }
$CLAUDE_SECRET
  template:
    scale:
      minReplicas: 0
      maxReplicas: 1
      rules:
        - name: http
          http: { metadata: { concurrentRequests: "80" } }
    containers:
      - name: api
        image: $R/api:$TAG
        resources: { cpu: 0.5, memory: 1Gi }
        env:
          - { name: APP_ENTRY, value: dist/main.js }
          - { name: NODE_ENV, value: production }
          - { name: TRUST_PROXY, value: "3" }
          - { name: DATABASE_URL, secretRef: database-url }
          - { name: REDIS_URL, value: "redis://localhost:6379/0" }
          - { name: S3_ENDPOINT, value: "http://localhost:8333" }
          - { name: S3_BUCKET, value: interiores-media }
          - { name: S3_ACCESS_KEY_ID, secretRef: s3-key }
          - { name: S3_SECRET_ACCESS_KEY, secretRef: s3-secret }
          - { name: S3_FORCE_PATH_STYLE, value: "true" }
          - { name: JWT_ACCESS_SECRET, secretRef: jwt }
          - { name: MEDIA_SIGNING_SECRET, secretRef: media }
          - { name: AI_SERVICE_URL, value: "http://localhost:8000" }
          - { name: AI_INTERNAL_TOKEN, secretRef: ai-token }
          - { name: COOKIE_SECURE, value: "true" }
          - { name: PUBLIC_WEB_URL, value: "$WEB_URL" }
          - { name: PLANO3D_API_URL, value: "$PLANO3D_API_URL" }
$CHAT_ENV
          - { name: WORKER_CONCURRENCY, value: "2" }
      - name: worker
        image: $R/api:$TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
        env:
          - { name: APP_ENTRY, value: dist/worker.js }
          - { name: NODE_ENV, value: production }
          - { name: DATABASE_URL, secretRef: database-url }
          - { name: REDIS_URL, value: "redis://localhost:6379/0" }
          - { name: S3_ENDPOINT, value: "http://localhost:8333" }
          - { name: S3_BUCKET, value: interiores-media }
          - { name: S3_ACCESS_KEY_ID, secretRef: s3-key }
          - { name: S3_SECRET_ACCESS_KEY, secretRef: s3-secret }
          - { name: S3_FORCE_PATH_STYLE, value: "true" }
          - { name: JWT_ACCESS_SECRET, secretRef: jwt }
          - { name: MEDIA_SIGNING_SECRET, secretRef: media }
          - { name: AI_SERVICE_URL, value: "http://localhost:8000" }
          - { name: AI_INTERNAL_TOKEN, secretRef: ai-token }
          - { name: PUBLIC_WEB_URL, value: "$WEB_URL" }
          - { name: PLANO3D_API_URL, value: "$PLANO3D_API_URL" }
$CHAT_ENV
          - { name: WORKER_CONCURRENCY, value: "2" }
      - name: ai
        image: $R/ai:$TAG
        resources: { cpu: 0.5, memory: 1Gi }
        env:
          - { name: AI_INTERNAL_TOKEN, secretRef: ai-token }
$ROOM_ENV
          - { name: STYLE_GENERATOR, value: mock }
          - { name: REDIS_URL, value: "redis://localhost:6379/0" }
          - { name: S3_ENDPOINT, value: "http://localhost:8333" }
          - { name: S3_BUCKET, value: interiores-media }
          - { name: S3_ACCESS_KEY_ID, secretRef: s3-key }
          - { name: S3_SECRET_ACCESS_KEY, secretRef: s3-secret }
          - { name: S3_FORCE_PATH_STYLE, value: "true" }
      - name: postgres
        image: $R/postgres-demo:$TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
        env:
          - { name: POSTGRES_USER, value: interiores }
          - { name: POSTGRES_DB, value: interiores }
          - { name: POSTGRES_PASSWORD, secretRef: pg-password }
      - name: redis
        image: $R/redis:$TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
        args: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory-policy", "noeviction"]
      - name: storage
        image: $R/storage-demo:$TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
        env:
          - { name: S3_ACCESS_KEY_ID, secretRef: s3-key }
          - { name: S3_SECRET_ACCESS_KEY, secretRef: s3-secret }
YAML

cat > "$TMP/web.yaml" <<YAML
location: $LOC
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 8080
      transport: auto
      allowInsecure: false
    registries:
      - server: $R
        username: $ACR
        passwordSecretRef: acr-password
    secrets:
      - { name: acr-password, value: "$ACR_PASS" }
  template:
    scale:
      minReplicas: 0
      maxReplicas: 1
      rules:
        - name: http
          http: { metadata: { concurrentRequests: "100" } }
    containers:
      - name: web
        image: $R/web:$TAG
        resources: { cpu: 0.25, memory: 0.5Gi }
        env:
          - { name: API_UPSTREAM, value: "$API_FQDN:80" }
          - { name: API_HOST, value: "$API_FQDN" }
YAML

for app in api web; do
  name=ca-interiores-$app
  if az containerapp show -n "$name" -g "$RG" -o none 2>/dev/null; then
    az containerapp update -n "$name" -g "$RG" --yaml "$TMP/$app.yaml" -o none
  else
    az containerapp create -n "$name" -g "$RG" --yaml "$TMP/$app.yaml" -o none
  fi
  echo "$name desplegada"
done
echo "Web: $WEB_URL"
