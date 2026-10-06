"""Puertos (Strategy) de cada capacidad de IA. El resto del servicio solo conoce estas interfaces."""

from dataclasses import dataclass
from typing import Protocol

from ..contracts import DetectedObject, RoomShell, RoomType, StyleId
from ..imaging import RGB


@dataclass(frozen=True)
class RoomAnalysis:
    shell: RoomShell
    objects: list[DetectedObject]


class RoomAnalyzer(Protocol):
    @property
    def name(self) -> str: ...

    def analyze(self, image: RGB, room_type: RoomType) -> RoomAnalysis: ...


class StyleGenerator(Protocol):
    @property
    def name(self) -> str: ...

    def generate(self, image: RGB, style: StyleId, room_type: RoomType, strength: float) -> RGB: ...


class ProviderError(RuntimeError):
    """Fallo del proveedor externo. `retryable` indica si reintentar tiene sentido."""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable
