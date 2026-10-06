import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from interiores_ai.config import Settings
from interiores_ai.container import Container
from interiores_ai.contracts import LayoutCandidate, Vector3
from interiores_ai.layout.rules_engine import RulesLayoutEngine
from interiores_ai.main import create_app
from interiores_ai.providers.room_mock import MockRoomAnalyzer
from interiores_ai.providers.style_mock import MockStyleGenerator
from interiores_ai.storage import MemoryStorage

TOKEN = "t" * 24


@pytest.fixture
def settings() -> Settings:
    return Settings(
        AI_INTERNAL_TOKEN=TOKEN,
        S3_BUCKET="test",
        S3_ACCESS_KEY_ID="a",
        S3_SECRET_ACCESS_KEY="b",
    )  # type: ignore[call-arg]


def room_photo(width: int = 960, height: int = 720) -> bytes:
    """Foto sintética de un cuarto: pared, piso, ventana luminosa y un 'sofá'."""
    img = np.full((height, width, 3), (205, 196, 180), np.uint8)
    img[int(height * 0.68) :, :] = (150, 110, 80)  # piso
    img[int(height * 0.12) : int(height * 0.45), int(width * 0.55) : int(width * 0.8)] = (252, 252, 250)  # ventana
    img[int(height * 0.55) : int(height * 0.8), int(width * 0.1) : int(width * 0.45)] = (60, 70, 90)  # sofá
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture
def storage() -> MemoryStorage:
    s = MemoryStorage()
    s.put_bytes("projects/p1/source.jpg", room_photo(), "image/jpeg")
    return s


@pytest.fixture
def client(settings: Settings, storage: MemoryStorage) -> TestClient:
    container = Container(
        settings=settings,
        storage=storage,
        room_analyzer=MockRoomAnalyzer(),
        style_generator=MockStyleGenerator(),
        layout_engine=RulesLayoutEngine(),
    )
    with TestClient(create_app(container)) as c:
        yield c  # type: ignore[misc]


def cand(
    id: str, category: str, sub: str | None, dims: tuple[float, float, float], styles: list[str], mount: str = "floor"
) -> LayoutCandidate:
    return LayoutCandidate(
        id=id,
        category=category,  # type: ignore[arg-type]
        subcategory=sub,
        styleTags=styles,  # type: ignore[arg-type]
        dimensionsM=Vector3(x=dims[0], y=dims[1], z=dims[2]),
        mount=mount,  # type: ignore[arg-type]
    )


@pytest.fixture
def catalog() -> list[LayoutCandidate]:
    return [
        cand("sofa-moderno", "sofa", None, (2.0, 0.8, 0.9), ["moderno"]),
        cand("sofa-clasico", "sofa", None, (2.2, 0.85, 0.95), ["clasico"]),
        cand("mesa-centro", "table", "coffee-table", (1.1, 0.4, 0.6), ["moderno", "escandinavo"]),
        cand("butaca", "chair", "armchair", (0.8, 0.9, 0.8), ["moderno"]),
        cand("mueble-tv", "storage", "tv-stand", (1.6, 0.5, 0.45), ["moderno"]),
        cand("estanteria", "storage", "shelf", (1.0, 2.0, 0.35), ["escandinavo"]),
        cand("alfombra", "decor", "rug", (2.3, 0.01, 1.6), ["moderno"]),
        cand("planta", "decor", "plant", (0.5, 1.2, 0.5), ["moderno"]),
        cand("lampara-pie", "lighting", "floor-lamp", (0.4, 1.6, 0.4), ["moderno"]),
        cand("colgante", "lighting", "pendant", (0.5, 0.5, 0.5), ["moderno"], mount="ceiling"),
        cand("cama", "bed", None, (1.6, 1.0, 2.1), ["moderno"]),
        cand("mesita", "table", "nightstand", (0.45, 0.55, 0.4), ["moderno"]),
        cand("comoda", "storage", "dresser", (1.0, 1.1, 0.5), ["moderno"]),
        cand("mesa-comedor", "table", "dining-table", (1.6, 0.76, 0.9), ["moderno"]),
        cand("silla", "chair", "dining-chair", (0.45, 0.9, 0.5), ["moderno"]),
        cand("escritorio", "table", "desk", (1.2, 0.75, 0.6), ["moderno"]),
    ]
