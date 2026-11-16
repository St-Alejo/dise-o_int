"""Análisis del cuarto con un modelo de visión. Ninguna prueba llama a la API real."""

import json
from datetime import date

import httpx
import numpy as np
import pytest

from interiores_ai.config import Settings
from interiores_ai.container import build_container
from interiores_ai.contracts import InventoryItem, PlaceFurnitureRequest
from interiores_ai.layout.rules_engine import RulesLayoutEngine, inventory_role, roles_for
from interiores_ai.providers.base import ProviderError
from interiores_ai.providers.fallback import FallbackRoomAnalyzer
from interiores_ai.providers.room_mock import MockRoomAnalyzer
from interiores_ai.providers.shell import rectangular_shell
from interiores_ai.providers.vision import (
    DailyBudget,
    GroqVisionClient,
    RoomGuess,
    VisionRoomAnalyzer,
    shell_from_guess,
)
from interiores_ai.storage import MemoryStorage
from tests.conftest import TOKEN

# Lo que respondió el modelo real para la foto de la oficina (docs/pruebas-vision/oficina.json).
OFFICE = {
    "roomType": "office",
    "shape": "rect",
    "widthM": 4.5,
    "depthM": 5.0,
    "heightM": 2.7,
    "openings": [{"wall": "right", "type": "window", "positionFraction": 0.5, "widthFraction": 0.8}],
    "objects": [
        {"category": "desk", "count": 1, "nearWall": "back"},
        {"category": "chair", "count": 3, "nearWall": "center"},
        {"category": "shelf", "count": 2, "nearWall": "back"},
        {"category": "plant", "count": 1, "nearWall": "left"},
    ],
    "palette": {"walls": "#4A6FA5", "floor": "#8b7355", "accent": "#d2b48c"},
    "floorMaterial": "wood",
    "style": "moderno",
    "confidence": 0.85,
    "notes": "Depth is estimated.",
}


def guess(**over) -> RoomGuess:
    return RoomGuess.model_validate({**OFFICE, **over})


class FakeClient:
    model = "fake-vision"

    def __init__(self, answer: str | Exception) -> None:
        self.answer = answer
        self.calls = 0

    def describe(self, jpeg: bytes, prompt: str) -> str:
        self.calls += 1
        assert jpeg[:2] == b"\xff\xd8", "al modelo se le manda un JPEG"
        assert "JSON" in prompt
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def photo(seed: int = 0, size: tuple[int, int] = (1500, 2000)) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 255, (*size, 3), dtype=np.uint8)


# ---------------------------------------------------------------- de la respuesta al cuarto
def test_opening_lands_on_wall_named_by_model():
    shell = shell_from_guess(guess())
    assert [w.id for w in shell.walls] == ["w-back", "w-right", "w-front", "w-left"]
    assert (shell.widthM, shell.depthM, shell.heightM, shell.shape) == (4.5, 5.0, 2.7, "rect")
    window = next(o for o in shell.openings if o.type == "window")
    # Ventanal del 80 % en la pared derecha (5 m), centrado: casi de piso a techo.
    assert (window.wallId, window.offsetM, window.widthM, window.sillHeightM) == ("w-right", 2.5, 4.0, 0.3)
    assert shell.needsCalibration and 0.35 < shell.scaleConfidence <= 0.65


def test_each_wall_measures_position_from_camera_view():
    openings = [
        {"wall": "back", "type": "window", "positionFraction": 0.25, "widthFraction": 0.2},
        {"wall": "left", "type": "window", "positionFraction": 0.25, "widthFraction": 0.2},
        {"wall": "right", "type": "door", "positionFraction": 0.85, "widthFraction": 0.2},
    ]
    shell = shell_from_guess(guess(widthM=4.0, depthM=4.0, openings=openings))
    by_wall = {o.wallId: o for o in shell.openings}
    # Fondo: de izquierda a derecha, igual que su `start` → 25 % de 4 m.
    assert by_wall["w-back"].offsetM == 1.0
    # Izquierda: el modelo mide desde el fondo, pero la pared empieza junto a la cámara → 75 %.
    assert by_wall["w-left"].offsetM == 3.0
    # Derecha: empieza en el fondo, igual que la mide el modelo.
    assert by_wall["w-right"].offsetM == pytest.approx(3.4)
    assert by_wall["w-right"].type == "door" and by_wall["w-right"].widthM == pytest.approx(0.8)


