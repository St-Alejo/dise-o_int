"""Imagen de referencia ("hazlo como esta foto"): estilo, paleta, piso, paredes, piezas y luz.

Con el modelo de visión (Groq) se le pregunta por todo eso en JSON y se valida contra el léxico. Sin
él (sin clave, sin cuota o si falla), se sacan los colores dominantes con k-means: el de la franja
de abajo es el piso, el de arriba las paredes, y el estilo se aproxima por la paleta.
"""

import hashlib
import json
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from ..logging import log
from ..providers.base import ProviderError
from ..providers.vision import Budget, VisionClient
from . import lexicon as lx

PROMPT = """Eres interiorista. Mira esta foto de un ambiente y responde SOLO un JSON con:
{"style": uno de [escandinavo, minimalista, industrial, bohemio, moderno, clasico],
 "palette": [3 a 5 colores #rrggbb, del más presente al menos],
 "floor": {"kind": uno de [tile, wood, stone, carpet, concrete], "pattern": uno de [plain, grid, checker, subway, herringbone, hex, mosaic, planks], "colors": [1 a 3 #rrggbb], "gloss": 0 a 1},
 "walls": {"color": "#rrggbb"},
 "objects": [hasta 8 muebles u objetos en español, en singular: "sofa", "alfombra", "lampara de pie"...],
 "lighting": {"mood": uno de [calida, neutra, fria], "level": uno de [tenue, media, alta]}}
Sin texto fuera del JSON."""

_KINDS = {"tile", "wood", "stone", "carpet", "concrete"}
_PATTERNS = {"plain", "grid", "checker", "subway", "herringbone", "hex", "mosaic", "planks"}
_STYLE_IDS = set(lx.STYLES.values())


@dataclass
class Floor:
    kind: str
    pattern: str
    colors: list[str]
    gloss: float


@dataclass
class Reference:
    style: str | None
    palette: list[str]
    floor: Floor | None
    wallColor: str | None
    objects: list[str] = field(default_factory=list)
    mood: str | None = None
    level: str | None = None
    source: str = "colors"


def _hex(v: Any) -> str | None:
    if isinstance(v, str) and len(v) == 7 and v.startswith("#"):
        try:
            int(v[1:], 16)
            return v.lower()
        except ValueError:
            return None
    return None


def parse_vision(raw: str) -> Reference:
    """Valida lo que dijo el modelo: lo que no encaja con el léxico se descarta, no se inventa."""
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start : end + 1]) if start >= 0 and end > start else {}
    if not isinstance(data, dict):
        data = {}
    style = lx.STYLES.get(lx.normalize(str(data.get("style", ""))))
    palette = [h for h in (_hex(c) for c in data.get("palette", []) or []) if h][:5]
    floor = None
    f = data.get("floor")
    if isinstance(f, dict) and f.get("kind") in _KINDS:
        colors = [h for h in (_hex(c) for c in f.get("colors", []) or []) if h][:3]
        if colors:
            gloss = f.get("gloss", 0.3)
            floor = Floor(
                kind=str(f["kind"]),
                pattern=str(f.get("pattern")) if f.get("pattern") in _PATTERNS else "plain",
                colors=colors,
                gloss=min(1.0, max(0.0, float(gloss))) if isinstance(gloss, int | float) else 0.3,
            )
    walls = data.get("walls")
    wall = _hex(walls.get("color")) if isinstance(walls, dict) else None
    objects: list[str] = []
    for o in data.get("objects", []) or []:
        sub = lx.SUBCATEGORIES.get(lx.normalize(str(o)))
        if sub and sub not in objects:
            objects.append(sub)
    light_raw = data.get("lighting")
    light: dict[str, Any] = light_raw if isinstance(light_raw, dict) else {}
    mood = lx.MOODS.get(lx.normalize(str(light.get("mood", ""))))
    level = lx.LEVELS.get(lx.normalize(str(light.get("level", ""))))
    return Reference(style=style if style in _STYLE_IDS else None, palette=palette, floor=floor, wallColor=wall, objects=objects[:8], mood=mood, level=level, source="vision")


