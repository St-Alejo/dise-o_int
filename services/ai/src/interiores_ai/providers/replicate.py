"""Adapter a la API HTTP de Replicate (inferencia hospedada, sin GPUs propias — §6.1).

- Modelos configurables por entorno ("owner/name" u "owner/name:version").
- Timeout global por predicción, polling con backoff y cancelación si se excede.
- Circuit breaker: tras varios fallos seguidos deja de llamar durante un tiempo y falla
  rápido, para no acumular jobs colgados cuando el proveedor está caído.
"""

import base64
import io
import threading
import time
from typing import Any, ClassVar

import httpx
import numpy as np
from PIL import Image

from ..config import Settings
from ..contracts import RoomType, StyleId
from ..imaging import RGB, decode_rgb, encode_jpeg
from .base import ProviderError, RoomAnalysis
from .room_mock import DEFAULT_DIMS, MockRoomAnalyzer
from .shell import rectangular_shell

API = "https://api.replicate.com/v1"

STYLE_PROMPTS: dict[StyleId, str] = {
    "escandinavo": "scandinavian interior, light oak wood, white walls, cozy wool textiles, hygge",
    "minimalista": "minimalist interior, clean lines, neutral palette, uncluttered, soft daylight",
    "industrial": "industrial loft interior, exposed brick, black steel, leather, edison bulbs",
    "bohemio": "bohemian interior, plants, rattan, terracotta, layered patterned rugs, warm light",
    "moderno": "modern contemporary interior, bold accents, geometric shapes, sleek furniture",
    "clasico": "classic elegant interior, dark wood, moldings, tufted upholstery, brass details",
}
ROOM_PROMPTS: dict[RoomType, str] = {
    "living": "living room",
    "bedroom": "bedroom",
    "dining": "dining room",
    "office": "home office",
}
NEGATIVE = "lowres, watermark, text, deformed, blurry, distorted walls, extra windows, people"