def test_drops_overlapping_openings_and_adds_no_extra_door():
    openings = [
        {"wall": "back", "type": "window", "positionFraction": 0.5, "widthFraction": 0.4},
        {"wall": "back", "type": "window", "positionFraction": 0.55, "widthFraction": 0.4},
        {"wall": "back", "type": "door", "positionFraction": 0.9, "widthFraction": 0.15},
    ]
    shell = shell_from_guess(guess(openings=openings))
    assert [(o.type, o.wallId) for o in shell.openings] == [("window", "w-back"), ("door", "w-back")]


def test_no_visible_door_goes_behind_camera_and_sizes_are_clamped():
    shell = shell_from_guess(guess(widthM=25, depthM=1.0, heightM=7, openings=[]))
    assert (shell.widthM, shell.depthM, shell.heightM) == (12.0, 2.2, 4.0)
    assert [(o.type, o.wallId) for o in shell.openings] == [("door", "w-front")]


def test_non_rectangular_shape_gives_more_walls():
    assert len(shell_from_guess(guess(shape="L")).walls) == 6
    assert len(shell_from_guess(guess(shape="U")).walls) == 8
    assert shell_from_guess(guess(shape="T")).shape == "T"


# ---------------------------------------------------------------- el analizador
def test_returns_room_inventory_and_photo_colors():
    analysis = VisionRoomAnalyzer(FakeClient(json.dumps(OFFICE)), budget=DailyBudget(5)).analyze(photo(), "office")
    assert analysis.provider == "vision-fake-vision"
    assert [(o.category, o.count, o.nearWall) for o in analysis.objects] == [("desk", 1, "back"), ("chair", 3, "center"), ("shelf", 2, "back"), ("plant", 1, "left")]
    assert analysis.suggestions is not None
    assert analysis.suggestions.model_dump(exclude_none=True) == {
        "roomType": "office",
        "styleId": "moderno",
        "wallColor": "#4a6fa5",
        "floorColor": "#8b7355",
        "accentColor": "#d2b48c",
        "floorMaterial": "wood",
        "confidence": 0.85,
        "notes": "Depth is estimated.",
    }


def test_same_photo_uses_one_call_and_daily_budget_stops():
    client = FakeClient(json.dumps(OFFICE))
    today = [date(2026, 10, 10)]
    analyzer = VisionRoomAnalyzer(client, budget=DailyBudget(2, today=lambda: today[0]))
    first = analyzer.analyze(photo(1), "office")
    assert analyzer.analyze(photo(1), "office") is first
    assert client.calls == 1

    analyzer.analyze(photo(2), "office")
    with pytest.raises(ProviderError, match="presupuesto diario"):
        analyzer.analyze(photo(3), "office")
    assert client.calls == 2
    # Al día siguiente vuelve a haber cupo.
    today[0] = date(2026, 10, 11)
    analyzer.analyze(photo(3), "office")
    assert client.calls == 3


@pytest.mark.parametrize("answer", ["esto no es json", json.dumps({**OFFICE, "widthM": -3}), json.dumps({"shape": "hexagon"})])
def test_invalid_response_is_provider_failure(answer):
    with pytest.raises(ProviderError, match="datos inválidos") as err:
        VisionRoomAnalyzer(FakeClient(answer), budget=DailyBudget(5)).analyze(photo(), "office")
    assert err.value.retryable is False


def test_unknown_style_or_material_is_ignored_instead_of_failing():
    answer = json.dumps({**OFFICE, "style": "art deco", "floorMaterial": "lava", "palette": None})
    suggestions = VisionRoomAnalyzer(FakeClient(answer), budget=DailyBudget(5)).analyze(photo(), "office").suggestions
    assert suggestions is not None
    assert (suggestions.styleId, suggestions.floorMaterial, suggestions.wallColor) == (None, None, None)


def test_local_analysis_answers_when_vision_fails():
    failing = VisionRoomAnalyzer(FakeClient(ProviderError("límite", retryable=False)), budget=DailyBudget(5))
    analysis = FallbackRoomAnalyzer(failing, MockRoomAnalyzer()).analyze(photo(size=(600, 800)), "living")
    assert analysis.provider == "mock-opencv (respaldo)"
    assert len(analysis.shell.walls) == 4 and analysis.suggestions is None


# ---------------------------------------------------------------- cliente de Groq
def groq(handler) -> GroqVisionClient:
    return GroqVisionClient("gsk_prueba", "modelo-x", transport=httpx.MockTransport(handler))


