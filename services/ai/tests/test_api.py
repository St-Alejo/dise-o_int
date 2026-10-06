import io

import httpx
import numpy as np
import pytest
from PIL import Image

from interiores_ai.imaging import decode_rgb
from interiores_ai.providers.base import ProviderError
from interiores_ai.providers.replicate import CircuitBreaker, ReplicateClient
from interiores_ai.providers.room_mock import MockRoomAnalyzer
from interiores_ai.providers.style_mock import MockStyleGenerator
from interiores_ai.storage import MemoryStorage
from tests.conftest import TOKEN, room_photo

AUTH = {"authorization": f"Bearer {TOKEN}", "x-request-id": "req-test-123"}


def test_health(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").status_code == 200


def test_rechaza_llamadas_sin_token(client):
    r = client.post("/v1/room/analyze", json={"photoKey": "projects/p1/source.jpg", "roomType": "living"})
    assert r.status_code == 401
    r = client.post("/v1/room/analyze", json={"photoKey": "x", "roomType": "living"}, headers={"authorization": "Bearer otro"})
    assert r.status_code == 401


def test_analyze_devuelve_un_roomshell_valido_que_pide_calibracion(client):
    r = client.post("/v1/room/analyze", json={"photoKey": "projects/p1/source.jpg", "roomType": "living"}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.headers["x-request-id"] == "req-test-123"
    body = r.json()
    shell = body["roomShell"]
    assert shell["needsCalibration"] is True
    assert shell["scaleConfidence"] < 0.5
    assert 2.2 <= shell["widthM"] <= 7 and 2.2 <= shell["depthM"] <= 7
    assert len(shell["walls"]) == 4
    assert any(o["type"] == "door" for o in shell["openings"])
    assert body["provider"] == "mock-opencv"


def test_analyze_detecta_la_ventana_luminosa():
    image = decode_rgb(room_photo())
    shell = MockRoomAnalyzer().analyze(image, "living").shell
    windows = [o for o in shell.openings if o.type == "window"]
    assert len(windows) == 1
    # la ventana sintética está entre el 55 % y el 80 % del ancho de la foto
    assert 0.5 < windows[0].offsetM / shell.widthM < 0.85


def test_generate_escribe_el_render_en_el_output_key(client, storage: MemoryStorage):
    r = client.post(
        "/v1/styles/generate",
        json={
            "photoKey": "projects/p1/source.jpg",
            "outputKey": "projects/p1/previews/abc.jpg",
            "styleId": "industrial",
            "roomType": "living",
            "promptStrength": 0.7,
        },
        headers=AUTH,
    )
    assert r.status_code == 200, r.text
    data, ctype = storage.objects["projects/p1/previews/abc.jpg"]
    assert ctype == "image/jpeg"
    assert Image.open(io.BytesIO(data)).size == (960, 720)


def test_generate_no_escribe_fuera_del_espacio_de_proyectos(client):
    r = client.post(
        "/v1/styles/generate",
        json={"photoKey": "projects/p1/source.jpg", "outputKey": "catalog/hack.glb", "styleId": "moderno", "roomType": "living", "promptStrength": 0.5},
        headers=AUTH,
    )
    assert r.status_code == 422


def test_foto_inexistente_es_404_no_reintentable(client):
    r = client.post("/v1/room/analyze", json={"photoKey": "projects/nope.jpg", "roomType": "living"}, headers=AUTH)
    assert r.status_code == 404


def test_ready_reporta_degradado_si_el_breaker_esta_abierto(client):
    container = client.app.state.container
    assert client.get("/health/ready").json()["status"] == "ok"

    class Abierto:
        is_open = True

    class Cliente:
        breaker = Abierto()

    container.replicate = Cliente()
    try:
        body = client.get("/health/ready")
        assert body.status_code == 200
        assert body.json()["status"] == "degraded"
    finally:
        container.replicate = None


def test_breaker_reporta_abierto_tras_fallos():
    breaker = CircuitBreaker(threshold=2, cooldown_s=60)
    assert not breaker.is_open
    breaker.failure()
    breaker.failure()
    assert breaker.is_open
    breaker.success()
    assert not breaker.is_open


def test_estilo_mock_es_determinista_y_distinto_por_estilo():
    image = decode_rgb(room_photo())
    gen = MockStyleGenerator()
    a = gen.generate(image, "industrial", "living", 0.7)
    b = gen.generate(image, "industrial", "living", 0.7)
    c = gen.generate(image, "escandinavo", "living", 0.7)
    assert np.array_equal(a, b)
    assert np.abs(a.astype(int) - c.astype(int)).mean() > 5
    # Mayor intensidad → más alejado del original
    soft = gen.generate(image, "industrial", "living", 0.2)
    diff = lambda x: np.abs(x.astype(int) - image.astype(int)).mean()  # noqa: E731
    assert diff(a) > diff(soft)


def test_layout_endpoint(client, catalog):
    from interiores_ai.providers.shell import rectangular_shell

    body = {
        "roomShell": rectangular_shell(4.5, 4.0, 2.6).model_dump(),
        "roomType": "living",
        "styleId": "moderno",
        "candidates": [c.model_dump() for c in catalog],
        "locked": [],
    }
    r = client.post("/v1/layout/place", json=body, headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["engine"] == "rules-greedy-v1"
    assert len(r.json()["placements"]) >= 3
    # zod rechaza null en campos opcionales: el endpoint no debe enviarlos.
    assert all(None not in p.values() for p in r.json()["placements"])


# --------------------------------------------------------------------- Replicate (sin red)
def replicate_client(settings, handler) -> ReplicateClient:
    settings.replicate_api_token = "r8_test"
    settings.replicate_timeout_s = 5
    return ReplicateClient(settings, transport=httpx.MockTransport(handler))


def test_replicate_hace_polling_hasta_terminar(settings, monkeypatch):
    monkeypatch.setattr("time.sleep", lambda _: None)
    calls = {"get": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            assert request.url.path == "/v1/models/adirik/interior-design/predictions"
            assert request.headers["authorization"] == "Bearer r8_test"
            return httpx.Response(201, json={"status": "starting", "urls": {"get": "https://api.replicate.com/v1/predictions/1"}})
        calls["get"] += 1
        status = "succeeded" if calls["get"] >= 2 else "processing"
        return httpx.Response(200, json={"status": status, "output": "https://x/out.png", "urls": {"get": str(request.url)}})

    client = replicate_client(settings, handler)
    assert client.run("adirik/interior-design", {"prompt": "x"}) == "https://x/out.png"
    assert calls["get"] == 2


def test_replicate_error_de_entrada_no_es_reintentable(settings):
    client = replicate_client(settings, lambda r: httpx.Response(422, json={"detail": "bad input"}))
    with pytest.raises(ProviderError) as exc:
        client.run("owner/model:abc123", {})
    assert exc.value.retryable is False


def test_circuit_breaker_abre_tras_fallos_seguidos():
    breaker = CircuitBreaker(threshold=2, cooldown_s=60)
    breaker.failure()
    breaker.before_call()
    breaker.failure()
    with pytest.raises(ProviderError):
        breaker.before_call()
