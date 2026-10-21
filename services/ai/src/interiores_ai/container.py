"""Raíz de composición: el único lugar que decide qué proveedor implementa cada capacidad."""

from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .layout.rules_engine import LayoutEngine, RulesLayoutEngine
from .logging import log
from .ml.nlu import IntentService
from .ml.reference import ReferenceAnalyzer
from .providers.base import RoomAnalyzer, StyleGenerator
from .providers.fallback import FallbackRoomAnalyzer
from .providers.replicate import ReplicateClient, ReplicateRoomAnalyzer, ReplicateStyleGenerator
from .providers.room_mock import MockRoomAnalyzer
from .providers.style_mock import MockStyleGenerator
from .providers.vision import (
    Budget,
    DailyBudget,
    GroqVisionClient,
    RedisAnalysisCache,
    RedisDailyBudget,
    VisionRoomAnalyzer,
)
from .providers.vision.shared_state import AnalysisCache
from .storage import ObjectStorage, S3Storage


@dataclass
class Container:
    settings: Settings
    storage: ObjectStorage
    room_analyzer: RoomAnalyzer
    style_generator: StyleGenerator
    layout_engine: LayoutEngine
    replicate: ReplicateClient | None = None
    intents: IntentService | None = None
    reference: ReferenceAnalyzer | None = None

    def provider_health(self) -> dict[str, str]:
        """Estado de los proveedores sin gastar inferencias: se lee el circuit breaker."""
        external = "down" if self.replicate is not None and self.replicate.breaker.is_open else "ok"
        return {"room": self.room_analyzer.name, "style": self.style_generator.name, "external": external}


def vision_state(settings: Settings) -> tuple[Budget, AnalysisCache | None]:
    """Cuota y caché de visión: en Redis si hay `REDIS_URL`; si no, en la memoria de este proceso."""
    if not settings.redis_url:
        return DailyBudget(settings.vision_per_day), None
    import redis  # solo se carga si se usa

    client = redis.Redis.from_url(settings.redis_url, socket_timeout=2, socket_connect_timeout=2)
    log.info("vision_estado", detail="cuota y caché compartidas en Redis")
    return RedisDailyBudget(client, settings.vision_per_day), RedisAnalysisCache(client)


def build_container(settings: Settings, storage: ObjectStorage | None = None) -> Container:
    room_kind = settings.resolved_room_analyzer()
    style_kind = settings.resolved_style_generator()
    if (settings.room_analyzer, settings.style_generator) != (room_kind, style_kind):
        log.warning("proveedor_sin_credencial", detail="Se pidió un proveedor externo pero falta su credencial; se usa mock")

    client = ReplicateClient(settings) if "replicate" in (room_kind, style_kind) else None
    room: RoomAnalyzer
    style: StyleGenerator
    # Una sola cuota diaria de visión para las fotos del cuarto y las imágenes de referencia.
    budget, cache = vision_state(settings) if settings.groq_api_key else (None, None)
    groq = GroqVisionClient(settings.groq_api_key, settings.vision_model, timeout_s=settings.vision_timeout_s) if settings.groq_api_key else None
    if client and room_kind == "replicate":
        room = ReplicateRoomAnalyzer(client, settings.replicate_depth_model)
    elif room_kind == "vision" and groq is not None and budget is not None:
        vision = VisionRoomAnalyzer(
            groq,
            budget=budget,
            cache=cache,
        )
        # Si el modelo alcanza su límite, está caído o responde algo inválido, contesta el local.
        room = FallbackRoomAnalyzer(vision, MockRoomAnalyzer())
    else:
        room = MockRoomAnalyzer()
    if client and style_kind == "replicate":
        style = ReplicateStyleGenerator(client, settings.replicate_style_model)
    else:
        style = MockStyleGenerator()
    log.info("proveedores", room=room.name, style=style.name, layout=RulesLayoutEngine.name)
    return Container(
        settings=settings,
        storage=storage or S3Storage(settings),
        room_analyzer=room,
        style_generator=style,
        layout_engine=RulesLayoutEngine(),
        replicate=client,
        intents=IntentService(Path(settings.nlu_model_path)),
        reference=ReferenceAnalyzer(groq, budget),
    )
