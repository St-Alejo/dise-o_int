"""Geometría de polígonos y distribución en cuartos de forma libre.

Los casos de `polygon-cases.json` los corre también Vitest contra la implementación de
TypeScript: si las dos geometrías dejan de coincidir, falla una de las dos suites.
"""

import json
import math
from pathlib import Path

import pytest

from interiores_ai.contracts import Opening, PlaceFurnitureRequest, RoomShell
from interiores_ai.layout.geometry import Footprint, overlaps
from interiores_ai.layout.polygon import (
    RoomGeometry,
    interior_anchor,
    is_convex_vertex,
    point_in_polygon,
    quad_inside_polygon,
    signed_area,
)
from interiores_ai.layout.rules_engine import RulesLayoutEngine, layer_of, wall_frame
from interiores_ai.providers.shell import polygon_shell, rectangular_shell

CASES = json.loads(
    (Path(__file__).resolve().parents[3] / "packages" / "shared-types" / "fixtures" / "polygon-cases.json").read_text(encoding="utf-8")
)


def poly(name: str) -> list[tuple[float, float]]:
    return [(x, z) for x, z in CASES["polygons"][name]]


@pytest.mark.parametrize("name", list(CASES["areas"]))
def test_area_esquinas_e_ids_de_pared(name):
    assert signed_area(poly(name)) == pytest.approx(CASES["areas"][name])
    assert [is_convex_vertex(poly(name), i) for i in range(len(poly(name)))] == CASES["convex"][name]
    assert [w.id for w in polygon_shell(poly(name), 2.6).walls] == CASES["wallIds"][name]


@pytest.mark.parametrize("case", CASES["points"], ids=lambda c: f"{c['polygon']}{c['p']}")
def test_punto_dentro_del_poligono(case):
    assert point_in_polygon(tuple(case["p"]), poly(case["polygon"]), 0.005) is case["inside"]


@pytest.mark.parametrize("case", CASES["quads"], ids=lambda c: f"{c['polygon']}{c['center']}{c['size']}")
def test_huella_dentro_del_poligono(case):
    cx, cz = case["center"]
    fp = Footprint.of(cx, cz, case["size"][0], case["size"][1], case["rotationY"])
    assert quad_inside_polygon(fp.corners, (cx, cz), poly(case["polygon"])) is case["inside"]


def test_el_sentido_de_giro_no_cambia_que_queda_dentro():
    reversed_l = list(reversed(poly("L")))
    assert signed_area(reversed_l) == pytest.approx(-17)
    assert point_in_polygon((1, 1), reversed_l)
    assert not point_in_polygon((4, 3.5), reversed_l)
    assert [w.id for w in polygon_shell(reversed_l, 2.6).walls] == CASES["wallIds"]["L"]


def test_el_punto_mas_despejado_cae_dentro():
    assert interior_anchor(poly("rect")) == (2.0, 1.5)
    assert point_in_polygon(interior_anchor(poly("U")), poly("U"))


def test_un_cuarto_rectangular_va_por_el_camino_de_siempre():
    box = RoomGeometry(rectangular_shell(4, 3, 2.6))
    assert box.is_box
    assert box.center == (2.0, 1.5)
    assert box.corners(0.5) == [(0.5, 0.5), (3.5, 0.5), (3.5, 2.5), (0.5, 2.5)]
    assert not RoomGeometry(polygon_shell(poly("L"), 2.6)).is_box


def test_las_normales_de_una_L_apuntan_al_cuarto():
    shell = polygon_shell(poly("L"), 2.6)
    room = RoomGeometry(shell)
    for wall in shell.walls:
        (sx, sz), (ux, uz, nx, nz), length = wall_frame(wall, shell)
        probe = (sx + ux * length / 2 + nx * 0.3, sz + uz * length / 2 + nz * 0.3)
        assert point_in_polygon(probe, room.poly), wall.id
    # Los rincones son las cinco esquinas salientes: la de la muesca no cuenta.
    assert len(room.corners(0.4)) == 5
    assert all(point_in_polygon(c, room.poly) for c in room.corners(0.4))


def shaped(name: str) -> RoomShell:
    """Cuarto de la forma pedida, a escala de vivienda, con ventana al fondo y puerta al frente."""
    points = [(x * 1.2, z * 1.2) for x, z in poly(name)]
    bare = polygon_shell(points, 2.6)
    front = next(w for w in bare.walls if w.id == "w-front")
    front_len = math.hypot(front.end.x - front.start.x, front.end.z - front.start.z)
    openings = [
        Opening(id="o-window-1", type="window", wallId="w-back", widthM=1.4, heightM=1.2, offsetM=bare.widthM / 2, sillHeightM=0.9),
        Opening(id="o-door-1", type="door", wallId="w-front", widthM=0.9, heightM=2.05, offsetM=front_len / 2, sillHeightM=0),
    ]
    return polygon_shell(points, 2.6, openings=openings, shape=name)  # type: ignore[arg-type]


@pytest.mark.parametrize("shape", ["L", "U"])
@pytest.mark.parametrize("room_type", ["living", "bedroom", "dining", "office"])
def test_distribuye_muebles_dentro_de_un_cuarto_de_forma_libre(catalog, shape, room_type):
    shell = shaped(shape)
    room = RoomGeometry(shell)
    req = PlaceFurnitureRequest(roomShell=shell, roomType=room_type, styleId="moderno", candidates=catalog, locked=[], seed=1)
    result = RulesLayoutEngine().place(req)
    assert result.placements, "no colocó nada"
    by_id = {c.id: c for c in catalog}
    fps = []
    for p in result.placements:
        item = by_id[p.catalogItemId]
        fp = Footprint.of(p.position.x, p.position.z, item.dimensionsM.x, item.dimensionsM.z, p.rotationY)
        assert room.inside(fp), f"{p.catalogItemId} quedó fuera del cuarto (o en la muesca)"
        fps.append((p, item, fp))
    for i, (p, item, fp) in enumerate(fps):
        for q, other, fp2 in fps[i + 1 :]:
            if layer_of(item) == layer_of(other):
                assert not overlaps(fp, fp2), f"{p.catalogItemId} se solapa con {q.catalogItemId}"
    main = {"living": "sofa", "bedroom": "cama", "dining": "mesa-comedor", "office": "escritorio"}[room_type]
    assert any(p.catalogItemId.startswith(main) for p in result.placements)