def _to_hex(rgb: np.ndarray) -> str:
    r, g, b = (round(float(c)) for c in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def _dominant(pixels: np.ndarray, k: int) -> list[tuple[np.ndarray, float]]:
    """Colores dominantes (RGB) con su peso, por k-means en Lab (más fiel a lo que se percibe)."""
    lab = cv2.cvtColor(pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    k = max(1, min(k, len(lab)))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    cv2.setRNGSeed(7)
    best = np.zeros((len(lab), 1), np.int32)
    _, labels, centers = cv2.kmeans(lab, k, best, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(np.asarray(labels, dtype=np.int64).flatten(), minlength=k).astype(float)
    rgb = cv2.cvtColor(centers.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB).reshape(-1, 3)
    order = np.argsort(-counts)
    return [(rgb[i], float(counts[i] / counts.sum())) for i in order]


def _hsv(rgb: np.ndarray) -> tuple[float, float, float]:
    h, s, v = cv2.cvtColor(rgb.reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV)[0, 0]
    return float(h) * 2, float(s) / 255, float(v) / 255


def guess_style(palette_rgb: list[np.ndarray]) -> str:
    """Estilo aproximado por la paleta: claridad, saturación y temperatura."""
    hsv = [_hsv(c) for c in palette_rgb]
    light = sum(v for _, _, v in hsv) / len(hsv)
    sat = sum(s for _, s, _ in hsv) / len(hsv)
    warm = sum(1 for h, s, _ in hsv if s > 0.15 and (h < 60 or h > 320)) / len(hsv)
    if light < 0.4 and sat < 0.3:
        return "industrial"
    if sat > 0.35 and warm > 0.4:
        return "bohemio"
    if light > 0.75 and sat < 0.15:
        return "minimalista"
    if light > 0.6 and warm > 0.2:
        return "escandinavo"
    if warm > 0.5:
        return "clasico"
    return "moderno"


def analyze_colors(image: np.ndarray) -> Reference:
    """Respaldo sin modelo de visión: colores dominantes del total, del piso y de las paredes."""
    h, w = image.shape[:2]
    scale = 160 / max(h, w)
    small = cv2.resize(image, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else image
    sh = small.shape[0]
    palette = _dominant(small.reshape(-1, 3), 5)
    floor_px = small[int(sh * 0.75) :].reshape(-1, 3)
    wall_px = small[: int(sh * 0.4)].reshape(-1, 3)
    floor_colors = _dominant(floor_px, 2)
    wall = _dominant(wall_px, 1)[0][0]
    # Brillo del piso: cuántos píxeles de su franja son reflejos casi blancos.
    v = cv2.cvtColor(floor_px.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV)[:, 0, 2]
    gloss = round(min(0.9, 0.2 + float((v > 235).mean()) * 4), 2)
    _, fs, _ = _hsv(floor_colors[0][0])
    kind = "wood" if fs > 0.25 else "tile"
    colors = [_to_hex(c) for c, share in floor_colors if share > 0.2][:2] or [_to_hex(floor_colors[0][0])]
    style = guess_style([c for c, _ in palette])
    warm = sum(1 for c, _ in palette if _hsv(c)[1] > 0.15 and (_hsv(c)[0] < 60 or _hsv(c)[0] > 320))
    return Reference(
        style=style,
        palette=[_to_hex(c) for c, _ in palette],
        floor=Floor(kind=kind, pattern="planks" if kind == "wood" else "grid", colors=colors, gloss=gloss),
        wallColor=_to_hex(wall),
        mood="calida" if warm >= 2 else "neutra",
        level="media",
        source="colors",
    )


class ReferenceAnalyzer:
    """Visión si hay modelo y cuota; si no (o si falla), colores dominantes. Con caché por imagen."""

    def __init__(self, vision: VisionClient | None = None, budget: Budget | None = None, cache_size: int = 32) -> None:
        self._vision = vision
        self._budget = budget
        self._cache: OrderedDict[str, Reference] = OrderedDict()
        self._size = cache_size

    @property
    def name(self) -> str:
        return f"vision:{self._vision.model}" if self._vision else "colors"

    def analyze(self, jpeg: bytes, image: np.ndarray) -> Reference:
        key = hashlib.sha256(jpeg).hexdigest()
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        result: Reference | None = None
        if self._vision is not None and self._budget is not None and self._budget.take():
            try:
                result = parse_vision(self._vision.describe(jpeg, PROMPT))
            except (ProviderError, ValueError) as err:
                log.warning("referencia_vision_fallo", error=str(err))
        colors = analyze_colors(image)
        if result is None or (not result.palette and result.floor is None):
            result = colors
        else:
            # Lo que el modelo no dijo se completa con lo que se ve en los colores.
            result.palette = result.palette or colors.palette
            result.floor = result.floor or colors.floor
            result.wallColor = result.wallColor or colors.wallColor
            result.style = result.style or colors.style
        self._cache[key] = result
        if len(self._cache) > self._size:
            self._cache.popitem(last=False)
        return result
