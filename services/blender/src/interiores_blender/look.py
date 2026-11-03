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


#: La "caja" del cuarto: en el visor se dibuja por una sola cara, así que desde fuera no tapa la vista.
SHELL_ROLES = frozenset({"wall", "ceiling", "floor", "trim"})


def camera_sees_through_back(role: str | None, single_sided: bool) -> bool:
    """¿La cámara debe atravesar la cara trasera de esta superficie?

    Con la cámara fuera del cuarto (la vista general desde arriba) el visor no dibuja el revés del
    techo ni de las paredes; Cycles dibuja las dos caras y el techo taparía todo. Solo para la cámara:
    para la luz siguen siendo sólidas y el techo sigue dando sombra.
    """
    return single_sided and role in SHELL_ROLES


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
