"""Test de contrato: lo que encola la API y lo que devuelve el nodo cumplen los schemas de zod.

El JSON Schema lo exporta `npm run schema -w @interiores/shared-types`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from interiores_blender.contracts import BlenderJob, BlenderResult, Heartbeat
from interiores_blender.worker import heartbeat_payload

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "packages" / "shared-types" / "generated" / "blender-contract.schema.json"
JOB: dict[str, Any] = json.loads(Path(__file__).with_name("fixtures").joinpath("job.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def schemas() -> dict[str, Any]:
    if not SCHEMA_PATH.exists():
        pytest.skip("Falta el JSON Schema exportado (npm run schema -w @interiores/shared-types)")
    loaded: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["schemas"]
    return loaded


def check(schemas: dict[str, Any], name: str, payload: Any) -> None:
    errors = sorted(Draft202012Validator(schemas[name]).iter_errors(payload), key=str)
    assert not errors, f"{name}: " + "; ".join(e.message for e in errors[:5])


def test_el_trabajo_de_ejemplo_es_uno_que_la_api_encolaria(schemas: dict[str, Any]) -> None:
    check(schemas, "BlenderJob", JOB)
    assert BlenderJob.model_validate(JOB).plan == JOB["plan"]


def test_lo_que_devuelve_el_nodo_lo_acepta_la_api(schemas: dict[str, Any]) -> None:
    prefix = JOB["outputPrefix"]
    for blend in (f"{prefix}.blend", None):
        result = BlenderResult(imageKey=f"{prefix}.png", previewKey=f"{prefix}.jpg", blendKey=blend, seconds=12.5, device="CUDA")
        check(schemas, "BlenderResult", result.model_dump())
    check(schemas, "RenderNodeHeartbeat", Heartbeat.model_validate_json(heartbeat_payload("OPTIX")).model_dump())


def test_python_pide_los_mismos_campos_que_typescript(schemas: dict[str, Any]) -> None:
    for name, model in (("BlenderJob", BlenderJob), ("BlenderResult", BlenderResult), ("RenderNodeHeartbeat", Heartbeat)):
        assert set(model.model_fields) == set(schemas[name]["properties"]), name
