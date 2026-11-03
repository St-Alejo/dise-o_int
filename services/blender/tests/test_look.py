import math

import pytest

from interiores_blender.look import (
    MaterialRecipe,
    bevel_radius,
    camera_sees_through_back,
    clamp_roughness,
    hex_to_linear,
    kelvin_to_linear,
    portal_for,
    recipe_for,
    sun_rotation,
    to_blender,
)
from interiores_blender.progress import progress_pct


def test_three_a_blender_como_el_importador_gltf() -> None:
    # Y arriba en three → Z arriba en Blender; el fondo (z negativa en three) es +Y en Blender.
    assert to_blender({"x": 1.0, "y": 2.0, "z": 3.0}) == (1.0, -3.0, 2.0)


@pytest.mark.parametrize(
    ("role", "material", "check"),
    [
        ("window-glass", "glass", lambda r: r.shadow_transparent and r.transmission == 1.0),
        ("lamp-shade", "fabric", lambda r: r.translucency > 0.3),
        ("furniture", "fabric", lambda r: r.sheen > 0 and r.bevel > 0),
        ("furniture", "metal", lambda r: r.metallic == 1.0),
        ("furniture", "other", lambda r: r.bevel > 0),
        ("wall", "paint", lambda r: r.micro_bump > 0 and (r.roughness_min or 0) >= 0.8),
        ("wall", None, lambda r: r.micro_bump > 0),
        ("floor", "tile", lambda r: r.coat > 0),
    ],
)
def test_receta_por_papel_y_material(role: str, material: str | None, check: object) -> None:
    assert callable(check)
    assert check(recipe_for(role, material))


def test_material_desconocido_no_toca_nada() -> None:
    assert recipe_for("other", "marciano") == MaterialRecipe()


def test_rugosidad_acotada_por_la_receta() -> None:
    metal = recipe_for("furniture", "metal")
    assert clamp_roughness(0.0, metal) == metal.roughness_min
    assert clamp_roughness(1.0, metal) == metal.roughness_max
    assert clamp_roughness(0.3, MaterialRecipe()) == 0.3


def test_colores_lineales() -> None:
    assert hex_to_linear("#ffffff") == pytest.approx((1.0, 1.0, 1.0))
    assert hex_to_linear("#000000") == (0.0, 0.0, 0.0)
    # El gris medio sRGB es mucho más oscuro en lineal.
    assert hex_to_linear("#808080")[0] == pytest.approx(0.2158, abs=1e-3)


def test_bombilla_calida_es_mas_roja_que_fria() -> None:
    warm = kelvin_to_linear(2700)
    cold = kelvin_to_linear(6500)
    assert max(warm) == pytest.approx(1.0)
    assert warm[2] < warm[0]
    assert warm[2] / warm[0] < cold[2] / cold[0]


def test_azimut_del_sol_opuesto_a_su_luz() -> None:
    # La luz viaja hacia -Y (hacia el espectador): el sol está al fondo, en +Y → giro 0.
    assert sun_rotation((0.0, -1.0, -1.0)) == pytest.approx(0.0)
    # Viaja hacia -X: el sol está en +X → +90°.
    assert sun_rotation((-1.0, 0.0, -0.5)) == pytest.approx(math.pi / 2)
    assert sun_rotation((0.0, 0.0, -1.0)) == 0.0


def test_portal_mira_hacia_el_cuarto() -> None:
    # Vidrio en la pared x=0 (fino en X), cuarto hacia +X.
    portal = portal_for((-0.01, 1.0, 0.9), (0.01, 2.2, 2.1), (2.0, 2.5, 1.35))
    assert portal is not None
    assert portal.facing == (1.0, 0.0, 0.0)
    assert portal.width == pytest.approx(1.2)
    assert portal.height == pytest.approx(1.2)
    # Vidrio en la pared del fondo (fino en Y), cuarto hacia -Y.
    back = portal_for((1.0, 5.49, 1.0), (2.0, 5.51, 2.0), (2.0, 2.5, 1.35))
    assert back is not None and back.facing == (0.0, -1.0, 0.0)


def test_sin_alto_no_hay_portal() -> None:
    assert portal_for((0, 0, 0), (0.01, 1, 0.01), (1, 1, 1)) is None


@pytest.mark.parametrize(
    ("line", "pct"),
    [
        ("Fra:1 Mem:120M | Time:00:01.20 | Scene, ViewLayer | Sample 0/512", 8),
        ("Fra:1 | Scene, ViewLayer | Sample 256/512", 52),
        ("Fra:1 | Scene, ViewLayer | Sample 512/512", 95),
        ("Fra:1 | Loading render kernels (may take a few minutes the first time)", 3),
        ("Fra:1 | Loading denoising kernels", 95),
        ("Saved: '/tmp/x.png'", None),
    ],
)
def test_avance_desde_la_salida_de_blender(line: str, pct: int | None) -> None:
    assert progress_pct(line) == pct


def test_la_camara_atraviesa_el_reves_de_lo_opaco_como_en_el_visor() -> None:
    assert camera_sees_through_back("ceiling", single_sided=True)
    assert camera_sees_through_back("wall", single_sided=True)
    # Un mueble con una tapa de menos: el visor deja ver lo de atrás, no su interior oscuro.
    assert camera_sees_through_back("furniture", single_sided=True)
    # Un material de doble cara se ve igual por los dos lados en el visor.
    assert not camera_sees_through_back("wall", single_sided=False)
    assert not camera_sees_through_back("window-glass", single_sided=True)
    assert not camera_sees_through_back("lamp-shade", single_sided=True)
    assert not camera_sees_through_back(None, single_sided=True)


def test_sin_bisel_en_superficies_abiertas() -> None:
    tela = recipe_for("furniture", "fabric")
    assert bevel_radius(tela, single_sided=True) == tela.bevel > 0
    # Cortinas: doble cara, el bisel las manchaba de negro.
    assert bevel_radius(tela, single_sided=False) == 0.0
