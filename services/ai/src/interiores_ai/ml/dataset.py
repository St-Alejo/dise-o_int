"""Frases de entrenamiento del modelo de intención, generadas con plantillas y sinónimos.

Cada intención tiene varias plantillas y cada hueco ({color}, {item}...) se llena con el léxico.
Encima se añaden variaciones de cómo escribe la gente (cortesías, "porfa", minúsculas, letras que se
comen o se cambian). Con la misma semilla sale el mismo conjunto: el entrenamiento es reproducible.
"""

import random
from collections.abc import Callable, Sequence

from . import lexicon as lx

INTENTS = (
    "set_floor",
    "set_walls",
    "set_wall_tiles",
    "set_ceiling",
    "add_item",
    "remove_item",
    "move_item",
    "set_lighting",
    "set_style",
    "recommend",
    "pin",
    "unpin",
    "add_zone",
    "avoid_item",
    "replicate_image",
    "room_size",
    "other",
)

_COLORS = list(lx.COLORS)
_ITEMS_SG = ["sofa", "sillon", "mesa de centro", "mesa auxiliar", "cama", "mesita de noche", "armario", "comoda", "tocador", "mesa de maquillaje", "escritorio", "estanteria", "televisor", "alfombra", "planta", "espejo", "lampara de pie", "lampara colgante", "cuadro", "aparador", "butaca", "silla", "ducha", "banera", "mampara", "toallero", "lavamanos", "tira led", "foco empotrado", "aplique", "cortina", "jarron", "taburete", "mueble de tv", "plafon"]
_ITEMS_PL = ["alfombras", "plantas", "cuadros", "cortinas", "cojines", "sillas", "focos", "lamparas", "espejos", "repisas"]
_WOODS = ["madera", "parquet", "tarima", "roble", "nogal", "laminado"]
_TILES = ["baldosa", "baldosas", "azulejo", "azulejos", "ceramica", "porcelanato", "mosaico", "gres", "losa"]
_STONES = ["marmol", "piedra", "granito", "microcemento", "cemento", "terrazo", "travertino", "pizarra"]
_PATTERNS = ["en espiga", "hexagonal", "tipo metro", "en damero", "en ajedrez", "mezclado", "en cuadricula", "hexagonales", "espina de pez"]
_GLOSS = ["brillante", "mate", "satinado", "pulido", "rustico", "con brillo"]
_SIZES = ["de 60x60 cm", "de 30 cm", "de 10 cm", "grandes", "pequenas", "de 20x20 cm", "de 120 cm"]
_PLACES = ["junto a la cama", "al lado del sofa", "frente al sofa", "en la esquina", "contra la pared", "cerca de la ventana", "en el centro", "a la izquierda", "a la derecha", "detras del sofa", "encima de la comoda", "debajo de la ventana", ""]
_STYLES = list(lx.STYLES)
_MOODS = ["calida", "fria", "neutra", "acogedora", "natural", "blanca", "amarilla"]
_LEVELS = ["tenue", "suave", "intensa", "fuerte", "baja", "alta", "media"]
_PIN = ["piso", "suelo", "paredes", "techo", "estilo", "luz", "colores", "revestimiento", "iluminacion"]
_ZONES = ["un bano privado", "un bano", "un bano en suite", "un vestidor", "una zona de tocador", "un rincon de estudio", "un banito"]
_PRESETS = ["con ducha de obra", "con banera con mampara", "tipo spa", "de marmol", "industrial", ""]


def _pick[T](r: random.Random, items: Sequence[T]) -> T:
    return items[r.randrange(len(items))]


def _color(r: random.Random) -> str:
    c = _pick(r, _COLORS)
    if r.random() < 0.15:
        c += " " + _pick(r, ["clarito", "pastel", "oscuro", "intenso"])
    return c


def _colors(r: random.Random) -> str:
    if r.random() < 0.35:
        return f"{_color(r)} {_pick(r, ['con', 'y', 'combinado con', 'mezclado con'])} {_color(r)}"
    return _color(r)


def _finish(r: random.Random, families: list[str]) -> str:
    parts = [_pick(r, families)]
    if r.random() < 0.5:
        parts.append(_pick(r, _GLOSS))
    if r.random() < 0.7:
        parts.append(_colors(r))
    if r.random() < 0.3:
        parts.append(_pick(r, _PATTERNS))
    if r.random() < 0.2:
        parts.append(_pick(r, _SIZES))
    head, *rest = parts
    r.shuffle(rest)
    return " ".join([head, *rest])


Template = Callable[[random.Random], str]

