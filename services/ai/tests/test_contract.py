"""Test de contrato: los modelos Pydantic deben producir/aceptar lo mismo que los schemas zod.

El JSON Schema lo exporta `npm run schema -w @interiores/shared-types`. Si alguien cambia el
contrato en TypeScript sin actualizar Python (o al revés), este test falla en CI.
"""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from interiores_ai.contracts import (
    AnalyzeRoomRequest,
    AnalyzeRoomResponse,
    DetectedObject,
    GenerateStyleRequest,
    GenerateStyleResponse,
    PlaceFurnitureRequest,
)
from interiores_ai.layout.rules_engine import RulesLayoutEngine
from interiores_ai.providers.shell import rectangular_shell

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "packages" / "shared-types" / "generated" / "ai-contract.schema.json"


@pytest.fixture(scope="module")
def schemas() -> dict[str, dict]:
    if not SCHEMA_PATH.exists():
        pytest.skip("Falta el JSON Schema exportado (npm run schema -w @interiores/shared-types)")
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["schemas"]


def check(schemas: dict[str, dict], name: str, payload: dict) -> None:
    errors = sorted(Draft202012Validator(schemas[name]).iter_errors(payload), key=str)
    assert not errors, f"{name}: " + "; ".join(e.message for e in errors[:5])


def test_respuestas_de_python_cumplen_el_schema_de_typescript(schemas, catalog):
    shell = rectangular_shell(4.2, 3.6, 2.6, windows=[(0.5, 1.2, 1.2, 0.9)])
    analyze = AnalyzeRoomResponse(
        roomShell=shell,
        detectedObjects=[DetectedObject(label="mueble", confidence=0.3, bbox=(0.1, 0.5, 0.4, 0.8))],
        provider="mock",
        durationMs=12,
    )
    # Igual que los endpoints (response_model_exclude_none): los opcionales ausentes no viajan.
    check(schemas, "AnalyzeRoomResponse", analyze.model_dump(mode="json", exclude_none=True))
    check(schemas, "GenerateStyleResponse", GenerateStyleResponse(imageKey="projects/a.jpg", provider="mock", durationMs=5).model_dump(mode="json"))

    req = PlaceFurnitureRequest(roomShell=shell, roomType="living", styleId="moderno", candidates=catalog, locked=[])
    placed = RulesLayoutEngine().place(req)
    check(schemas, "PlaceFurnitureResponse", placed.model_dump(mode="json", exclude_none=True))


def test_peticiones_de_typescript_se_aceptan_en_python(schemas, catalog):
    shell = rectangular_shell(4, 3, 2.5).model_dump(mode="json", exclude_none=True)
    samples = {
        "AnalyzeRoomRequest": (AnalyzeRoomRequest, {"photoKey": "projects/p/source.jpg", "roomType": "bedroom"}),
        "GenerateStyleRequest": (
            GenerateStyleRequest,
            {"photoKey": "k", "outputKey": "projects/o.jpg", "styleId": "bohemio", "roomType": "living", "promptStrength": 0.6},
        ),
        "PlaceFurnitureRequest": (
            PlaceFurnitureRequest,
            {"roomShell": shell, "roomType": "office", "styleId": None, "candidates": [c.model_dump(mode="json", exclude_none=True) for c in catalog[:3]], "locked": []},
        ),
    }
    for name, (model, payload) in samples.items():
        check(schemas, name, payload)  # válido para zod…
        model.model_validate(payload)  # …y para Pydantic


def test_enums_coinciden(schemas):
    style_enum = schemas["GenerateStyleRequest"]["properties"]["styleId"]["enum"]
    room_enum = schemas["GenerateStyleRequest"]["properties"]["roomType"]["enum"]
    from typing import get_args

    from interiores_ai.contracts import RoomType, StyleId

    assert sorted(style_enum) == sorted(get_args(StyleId))
    assert sorted(room_enum) == sorted(get_args(RoomType))
