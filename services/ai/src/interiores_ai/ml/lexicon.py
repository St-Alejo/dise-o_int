"""Léxico en español del chat de diseño: colores, superficies, materiales, dibujos, piezas, estilos.

Todo en minúsculas y sin tildes (ver `normalize`): así "baño", "bano" y "BAÑO" son lo mismo. Las
entradas de varias palabras van primero en la búsqueda (la más larga gana: "azul claro" antes que
"azul"). Lo usan el extractor de parámetros y el generador de frases de entrenamiento.
"""

import re
import unicodedata

_SPACES = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s#.,x×-]")
# Comas y puntos que no son decimales ("brillante, azul" sí; "1,2 m" no).
_SEPARATORS = re.compile(r"[.,](?!\d)")


def normalize(text: str) -> str:
    """Minúsculas, sin tildes ni signos (la ñ pasa a n), espacios simples."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _SPACES.sub(" ", _SEPARATORS.sub(" ", _PUNCT.sub(" ", plain))).strip()


# --------------------------------------------------------------------------------------------- colores
COLORS: dict[str, str] = {
    "blanco": "#f4f4f1",
    "blanco roto": "#eeeae0",
    "negro": "#1d1d1f",
    "gris": "#8a8d91",
    "gris claro": "#c9cbcd",
    "gris oscuro": "#4a4d52",
    "gris perla": "#d5d6d2",
    "grafito": "#3b3e43",
    "antracita": "#33363a",
    "beige": "#d9c7a7",
    "crema": "#efe6d2",
    "marfil": "#f3eddc",
    "arena": "#d8c3a0",
    "topo": "#8b7d6b",
    "greige": "#b8ada0",
    "terracota": "#c0603f",
    "marron": "#7a5236",
    "cafe": "#6f4a2f",
    "chocolate": "#4b2e1e",
    "rojo": "#b8312f",
    "burdeos": "#6d1f2a",
    "vino": "#6d1f2a",
    "rosa": "#e8a5b4",
    "rosa palo": "#e7c3c3",
    "rosado": "#e8a5b4",
    "coral": "#f07c5e",
    "salmon": "#f2a08a",
    "naranja": "#e07b28",
    "mostaza": "#c9a227",
    "amarillo": "#f2d14b",
    "ocre": "#c08a2f",
    "verde": "#4f8a52",
    "verde claro": "#9bd3b0",
    "verde menta": "#a8dcc4",
    "menta": "#a8dcc4",
    "verde agua": "#9fd8cb",
    "verde oliva": "#7a7c3a",
    "oliva": "#7a7c3a",
    "verde salvia": "#9caf88",
    "salvia": "#9caf88",
    "verde esmeralda": "#2e8b6a",
    "esmeralda": "#2e8b6a",
    "verde oscuro": "#2f5d3a",
    "verde botella": "#24493a",
    "turquesa": "#3cb6b0",
    "azul": "#3b6db3",
    "azul claro": "#a9d4ee",
    "azul cielo": "#8ec5ea",
    "celeste": "#a9d4ee",
    "azul bebe": "#bcdcf2",
    "azul marino": "#1f2f57",
    "azul oscuro": "#24375f",
    "azul petroleo": "#1e5266",
    "azul cobalto": "#2c4fa3",
    "lila": "#b9a3d6",
    "lavanda": "#c9b8e6",
    "morado": "#6a3f8f",
    "purpura": "#6a3f8f",
    "violeta": "#7b4fa6",
    "dorado": "#c9a54a",
    "plateado": "#c0c4c8",
    "cobre": "#b36a3c",
}

# Lo que se dice de un color para aclararlo u oscurecerlo ("rojo clarito", "verde pastel").
LIGHTER = ("claro", "clarito", "pastel", "suave")
DARKER = ("oscuro", "oscurito", "intenso", "profundo")


def shade(hex_color: str, factor: float) -> str:
    """Aclara (factor > 0) u oscurece (< 0) un color hacia el blanco o el negro."""
    rgb = [int(hex_color[i : i + 2], 16) for i in (1, 3, 5)]
    target = 255 if factor > 0 else 0
    mixed = [round(c + (target - c) * abs(factor)) for c in rgb]
    return "#" + "".join(f"{c:02x}" for c in mixed)


# ------------------------------------------------------------------------------------------ superficies
SURFACES: dict[str, str] = {
    "piso": "floor",
    "suelo": "floor",
    "pavimento": "floor",
    "pared": "walls",
    "paredes": "walls",
    "muro": "walls",
    "muros": "walls",
    "techo": "ceiling",
    "cielo raso": "ceiling",
    "cielorraso": "ceiling",
    "revestimiento": "wallTiles",
    "azulejo de pared": "wallTiles",
    "azulejos de pared": "wallTiles",
    "alicatado": "wallTiles",
    "zocalo": "wallTiles",
    "media pared": "wallTiles",
    "pared de la ducha": "wallTiles",
    "paredes del bano": "wallTiles",
}

# Familia del acabado (FinishSpec.kind) y el material de la biblioteca que le da la textura.
KINDS: dict[str, tuple[str, str]] = {
    "baldosa": ("tile", "ceramic-white"),
    "baldosas": ("tile", "ceramic-white"),
    "azulejo": ("tile", "ceramic-white"),
    "azulejos": ("tile", "ceramic-white"),
    "ceramica": ("tile", "ceramic-white"),
    "porcelanato": ("tile", "ceramic-grey-tile"),
    "gres": ("tile", "ceramic-grey-tile"),
    "losa": ("tile", "ceramic-white"),
    "losas": ("tile", "ceramic-white"),
    "mosaico": ("tile", "ceramic-white"),
    "madera": ("wood", "wood-oak"),
    "parquet": ("wood", "wood-oak"),
    "tarima": ("wood", "wood-oak"),
    "laminado": ("wood", "wood-oak"),
    "roble": ("wood", "wood-oak"),
    "nogal": ("wood", "wood-walnut"),
    "marmol": ("stone", "stone-marble-white"),
    "travertino": ("stone", "stone-travertine"),
    "piedra": ("stone", "stone-slate"),
    "granito": ("stone", "stone-slate"),
    "pizarra": ("stone", "stone-slate"),
    "terrazo": ("stone", "stone-terrazzo"),
    "microcemento": ("concrete", "stone-microcement"),
    "cemento": ("concrete", "stone-microcement"),
    "hormigon": ("concrete", "stone-microcement"),
    "concreto": ("concrete", "stone-microcement"),
    "moqueta": ("carpet", "carpet-grey"),
    "alfombrado": ("carpet", "carpet-grey"),
    "ladrillo": ("brick", "brick-white"),
    "ladrillo visto": ("brick", "brick-white"),
    "pintura": ("paint", "paint-white"),
}

PATTERNS: dict[str, str] = {
    "cuadricula": "grid",
    "en cuadricula": "grid",
    "ajedrez": "checker",
    "damero": "checker",
    "tablero": "checker",
    "metro": "subway",
    "tipo metro": "subway",
    "subway": "subway",
    "espiga": "herringbone",
    "espina de pez": "herringbone",
    "espina": "herringbone",
    "hexagonal": "hex",
    "hexagonales": "hex",
    "hexagono": "hex",
    "hexagonos": "hex",
    "mosaico": "mosaic",
    "mezclado": "mosaic",
    "mezcladas": "mosaic",
    "combinado": "mosaic",
    "combinadas": "mosaic",
    "tablones": "planks",
    "tablas": "planks",
}

GLOSS: dict[str, float] = {
    "brillante": 0.85,
    "brillantes": 0.85,
    "brillo": 0.85,
    "pulido": 0.9,
    "pulida": 0.9,
    "lacado": 0.8,
    "satinado": 0.5,
    "satinada": 0.5,
    "mate": 0.1,
    "mates": 0.1,
    "rustico": 0.15,
    "rustica": 0.15,
}

# ------------------------------------------------------------------------------- piezas del catálogo
SUBCATEGORIES: dict[str, str] = {
    "sofa": "sofa",
    "sillon": "armchair",
    "butaca": "armchair",
    "mesa de centro": "coffee-table",
    "mesita de centro": "coffee-table",
    "mesa auxiliar": "side-table",
    "mesa de comedor": "dining-table",
    "mesa": "dining-table",
    "silla": "dining-chair",
    "sillas": "dining-chair",
    "taburete": "stool",
    "cama": "bed",
    "mesita de noche": "nightstand",
    "mesa de noche": "nightstand",
    "velador": "table-lamp",
    "armario": "wardrobe",
    "ropero": "wardrobe",
    "comoda": "dresser",
    "tocador": "dressing-table",
    "mesa de maquillaje": "dressing-table",
    "maquillador": "dressing-table",
    "escritorio": "desk",
    "silla de oficina": "office-chair",
    "estanteria": "shelf",
    "librero": "shelf",
    "repisa": "wall-shelf",
    "aparador": "sideboard",
    "mueble de tv": "tv-stand",
    "televisor": "tv",
    "tele": "tv",
    "tv": "tv",
    "alfombra": "rug",
    "alfombras": "rug",
    "tapete": "rug",
    "cortina": "curtains",
    "cortinas": "curtains",
    "cuadro": "wall-art",
    "cuadros": "wall-art",
    "espejo": "mirror",
    "planta": "plant",
    "plantas": "plant",
    "jarron": "vase",
    "cojin": "cushion",
    "cojines": "cushion",
    "lampara de pie": "floor-lamp",
    "lampara de mesa": "table-lamp",
    "lampara colgante": "pendant",
    "lampara de techo": "pendant",
    "lampara": "floor-lamp",
    "plafon": "flush-light",
    "tira led": "led-strip",
    "luces led": "led-strip",
    "foco empotrado": "recessed-spot",
    "focos empotrados": "recessed-spot",
    "foco": "recessed-spot",
    "focos": "recessed-spot",
    "aplique": "sconce",
    "ducha": "shower",
    "banera": "bathtub",
    "mampara": "shower-screen",
    "inodoro": "toilet",
    "lavamanos": "vanity",
    "lavabo": "vanity",
    "bide": "bidet",
    "toallero": "towel-rail",
    "nevera": "fridge",
    "refrigerador": "fridge",
    "estufa": "stove",
    "fogon": "stove",
    "isla": "kitchen-island",
}

STYLES: dict[str, str] = {
    "escandinavo": "escandinavo",
    "nordico": "escandinavo",
    "minimalista": "minimalista",
    "minimal": "minimalista",
    "industrial": "industrial",
    "bohemio": "bohemio",
    "boho": "bohemio",
    "moderno": "moderno",
    "contemporaneo": "moderno",
    "clasico": "clasico",
    "tradicional": "clasico",
}

MOODS: dict[str, str] = {
    "calida": "calida",
    "calido": "calida",
    "amarilla": "calida",
    "acogedora": "calida",
    "neutra": "neutra",
    "neutral": "neutra",
    "natural": "neutra",
    "fria": "fria",
    "frio": "fria",
    "blanca": "fria",
}

LEVELS: dict[str, str] = {
    "tenue": "tenue",
    "suave": "tenue",
    "baja": "tenue",
    "poca": "tenue",
    "media": "media",
    "normal": "media",
    "alta": "alta",
    "mucha": "alta",
    "intensa": "alta",
    "fuerte": "alta",
}

ZONES: dict[str, str] = {
    "bano privado": "bathroom",
    "bano": "bathroom",
    "banito": "bathroom",
    "vestidor": "closet",
    "zona de tocador": "vanity",
    "rincon de estudio": "office-nook",
}

BATH_PRESETS: dict[str, str] = {
    "ducha de obra": "ducha-obra",
    "banera con mampara": "banera-mampara",
    "con banera": "banera-mampara",
    "spa": "spa-marmol",
    "marmol": "spa-marmol",
    "industrial": "industrial",
}

# Qué fijar o soltar ("fija el piso", "suelta el estilo").
PIN_TARGETS: dict[str, str] = {
    "piso": "floor",
    "suelo": "floor",
    "paredes": "walls",
    "pared": "walls",
    "techo": "ceiling",
    "revestimiento": "wallTiles",
    "estilo": "style",
    "luz": "lighting",
    "iluminacion": "lighting",
    "colores": "palette",
    "paleta": "palette",
}


def longest_first(words: dict[str, object]) -> list[str]:
    return sorted(words, key=lambda w: (-len(w.split()), -len(w)))
