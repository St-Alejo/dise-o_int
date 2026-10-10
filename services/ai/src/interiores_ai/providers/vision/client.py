"""Puerto del modelo de visión y su adaptador para Groq (API compatible con OpenAI)."""

import base64
from typing import Protocol

import httpx

from ..base import ProviderError


class VisionClient(Protocol):
    """Un modelo multimodal: recibe una foto y una pregunta, devuelve texto (se espera JSON)."""

    @property
    def model(self) -> str: ...

    def describe(self, jpeg: bytes, prompt: str) -> str: ...


class GroqVisionClient:
    """Chat completions de Groq con una imagen en línea. Una llamada, sin reintentos.

    La capa gratuita limita llamadas y tokens por minuto: ante un 429 se informa y se deja que el
    analizador de respaldo responda, en lugar de insistir y gastar más cuota.
    """

    def __init__(self, api_key: str, model: str, *, timeout_s: float = 45.0, base_url: str = "https://api.groq.com/openai/v1", transport: httpx.BaseTransport | None = None) -> None:
        self._model = model
        self._http = httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout_s, transport=transport)

    @property
    def model(self) -> str:
        return self._model

    def describe(self, jpeg: bytes, prompt: str) -> str:
        image_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
        try:
            response = self._http.post(
                "/chat/completions",
                json={
                    "model": self._model,
                    "temperature": 0.2,
                    "max_completion_tokens": 900,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": image_url}}]}],
                },
            )
        except httpx.HTTPError as err:
            raise ProviderError(f"El modelo de visión no respondió: {type(err).__name__}") from err
        if response.status_code == 429:
            raise ProviderError("El modelo de visión alcanzó su límite de uso", retryable=False)
        if response.status_code >= 400:
            # El cuerpo puede traer detalles de la cuenta: solo se propaga el código.
            raise ProviderError(f"El modelo de visión respondió {response.status_code}", retryable=response.status_code >= 500)
        try:
            return str(response.json()["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, ValueError) as err:
            raise ProviderError("El modelo de visión devolvió una respuesta sin contenido", retryable=False) from err

    def close(self) -> None:
        self._http.close()
