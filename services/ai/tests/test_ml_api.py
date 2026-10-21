"""Endpoints de los modelos propios y su contrato con TypeScript."""

import json

import pytest
from fastapi.testclient import TestClient

from interiores_ai.config import Settings
from interiores_ai.container import Container
from interiores_ai.contracts import (
    AnalyzeReferenceResponse,
    NluParseResponse,
    RankRecommendationsRequest,
    RankRecommendationsResponse,
)
from interiores_ai.layout.rules_engine import RulesLayoutEngine
from interiores_ai.main import create_app
from interiores_ai.ml import dataset
from interiores_ai.ml.nlu import IntentModel, IntentService
from interiores_ai.providers.room_mock import MockRoomAnalyzer
from interiores_ai.providers.style_mock import MockStyleGenerator
from interiores_ai.storage import MemoryStorage
from tests.conftest import TOKEN
from tests.test_contract import SCHEMA_PATH, check

AUTH = {"authorization": f"Bearer {TOKEN}"}


@pytest.fixture(scope="module")
def contract() -> dict[str, dict]:
    if not SCHEMA_PATH.exists():
        pytest.skip("Falta el JSON Schema exportado (npm run schema -w @interiores/shared-types)")
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["schemas"]


@pytest.fixture(scope="module")
def small_model() -> IntentModel:
    return IntentModel.train(dataset.generate(200, seed=7))


@pytest.fixture
def ml_client(settings: Settings, storage: MemoryStorage, small_model: IntentModel) -> TestClient:
    intents = IntentService(None)
    intents._model = small_model
    container = Container(settings=settings, storage=storage, room_analyzer=MockRoomAnalyzer(), style_generator=MockStyleGenerator(), layout_engine=RulesLayoutEngine(), intents=intents)
    with TestClient(create_app(container)) as c:
        yield c  # type: ignore[misc]


def test_nlu_parse_devuelve_intencion_confianza_y_parametros(ml_client: TestClient, contract: dict[str, dict]) -> None:
    r = ml_client.post("/v1/nlu/parse", json={"text": "piso de baldosa brillante azul claro con verde"}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["intent"] == "set_floor"
    assert body["slots"]["surface"] == "floor"
    assert [c["hex"] for c in body["slots"]["colors"]] == ["#a9d4ee", "#4f8a52"]
    assert body["model"].startswith("nlu-1-")
    NluParseResponse.model_validate(body)
    check(contract, "NluParseResponse", body)
    assert ml_client.post("/v1/nlu/parse", json={"text": ""}, headers=AUTH).status_code == 422
    assert ml_client.post("/v1/nlu/parse", json={"text": "hola"}).status_code == 401


def test_rank_ordena_por_lo_aprendido(ml_client: TestClient, contract: dict[str, dict]) -> None:
    like = {"style:bohemio": 1.0}
    dislike = {"style:moderno": 1.0}
    body = {
        "candidates": [{"id": "a", "features": dislike, "prior": 1.1}, {"id": "b", "features": like, "prior": 1.0}],
        "history": [{"features": like, "action": "like"}] * 4 + [{"features": dislike, "action": "dislike"}] * 3,
    }
    check(contract, "RankRecommendationsRequest", body)
    RankRecommendationsRequest.model_validate(body)
    r = ml_client.post("/v1/recommend/rank", json=body, headers=AUTH)
    assert r.status_code == 200, r.text
    out = r.json()
    check(contract, "RankRecommendationsResponse", out)
    RankRecommendationsResponse.model_validate(out)
    assert out["model"] == "logreg"
    assert out["scores"]["b"] > out["scores"]["a"]


def test_referencia_por_colores_sin_vision(ml_client: TestClient, contract: dict[str, dict]) -> None:
    r = ml_client.post("/v1/reference/analyze", json={"imageKey": "projects/p1/source.jpg"}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "colors"
    assert body["floor"]["colors"]
    check(contract, "AnalyzeReferenceResponse", body)
    AnalyzeReferenceResponse.model_validate(body)
    assert ml_client.post("/v1/reference/analyze", json={"imageKey": "otros/x.jpg"}, headers=AUTH).status_code == 422
    assert ml_client.post("/v1/reference/analyze", json={"imageKey": "projects/nope.jpg"}, headers=AUTH).status_code == 404
