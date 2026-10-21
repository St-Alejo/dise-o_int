"""Modelos propios: intención del chat, parámetros, preferencias e imagen de referencia."""

import numpy as np
import pytest
from sklearn.metrics import f1_score

from interiores_ai.ml import dataset, preferences
from interiores_ai.ml.nlu import IntentModel, IntentService
from interiores_ai.ml.reference import ReferenceAnalyzer, analyze_colors, parse_vision
from interiores_ai.ml.slots import extract
from interiores_ai.providers.base import ProviderError

# Frases escritas a mano, como las escribiría alguien (no salen de las plantillas).
HANDWRITTEN: list[tuple[str, str]] = [
    ("Quiero el piso de baldosa brillante, color azul claro con verde", "set_floor"),
    ("ponme parquet de roble en el suelo", "set_floor"),
    ("el suelo mejor de microcemento gris", "set_floor"),
    ("cambiemos el piso por uno de madera oscura", "set_floor"),
    ("Pinta las paredes de verde salvia", "set_walls"),
    ("las paredes en beige por fa", "set_walls"),
    ("quiero una pared de ladrillo visto", "set_walls"),
    ("pon azulejo blanco tipo metro en la pared de la ducha hasta el techo", "set_wall_tiles"),
    ("revestimiento de mármol en el baño hasta 1,2 m", "set_wall_tiles"),
    ("el techo negro", "set_ceiling"),
    ("pinta el techo de blanco roto", "set_ceiling"),
    ("agrega un tocador junto a la cama", "add_item"),
    ("me falta una lámpara de pie al lado del sofá", "add_item"),
    ("pon dos sillas", "add_item"),
    ("necesito un escritorio cerca de la ventana", "add_item"),
    ("quita la alfombra", "remove_item"),
    ("saca el televisor", "remove_item"),
    ("borra esa planta", "remove_item"),
    ("mueve el sofá contra la pared", "move_item"),
    ("acerca la mesita a la cama", "move_item"),
    ("gira la cama hacia la ventana", "move_item"),
    ("luz cálida y tenue", "set_lighting"),
    ("baja un poco la luz", "set_lighting"),
    ("quiero una iluminación fría y fuerte", "set_lighting"),
    ("hazlo industrial", "set_style"),
    ("cambia todo a estilo escandinavo", "set_style"),
    ("quiero que se vea más bohemio", "set_style"),
    ("recomiéndame algo", "recommend"),
    ("sorpréndeme con otra propuesta", "recommend"),
    ("dame otra idea pero solo colores", "recommend"),
    ("fija el piso", "pin"),
    ("no cambies las paredes", "pin"),
    ("me gusta este estilo, no lo toques", "pin"),
    ("suelta el estilo", "unpin"),
    ("ya puedes cambiar el piso", "unpin"),
    ("agrega un baño privado", "add_zone"),
    ("quiero un baño dentro del cuarto con bañera", "add_zone"),
    ("haz un vestidor en la esquina", "add_zone"),
    ("no quiero alfombras", "avoid_item"),
    ("nada de cortinas", "avoid_item"),
    ("sin plantas por favor", "avoid_item"),
    ("hazlo como en esta foto", "replicate_image"),
    ("copia los colores de la imagen", "replicate_image"),
    ("el cuarto mide 4 por 3,5", "room_size"),
    ("las medidas reales son 5 x 4 metros", "room_size"),
    ("hola", "other"),
    ("gracias, quedó lindo", "other"),
    ("cuánto cuesta el sofá", "other"),
]


@pytest.fixture(scope="module")
def model() -> IntentModel:
    return IntentModel.train(dataset.generate(900, seed=7))


def test_el_dataset_cubre_todas_las_intenciones_y_es_reproducible() -> None:
    rows = dataset.generate(60, seed=3)
    assert {i for _, i in rows} == set(dataset.INTENTS)
    assert rows == dataset.generate(60, seed=3)
    assert dataset.generate(60, seed=4) != rows