_TEMPLATES: dict[str, list[Template]] = {
    "set_floor": [
        lambda r: f"pon el {_pick(r, ['piso', 'suelo'])} de {_finish(r, _TILES + _WOODS + _STONES)}",
        lambda r: f"quiero un {_pick(r, ['piso', 'suelo', 'pavimento'])} de {_finish(r, _TILES + _WOODS + _STONES)}",
        lambda r: f"cambia el {_pick(r, ['piso', 'suelo'])} a {_finish(r, _TILES + _WOODS + _STONES)}",
        lambda r: f"{_finish(r, _TILES + _WOODS + _STONES)} para el {_pick(r, ['piso', 'suelo'])}",
        lambda r: f"el {_pick(r, ['piso', 'suelo'])} que sea {_pick(r, ['de ', ''])}{_finish(r, _TILES + _WOODS + _STONES)}",
        lambda r: f"me gustaria el {_pick(r, ['piso', 'suelo'])} en {_finish(r, _TILES + _WOODS + _STONES)}",
        lambda r: f"{_pick(r, ['pon', 'ponle', 'cambia el piso por', 'usa'])} {_pick(r, ['moqueta', 'alfombrado', 'parquet en espiga', 'piso flotante', 'baldosa hidraulica'])} {_pick(r, ['en el suelo', 'en el piso', 'de piso', ''])}",
        lambda r: f"{_pick(r, ['piso', 'suelo'])} {_colors(r)} {_pick(r, _GLOSS)}",
    ],
    "set_walls": [
        lambda r: f"pinta las paredes de {_colors(r)}",
        lambda r: f"{_pick(r, ['quiero', 'pon', 'deja'])} las paredes {_pick(r, ['en ', 'de color ', ''])}{_color(r)}",
        lambda r: f"cambia el color de {_pick(r, ['la pared', 'las paredes', 'los muros'])} a {_color(r)}",
        lambda r: f"paredes {_color(r)} {_pick(r, ['mate', 'satinado', '', 'por favor'])}",
        lambda r: f"{_pick(r, ['pon', 'quiero'])} {_pick(r, ['ladrillo visto', 'pintura ' + _color(r), 'papel pintado', 'estuco'])} en {_pick(r, ['las paredes', 'la pared del fondo', 'una pared'])}",
        lambda r: f"pinta la pared {_pick(r, ['del fondo', 'de la ventana', 'de la cama', 'principal'])} de {_color(r)}",
        lambda r: f"una pared de acento {_color(r)}",
        lambda r: f"las paredes {_pick(r, ['mas claras', 'mas oscuras', 'en un tono ' + _color(r), 'color ' + _color(r)])}",
    ],
    "set_wall_tiles": [
        lambda r: f"pon {_finish(r, ['azulejos', 'baldosas', 'azulejo', 'ceramica', 'marmol', 'mosaico'])} en {_pick(r, ['la pared de la ducha', 'las paredes del bano', 'la pared', 'media pared'])}",
        lambda r: f"revestimiento de {_finish(r, [*_TILES, 'marmol', 'piedra', 'microcemento'])} hasta {_pick(r, ['el techo', '1.2 m', '1,5 metros', 'la mitad', '2 m', '120 cm'])}",
        lambda r: f"alicatado {_colors(r)} {_pick(r, ['hasta el techo', 'hasta 1.2 m', 'en el bano', ''])}",
        lambda r: f"azulejo {_pick(r, _PATTERNS)} {_color(r)} en las paredes del bano",
        lambda r: f"zocalo de {_finish(r, _TILES)}",
        lambda r: f"quiero la pared del bano con {_finish(r, _TILES)}",
        lambda r: f"cubre las paredes de la ducha con {_finish(r, [*_TILES, 'marmol'])}",
    ],
    "set_ceiling": [
        lambda r: f"pinta el techo de {_color(r)}",
        lambda r: f"{_pick(r, ['quiero', 'pon', 'deja'])} el techo {_pick(r, ['en ', 'de ', 'de color '])}{_color(r)}",
        lambda r: f"techo de {_pick(r, ['madera', 'listones de madera', 'microcemento', 'hormigon visto'])}",
        lambda r: f"cambia el {_pick(r, ['techo', 'cielo raso', 'cielorraso'])} a {_color(r)}",
        lambda r: f"el techo {_pick(r, ['mas oscuro', 'mas claro', 'blanco', 'negro'])}",
    ],
    "add_item": [
        lambda r: f"{_pick(r, ['pon', 'agrega', 'anade', 'coloca', 'mete', 'suma'])} {_pick(r, ['un', 'una', 'dos', 'otra', 'otro'])} {_pick(r, _ITEMS_SG)} {_pick(r, _PLACES)}",
        lambda r: f"{_pick(r, ['quiero', 'necesito', 'me gustaria', 'me falta'])} {_pick(r, ['un', 'una', 'otro', 'otra'])} {_pick(r, _ITEMS_SG)} {_pick(r, _PLACES)}",
        lambda r: f"falta {_pick(r, ['un', 'una'])} {_pick(r, _ITEMS_SG)}",
        lambda r: f"{_pick(r, ['puedes poner', 'podrias agregar'])} {_pick(r, ['un', 'una'])} {_pick(r, _ITEMS_SG)} {_color(r)} {_pick(r, _PLACES)}",
        lambda r: f"{_pick(r, ['un', 'una'])} {_pick(r, _ITEMS_SG)} {_pick(r, _PLACES)} {_pick(r, ['por favor', 'porfa', ''])}",
        lambda r: f"agrega {_pick(r, ['unas', 'algunas', 'tres', 'dos'])} {_pick(r, _ITEMS_PL)}",
    ],
    "remove_item": [
        lambda r: f"{_pick(r, ['quita', 'elimina', 'saca', 'borra', 'retira'])} {_pick(r, ['el', 'la', 'ese', 'esa', 'los', 'las'])} {_pick(r, _ITEMS_SG + _ITEMS_PL)}",
        lambda r: f"{_pick(r, ['sobra', 'ya no quiero', 'no me gusta'])} {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)}{_pick(r, [', quitalo', ', sacala', ''])}",
        lambda r: f"fuera {_pick(r, ['el', 'la', 'las', 'los'])} {_pick(r, _ITEMS_SG + _ITEMS_PL)}",
        lambda r: f"deshazte de {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)}",
        lambda r: f"{_pick(r, ['quita', 'elimina'])} todo lo que hay {_pick(r, ['en la esquina', 'junto a la ventana', 'en la pared'])}",
    ],
    "move_item": [
        lambda r: f"{_pick(r, ['mueve', 'lleva', 'corre', 'pon', 'cambia de lugar'])} {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)} {_pick(r, [p for p in _PLACES if p])}",
        lambda r: f"{_pick(r, ['acerca', 'aleja', 'separa', 'junta'])} {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)} {_pick(r, ['de la cama', 'del sofa', 'a la pared', 'de la ventana', ''])}",
        lambda r: f"gira {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)} {_pick(r, ['90 grados', 'hacia la ventana', 'un poco', 'al otro lado'])}",
        lambda r: f"{_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)} {_pick(r, ['mas cerca', 'mas lejos', 'mas a la izquierda', 'mas a la derecha', 'pegado a la pared'])}",
        lambda r: f"cambia {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)} de sitio",
        lambda r: f"intercambia {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)} con {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)}",
    ],
    "set_lighting": [
        lambda r: f"{_pick(r, ['quiero', 'pon', 'dame'])} una {_pick(r, ['luz', 'iluminacion'])} {_pick(r, _MOODS)}{_pick(r, [' y ' + _pick(r, _LEVELS), ''])}",
        lambda r: f"{_pick(r, ['luz', 'iluminacion'])} {_pick(r, _MOODS + _LEVELS)}",
        lambda r: f"{_pick(r, ['baja', 'sube', 'atenua', 'aumenta', 'bajale', 'subele'])} {_pick(r, ['la luz', 'las luces', 'la iluminacion', 'el brillo de las lamparas'])}",
        lambda r: f"{_pick(r, ['mas', 'menos'])} luz {_pick(r, ['por favor', 'en el cuarto', 'para la noche', ''])}",
        lambda r: f"un ambiente {_pick(r, ['calido', 'frio', 'acogedor', 'luminoso', 'oscuro'])} con la luz",
        lambda r: f"la luz {_pick(r, ['mas calida', 'mas fria', 'mas suave', 'mas fuerte', 'neutra'])}",
        lambda r: f"enciende las luces {_pick(r, _MOODS)}",
    ],
    "set_style": [
        lambda r: f"{_pick(r, ['hazlo', 'ponlo', 'dejalo'])} {_pick(r, _STYLES)}",
        lambda r: f"cambia el estilo a {_pick(r, _STYLES)}",
        lambda r: f"quiero un {_pick(r, ['cuarto', 'dormitorio', 'salon', 'estilo', 'look', 'ambiente'])} {_pick(r, _STYLES)}",
        lambda r: f"estilo {_pick(r, _STYLES)}{_pick(r, [' por favor', ''])}",
        lambda r: f"dale un aire {_pick(r, _STYLES)}",
        lambda r: f"me gusta lo {_pick(r, _STYLES)}, cambialo a eso",
        lambda r: f"que se vea mas {_pick(r, _STYLES)}",
    ],
    "recommend": [
        lambda r: _pick(r, ["recomiendame algo", "sorprendeme", "dame otra propuesta", "otra idea", "propon algo distinto", "que me recomiendas", "otra combinacion", "muestrame otra opcion", "recomienda", "dame ideas", "haz una propuesta", "inspirame", "prueba otra cosa", "dame otra version"]),
        lambda r: f"recomienda {_pick(r, ['solo colores', 'solo los acabados', 'algo sin cambiar los muebles', 'algo completo', 'todo de cero', 'algo suave'])}",
        lambda r: f"{_pick(r, ['propon', 'sugiere', 'recomienda'])} {_pick(r, ['un diseno', 'una paleta', 'una decoracion', 'colores'])} {_pick(r, ['que combine', 'que vaya con lo que fije', 'distinto', 'nuevo', ''])}",
        lambda r: f"no se que poner, {_pick(r, ['ayudame', 'recomiendame', 'sugiere algo'])}",
    ],
    "pin": [
        lambda r: f"{_pick(r, ['fija', 'bloquea', 'manten', 'conserva', 'guarda'])} {_pick(r, ['el', 'la', 'las', 'los'])} {_pick(r, _PIN)}",
        lambda r: f"no cambies {_pick(r, ['el', 'la', 'las', 'los'])} {_pick(r, _PIN)}",
        lambda r: f"deja {_pick(r, ['el', 'la', 'las'])} {_pick(r, _PIN)} como esta",
        lambda r: f"me gusta {_pick(r, ['el', 'la', 'este', 'esta'])} {_pick(r, _PIN)}, {_pick(r, ['consérvalo', 'no lo toques', 'fijalo', 'que no cambie'])}",
        lambda r: f"{_pick(r, ['el', 'la'])} {_pick(r, _PIN)} {_pick(r, ['que no cambie', 'se queda', 'no se toca', 'fijo'])}",
    ],
    "unpin": [
        lambda r: f"{_pick(r, ['suelta', 'desbloquea', 'libera', 'desfija'])} {_pick(r, ['el', 'la', 'las', 'los'])} {_pick(r, _PIN)}",
        lambda r: f"ya puedes cambiar {_pick(r, ['el', 'la', 'las'])} {_pick(r, _PIN)}",
        lambda r: f"{_pick(r, ['el', 'la'])} {_pick(r, _PIN)} {_pick(r, ['puede cambiar', 'ya no esta fijo', 'cambialo si quieres', 'da igual'])}",
        lambda r: f"no me importa {_pick(r, ['el', 'la'])} {_pick(r, _PIN)}, cambialo",
        lambda r: f"quita el candado {_pick(r, ['del', 'de la'])} {_pick(r, _PIN)}",
    ],
    "add_zone": [
        lambda r: f"{_pick(r, ['agrega', 'pon', 'crea', 'haz', 'anade'])} {_pick(r, _ZONES)} {_pick(r, _PRESETS)}",
        lambda r: f"quiero {_pick(r, _ZONES)} {_pick(r, ['dentro del cuarto', 'en el dormitorio', 'en una esquina', ''])} {_pick(r, _PRESETS)}",
        lambda r: f"{_pick(r, ['me gustaria', 'necesito'])} {_pick(r, _ZONES)} {_pick(r, _PRESETS)}",
        lambda r: f"separa una parte del cuarto para {_pick(r, ['un bano', 'el vestidor', 'un tocador', 'estudiar'])}",
        lambda r: f"suite con {_pick(r, ['bano', 'bano privado', 'vestidor'])}",
    ],
    "avoid_item": [
        lambda r: f"no quiero {_pick(r, _ITEMS_PL)}",
        lambda r: f"{_pick(r, ['sin', 'nada de', 'evita', 'odio las', 'no pongas'])} {_pick(r, _ITEMS_PL)}",
        lambda r: f"que no haya {_pick(r, [*_ITEMS_PL, 'alfombra', 'televisor', 'espejo'])}",
        lambda r: f"no me gustan {_pick(r, ['las', 'los'])} {_pick(r, _ITEMS_PL)}, no las pongas",
        lambda r: f"prohibido {_pick(r, ['poner', 'usar'])} {_pick(r, _ITEMS_PL)}",
    ],
    "replicate_image": [
        lambda r: _pick(r, ["replica esta imagen", "hazlo como en la foto", "quiero que se parezca a esta foto", "copia el estilo de esta imagen", "igual que esta referencia", "inspirate en esta foto", "algo asi como la imagen", "mira esta foto y hazlo parecido", "como la foto que te pase", "usa esta imagen de referencia"]),
        lambda r: f"{_pick(r, ['quiero', 'me gustaria'])} {_pick(r, ['algo como', 'un cuarto como', 'que quede como'])} {_pick(r, ['esta foto', 'la imagen', 'esta referencia', 'la de pinterest'])}",
        lambda r: f"{_pick(r, ['copia', 'imita', 'replica'])} {_pick(r, ['los colores', 'el piso', 'el estilo', 'todo'])} de {_pick(r, ['esta foto', 'la imagen', 'la referencia'])}",
    ],
    "room_size": [
        lambda r: f"el cuarto mide {r.randint(2, 8)} {_pick(r, ['x', 'por'])} {r.randint(2, 8)}{_pick(r, [' metros', ' m', ''])}",
        lambda r: f"cambia las medidas a {r.randint(2, 8)},{r.randint(0, 9)} por {r.randint(2, 8)}",
        lambda r: f"{_pick(r, ['haz', 'deja'])} {_pick(r, ['la habitacion', 'el cuarto', 'la sala'])} de {r.randint(2, 8)}x{r.randint(2, 8)}",
        lambda r: f"{_pick(r, ['agranda', 'achica', 'amplia', 'reduce'])} el cuarto {_pick(r, ['un metro', 'medio metro', 'a ' + str(r.randint(3, 7)) + ' x ' + str(r.randint(3, 7))])}",
        lambda r: f"las medidas reales son {r.randint(2, 8)} metros de ancho y {r.randint(2, 8)} de largo",
    ],
    "other": [
        lambda r: _pick(r, ["hola", "gracias", "que hora es", "cuanto cuesta todo", "como estas", "quien eres", "ayuda", "que puedes hacer", "jaja", "ok", "cuentame un chiste", "cual es la capital de francia", "buenas noches", "perfecto, gracias", "me encanta", "esta bien asi", "no entiendo", "que tal", "adios", "genial", "eres un robot", "como funciona esto", "guarda el proyecto", "exporta el plano", "cuanto mide el sofa", "donde compro esto", "que es el estilo bohemio", "explicame la revision", "buen trabajo", "no", "si", "vale"]),
        lambda r: f"{_pick(r, ['que opinas de', 'te gusta', 'que piensas de'])} {_pick(r, ['mi cuarto', 'este diseno', 'el sofa', 'los colores'])}",
        lambda r: f"{_pick(r, ['cuanto cuesta', 'donde compro', 'que medidas tiene'])} {_pick(r, ['el', 'la'])} {_pick(r, _ITEMS_SG)}",
    ],
}

