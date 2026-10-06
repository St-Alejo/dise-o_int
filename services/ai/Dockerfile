# syntax=docker/dockerfile:1.7
# Servicio de IA (FastAPI). Etapas: base → deps → test → prod (no-root, healthcheck).
ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencias en una capa propia: solo se reconstruye si cambia pyproject.toml.
FROM base AS deps
COPY pyproject.toml ./
RUN python - <<'PY'
import tomllib
p = tomllib.load(open("pyproject.toml", "rb"))["project"]
open("requirements.txt", "w").write("\n".join(p["dependencies"]))
open("requirements-dev.txt", "w").write("\n".join(p["optional-dependencies"]["dev"]))
PY
RUN pip install --prefix=/install -r requirements.txt

FROM base AS dev
COPY --from=deps /install /usr/local
COPY --from=deps /app/requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY . .
RUN pip install --no-deps -e .
CMD ["uvicorn", "--factory", "interiores_ai.main:app_factory", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "src"]

FROM dev AS test
CMD ["sh", "-c", "ruff check src tests && mypy src && pytest --cov=interiores_ai --cov-report=term-missing"]

FROM base AS prod
COPY --from=deps /install /usr/local
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-deps . \
 && useradd --create-home --uid 10001 app
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=2).status == 200 else 1)"
# UVICORN_HOST='::' escucha IPv4 + IPv6 (red privada de Railway).
ENV UVICORN_HOST=0.0.0.0 UVICORN_PORT=8000
CMD ["sh", "-c", "exec uvicorn --factory interiores_ai.main:app_factory --host \"$UVICORN_HOST\" --port \"$UVICORN_PORT\" --workers 2 --no-server-header"]
