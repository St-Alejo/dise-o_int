"""Cuota y caché del modelo de visión compartidas entre procesos (Redis).

Con un solo proceso bastaba la memoria. Con varias réplicas, o tras un reinicio, cada una empezaba
con la cuota entera y sin caché: se podía gastar varias veces el tope diario y repetir llamadas ya
pagadas. Aquí las dos cosas viven en Redis.

Redis es una ayuda, no un requisito: si no responde, cada operación cae a su versión en memoria y
el análisis sigue. Nunca se deja de analizar una foto porque falló la caché.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, date, datetime
from threading import Lock
from typing import Any, Protocol

from ...contracts import DetectedObject, RoomShell, RoomSuggestions
from ...logging import log
from ..base import RoomAnalysis

BUDGET_TTL_S = 2 * 24 * 3600
CACHE_TTL_S = 7 * 24 * 3600


class KeyValue(Protocol):
    """Lo poco que se usa de un cliente de Redis (así las pruebas ponen uno de mentira)."""

    def incr(self, name: str) -> Any: ...
    def decr(self, name: str) -> Any: ...
    def expire(self, name: str, time: int) -> Any: ...
    def get(self, name: str) -> Any: ...
    def set(self, name: str, value: str, ex: int | None = None) -> Any: ...


class AnalysisCache(Protocol):
    def get(self, key: str) -> RoomAnalysis | None: ...
    def put(self, key: str, analysis: RoomAnalysis) -> None: ...


class MemoryAnalysisCache:
    """Caché LRU en memoria: la de siempre, y el respaldo cuando Redis no está."""

    def __init__(self, size: int = 64) -> None:
        self._items: OrderedDict[str, RoomAnalysis] = OrderedDict()
        self._size = size
        self._lock = Lock()

    def get(self, key: str) -> RoomAnalysis | None:
        with self._lock:
            found = self._items.get(key)
            if found is not None:
                self._items.move_to_end(key)
            return found

    def put(self, key: str, analysis: RoomAnalysis) -> None:
        with self._lock:
            self._items[key] = analysis
            self._items.move_to_end(key)
            while len(self._items) > self._size:
                self._items.popitem(last=False)


def dump_analysis(analysis: RoomAnalysis) -> str:
    return json.dumps(
        {
            "shell": analysis.shell.model_dump(mode="json"),
            "objects": [o.model_dump(mode="json") for o in analysis.objects],
            "suggestions": analysis.suggestions.model_dump(mode="json") if analysis.suggestions else None,
            "provider": analysis.provider,
        }
    )


def load_analysis(raw: str | bytes) -> RoomAnalysis:
    data = json.loads(raw)
    return RoomAnalysis(
        shell=RoomShell.model_validate(data["shell"]),
        objects=[DetectedObject.model_validate(o) for o in data["objects"]],
        suggestions=RoomSuggestions.model_validate(data["suggestions"]) if data.get("suggestions") else None,
        provider=data.get("provider"),
    )


class RedisAnalysisCache:
    """La misma foto se responde desde Redis en cualquier réplica, durante una semana."""

    def __init__(self, redis: KeyValue, fallback: AnalysisCache | None = None, prefix: str = "vision:analysis:") -> None:
        self._redis = redis
        self._fallback = fallback or MemoryAnalysisCache()
        self._prefix = prefix

    def get(self, key: str) -> RoomAnalysis | None:
        try:
            raw = self._redis.get(self._prefix + key)
            if raw is not None:
                return load_analysis(raw)
        except Exception as err:  # Redis caído o un valor de otra versión: como si no estuviera
            log.warning("vision_cache", detail=f"lectura fallida: {err}")
        return self._fallback.get(key)

    def put(self, key: str, analysis: RoomAnalysis) -> None:
        self._fallback.put(key, analysis)
        try:
            self._redis.set(self._prefix + key, dump_analysis(analysis), ex=CACHE_TTL_S)
        except Exception as err:
            log.warning("vision_cache", detail=f"escritura fallida: {err}")


class RedisDailyBudget:
    """Tope diario (UTC) contado en Redis: lo comparten todas las réplicas y sobrevive a reinicios."""

    def __init__(
        self,
        redis: KeyValue,
        limit: int,
        today: Callable[[], date] = lambda: datetime.now(UTC).date(),
        prefix: str = "vision:budget:",
    ) -> None:
        self._redis = redis
        self._limit = limit
        self._today = today
        self._prefix = prefix
        # Si Redis falla, cuenta este proceso por su cuenta: mejor un tope aproximado que ninguno.
        self._local_day = today()
        self._local_used = 0
        self._lock = Lock()

    def _key(self) -> str:
        return f"{self._prefix}{self._today().isoformat()}"

    def take(self) -> bool:
        """Reserva una llamada; False si hoy ya no quedan."""
        try:
            used = int(self._redis.incr(self._key()))
            if used == 1:
                self._redis.expire(self._key(), BUDGET_TTL_S)
            if used > self._limit:
                self._redis.decr(self._key())
                return False
            return True
        except Exception as err:
            log.warning("vision_budget", detail=f"sin Redis, se cuenta en memoria: {err}")
            return self._take_local()

    def _take_local(self) -> bool:
        with self._lock:
            if self._today() != self._local_day:
                self._local_day, self._local_used = self._today(), 0
            if self._local_used >= self._limit:
                return False
            self._local_used += 1
            return True

    @property
    def remaining(self) -> int:
        try:
            return max(0, self._limit - int(self._redis.get(self._key()) or 0))
        except Exception:
            with self._lock:
                return self._limit if self._today() != self._local_day else max(0, self._limit - self._local_used)