_PREFIXES = ["", "", "", "", "por favor ", "oye ", "puedes ", "me gustaria que ", "quisiera ", "hey ", "bueno, ", "ahora ", "y "]
_SUFFIXES = ["", "", "", "", " por favor", " porfa", " gracias", "!", " ya", " plis", "?"]


def _typo(r: random.Random, text: str) -> str:
    """Un error de dedo: una letra que se come, se repite o se cambia con la vecina."""
    if len(text) < 6:
        return text
    i = r.randrange(1, len(text) - 1)
    op = r.randrange(3)
    if op == 0:
        return text[:i] + text[i + 1 :]
    if op == 1:
        return text[:i] + text[i] + text[i:]
    return text[: i - 1] + text[i] + text[i - 1] + text[i + 1 :]


def _clean(text: str) -> str:
    return " ".join(text.split())


def generate(per_intent: int = 900, seed: int = 7) -> list[tuple[str, str]]:
    """`per_intent` frases por intención, ya mezcladas. 17 intenciones × 900 ≈ 15 000 frases."""
    r = random.Random(seed)
    rows: list[tuple[str, str]] = []
    for intent in INTENTS:
        templates = _TEMPLATES[intent]
        seen: set[str] = set()
        attempts = 0
        while len(seen) < per_intent and attempts < per_intent * 20:
            attempts += 1
            text = _clean(_pick(r, _PREFIXES) + _pick(r, templates)(r) + _pick(r, _SUFFIXES))
            if r.random() < 0.12:
                text = _typo(r, text)
            if r.random() < 0.1:
                text = text.capitalize()
            if text not in seen:
                seen.add(text)
                rows.append((text, intent))
    r.shuffle(rows)
    return rows