def test_groq_sends_inline_image_and_returns_content():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}}]})

    assert groq(handler).describe(b"\xff\xd8jpeg", "describe") == '{"ok": true}'
    assert seen["auth"] == "Bearer gsk_prueba"
    assert seen["body"]["model"] == "modelo-x"
    assert seen["body"]["response_format"] == {"type": "json_object"}
    text, image = seen["body"]["messages"][0]["content"]
    assert text == {"type": "text", "text": "describe"}
    assert image["image_url"]["url"].startswith("data:image/jpeg;base64,/9hq")


@pytest.mark.parametrize(("status", "retryable"), [(429, False), (401, False), (503, True)])
def test_groq_maps_errors_without_retrying_or_leaking_body(status, retryable):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status, json={"error": {"message": "detalle de la cuenta gsk_secreto"}})

    with pytest.raises(ProviderError) as err:
        groq(handler).describe(b"\xff\xd8", "x")
    assert err.value.retryable is retryable
    assert "gsk_secreto" not in str(err.value)
    assert len(calls) == 1


def test_groq_down_is_provider_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sin red")

    with pytest.raises(ProviderError, match="no respondió"):
        groq(handler).describe(b"\xff\xd8", "x")


# ---------------------------------------------------------------- composición
def settings(**env) -> Settings:
    return Settings(AI_INTERNAL_TOKEN=TOKEN, S3_BUCKET="t", S3_ACCESS_KEY_ID="a", S3_SECRET_ACCESS_KEY="b", **env)  # type: ignore[call-arg]


def test_without_key_vision_degrades_to_local_analysis():
    container = build_container(settings(ROOM_ANALYZER="vision"), MemoryStorage())
    assert container.room_analyzer.name == "mock-opencv"


def test_with_key_vision_is_used_with_fallback():
    container = build_container(settings(ROOM_ANALYZER="vision", GROQ_API_KEY="gsk_prueba", VISION_MODEL="modelo-x"), MemoryStorage())
    assert isinstance(container.room_analyzer, FallbackRoomAnalyzer)
    assert container.room_analyzer.name == "vision-modelo-x"


# ---------------------------------------------------------------- inventario → distribución
def inventory(*items: tuple[str, int]) -> list[InventoryItem]:
    return [InventoryItem(category=c, count=n) for c, n in items]


def test_each_model_word_has_role_per_room():
    assert inventory_role("Sofa", "living") == "sofa"
    assert inventory_role("coffee tables", "living") == "coffee-table"
    assert inventory_role("tv-stand", "living") == "tv-stand"
    assert [inventory_role("chair", r) for r in ("living", "dining", "office")] == ["armchair", "dining-chair", "desk-chair"]
    assert inventory_role("table", "bedroom") is None
    assert inventory_role("microwave", "living") is None


def test_with_inventory_places_what_was_in_photo():
    names = lambda roles: [(r.name, r.count) for r in roles]  # noqa: E731
    full = names(roles_for("living", None))
    assert len(full) == 9

    ambient = {"rug": 1, "pendant": 1, "floor-lamp": 1, "plant": 1}
    seen = dict(names(roles_for("living", inventory(("sofa", 1), ("tv", 1), ("rug", 1)))))
    # Lo imprescindible (sofá y mesa de centro), lo visto y lo que da ambiente; ni butaca ni estantería.
    assert seen == {"sofa": 1, "coffee-table": 1, "tv-stand": 1, **ambient}

    bedroom = dict(names(roles_for("bedroom", inventory(("bed", 1), ("nightstand", 1), ("desk", 1), ("chair", 1)))))
    assert bedroom == {"bed": 1, "desk": 1, "nightstand": 1, "armchair": 1, **ambient}

    # Sala abierta al comedor: la mesa y sus sillas entran aunque el cuarto sea una sala.
    open_plan = dict(names(roles_for("living", inventory(("sofa", 1), ("dining table", 1), ("dining chair", 4)))))
    assert open_plan == {"sofa": 1, "coffee-table": 1, "dining-table": 1, "dining-chair": 4, **ambient}
    # Sillas de comedor sin mesa no tienen dónde ir.
    assert "dining-chair" not in dict(names(roles_for("bedroom", inventory(("bed", 1), ("dining chair", 4)))))
    # Un inventario que no se entiende no vacía el cuarto: se usa la plantilla.
    assert names(roles_for("living", inventory(("microwave", 1)))) == full


