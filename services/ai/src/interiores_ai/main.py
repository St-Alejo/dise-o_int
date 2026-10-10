"""Microservicio de IA (FastAPI). Solo accesible desde la red interna, protegido con token."""

import hmac
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .container import Container, build_container
from .contracts import (
    AnalyzeRoomRequest,
    AnalyzeRoomResponse,
    GenerateStyleRequest,
    GenerateStyleResponse,
    PlaceFurnitureRequest,
    PlaceFurnitureResponse,
)
from .imaging import InvalidImageError, decode_rgb, encode_jpeg
from .logging import configure_logging, log
from .providers.base import ProviderError
from .storage import ObjectNotFoundError


def create_app(container: Container | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or (container.settings if container else get_settings())
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.container = container or build_container(settings)
        yield

    app = FastAPI(title="Interiores IA — servicio de IA", version="0.1.0", lifespan=lifespan, docs_url="/docs")

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        if not request.url.path.startswith("/health"):
            log.info("request", status=response.status_code, ms=round((time.perf_counter() - started) * 1000, 1))
        return response

    @app.exception_handler(InvalidImageError)
    async def invalid_image(_: Request, exc: InvalidImageError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(ObjectNotFoundError)
    async def not_found(_: Request, exc: ObjectNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": f"No existe el objeto {exc}"})

    @app.exception_handler(ProviderError)
    async def provider_error(_: Request, exc: ProviderError) -> JSONResponse:
        log.warning("provider_error", error=str(exc), retryable=exc.retryable)
        return JSONResponse(status_code=503 if exc.retryable else 422, content={"detail": str(exc)})

    def get_container(request: Request) -> Container:
        c: Container = request.app.state.container
        return c

    def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
        expected = f"Bearer {settings.ai_internal_token}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Token interno inválido")

    Dep = Annotated[Container, Depends(get_container)]
    auth = [Depends(require_token)]

    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready(c: Dep) -> JSONResponse:
        try:
            c.storage.ping()
        except Exception as err:
            return JSONResponse(status_code=503, content={"status": "error", "detail": str(err)})
        # Si el proveedor externo está caído el servicio sigue sirviendo (layout y análisis
        # básico), así que se reporta "degraded" con 200 en vez de sacarlo de rotación.
        providers = c.provider_health()
        status = "degraded" if providers["external"] == "down" else "ok"
        return JSONResponse({"status": status, **providers})

    # Endpoints síncronos: FastAPI los ejecuta en un threadpool (OpenCV/boto3 son bloqueantes).
    @app.post("/v1/room/analyze", dependencies=auth, response_model_exclude_none=True)
    def analyze_room(req: AnalyzeRoomRequest, c: Dep) -> AnalyzeRoomResponse:
        started = time.perf_counter()
        image = decode_rgb(c.storage.get_bytes(req.photoKey), c.settings.max_image_side)
        result = c.room_analyzer.analyze(image, req.roomType)
        ms = (time.perf_counter() - started) * 1000
        provider = result.provider or c.room_analyzer.name
        log.info("room_analyzed", provider=provider, ms=round(ms), width=result.shell.widthM, depth=result.shell.depthM)
        return AnalyzeRoomResponse(roomShell=result.shell, detectedObjects=result.objects, provider=provider, durationMs=ms, suggestions=result.suggestions)

    @app.post("/v1/styles/generate", dependencies=auth)
    def generate_style(req: GenerateStyleRequest, c: Dep) -> GenerateStyleResponse:
        if not req.outputKey.startswith("projects/"):
            raise HTTPException(status_code=422, detail="outputKey fuera del espacio de proyectos")
        started = time.perf_counter()
        image = decode_rgb(c.storage.get_bytes(req.photoKey), c.settings.max_image_side)
        styled = c.style_generator.generate(image, req.styleId, req.roomType, req.promptStrength)
        c.storage.put_bytes(req.outputKey, encode_jpeg(styled), "image/jpeg")
        ms = (time.perf_counter() - started) * 1000
        log.info("style_generated", provider=c.style_generator.name, style=req.styleId, ms=round(ms))
        return GenerateStyleResponse(imageKey=req.outputKey, provider=c.style_generator.name, durationMs=ms)

    # exclude_none: los campos opcionales ausentes no viajan como null (zod los rechazaría).
    @app.post("/v1/layout/place", dependencies=auth, response_model_exclude_none=True)
    def place_furniture(req: PlaceFurnitureRequest, c: Dep) -> PlaceFurnitureResponse:
        result = c.layout_engine.place(req)
        log.info("layout", engine=result.engine, placed=len(result.placements), unplaced=result.unplaced, score=result.score)
        return result

    return app


def app_factory() -> FastAPI:
    """Punto de entrada de uvicorn (`--factory`)."""
    return create_app()
