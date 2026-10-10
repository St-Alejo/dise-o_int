import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from interiores_ai.contracts import (
    Dimensions,
    FurniturePlacement,
    LayoutCandidate,
    PlaceFurnitureRequest,
    RoomType,
    Vector3,
)
from interiores_ai.layout.geometry import Footprint, forward, inside, overlaps
from interiores_ai.layout.rules_engine import RulesLayoutEngine, layer_of
from interiores_ai.providers.shell import rectangular_shell

engine = RulesLayoutEngine()


def run(catalog: list[LayoutCandidate], room: RoomType, w: float = 4.5, d: float = 4.0, style: str = "moderno", locked=None):
    shell = rectangular_shell(w, d, 2.6, windows=[(0.5, 1.4, 1.2, 0.9)])
    req = PlaceFurnitureRequest(roomShell=shell, roomType=room, styleId=style, candidates=catalog, locked=locked or [], seed=1)  # type: ignore[arg-type]
    return shell, engine.place(req)


def footprints(result, catalog):
    by_id = {c.id: c for c in catalog}
    out = []
    for p in result.placements:
        item = by_id[p.catalogItemId]
        out.append((p, item, Footprint.of(p.position.x, p.position.z, item.dimensionsM.x, item.dimensionsM.z, p.rotationY)))
    return out


def assert_valid(shell, result, catalog):
    fps = footprints(result, catalog)
    for i, (p, item, fp) in enumerate(fps):
        assert inside(fp, shell.widthM, shell.depthM), f"{p.catalogItemId} fuera del cuarto"
        for q, other, fp2 in fps[i + 1 :]:
            if layer_of(item) == layer_of(other):
                assert not overlaps(fp, fp2), f"{p.catalogItemId} se solapa con {q.catalogItemId}"


@pytest.mark.parametrize("room", ["living", "bedroom", "dining", "office"])
def test_cada_tipo_de_cuarto_coloca_su_mueble_principal_sin_colisiones(catalog, room):
    shell, result = run(catalog, room)
    assert result.unplaced == []
    assert result.score == 1.0
    assert_valid(shell, result, catalog)
    main = {"living": "sofa", "bedroom": "cama", "dining": "mesa-comedor", "office": "escritorio"}[room]
    assert any(p.catalogItemId.startswith(main) for p in result.placements)


def test_prefiere_muebles_del_estilo_elegido(catalog):
    _, moderno = run(catalog, "living", style="moderno")
    _, clasico = run(catalog, "living", style="clasico")
    assert any(p.catalogItemId == "sofa-moderno" for p in moderno.placements)
    assert any(p.catalogItemId == "sofa-clasico" for p in clasico.placements)


def test_sala_la_mesa_de_centro_queda_frente_al_sofa(catalog):
    _, result = run(catalog, "living")
    sofa = next(p for p in result.placements if p.catalogItemId.startswith("sofa"))
    table = next(p for p in result.placements if p.catalogItemId == "mesa-centro")
    fx, fz = forward(sofa.rotationY)
    along = (table.position.x - sofa.position.x) * fx + (table.position.z - sofa.position.z) * fz
    assert 0.5 < along < 1.8


def test_el_sofa_va_contra_una_pared_y_mira_hacia_adentro(catalog):
    shell, result = run(catalog, "living")
    sofa = next(p for p in result.placements if p.catalogItemId.startswith("sofa"))
    fx, fz = forward(sofa.rotationY)
    to_center = (shell.widthM / 2 - sofa.position.x, shell.depthM / 2 - sofa.position.z)
    assert fx * to_center[0] + fz * to_center[1] > 0
    fp = Footprint.of(sofa.position.x, sofa.position.z, 2.0, 0.9, sofa.rotationY)
    min_x, min_z, max_x, max_z = fp.bounds()
    assert min(min_x, min_z, shell.widthM - max_x, shell.depthM - max_z) < 0.05


def test_dormitorio_mesitas_a_ambos_lados_de_la_cama(catalog):
    _, result = run(catalog, "bedroom")
    assert sum(p.catalogItemId == "mesita" for p in result.placements) == 2


def test_comedor_sillas_alrededor_y_mirando_la_mesa(catalog):
    _, result = run(catalog, "dining", w=4.5, d=4.5)
    table = next(p for p in result.placements if p.catalogItemId == "mesa-comedor")
    chairs = [p for p in result.placements if p.catalogItemId == "silla"]
    assert len(chairs) >= 4
    for c in chairs:
        fx, fz = forward(c.rotationY)
        assert fx * (table.position.x - c.position.x) + fz * (table.position.z - c.position.z) > 0


