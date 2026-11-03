"""El nodo baja la escena, corre Blender, informa el avance y sube los archivos con las claves del trabajo."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from interiores_blender import runner as runner_module
from interiores_blender.contracts import Heartbeat
from interiores_blender.runner import BlenderRunner, RenderCancelledError, RenderFailedError
from interiores_blender.storage import MemoryStorage
from interiores_blender.worker import ProgressThrottle, RenderJobHandler, heartbeat_payload

FAKE = Path(__file__).with_name("fake_blender.py")
JOB: dict[str, Any] = json.loads(Path(__file__).with_name("fixtures").joinpath("job.json").read_text(encoding="utf-8"))
PREFIX = JOB["outputPrefix"]


def make_handler(tmp_path: Path, *, timeout_s: float = 30, cancelled: bool = False) -> tuple[RenderJobHandler, MemoryStorage]:
    storage = MemoryStorage()
    storage.objects[JOB["sceneKey"]] = (b"glTF...", "model/gltf-binary")

    async def is_cancelled(_render_id: str) -> bool:
        return cancelled

    runner = BlenderRunner([sys.executable, str(FAKE)], timeout_s)
    return RenderJobHandler(storage, runner, tmp_path, is_cancelled), storage


async def test_renderiza_sube_los_tres_archivos_y_limpia(tmp_path: Path) -> None:
    handler, storage = make_handler(tmp_path)
    reported: list[int] = []

    async def report(pct: int) -> None:
        reported.append(pct)

    result = await handler.handle(JOB, report)

    assert result.model_dump() == {
        "imageKey": f"{PREFIX}.png",
        "previewKey": f"{PREFIX}.jpg",
        "blendKey": f"{PREFIX}.blend",
        "seconds": 1.5,
        "device": "CPU",
    }
    assert storage.objects[f"{PREFIX}.png"][1] == "image/png"
    assert storage.objects[f"{PREFIX}.jpg"][1] == "image/jpeg"
    assert storage.objects[f"{PREFIX}.blend"][1] == "application/x-blender"
    assert reported and reported[0] == 3  # "Loading render kernels" llega antes del muestreo
    assert list(tmp_path.iterdir()) == []


async def test_si_blender_falla_cuenta_por_que(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_BLENDER", "fail")
    handler, storage = make_handler(tmp_path)
    with pytest.raises(RenderFailedError, match="out of memory"):
        await handler.handle(JOB, _ignore)
    assert f"{PREFIX}.png" not in storage.objects
    assert list(tmp_path.iterdir()) == []


async def test_sin_resultado_no_hay_render(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_BLENDER", "mute")
    handler, _ = make_handler(tmp_path)
    with pytest.raises(RenderFailedError):
        await handler.handle(JOB, _ignore)


async def test_cancelar_corta_blender(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_BLENDER", "hang")
    monkeypatch.setattr(runner_module, "CANCEL_POLL_S", 0.05)
    handler, _ = make_handler(tmp_path, cancelled=True)
    with pytest.raises(RenderCancelledError):
        await handler.handle(JOB, _ignore)


async def test_un_render_colgado_se_corta_por_tiempo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_BLENDER", "hang")
    monkeypatch.setattr(runner_module, "CANCEL_POLL_S", 0.05)
    handler, _ = make_handler(tmp_path, timeout_s=0.3)
    with pytest.raises(RenderFailedError, match="timeout"):
        await handler.handle(JOB, _ignore)


async def test_el_avance_solo_sube_y_no_satura_redis() -> None:
    sent: list[int] = []

    async def report(pct: int) -> None:
        sent.append(pct)

    throttle = ProgressThrottle(report, interval_s=0)
    for pct in (3, 5, 5, 4, 40):
        await throttle(pct)
    assert sent == [3, 5, 40]
    slow = ProgressThrottle(report, interval_s=60)
    sent.clear()
    for pct in (10, 20, 30):
        await slow(pct)
    assert sent == [10]


def test_el_latido_cumple_su_modelo() -> None:
    beat = Heartbeat.model_validate_json(heartbeat_payload("CUDA"))
    assert beat.device == "CUDA"


async def _ignore(_pct: int) -> None:
    return None
