"""El "look" del render: cómo se afina cada material y se ubica cada luz.

Funciones puras (sin bpy ni dependencias externas): las usa `blender/render_scene.py` dentro del
Python de Blender y se prueban con pytest sin Blender. Unidades: metros. Las coordenadas que llegan
de la web son de three.js (Y arriba); Blender usa Z arriba.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

Vec3 = tuple[float, float, float]


def to_blender(v: dict[str, float]) -> Vec3:
    """three.js (x, y arriba, z hacia el espectador) → Blender (x, y al fondo, z arriba).

    Es la misma conversión que hace el importador glTF de Blender, así que la escena y lo que
    describe el plan quedan en el mismo sitio.
    """
    return (v["x"], -v["z"], v["y"])


# ---------------------------------------------------------------------------
# Materiales
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MaterialRecipe:
    """Ajustes sobre el Principled BSDF que trae el glTF. None = dejar lo que venía."""

    roughness_min: float | None = None
    roughness_max: float | None = None
    metallic: float | None = None
    sheen: float = 0.0
    coat: float = 0.0
    coat_roughness: float = 0.1
    transmission: float | None = None
    #: Radio del bisel en el sombreado (m): bordes que atrapan la luz.
    bevel: float = 0.0
    #: Micro-relieve (fuerza del nodo Bump con ruido); 0 = nada.
    micro_bump: float = 0.0
    #: Mezcla con luz que atraviesa (pantallas de lámpara).
    translucency: float = 0.0
    #: Vidrio de ventana: deja pasar las sombras para que entre el sol.
    shadow_transparent: bool = False


_RECIPES: dict[str, MaterialRecipe] = {
    "paint": MaterialRecipe(roughness_min=0.82, micro_bump=0.04),
    "wood": MaterialRecipe(roughness_min=0.35, roughness_max=0.75, coat=0.08, coat_roughness=0.25, bevel=0.003),
    "stone": MaterialRecipe(roughness_min=0.25, roughness_max=0.6, coat=0.05, bevel=0.002),
    "tile": MaterialRecipe(roughness_min=0.15, roughness_max=0.4, coat=0.25, coat_roughness=0.05),
    "concrete": MaterialRecipe(roughness_min=0.7, micro_bump=0.08),
    "fabric": MaterialRecipe(roughness_min=0.85, sheen=0.6, bevel=0.012),
    "leather": MaterialRecipe(roughness_min=0.4, roughness_max=0.7, coat=0.2, coat_roughness=0.35, bevel=0.008),
    "metal": MaterialRecipe(roughness_min=0.18, roughness_max=0.45, metallic=1.0, bevel=0.002),
    "glass": MaterialRecipe(roughness_max=0.03, metallic=0.0, transmission=1.0),
    "lacquer": MaterialRecipe(roughness_min=0.25, roughness_max=0.45, coat=0.25, coat_roughness=0.15, bevel=0.002),
    "ceramic": MaterialRecipe(roughness_min=0.1, roughness_max=0.3, coat=0.6, coat_roughness=0.05, bevel=0.003),
    "plastic": MaterialRecipe(roughness_min=0.3, roughness_max=0.6, bevel=0.002),
    "plant": MaterialRecipe(roughness_min=0.5, translucency=0.25),
    "other": MaterialRecipe(),
}


def recipe_for(role: str | None, material: str | None) -> MaterialRecipe:
    """La receta de una malla según su papel y su familia de material."""
    base = _RECIPES.get(material or "other", _RECIPES["other"])
    if role == "window-glass":
        return MaterialRecipe(roughness_max=0.0, metallic=0.0, transmission=1.0, shadow_transparent=True)
    if role == "lamp-shade":
        return MaterialRecipe(roughness_min=0.8, sheen=0.3, translucency=0.6)
    if role == "furniture" and base.bevel == 0.0 and material not in ("glass", "plant"):
        # Un mueble sin familia conocida igual agradece bordes suaves.
        return MaterialRecipe(**{**base.__dict__, "bevel": 0.003})
    if role in ("wall", "ceiling") and material in (None, "other"):
        return _RECIPES["paint"]
    return base


#: Lo opaco que el visor dibuja por una sola cara: la "caja" del cuarto y las piezas sólidas. Vidrio
#: y pantallas quedan fuera: ya dejan pasar la luz a su manera.
OPAQUE_ROLES = frozenset({"wall", "ceiling", "floor", "trim", "door", "furniture"})


def camera_sees_through_back(role: str | None, single_sided: bool) -> bool:
    """¿La cámara debe atravesar la cara trasera de esta superficie?

    El visor no dibuja el revés de un material de una cara: con la cámara fuera del cuarto (la vista
    general desde arriba) el techo no tapa nada, y una tapa que le falta a un mueble deja ver lo que
    hay detrás. Cycles dibuja las dos caras: el techo taparía todo y por el hueco del mueble se vería
    su interior a oscuras. Solo para la cámara: para la luz siguen siendo sólidas.
    """
    return single_sided and role in OPAQUE_ROLES


#: Lo que la cámara ve directamente "fuera" (la vista general desde arriba): el fondo claro del visor.
#: El cielo Nishita es negro bajo el horizonte y dejaba esquinas negras alrededor del cuarto.
BACKDROP_HEX = "#e9e3da"


def inside_room(point: Vec3, lo: Vec3, hi: Vec3) -> bool:
    """¿La cámara está dentro de la caja del cuarto?

    Desde fuera (la vista general) las paredes recortadas sobran: si siguieran tapando la luz, lo que
    queda dentro de su volumen (el borde del piso, el canto de las paredes vecinas) saldría negro.
    """
    return all(lo[i] <= point[i] <= hi[i] for i in range(3))


#: Cuánto puede alejarse la exposición automática (en pasos) del valor fijo de la hora.
EXPOSURE_RANGE_STOPS = 2.5


def auto_exposure(log_mean: float, key: float, preset: float) -> float:
    """Exposición (en pasos) que lleva la luminancia media de la escena a la `key` de la hora.

    `log_mean` es la media geométrica de la luminancia lineal del pre-render (sin exposición). Un
    cuarto blanco y uno de paredes oscuras reciben la misma luz, pero sin esto el blanco sale quemado
    y el oscuro apagado. La corrección se limita alrededor de `preset`, así la noche sigue siendo
    noche aunque la escena esté casi a oscuras.
    """
    if log_mean <= 0 or key <= 0:
        return preset
    wanted = math.log2(key / log_mean)
    return round(min(preset + EXPOSURE_RANGE_STOPS, max(preset - EXPOSURE_RANGE_STOPS, wanted)), 2)


def bevel_radius(recipe: MaterialRecipe, single_sided: bool) -> float:
    """El bisel solo en sólidos cerrados (materiales de una cara).

    En superficies abiertas de doble cara (cortinas, hojas) el nodo Bevel encuentra la cara de
    enfrente dentro del radio y deja bandas negras.
    """
    return recipe.bevel if single_sided else 0.0


def clamp_roughness(value: float, recipe: MaterialRecipe) -> float:
    if recipe.roughness_min is not None:
        value = max(value, recipe.roughness_min)
    if recipe.roughness_max is not None:
        value = min(value, recipe.roughness_max)
    return value


# ---------------------------------------------------------------------------
# Color
# ---------------------------------------------------------------------------


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> Vec3:
    """`#rrggbb` (sRGB) → color lineal, que es lo que esperan las luces de Blender."""
    h = value.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


def kelvin_to_linear(kelvin: float) -> Vec3:
    """Color de una bombilla por su temperatura (aproximación de Tanner Helland), en lineal.

    Se normaliza para que el canal más alto sea 1: la potencia la pone el plan, no el color.
    """
    t = max(1000.0, min(40000.0, kelvin)) / 100
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * (t - 60) ** -0.1332047592
        g = 288.1221695283 * (t - 60) ** -0.0755148492
        b = 255.0
    rgb = [srgb_to_linear(max(0.0, min(255.0, c)) / 255) for c in (r, g, b)]
    top = max(rgb) or 1.0
    return (rgb[0] / top, rgb[1] / top, rgb[2] / top)


# ---------------------------------------------------------------------------
# Luz
# ---------------------------------------------------------------------------


def sun_rotation(direction: Vec3) -> float:
    """Azimut (rad) del cielo físico para un sol que viaja en `direction` (coordenadas Blender).

    El cielo Nishita mide el giro desde +Y hacia +X: el sol está en el lado opuesto al que va su luz.
    """
    to_sun_x, to_sun_y = -direction[0], -direction[1]
    if abs(to_sun_x) < 1e-9 and abs(to_sun_y) < 1e-9:
        return 0.0
    return math.atan2(to_sun_x, to_sun_y)


@dataclass(frozen=True)
class Portal:
    """Una luz portal del tamaño de la ventana, mirando hacia dentro del cuarto."""

    center: Vec3
    width: float
    height: float
    #: Hacia dónde emite (unitario, horizontal): del vidrio al interior.
    facing: Vec3


def portal_for(bbox_min: Vec3, bbox_max: Vec3, room_center: Vec3) -> Portal | None:
    """Portal de una ventana a partir de la caja de su vidrio (coordenadas Blender).

    El vidrio es una lámina: su eje más fino es la normal. Se emite hacia el centro del cuarto.
    """
    size = [bbox_max[i] - bbox_min[i] for i in range(3)]
    center = tuple((bbox_min[i] + bbox_max[i]) / 2 for i in range(3))
    if size[2] < 0.05:
        return None  # sin alto: no es una ventana
    thin = 0 if size[0] < size[1] else 1
    sign = 1.0 if room_center[thin] > center[thin] else -1.0
    facing: Vec3 = (sign, 0.0, 0.0) if thin == 0 else (0.0, sign, 0.0)
    width = size[1 - thin]
    if width < 0.05:
        return None
    return Portal(center=(center[0], center[1], center[2]), width=width, height=size[2], facing=facing)


#: Nombres que no son parte del cuarto en sí y se descartan al importar.
DROP_NAMES = ("contact-shadow", "corner-shade", "edge-shade", "gizmo", "guides", "selection-outline")


#: Colecciones del `.blend` exportado, en el orden en que aparecen en el Outliner.
COLLECTIONS = ("Cuarto", "Muebles", "Luces", "Cámara")
#: Texto que acompaña al .blend exportado (se ve en el editor de texto de Blender).
README_TEXT = """Escena exportada desde Interiores IA
====================================

Ya está todo listo: materiales, luces, cielo, cámara y ajustes de Cycles.

- F12: render final con Cycles (calidad final, con denoiser). Image > Save As para guardarlo.
- En el visor 3D, Z > Rendered: ver Cycles en vivo mientras mueves la cámara o cambias materiales.
- Numpad 0: volver a la vista de la cámara.

Colecciones: Cuarto (paredes, piso, techo, puertas y ventanas), Muebles (cada uno con su nombre
del catálogo), Luces (sol, lámparas, techo y portales de las ventanas) y Cámara.
La exposición ya viene medida para esta escena (Render > Color Management).
"""
#: Muestras del visor en modo Rendered: con el denoiser, suficiente para ver el resultado al abrir.
VIEWPORT_SAMPLES = 96


def collection_for(name: str, kind: str) -> str:
    """Colección de un objeto raíz de la escena: el cuarto, cada mueble, las luces y la cámara."""
    if kind == "LIGHT":
        return "Luces"
    if kind == "CAMERA":
        return "Cámara"
    return "Cuarto" if name.split(".")[0] == "room" else "Muebles"
