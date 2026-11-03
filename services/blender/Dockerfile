# syntax=docker/dockerfile:1.7
# Nodo de render con Blender (ADR-0036). Etapas: blender (descarga verificada) → base → test → prod.
# La GPU la pone el runtime de NVIDIA (compose: perfil gpu); sin ella Cycles cae a CPU.
ARG UBUNTU_VERSION=24.04
ARG BLENDER_VERSION=4.5.15
ARG BLENDER_SHA256=0d2b8bb2efe97e6c8eb57de6b7322f8800e1984e3125b60decca5f6771e4773e

FROM ubuntu:${UBUNTU_VERSION} AS blender
ARG BLENDER_VERSION
ARG BLENDER_SHA256
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
RUN series="$(echo "$BLENDER_VERSION" | cut -d. -f1,2)" \
 && curl -fsSL -o /tmp/blender.tar.xz "https://download.blender.org/release/Blender${series}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
 && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/blender \
 && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
 && rm /tmp/blender.tar.xz

FROM ubuntu:${UBUNTU_VERSION} AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive
# Bibliotecas que Blender carga aunque corra sin ventana (-b), y Python para el worker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates python3 python3-venv \
      libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libice6 \
      libgl1 libegl1 libglu1-mesa libxext6 libxcursor1 libxinerama1 libxrandr2 libwayland-client0 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=blender /opt/blender /opt/blender
ENV PATH="/opt/venv/bin:/opt/blender:${PATH}" \
    BLENDER_BIN=/opt/blender/blender \
    INTERIORES_BLENDER_SRC=/app/src \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics
WORKDIR /app
RUN python3 -m venv /opt/venv
COPY pyproject.toml ./
RUN python - <<'PY'
import tomllib
p = tomllib.load(open("pyproject.toml", "rb"))["project"]
open("requirements.txt", "w").write("\n".join(p["dependencies"]))
open("requirements-dev.txt", "w").write("\n".join(p["optional-dependencies"]["dev"]))
PY
RUN pip install -r requirements.txt

FROM base AS test
RUN pip install -r requirements-dev.txt
COPY . .
RUN pip install --no-deps -e .
CMD ["sh", "-c", "ruff check src tests blender && mypy src && pytest --cov=interiores_blender --cov-report=term-missing"]

FROM base AS prod
COPY src ./src
COPY blender ./blender
RUN pip install --no-deps . \
 && useradd --create-home --uid 10001 app \
 && mkdir -p /tmp/renders && chown app /tmp/renders
USER app
CMD ["python", "-m", "interiores_blender.worker"]