def test_la_lampara_de_techo_queda_colgada_del_techo(catalog):
    shell, result = run(catalog, "living")
    lamp = next(p for p in result.placements if p.catalogItemId == "colgante")
    assert lamp.position.y == pytest.approx(shell.heightM - 0.5)


def test_nunca_bloquea_la_puerta(catalog):
    shell, result = run(catalog, "living", w=3.2, d=3.0)
    door = next(o for o in shell.openings if o.type == "door")
    # w-front va de (w, d) a (0, d); el centro de la puerta está a offsetM desde (w, d).
    door_x = shell.widthM - door.offsetM
    zone = Footprint.rect(door_x - door.widthM / 2, shell.depthM - 0.9, door_x + door.widthM / 2, shell.depthM)
    for p, item, fp in footprints(result, catalog):
        if layer_of(item) == "floor":
            assert not overlaps(fp, zone, 0.0), f"{p.catalogItemId} bloquea la puerta"


def test_respeta_muebles_bloqueados_y_no_duplica_su_rol(catalog):
    locked = [
        FurniturePlacement(
            id="mio", catalogItemId="sofa-clasico", position=Vector3(x=2.25, y=0, z=0.5), rotationY=0, lockedByUser=True
        )
    ]
    shell, result = run(catalog, "living", locked=locked)
    assert not any(p.catalogItemId.startswith("sofa") for p in result.placements)
    assert all(p.id != "mio" for p in result.placements)
    sofa_fp = Footprint.of(2.25, 0.5, 2.2, 0.95, 0)
    for p, item, fp in footprints(result, catalog):
        if layer_of(item) == "floor":
            assert not overlaps(fp, sofa_fp)


def test_cuarto_diminuto_reporta_lo_que_no_cabe(catalog):
    _, result = run([c for c in catalog if c.id == "sofa-clasico"], "living", w=2.0, d=1.6)
    assert "sofa" in result.unplaced
    assert result.score < 1


def test_los_muebles_altos_no_van_en_la_pared_de_la_camara(catalog):
    shell, result = run(catalog, "living", w=5.0, d=4.5)
    shelf = next(p for p in result.placements if p.catalogItemId == "estanteria")
    assert shelf.position.z < shell.depthM - 0.5, "la estantería alta tapa la vista desde la cámara"


def test_es_determinista_con_la_misma_semilla(catalog):
    _, a = run(catalog, "living")
    _, b = run(catalog, "living")
    assert a == b


@settings(max_examples=60, deadline=None)
@given(
    w=st.floats(min_value=2.4, max_value=7.0),
    d=st.floats(min_value=2.4, max_value=7.0),
    room=st.sampled_from(["living", "bedroom", "dining", "office"]),
)
def test_invariante_sin_solapes_y_todo_dentro(w, d, room):
    from tests.conftest import cand

    catalog = [
        cand("sofa", "sofa", None, (2.0, 0.8, 0.9), ["moderno"]),
        cand("mesa-centro", "table", "coffee-table", (1.1, 0.4, 0.6), ["moderno"]),
        cand("butaca", "chair", "armchair", (0.8, 0.9, 0.8), ["moderno"]),
        cand("cama", "bed", None, (1.6, 1.0, 2.1), ["moderno"]),
        cand("mesita", "table", "nightstand", (0.45, 0.55, 0.4), ["moderno"]),
        cand("mesa-comedor", "table", "dining-table", (1.6, 0.76, 0.9), ["moderno"]),
        cand("silla", "chair", "dining-chair", (0.45, 0.9, 0.5), ["moderno"]),
        cand("escritorio", "table", "desk", (1.2, 0.75, 0.6), ["moderno"]),
        cand("planta", "decor", "plant", (0.5, 1.2, 0.5), ["moderno"]),
        cand("alfombra", "decor", "rug", (2.0, 0.01, 1.4), ["moderno"]),
    ]
    shell, result = run(catalog, room, w=w, d=d)
    assert_valid(shell, result, catalog)
    for p in result.placements:
        assert math.isfinite(p.position.x) and math.isfinite(p.position.z)


def test_objetos_de_pared_y_superficie_no_se_autocolocan(catalog):
    extra = [
        *catalog,
        LayoutCandidate(id="cuadro", category="wall-decor", styleTags=["moderno"], dimensionsM=Vector3(x=0.8, y=0.6, z=0.04), mount="wall"),
        LayoutCandidate(
            id="lampara-mesa",
            category="lighting",
            subcategory="table-lamp",
            styleTags=["moderno"],
            dimensionsM=Vector3(x=0.3, y=0.5, z=0.3),
            mount="surface",
        ),
    ]
    shell, result = run(extra, "living")
    ids = {p.catalogItemId for p in result.placements}
    assert "cuadro" not in ids
    assert "lampara-mesa" not in ids
    assert result.unplaced == []
    assert_valid(shell, result, extra)


