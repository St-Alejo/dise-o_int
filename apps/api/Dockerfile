# syntax=docker/dockerfile:1.7
# API NestJS + worker BullMQ (misma imagen, distinto comando). Contexto: raíz del monorepo.
# Etapas: deps → dev | build → migrate | prod-deps → prod
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache tini
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/furniture-kit/package.json packages/furniture-kit/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace api --workspace @interiores/shared-types --workspace @interiores/furniture-kit --include-workspace-root --no-audit --no-fund

# ---- desarrollo: hot reload con el código montado como volumen
FROM deps AS dev
COPY packages/shared-types packages/shared-types
COPY packages/furniture-kit packages/furniture-kit
COPY apps/api apps/api
RUN npm run build:types && npm run prisma:generate -w api
ENV NODE_ENV=development
CMD ["npm", "run", "start:dev", "-w", "api"]

# ---- compilación
FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY packages/furniture-kit packages/furniture-kit
COPY apps/api apps/api
RUN npm run build:types && npm run build -w api

# ---- migraciones (job one-shot: `prisma migrate deploy`; nunca dentro del arranque de la API)
FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- dependencias de producción (sin devDependencies)
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/furniture-kit/package.json packages/furniture-kit/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace api --workspace @interiores/shared-types --workspace @interiores/furniture-kit --no-audit --no-fund

# ---- imagen final: sin compiladores ni devDeps, usuario no-root, tini como PID 1
FROM base AS prod
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/furniture-kit/package.json ./packages/furniture-kit/package.json
COPY --from=build /app/packages/furniture-kit/dist ./packages/furniture-kit/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /tmp/catalog-cache && chown node:node /tmp/catalog-cache
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# APP_ENTRY elige el proceso con la misma imagen: dist/main.js (API) · dist/worker.js · dist/cli/seed.js
ENV APP_ENTRY=dist/main.js
CMD ["sh", "-c", "exec node \"$APP_ENTRY\""]
