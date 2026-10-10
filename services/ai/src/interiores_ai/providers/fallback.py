"""Decorator: un analizador con respaldo. Si el principal falla, responde el secundario."""

from dataclasses import replace

from ..contracts import RoomType
from ..imaging import RGB
from ..logging import log
from .base import ProviderError, RoomAnalysis, RoomAnalyzer


class FallbackRoomAnalyzer:
    """Envuelve a un analizador externo (visión) con uno local que nunca falla.

    El pipeline no se entera: si el modelo de visión alcanza su límite, está caído o devuelve algo
    inválido, el cuarto sale del análisis local y el proyecto se crea igual.
    """

    def __init__(self, primary: RoomAnalyzer, secondary: RoomAnalyzer) -> None:
        self._primary = primary
        self._secondary = secondary

    @property
    def name(self) -> str:
        return self._primary.name

    def analyze(self, image: RGB, room_type: RoomType) -> RoomAnalysis:
        try:
            return self._primary.analyze(image, room_type)
        except ProviderError as err:
            log.warning("analizador_de_respaldo", primary=self._primary.name, secondary=self._secondary.name, reason=str(err))
            result = self._secondary.analyze(image, room_type)
            # Queda dicho quién respondió de verdad: sirve para explicar por qué el cuarto salió genérico.
            return replace(result, provider=f"{self._secondary.name} (respaldo)")
