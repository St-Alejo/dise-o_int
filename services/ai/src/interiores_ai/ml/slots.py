"""Parámetros de una frase: colores, superficie, material, dibujo, brillo, pieza, estilo, luz, zona.

Es determinista (léxico + expresiones regulares): el modelo decide QUÉ se pide (la intención) y esto
saca CON QUÉ. Así "piso de baldosa brillante azul claro con verde" da superficie `floor`, familia
`tile`, brillo 0.85 y los colores #a9d4ee y #4f8a52, sin que el modelo tenga que aprender colores.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field

from . import lexicon as lx

_NUMBER_WORDS = {"un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "par": 2}
_NUM = r"(\d+(?:[.,]\d+)?)"
_TILE_SIZE = re.compile(_NUM + r"\s*(?:x\s*" + _NUM + r"\s*)?(cm|centimetros|mm)\b")
_HEIGHT = re.compile(r"hasta\s+(?:una\s+altura\s+de\s+|los\s+|el\s+)?" + _NUM + r"\s*(m|metros|metro|cm|centimetros)\b")
_FULL_HEIGHT = re.compile(r"hasta\s+(?:el\s+)?techo|toda\s+la\s+pared|pared\s+completa")
_ROOM = re.compile(_NUM + r"\s*(?:m|metros)?\s*(?:x|por|×)\s*" + _NUM)
_SOFT = re.compile(r"\bsolo\s+(?:los\s+)?(?:colores|acabados|la\s+luz|pintura)|\bsin\s+(?:cambiar|tocar|mover)\s+(?:los\s+)?muebles|\bsuave\b")
_TOTAL = re.compile(r"\b(?:todo|completa|completo|total|entera|de\s+cero)\b")


@dataclass
class Color:
    name: str
    hex: str


@dataclass
class Slots:
    colors: list[Color] = field(default_factory=list)
    surface: str | None = None
    finishKind: str | None = None
    base: str | None = None
    pattern: str | None = None
    gloss: float | None = None
    tileSizeM: float | None = None
    heightM: float | None = None
    fullHeight: bool = False
    subcategory: str | None = None
    quantity: int | None = None
    style: str | None = None
    mood: str | None = None
    level: str | None = None
    zoneKind: str | None = None
    preset: str | None = None
    intensity: str | None = None
    pinTarget: str | None = None
    widthM: float | None = None
    depthM: float | None = None


def _scan(tokens: list[str], words: Mapping[str, object]) -> list[tuple[int, int, str]]:
    """Coincidencias (inicio, fin, frase) de izquierda a derecha, la más larga primero, sin solaparse."""
    by_len = sorted({len(w.split()) for w in words}, reverse=True)
    found: list[tuple[int, int, str]] = []
    i = 0
    while i < len(tokens):
        for n in by_len:
            phrase = " ".join(tokens[i : i + n])
            if len(tokens[i : i + n]) == n and phrase in words:
                found.append((i, i + n, phrase))
                i += n
                break
        else:
            i += 1
    return found


def _num(raw: str) -> float:
    return float(raw.replace(",", "."))


def _colors(tokens: list[str]) -> list[Color]:
    out: list[Color] = []
    for _start, end, phrase in _scan(tokens, lx.COLORS):
        hex_color = lx.COLORS[phrase]
        name = phrase
        after = tokens[end] if end < len(tokens) else ""
        # "rojo clarito": si el léxico no trae ese tono, se aclara u oscurece el color base.
        if after in lx.LIGHTER and not phrase.endswith(lx.LIGHTER):
            hex_color, name = lx.shade(hex_color, 0.45), f"{phrase} {after}"
        elif after in lx.DARKER and not phrase.endswith(lx.DARKER):
            hex_color, name = lx.shade(hex_color, -0.4), f"{phrase} {after}"
        if all(c.hex != hex_color for c in out):
            out.append(Color(name=name, hex=hex_color))
    return out[:3]


def _first(tokens: list[str], words: dict[str, str]) -> str | None:
    hits = _scan(tokens, words)
    return words[hits[0][2]] if hits else None


def extract(text: str) -> Slots:
    norm = lx.normalize(text)
    tokens = norm.split()
    s = Slots(colors=_colors(tokens))
    s.surface = _first(tokens, lx.SURFACES)
    kind_hits = _scan(tokens, lx.KINDS)
    if kind_hits:
        s.finishKind, s.base = lx.KINDS[kind_hits[0][2]]
    s.pattern = _first(tokens, lx.PATTERNS)
    gloss_hits = _scan(tokens, lx.GLOSS)
    s.gloss = lx.GLOSS[gloss_hits[0][2]] if gloss_hits else None
    # Una pared "de baldosa" es revestimiento, no pintura (salvo que se diga a qué altura).
    if s.surface == "walls" and s.finishKind in ("tile", "stone") and (_HEIGHT.search(norm) or _FULL_HEIGHT.search(norm) or "bano" in tokens or "ducha" in tokens):
        s.surface = "wallTiles"
    if (m := _TILE_SIZE.search(norm)) and s.finishKind in (None, "tile", "stone", "wood"):
        size = _num(m.group(1))
        s.tileSizeM = round(size / (1000 if m.group(3) == "mm" else 100), 3)
    if m := _HEIGHT.search(norm):
        value = _num(m.group(1))
        s.heightM = round(value / 100 if m.group(2).startswith("c") else value, 2)
    s.fullHeight = bool(_FULL_HEIGHT.search(norm))

    # Pieza del catálogo ("baño" es una zona, no una pieza: está en otro léxico).
    sub_hits = _scan(tokens, lx.SUBCATEGORIES)
    if sub_hits:
        start, _end, phrase = sub_hits[0]
        s.subcategory = lx.SUBCATEGORIES[phrase]
        before = tokens[start - 1] if start > 0 else ""
        if before.isdigit():
            s.quantity = int(before)
        elif before in _NUMBER_WORDS:
            s.quantity = _NUMBER_WORDS[before]
    s.style = _first(tokens, lx.STYLES)
    s.mood = _first(tokens, lx.MOODS)
    s.level = _first(tokens, lx.LEVELS)
    if any(t in tokens for t in ("baja", "bajale", "atenua", "menos")) and "luz" in tokens:
        s.level = "tenue"
    if any(t in tokens for t in ("sube", "subele", "mas")) and "luz" in tokens and s.level is None:
        s.level = "alta"
    s.zoneKind = _first(tokens, lx.ZONES)
    if s.zoneKind == "bathroom":
        s.preset = _first(tokens, lx.BATH_PRESETS)
    s.pinTarget = _first(tokens, lx.PIN_TARGETS)
    if _SOFT.search(norm):
        s.intensity = "suave"
    elif _TOTAL.search(norm):
        s.intensity = "total"
    if m := _ROOM.search(norm):
        s.widthM, s.depthM = _num(m.group(1)), _num(m.group(2))
    return s