def test_two_different_photos_give_two_different_layouts(catalog):
    shell = rectangular_shell(5, 4.5, 2.6)

    def placed(items):
        req = PlaceFurnitureRequest(roomShell=shell, roomType="living", styleId="moderno", candidates=catalog, locked=[], seed=1, inventory=items)
        return sorted(p.catalogItemId for p in RulesLayoutEngine().place(req).placements)

    minimal = placed(inventory(("sofa", 1), ("rug", 1)))
    furnished = placed(inventory(("sofa", 1), ("armchair", 1), ("shelf", 1), ("plant", 1), ("tv", 1)))
    assert minimal != furnished
    assert len(minimal) < len(furnished) < len(placed(None)) + 1
    assert any(i.startswith("sofa") for i in minimal) and any(i.startswith("sofa") for i in furnished)


# ---------------------------------------------------------------- cuota y caché compartidas
class FakeRedis:
    """Un Redis de mentira: lo justo para contar y guardar; con `broken`, todo falla."""

    def __init__(self):
        self.data: dict[str, str] = {}
        self.expires: dict[str, int] = {}
        self.broken = False

    def _check(self):
        if self.broken:
            raise ConnectionError("redis caído")

    def incr(self, name):
        self._check()
        self.data[name] = str(int(self.data.get(name, "0")) + 1)
        return int(self.data[name])

    def decr(self, name):
        self._check()
        self.data[name] = str(int(self.data.get(name, "0")) - 1)
        return int(self.data[name])

    def expire(self, name, time):
        self._check()
        self.expires[name] = time

    def get(self, name):
        self._check()
        return self.data.get(name)

    def set(self, name, value, ex=None):
        self._check()
        self.data[name] = value
        if ex:
            self.expires[name] = ex


def test_redis_quota_is_shared_by_replicas_and_resets_daily():
    from datetime import date

    from interiores_ai.providers.vision import RedisDailyBudget

    redis = FakeRedis()
    today = [date(2026, 5, 1)]
    one = RedisDailyBudget(redis, 3, today=lambda: today[0])
    other = RedisDailyBudget(redis, 3, today=lambda: today[0])
    assert [one.take(), other.take(), one.take()] == [True, True, True]
    # El tope es de las dos juntas, y pasarse no deja el contador por encima.
    assert other.take() is False
    assert one.remaining == 0
    assert redis.data["vision:budget:2026-05-01"] == "3"
    assert redis.expires["vision:budget:2026-05-01"] > 24 * 3600
    today[0] = date(2026, 5, 2)
    assert other.take() is True
    assert one.remaining == 2


def test_without_redis_quota_counts_in_memory():
    from interiores_ai.providers.vision import RedisDailyBudget

    redis = FakeRedis()
    redis.broken = True
    budget = RedisDailyBudget(redis, 2)
    assert [budget.take(), budget.take(), budget.take()] == [True, True, False]
    assert budget.remaining == 0


def test_redis_cache_avoids_repeat_call_on_other_replica():
    from interiores_ai.providers.vision import RedisAnalysisCache

    redis = FakeRedis()
    first = FakeClient(json.dumps(OFFICE))
    VisionRoomAnalyzer(first, budget=DailyBudget(5), cache=RedisAnalysisCache(redis)).analyze(photo(), "office")
    assert first.calls == 1

    # Otra réplica (otra caché en memoria, el mismo Redis): responde sin llamar al modelo.
    second = FakeClient(json.dumps(OFFICE))
    budget = DailyBudget(5)
    again = VisionRoomAnalyzer(second, budget=budget, cache=RedisAnalysisCache(redis)).analyze(photo(), "office")
    assert second.calls == 0
    assert budget.remaining == 5
    assert again.shell.widthM > 0
    assert again.provider and again.provider.startswith("vision-")
    assert any(key.startswith("vision:analysis:") for key in redis.data)


def test_redis_failure_falls_back_to_memory_cache():
    from interiores_ai.providers.vision import RedisAnalysisCache

    redis = FakeRedis()
    redis.broken = True
    client = FakeClient(json.dumps(OFFICE))
    analyzer = VisionRoomAnalyzer(client, budget=DailyBudget(5), cache=RedisAnalysisCache(redis))
    analyzer.analyze(photo(), "office")
    analyzer.analyze(photo(), "office")
    assert client.calls == 1  # la segunda salió de la memoria de este proceso
    # Un valor ilegible en Redis (de otra versión) se ignora en vez de romper.
    redis.broken = False
    redis.data = {key: "no es json" for key in ["vision:analysis:x"]}
    assert RedisAnalysisCache(redis).get("x") is None


def test_without_redis_configured_everything_stays_in_memory(settings):
    from interiores_ai.container import vision_state

    budget, cache = vision_state(settings)
    assert isinstance(budget, DailyBudget)
    assert cache is None