def test_f1_macro_sobre_validacion_y_frases_reales(model: IntentModel) -> None:
    val = dataset.generate(150, seed=99)
    assert f1_score([i for _, i in val], model.predict_many([t for t, _ in val]), average="macro") >= 0.9
    texts = [t for t, _ in HANDWRITTEN]
    truth = [i for _, i in HANDWRITTEN]
    predicted = model.predict_many(texts)
    wrong = [(t, p) for t, p, y in zip(texts, predicted, truth, strict=True) if p != y]
    assert f1_score(truth, predicted, average="macro") >= 0.9, wrong


def test_prediccion_con_confianza_y_parametros(model: IntentModel) -> None:
    p = model.predict("Quiero el piso de baldosa brillante, color azul claro con verde")
    assert p.intent == "set_floor"
    assert p.confidence >= 0.75
    assert [c.hex for c in p.slots.colors] == ["#a9d4ee", "#4f8a52"]
    assert (p.slots.surface, p.slots.finishKind, p.slots.gloss) == ("floor", "tile", 0.85)
    assert len(p.alternatives) == 3
    # Lo que no es del dominio no sale con confianza alta de una intención de diseño.
    other = model.predict("cuál es la capital de Francia")
    assert other.intent == "other" or other.confidence < 0.75


def test_guardar_y_cargar_da_lo_mismo(model: IntentModel, tmp_path) -> None:
    path = tmp_path / "nlu.joblib"
    model.save(path)
    again = IntentService(path).model
    assert again.version == model.version
    assert again.predict("quita la alfombra").intent == "remove_item"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("revestimiento de azulejo blanco tipo metro hasta 1.2 m", {"surface": "wallTiles", "pattern": "subway", "heightM": 1.2}),
        ("pared de la ducha con baldosa hasta el techo", {"surface": "wallTiles", "fullHeight": True}),
        ("piso de porcelanato de 60x60 cm mate", {"surface": "floor", "tileSizeM": 0.6, "gloss": 0.1}),
        ("pon un tocador junto a la cama", {"subcategory": "dressing-table", "quantity": 1}),
        ("agrega dos sillas", {"subcategory": "dining-chair", "quantity": 2}),
        ("el cuarto mide 4,5 x 3", {"widthM": 4.5, "depthM": 3.0}),
        ("luz cálida y tenue", {"mood": "calida", "level": "tenue"}),
        ("baja la luz", {"level": "tenue"}),
        ("agrega un baño privado con ducha de obra", {"zoneKind": "bathroom", "preset": "ducha-obra"}),
        ("recomienda solo colores", {"intensity": "suave"}),
        ("hazlo nórdico", {"style": "escandinavo"}),
        ("suelta el estilo", {"pinTarget": "style"}),
    ],
)
def test_parametros(text: str, expected: dict[str, object]) -> None:
    slots = extract(text)
    for key, value in expected.items():
        assert getattr(slots, key) == value, (text, key)


def test_colores_compuestos_y_matices() -> None:
    assert [c.hex for c in extract("verde menta y gris claro").colors] == ["#a8dcc4", "#c9cbcd"]
    clarito = extract("rojo clarito").colors[0]
    assert clarito.name == "rojo clarito"
    assert clarito.hex != "#b8312f"
    assert extract("sin colores aquí").colors == []


# ------------------------------------------------------------------------------ preferencias
def _cand(i: str, style: str, prior: float = 1.0) -> preferences.Candidate:
    return preferences.Candidate(id=i, features={f"style:{style}": 1.0, "palette:warmth": 0.8 if style == "bohemio" else 0.2}, prior=prior)


def test_sin_historial_suficiente_manda_la_nota_de_oficio() -> None:
    cands = [_cand("a", "moderno", 1.2), _cand("b", "bohemio", 0.9)]
    r = preferences.rank(cands, [preferences.Sample(features=cands[1].features, action="like")])
    assert r.model == "prior"
    assert r.scores == {"a": 1.2, "b": 0.9}


