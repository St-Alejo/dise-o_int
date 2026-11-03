"""Nodo de render: consume la cola `render-jobs`, renderiza con Blender y deja el resultado en S3.

La API es la única que escribe en la base (ADR-0036): aquí solo se baja la escena, se renderiza,
se suben los archivos y se devuelve un BlenderResult que la API recoge desde la cola.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import shutil
import signal
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
from bullmq import Job, UnrecoverableError, Worker
from redis.asyncio import Redis

from .config import Settings
from .contracts import HEARTBEAT_KEY, RENDER_QUEUE, BlenderJob, BlenderResult, Heartbeat, cancel_key
from .runner import BlenderRunner, ProgressFn, RenderCancelledError
from .storage import ObjectStorage, S3Storage

log = structlog.get_logger()

#: Tipo de cada archivo que sube el nodo.
CONTENT_TYPES = {"image": ("png", "image/png"), "preview": ("jpg", "image/jpeg"), "blend": ("blend", "application/x-blender")}


class ProgressThrottle:
    """Reporta el avance solo cuando sube y, como mucho, una vez por intervalo (cada aviso va a Redis)."""

    def __init__(self, report: ProgressFn, interval_s: float = 1.0) -> None:
        self._report = report
        self._interval_s = interval_s
        self._last_pct = -1
        self._last_at = -math.inf  # el primer aviso siempre sale (monotonic puede ser pequeño)

    async def __call__(self, pct: int) -> None:
        now = time.monotonic()
        if pct <= self._last_pct or now - self._last_at < self._interval_s:
            return
        self._last_pct, self._last_at = pct, now
        await self._report(pct)


class RenderJobHandler:
    def __init__(
        self,
        storage: ObjectStorage,
        runner: BlenderRunner,
        work_dir: Path,
        is_cancelled: Callable[[str], Awaitable[bool]],
    ) -> None:
        self._storage = storage
        self._runner = runner
        self._work_dir = work_dir
        self._is_cancelled = is_cancelled

    async def handle(self, data: dict[str, Any], report: ProgressFn) -> BlenderResult:
        job = BlenderJob.model_validate(data)
        folder = self._work_dir / job.renderId
        folder.mkdir(parents=True, exist_ok=True)
        try:
            scene = folder / "scene.glb"
            await asyncio.to_thread(self._storage.download, job.sceneKey, scene)
            plan = folder / "plan.json"
            plan.write_text(json.dumps(job.plan), encoding="utf-8")

            async def cancelled() -> bool:
                return await self._is_cancelled(job.renderId)

            output = await self._runner.run(scene, plan, folder / "render", ProgressThrottle(report), cancelled)
            keys: dict[str, str] = {}
            for role, local in output.files.items():
                if role not in CONTENT_TYPES or not Path(local).exists():
                    continue
                ext, content_type = CONTENT_TYPES[role]
                keys[role] = f"{job.outputPrefix}.{ext}"
                await asyncio.to_thread(self._storage.upload, Path(local), keys[role], content_type)
            return BlenderResult(
                imageKey=keys["image"],
                previewKey=keys["preview"],
                blendKey=keys.get("blend"),
                seconds=output.seconds,
                device=output.device,
            )
        finally:
            shutil.rmtree(folder, ignore_errors=True)


def heartbeat_payload(device: str) -> str:
    return Heartbeat(device=device, at=datetime.now(UTC).isoformat()).model_dump_json()


async def run(settings: Settings) -> None:
    redis = Redis.from_url(settings.redis_url)
    runner = BlenderRunner.for_blender(settings.blender_bin, settings.render_script, settings.render_timeout_s)

    async def is_cancelled(render_id: str) -> bool:
        return bool(await redis.exists(cancel_key(render_id)))

    handler = RenderJobHandler(S3Storage(settings), runner, settings.work_dir, is_cancelled)
    device = settings.node_device

    async def process(job: Job, _token: str) -> dict[str, Any]:
        nonlocal device
        bound = log.bind(render_id=job.id, attempt=job.attemptsMade + 1)
        bound.info("render.start")
        try:
            result = await handler.handle(job.data, job.updateProgress)
        except RenderCancelledError as err:
            # Reintentar algo que borraron no tiene sentido.
            bound.info("render.cancelled")
            raise UnrecoverableError(str(err)) from err
        except Exception as err:
            bound.warning("render.failed", error=str(err))
            raise
        finally:
            await redis.delete(cancel_key(str(job.id)))
        device = result.device
        bound.info("render.done", seconds=result.seconds, device=result.device)
        return result.model_dump()

    # Un render a la vez: la GPU es una. El bloqueo se renueva solo mientras Blender trabaja.
    worker = Worker(RENDER_QUEUE, process, {"connection": settings.redis_url, "concurrency": 1, "lockDuration": 60_000})
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    ttl = int(settings.heartbeat_interval_s * 3)
    log.info("node.ready", queue=RENDER_QUEUE, device=device)
    try:
        while not stop.is_set():
            await redis.set(HEARTBEAT_KEY, heartbeat_payload(device), ex=ttl)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=settings.heartbeat_interval_s)
    finally:
        # Primero se deja de anunciar el nodo, para que la API no encole más; luego se espera al render en curso.
        await redis.delete(HEARTBEAT_KEY)
        await worker.close()
        await redis.aclose()
        log.info("node.stopped")


def main() -> None:
    settings = Settings()
    structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(settings.log_level.upper()))
    asyncio.run(run(settings))


if __name__ == "__main__":
    main()
