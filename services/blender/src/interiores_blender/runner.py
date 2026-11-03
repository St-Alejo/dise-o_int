"""Lanza Blender en segundo plano con render_scene.py y sigue su salida línea a línea."""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from .progress import RESULT_PREFIX, progress_pct

ProgressFn = Callable[[int], Awaitable[None]]
CancelFn = Callable[[], Awaitable[bool]]

#: Cada cuánto se pregunta si cancelaron el render (una consulta a Redis).
CANCEL_POLL_S = 2.0


class RenderCancelledError(Exception):
    """Borraron el render mientras se hacía."""


class RenderFailedError(Exception):
    """Blender terminó mal, no dijo qué produjo o tardó demasiado."""


@dataclass(frozen=True)
class RenderOutput:
    #: Rutas locales: `image` (PNG), `preview` (JPEG) y, si se guardó, `blend`.
    files: dict[str, str]
    device: str
    seconds: float


class BlenderRunner:
    def __init__(self, command: Sequence[str], timeout_s: float) -> None:
        #: Lo que va antes de `--`: el ejecutable de Blender y sus opciones (o un doble en los tests).
        self._command = list(command)
        self._timeout_s = timeout_s

    @classmethod
    def for_blender(cls, blender_bin: str, script: Path, timeout_s: float) -> BlenderRunner:
        return cls([blender_bin, "-b", "--factory-startup", "--python", str(script)], timeout_s)

    async def run(self, scene: Path, plan: Path, out: Path, on_progress: ProgressFn, is_cancelled: CancelFn) -> RenderOutput:
        args = ["--", "--scene", str(scene), "--plan", str(plan), "--out", str(out), "--save-blend"]
        proc = await asyncio.create_subprocess_exec(
            *self._command, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        assert proc.stdout is not None
        summary: dict[str, object] | None = None
        tail: deque[str] = deque(maxlen=20)
        started = time.monotonic()
        last_cancel_check = started
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(proc.stdout.readline(), timeout=CANCEL_POLL_S)
                except TimeoutError:
                    raw = None
                if raw == b"":
                    break
                if raw:
                    line = raw.decode("utf-8", errors="replace").rstrip()
                    tail.append(line)
                    if line.startswith(RESULT_PREFIX):
                        summary = json.loads(line[len(RESULT_PREFIX) :])
                    pct = progress_pct(line)
                    if pct is not None:
                        await on_progress(pct)
                now = time.monotonic()
                if now - last_cancel_check >= CANCEL_POLL_S:
                    last_cancel_check = now
                    if await is_cancelled():
                        raise RenderCancelledError("Render cancelado")
                if now - started > self._timeout_s:
                    raise RenderFailedError(f"timeout: Blender superó los {self._timeout_s:.0f} s")
            code = await proc.wait()
        except BaseException:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
            raise
        if code != 0 or summary is None:
            raise RenderFailedError(f"Blender terminó con código {code}: " + " | ".join(_errors(tail)))
        files = summary.get("files")
        if not isinstance(files, dict) or "image" not in files or "preview" not in files:
            raise RenderFailedError("Blender no dijo qué archivos produjo")
        return RenderOutput(
            files={str(k): str(v) for k, v in files.items()},
            device=str(summary.get("device", "?")),
            seconds=float(summary.get("seconds", time.monotonic() - started)),  # type: ignore[arg-type]
        )


def _errors(tail: deque[str]) -> list[str]:
    """Las últimas líneas que parecen un error; si no hay, las últimas a secas."""
    errors = [line for line in tail if "error" in line.lower() or "traceback" in line.lower()]
    return (errors or list(tail))[-3:]