def test_con_historial_aprende_lo_que_gusta() -> None:
    bohemio, moderno = _cand("b", "bohemio", 0.9), _cand("a", "moderno", 1.2)
    history = [preferences.Sample(features=bohemio.features, action=a) for a in ("like", "kept", "like", "like")]
    history += [preferences.Sample(features=moderno.features, action=a) for a in ("dislike", "undone", "dislike")]
    history.append(preferences.Sample(features=moderno.features, action="shown"))
    r = preferences.rank([moderno, bohemio], history)
    assert r.model == "logreg"
    assert r.samples == 7
    assert r.scores["b"] > r.scores["a"]


# ------------------------------------------------------------------------------ referencia
def _room(wall: tuple[int, int, int], floor: tuple[int, int, int]) -> np.ndarray:
    img = np.zeros((300, 400, 3), dtype=np.uint8)
    img[:180] = wall
    img[180:] = floor
    return img


def test_referencia_por_colores_piso_abajo_y_paredes_arriba() -> None:
    ref = analyze_colors(_room((236, 230, 218), (150, 105, 60)))
    assert ref.source == "colors"
    assert ref.floor is not None and ref.floor.kind == "wood"
    floor = ref.floor.colors[0]
    assert int(floor[1:3], 16) > int(floor[5:7], 16)  # más rojo que azul: madera
    assert ref.wallColor is not None and int(ref.wallColor[1:3], 16) > 200
    assert 1 <= len(ref.palette) <= 5
    assert ref.style in {"escandinavo", "minimalista", "moderno", "clasico", "bohemio", "industrial"}


def test_lo_que_dice_la_vision_se_valida_contra_el_lexico() -> None:
    raw = 'Aquí va: {"style": "Nórdico", "palette": ["#A9D4EE", "nope", "#9bd3b0"], "floor": {"kind": "tile", "pattern": "mosaic", "colors": ["#a9d4ee", "#9bd3b0"], "gloss": 0.9}, "walls": {"color": "#f4f4f1"}, "objects": ["Sofá", "alfombra", "nave espacial"], "lighting": {"mood": "cálida", "level": "media"}}'
    ref = parse_vision(raw)
    assert ref.style == "escandinavo"
    assert ref.palette == ["#a9d4ee", "#9bd3b0"]
    assert ref.floor is not None and (ref.floor.kind, ref.floor.pattern, ref.floor.gloss) == ("tile", "mosaic", 0.9)
    assert ref.objects == ["sofa", "rug"]
    assert (ref.mood, ref.level, ref.source) == ("calida", "media", "vision")


class _Vision:
    model = "fake"

    def __init__(self, answer: str | Exception) -> None:
        self.answer = answer
        self.calls = 0

    def describe(self, jpeg: bytes, prompt: str) -> str:
        self.calls += 1
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


class _Budget:
    def __init__(self, n: int) -> None:
        self.n = n

    def take(self) -> bool:
        self.n -= 1
        return self.n >= 0

    def remaining(self) -> int:
        return max(0, self.n)


def test_analizador_usa_vision_con_cuota_cachea_y_cae_a_colores() -> None:
    img = _room((236, 230, 218), (150, 105, 60))
    vision = _Vision('{"style": "industrial", "palette": ["#333333"], "objects": ["sofa"]}')
    analyzer = ReferenceAnalyzer(vision, _Budget(1))
    first = analyzer.analyze(b"foto-1", img)
    assert (first.source, first.style) == ("vision", "industrial")
    assert first.floor is not None  # lo que el modelo no dijo sale de los colores
    assert analyzer.analyze(b"foto-1", img) is first
    assert vision.calls == 1
    # Sin cuota, la segunda foto se analiza por colores.
    assert analyzer.analyze(b"foto-2", img).source == "colors"
    # Si el modelo falla, también.
    broken = ReferenceAnalyzer(_Vision(ProviderError("límite", retryable=False)), _Budget(5))
    assert broken.analyze(b"foto-3", img).source == "colors"


def test_cli_de_entrenamiento_guarda_el_modelo(tmp_path, monkeypatch, capsys) -> None:
    from interiores_ai.ml import train

    monkeypatch.setattr("sys.argv", ["train", "--out", str(tmp_path), "--per-intent", "80"])
    train.main()
    assert (tmp_path / "nlu.joblib").exists()
    assert "F1 macro" in capsys.readouterr().out
