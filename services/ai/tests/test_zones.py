from interiores_ai.contracts import (
    FurniturePlacement,
    LayoutCandidate,
    PlaceFurnitureRequest,
    Point2,
    Vector3,
    Zone,
    ZoneDoor,
)
from interiores_ai.layout.geometry import Footprint, overlaps
from interiores_ai.layout.polygon import RoomGeometry, point_in_polygon
from interiores_ai.layout.rules_engine import RulesLayoutEngine, layer_of
from interiores_ai.layout.zones import PARTITION_THICKNESS_M, touches_zone, zone_edges, zone_poly, zone_shell
from interiores_ai.providers.shell import rectangular_shell

from .conftest import cand

engine = RulesLayoutEngine()

# Baño privado de 2 × 1,6 m en el rincón del fondo a la derecha (lejos de la puerta del cuarto),
# con el mismo sentido de giro que el cuarto y la puerta en el tabique largo.
BATH = Zone(
    id="bano",
    kind="bathroom",
    outline=[Point2(x=2.5, z=0), Point2(x=4.5, z=0), Point2(x=4.5, z=1.6), Point2(x=2.5, z=1.6)],
    door=ZoneDoor(edge=2, offsetM=1.0, widthM=0.7),
)

BATH_ITEMS = [
    cand("ducha", "bathroom", "shower", (0.8, 2.1, 0.8), ["moderno"]),
    cand("lavabo", "bathroom", "vanity", (0.7, 0.85, 0.45), ["moderno"]),
    cand("inodoro", "bathroom", "toilet", (0.38, 0.8, 0.65), ["moderno"]),
]


def shell_with_bath():
    base = rectangular_shell(4.5, 4.0, 2.6, windows=[(0.2, 1.0, 1.2, 0.9)])
    return base.model_copy(update={"zones": [BATH]})


def place(catalog: list[LayoutCandidate], room="bedroom", locked=None, must_have=None, seed=1):
    shell = shell_with_bath()
    req = PlaceFurnitureRequest(
        roomShell=shell,
        roomType=room,
        styleId="moderno",
        candidates=catalog + BATH_ITEMS,
        locked=locked or [],
        seed=seed,
        mustHave=must_have,
    )  # type: ignore[arg-type]
    return shell, engine.place(req)


def fp_of(p: FurniturePlacement, items: dict[str, LayoutCandidate]) -> Footprint:
    d = items[p.catalogItemId].dimensionsM
    return Footprint.of(p.position.x, p.position.z, d.x, d.z, p.rotationY)


def test_la_zona_es_un_cuarto_con_los_tabiques_corridos_y_su_puerta():
    shell = shell_with_bath()
    edges = zone_edges(shell, BATH)
    assert [e.partition for e in edges] == [False, False, True, True]
    sub = zone_shell(shell, BATH)
    room = RoomGeometry(sub)
    # El tabique de x = 2,5 y el de z = 1,6 se corren medio espesor hacia dentro.
    xs = sorted({round(w.start.x, 3) for w in sub.walls})
    zs = sorted({round(w.start.z, 3) for w in sub.walls})
    assert xs == [round(2.5 + PARTITION_THICKNESS_M / 2, 3), 4.5]
    assert zs == [0.0, round(1.6 - PARTITION_THICKNESS_M / 2, 3)]
    assert room.center[0] > 2.5
    doors = [o for o in sub.openings if o.type == "door"]
    assert len(doors) == 1 and doors[0].wallId == sub.walls[2].id


def test_el_bano_privado_se_distribuye_dentro_y_el_dormitorio_fuera(catalog):
    shell, result = place(catalog)
    items = {c.id: c for c in catalog + BATH_ITEMS}
    poly = zone_poly(BATH)
    by_id = {p.catalogItemId: p for p in result.placements}
    for fixture in ("lavabo", "inodoro"):
        assert fixture in by_id, result.unplaced
        p = by_id[fixture]
        assert point_in_polygon((p.position.x, p.position.z), poly), fixture
        # Y entero dentro de la cara de los tabiques.
        assert RoomGeometry(zone_shell(shell, BATH)).inside(fp_of(p, items))
    assert "cama" in by_id
    for p in result.placements:
        if p.catalogItemId in {"ducha", "lavabo", "inodoro"}:
            continue
        if layer_of(items[p.catalogItemId]) in ("floor", "rug"):
            assert not touches_zone(fp_of(p, items), poly), f"{p.catalogItemId} invade el baño"


def test_nada_tapa_la_puerta_del_bano_por_fuera(catalog):
    _, result = place(catalog)
    items = {c.id: c for c in catalog + BATH_ITEMS}
    # Paso de 0,9 m delante del vano (x de 3,15 a 3,85; z de 1,7 a 2,5).
    door_way = Footprint.rect(3.15, 1.7, 3.85, 2.5)
    for p in result.placements:
        if layer_of(items[p.catalogItemId]) == "floor":
            assert not overlaps(fp_of(p, items), door_way, 0.0), p.catalogItemId


def test_sin_solapes_entre_las_partes(catalog):
    _, result = place(catalog, seed=5)
    items = {c.id: c for c in catalog + BATH_ITEMS}
    fps = [(p, fp_of(p, items)) for p in result.placements]
    for i, (p, a) in enumerate(fps):
        for q, b in fps[i + 1 :]:
            if layer_of(items[p.catalogItemId]) == layer_of(items[q.catalogItemId]):
                assert not overlaps(a, b), (p.catalogItemId, q.catalogItemId)


def test_una_pieza_fijada_en_el_bano_cuenta_para_el_bano(catalog):
    locked = [
        FurniturePlacement(
            id="fijo",
            catalogItemId="inodoro",
            position=Vector3(x=4.1, y=0, z=0.9),
            rotationY=-1.5707963,
            lockedByUser=True,
        )
    ]
    _, result = place(catalog, locked=locked)
    # El inodoro ya está: no se pone otro.
    assert [p.catalogItemId for p in result.placements].count("inodoro") == 0


def test_el_tocador_va_si_la_persona_lo_pide(catalog):
    tocador = cand("tocador", "table", "dressing-table", (1.0, 1.45, 0.45), ["moderno"])
    _, sin = place([*catalog, tocador])
    assert "tocador" not in {p.catalogItemId for p in sin.placements}
    _, con = place([*catalog, tocador], must_have=["dressing-table"])
    assert "tocador" in {p.catalogItemId for p in con.placements}
