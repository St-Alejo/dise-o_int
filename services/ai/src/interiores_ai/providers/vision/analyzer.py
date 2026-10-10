"""Análisis del cuarto con un modelo de visión: de la foto a paredes, aberturas, inventario y colores."""

import hashlib
import io
import threading
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import get_args

from PIL import Image
from pydantic import ValidationError

from ...contracts import DetectedObject, RoomSuggestions, RoomType, StyleId
from ...imaging import RGB
from ...logging import log
from ..base import ProviderError, RoomAnalysis
from .client import VisionClient
from .guess import PROMPT, RoomGuess
from .shell_spec import shell_from_guess

STYLE_IDS = set(get_args(StyleId))
FLOOR_MATERIALS = {"wood", "tile", "carpet", "concrete", "other"}


class DailyBudget:
    """Tope de llamadas por día (UTC): cuida la cuota de una capa gratuita. Se reinicia con el proceso."""

    def __init__(self, limit: int, today: Callable[[], date] = lambda: datetime.now(UTC).date()) -> None:
        self._limit = limit
        self._today = today
        self._day = today()
        self._used = 0
        self._lock = threading.Lock()

    def take(self) -> bool:
        """Reserva una llamada; False si hoy ya no quedan."""
        with self._lock:
            if self._today() != self._day:
                self._day, self._used = self._today(), 0
            if self._used >= self._limit:
                return False
            self._used += 1
            return True

    @property
    def remaining(self) -> int:
        with self._lock:
            return self._limit if self._today() != self._day else max(0, self._limit - self._used)


class VisionRoomAnalyzer:
    """Template Method: preparar la imagen → preguntar al modelo → validar → construir el cuarto.

    Una llamada por foto: la misma imagen se responde desde caché y el presupuesto diario corta
    antes de gastar. Cualquier fallo es un `ProviderError`, que el analizador de respaldo absorbe.
    """

    def __init__(self, client: VisionClient, *, budget: DailyBudget, max_side: int = 1024, cache_size: int = 64) -> None:
        self._client = client
        self._budget = budget
        self._max_side = max_side
        self._cache: OrderedDict[str, RoomAnalysis] = OrderedDict()
        self._cache_size = cache_size
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return f"vision-{self._client.model}"

    def analyze(self, image: RGB, room_type: RoomType) -> RoomAnalysis:
        jpeg = self._prepare(image)
        key = hashlib.sha256(jpeg).hexdigest()
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                return cached
        if not self._budget.take():
            raise ProviderError("Se agotó el presupuesto diario del modelo de visión", retryable=False)
        guess = self._validate(self._client.describe(jpeg, PROMPT))
        analysis = self._build(guess)
        log.info("vision", model=self._client.model, shape=guess.shape, openings=len(analysis.shell.openings), objects=len(analysis.objects), left_today=self._budget.remaining)
        with self._lock:
            self._cache[key] = analysis
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return analysis

    def _prepare(self, image: RGB) -> bytes:
        """JPEG de a lo sumo `max_side` px: suficiente para el modelo y barato en tokens."""
        picture = Image.fromarray(image, "RGB")
        picture.thumbnail((self._max_side, self._max_side))
        buffer = io.BytesIO()
        picture.save(buffer, format="JPEG", quality=85)
        return buffer.getvalue()

    @staticmethod
    def _validate(text: str) -> RoomGuess:
        try:
            return RoomGuess.model_validate_json(text)
        except ValidationError as err:
            raise ProviderError(f"El modelo de visión devolvió datos inválidos ({err.error_count()} errores)", retryable=False) from err

    def _build(self, guess: RoomGuess) -> RoomAnalysis:
        objects = [
            DetectedObject(label=o.category, confidence=guess.confidence, bbox=(0.0, 0.0, 1.0, 1.0), category=o.category.strip().lower(), count=o.count, nearWall=o.nearWall)
            for o in guess.objects
        ]
        suggestions = RoomSuggestions(
            roomType=guess.roomType,
            styleId=guess.style if guess.style in STYLE_IDS else None,
            wallColor=guess.palette.walls.lower() if guess.palette else None,
            floorColor=guess.palette.floor.lower() if guess.palette else None,
            accentColor=guess.palette.accent.lower() if guess.palette else None,
            floorMaterial=guess.floorMaterial if guess.floorMaterial in FLOOR_MATERIALS else None,
            confidence=guess.confidence,
            notes=guess.notes[:300] or None,
        )
        return RoomAnalysis(shell=shell_from_guess(guess), objects=objects, suggestions=suggestions, provider=self.name)
