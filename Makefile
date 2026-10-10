# Interiores IA — atajos. Requiere Docker (y make: en Windows usa Git Bash o WSL).
# `make help` lista los comandos.
SHELL := /bin/sh
COMPOSE := docker compose
DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
WEB_PORT ?= $(shell grep -E "^WEB_PORT=" .env 2>/dev/null | cut -d= -f2)
BASE_URL ?= http://localhost:$(or $(WEB_PORT),8080)

.PHONY: help env build up down dev logs ps test test-api test-web test-ai smoke e2e seed backup-db restore-db clean

help: ## Muestra esta ayuda
	@grep -E "^[a-z0-9-]+:.*## " $(MAKEFILE_LIST) | awk -F ":.*## " '{printf "  %-12s %s\n", $$1, $$2}'

env: ## Crea .env con secretos aleatorios (solo la primera vez)
	./scripts/init-env.sh

build: ## Construye las imágenes de producción
	./scripts/build-images.sh

up: env build ## Levanta el stack completo y espera a que esté sano
	$(COMPOSE) up -d --no-build --wait
	@echo "Listo → $(BASE_URL)"

down: ## Detiene el stack (conserva los datos)
	$(COMPOSE) down

dev: env ## Modo desarrollo con recarga en caliente (web en :4300)
	./scripts/build-images.sh api api-dev web-dev ai-dev migrate
	$(DEV) up -d --no-build --wait

logs: ## Sigue los logs (make logs s=api)
	$(COMPOSE) logs -f --tail=100 $(s)

ps: ## Estado y salud de los servicios
	$(COMPOSE) ps

test: test-api test-web test-ai ## Todas las pruebas unitarias

test-api: ## Pruebas de tipos compartidos + API (Vitest)
	./scripts/toolbox.sh "npm ci --no-audit --no-fund && npm run build:types && npm test -w @interiores/shared-types && npm test -w api"

test-web: ## Lint, pruebas y build de la web (Angular + Vitest)
	./scripts/toolbox.sh "npm run build:types && npm run lint -w web && npm test -w web && npm run build -w web"

test-ai: ## Lint, tipos y pruebas del servicio de IA (pytest)
	docker build --target dev -t interiores-ai:dev services/ai
	docker run --rm -v "$$(pwd -W 2>/dev/null || pwd):/repo" -w /repo/services/ai -e PYTHONPATH=/repo/services/ai/src interiores-ai:dev sh -c "ruff check src tests && mypy src && pytest -q"

smoke: ## Prueba de humo del backend contra el stack levantado
	node e2e/smoke.mjs $(BASE_URL)

e2e: ## Pruebas E2E de UI (Playwright + axe) contra el stack levantado
	docker run --rm -v "$$(pwd -W 2>/dev/null || pwd)/e2e:/e2e" -v interiores_nm_e2e:/e2e/node_modules -w /e2e --ipc=host \
	  -e BASE_URL=$(subst localhost,host.docker.internal,$(BASE_URL)) mcr.microsoft.com/playwright:v1.63.0-noble \
	  sh -c "npm install --no-audit --no-fund >/dev/null && npx playwright test"

seed: ## Recarga el catálogo de muebles (idempotente)
	$(COMPOSE) run --rm seed

backup-db: ## Copia de seguridad de PostgreSQL en ./backups
	@mkdir -p backups
	$(COMPOSE) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --format=custom' > backups/interiores-$$(date +%Y%m%d-%H%M%S).dump
	@ls -1t backups | head -1

restore-db: ## Restaura una copia: make restore-db f=backups/archivo.dump
	@test -n "$(f)" || (echo "Uso: make restore-db f=backups/archivo.dump" && exit 1)
	$(COMPOSE) cp $(f) postgres:/tmp/restore.dump
	$(COMPOSE) exec -T postgres sh -c 'pg_restore -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --clean --if-exists /tmp/restore.dump && rm /tmp/restore.dump'

clean: ## Borra contenedores Y DATOS (volúmenes). Pide confirmación.
	@printf "Esto borra la base de datos, fotos y catálogo locales. ¿Seguro? [y/N] " && read ans && [ "$$ans" = y ]
	$(COMPOSE) down -v --remove-orphans