def test_respeta_las_medidas_propias_de_un_mueble_fijado(catalog):
    sofa = next(c for c in catalog if c.category == "sofa")
    big = FurniturePlacement(
        id="u1",
        catalogItemId=sofa.id,
        position=Vector3(x=2.25, y=0, z=2.0),
        rotationY=0,
        lockedByUser=True,
        dimensionsM=Dimensions(x=3.0, y=0.8, z=1.6),
        materials={"tapizado": "fabric-wool-grey"},
        origin="user",
    )
    _, result = run(catalog, "living", locked=[big])
    big_fp = Footprint.of(2.25, 2.0, 3.0, 1.6, 0)
    by_id = {c.id: c for c in catalog}
    for p in result.placements:
        item = by_id[p.catalogItemId]
        if p.id == "u1" or layer_of(item) != "floor":
            continue
        fp = Footprint.of(p.position.x, p.position.z, item.dimensionsM.x, item.dimensionsM.z, p.rotationY)
        assert not overlaps(fp, big_fp), f"{p.catalogItemId} invade el sofá agrandado"


def test_la_respuesta_no_envia_nulls_de_campos_opcionales(catalog):
    _, result = run(catalog, "bedroom")
    dumped = result.model_dump(mode="json", exclude_none=True)
    for p in dumped["placements"]:
        assert "dimensionsM" not in p
        assert "origin" not in p


def test_el_cascaron_descarta_ventanas_duplicadas_o_solapadas():
    # Regresión: el detector devolvía la misma ventana dos veces y el cuarto quedaba con
    # aberturas superpuestas (el API las rechaza al cambiar las medidas).
    shell = rectangular_shell(3.0, 3.0, 2.6, windows=[(0.7, 1.2, 1.0, 0.9), (0.7, 1.2, 1.0, 0.9), (0.75, 1.0, 1.0, 0.9)])
    windows = [o for o in shell.openings if o.type == "window"]
    assert len(windows) == 1


def test_el_cascaron_conserva_ventanas_separadas():
    shell = rectangular_shell(6.0, 3.0, 2.6, windows=[(0.2, 1.0, 1.0, 0.9), (0.8, 1.0, 1.0, 0.9)])
    assert [o.id for o in shell.openings if o.type == "window"] == ["o-window-1", "o-window-2"]


# ---------------------------------------------------------------- otra distribución (semilla)
def seeded(catalog, room: RoomType, seed: int | None, w: float = 5.0, d: float = 4.5):
    shell = rectangular_shell(w, d, 2.6, windows=[(0.5, 1.4, 1.2, 0.9)])
    req = PlaceFurnitureRequest(roomShell=shell, roomType=room, styleId="moderno", candidates=catalog, locked=[], seed=seed)
    return shell, engine.place(req)


def signature(result) -> tuple:
    return tuple(sorted((p.catalogItemId, round(p.position.x, 1), round(p.position.z, 1), round(p.rotationY, 1)) for p in result.placements))


@pytest.mark.parametrize("room", ["living", "bedroom", "dining", "office"])
def test_cada_semilla_da_otra_distribucion_igual_de_valida(catalog, room):
    seen = set()
    for seed in range(8):
        shell, result = seeded(catalog, room, seed)
        assert result.unplaced == [], f"semilla {seed}"
        assert_valid(shell, result, catalog)
        seen.add(signature(result))
    assert len(seen) >= 3, "las semillas deberían producir varias distribuciones distintas"


def test_la_misma_semilla_repite_la_distribucion_y_sin_semilla_sale_siempre_la_mejor(catalog):
    assert signature(seeded(catalog, "living", 5)[1]) == signature(seeded(catalog, "living", 5)[1])
    assert signature(seeded(catalog, "living", None)[1]) == signature(seeded(catalog, "living", None)[1])


def test_una_variante_no_rompe_las_reglas_duras(catalog):
    for seed in range(12):
        shell, result = seeded(catalog, "living", seed)
        door = next(o for o in shell.openings if o.type == "door")
        door_x = shell.widthM - door.offsetM
        zone = Footprint.rect(door_x - door.widthM / 2, shell.depthM - 0.9, door_x + door.widthM / 2, shell.depthM)
        for p, item, fp in footprints(result, catalog):
            if layer_of(item) == "floor":
                assert not overlaps(fp, zone, 0.0), f"semilla {seed}: {p.catalogItemId} bloquea la puerta"
        # Los muebles altos siguen lejos de la pared de la cámara.
        shelf = next((p for p in result.placements if p.catalogItemId == "estanteria"), None)
        assert shelf is None or shelf.position.z < shell.depthM - 0.5, f"semilla {seed}"