class CircuitBreaker:
    def __init__(self, threshold: int = 4, cooldown_s: float = 60.0) -> None:
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self._failures = 0
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    def before_call(self) -> None:
        with self._lock:
            if self._opened_at is None:
                return
            if time.monotonic() - self._opened_at < self.cooldown_s:
                raise ProviderError("Proveedor de IA temporalmente deshabilitado (circuit breaker abierto)")
            self._opened_at = None  # half-open: se permite un intento

    def success(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = None

    def failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self.threshold:
                self._opened_at = time.monotonic()


class ReplicateClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        if not settings.replicate_api_token:
            raise ProviderError("Falta REPLICATE_API_TOKEN", retryable=False)
        self.timeout_s = settings.replicate_timeout_s
        self.breaker = CircuitBreaker()
        self._http = httpx.Client(
            base_url=API,
            headers={"Authorization": f"Bearer {settings.replicate_api_token}"},
            timeout=httpx.Timeout(30.0, connect=10.0),
            transport=transport,
        )

    def run(self, model: str, inputs: dict[str, Any]) -> Any:
        self.breaker.before_call()
        try:
            result = self._run(model, inputs)
        except ProviderError as err:
            if err.retryable:
                self.breaker.failure()
            raise
        except httpx.HTTPError as err:
            self.breaker.failure()
            raise ProviderError(f"Error de red con Replicate: {err}") from err
        self.breaker.success()
        return result

    def download(self, url: str) -> bytes:
        res = self._http.get(url, follow_redirects=True, timeout=60.0)
        res.raise_for_status()
        return res.content

    def _run(self, model: str, inputs: dict[str, Any]) -> Any:
        if ":" in model:
            _, version = model.split(":", 1)
            res = self._http.post("/predictions", json={"version": version, "input": inputs}, headers={"Prefer": "wait=30"})
        else:
            res = self._http.post(f"/models/{model}/predictions", json={"input": inputs}, headers={"Prefer": "wait=30"})
        if res.status_code in (401, 403, 404, 422):
            raise ProviderError(f"Replicate rechazó la petición ({res.status_code}): {res.text[:300]}", retryable=False)
        if res.status_code >= 400:
            raise ProviderError(f"Replicate respondió {res.status_code}")
        prediction = res.json()
        deadline = time.monotonic() + self.timeout_s
        delay = 1.0
        while prediction.get("status") not in ("succeeded", "failed", "canceled"):
            if time.monotonic() > deadline:
                cancel = prediction.get("urls", {}).get("cancel")
                if cancel:
                    self._http.post(cancel)
                raise ProviderError("Replicate no terminó a tiempo")
            time.sleep(delay)
            delay = min(delay * 1.5, 5.0)
            prediction = self._http.get(prediction["urls"]["get"]).json()
        if prediction["status"] != "succeeded":
            raise ProviderError(f"La predicción falló: {prediction.get('error')}", retryable=False)
        return prediction.get("output")


def _data_uri(rgb: RGB) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(encode_jpeg(rgb, quality=90)).decode()


def _first_url(output: Any) -> str:
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output and isinstance(output[-1], str):
        return output[-1]
    if isinstance(output, dict):
        for value in output.values():
            if isinstance(value, str) and value.startswith("http"):
                return value
    raise ProviderError("Respuesta de Replicate sin imagen", retryable=False)


class ReplicateStyleGenerator:
    """ControlNet/difusión de interiores en modo img2img (preserva paredes y ventanas)."""

    name: ClassVar[str] = "replicate"

    def __init__(self, client: ReplicateClient, model: str) -> None:
        self.client = client
        self.model = model

    def generate(self, image: RGB, style: StyleId, room_type: RoomType, strength: float) -> RGB:
        prompt = f"{ROOM_PROMPTS[room_type]}, {STYLE_PROMPTS[style]}, photorealistic, interior design photo, 4k"
        output = self.client.run(
            self.model,
            {
                "image": _data_uri(image),
                "prompt": prompt,
                "negative_prompt": NEGATIVE,
                "prompt_strength": round(float(strength), 2),
                "guidance_scale": 15,
                "num_inference_steps": 40,
            },
        )
        return decode_rgb(self.client.download(_first_url(output)))


class ReplicateRoomAnalyzer:
    """Depth-Anything-V2 hospedado + la heurística de layout aplicada sobre el mapa de profundidad.

    La profundidad monocular es relativa (§8.1): se usa para estimar la PROPORCIÓN
    ancho/profundidad del cuarto; la escala absoluta la sigue fijando la calibración.
    """

    name: ClassVar[str] = "replicate-depth"

    def __init__(self, client: ReplicateClient, model: str) -> None:
        self.client = client
        self.model = model
        self.fallback = MockRoomAnalyzer()

    def analyze(self, image: RGB, room_type: RoomType) -> RoomAnalysis:
        base = self.fallback.analyze(image, room_type)  # ventanas y objetos por heurística
        output = self.client.run(self.model, {"image": _data_uri(image)})
        depth_png = self.client.download(_first_url(output))
        disparity = np.asarray(Image.open(io.BytesIO(depth_png)).convert("L"), dtype=np.float32) + 1.0
        h, w = disparity.shape
        far = float(np.median(disparity[int(h * 0.25) : int(h * 0.45), int(w * 0.35) : int(w * 0.65)]))
        near = float(np.median(disparity[int(h * 0.85) :, int(w * 0.3) : int(w * 0.7)]))
        ratio = float(np.clip(near / far, 1.2, 4.0))  # disparidad ∝ 1/distancia

        base_w, _, base_h = DEFAULT_DIMS[room_type]
        width = base.shell.widthM or base_w
        # Distancia al fondo relativa al primer plano visible (~1.2 m delante de la cámara).
        depth = float(np.clip(1.2 * ratio, 2.2, 7.5))
        windows = [
            ((o.offsetM / width), o.widthM, o.heightM, o.sillHeightM)
            for o in base.shell.openings
            if o.type == "window"
        ]
        shell = rectangular_shell(width, round(depth, 2), base_h, windows=windows, scale_confidence=0.5)
        return RoomAnalysis(shell=shell, objects=base.objects)
