# syntax=docker/dockerfile:1.7
# Web Angular servida por nginx no-root. Contexto: raíz del monorepo.
ARG NODE_VERSION=24.21.0
ARG NGINX_VERSION=1.30.5

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/furniture-kit/package.json packages/furniture-kit/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace web --workspace @interiores/shared-types --workspace @interiores/furniture-kit --include-workspace-root --no-audit --no-fund

FROM deps AS dev
COPY packages/shared-types packages/shared-types
COPY packages/furniture-kit packages/furniture-kit
COPY apps/web apps/web
RUN npm run build:types
EXPOSE 4200
CMD ["npm", "start", "-w", "web"]

FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY packages/furniture-kit packages/furniture-kit
COPY apps/web apps/web
RUN npm run build:types && npm run build -w web

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS prod
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS: la imagen detecta el DNS local (Docker, K8s, Railway...)
ENV API_UPSTREAM=api:3000 NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 NGINX_RESOLVER_IPV6=off
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
