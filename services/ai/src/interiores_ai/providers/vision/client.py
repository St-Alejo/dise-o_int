"""Puerto del modelo de visión y sus adaptadores: Claude (el que se usa) y Groq (ya no se usa)."""

import base64
from typing import Any, Protocol

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


#: modelo de visión por defecto (Claude Sonnet 5.5: US$2 / US$10 por millón de tokens)
CLAUDE_VISION_MODEL = "claude-sonnet-5-5"


def _json_object(text: str) -> str:
    """El objeto JSON de la respuesta (Claude a veces lo envuelve en ```json)."""
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if 0 <= start < end else text


class ClaudeVisionClient:
    """Claude (SDK oficial de Anthropic) con la foto en línea. Una llamada, sin reintentos.

    Reemplaza a Groq: su capa gratuita se puede agotar en plena demostración. El tope diario de
    fotos (`VISION_PER_DAY`) acota el gasto: ~US$0,01 por foto.
    """

    def __init__(self, api_key: str, model: str = CLAUDE_VISION_MODEL, *, timeout_s: float = 45.0, http_client: Any = None) -> None:
        """`http_client` (un ``httpx2.Client`` del SDK) solo lo usan las pruebas."""
        import anthropic  # solo se carga si se usa

        self._model = model
        self._anthropic = anthropic
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=0, timeout=timeout_s, http_client=http_client)

    @property
    def model(self) -> str:
        return self._model

    def describe(self, jpeg: bytes, prompt: str) -> str:
        data = base64.b64encode(jpeg).decode("ascii")
        errors = self._anthropic
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1600,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                            {"type": "text", "text": prompt + "\n\nResponde SOLO con el objeto JSON en una sola línea (compacto, sin sangrías), sin texto alrededor."},
                        ],
                    }
                ],
            )
        except errors.APIStatusError as err:
            # El cuerpo puede traer detalles de la cuenta: solo se propaga el código.
            status = err.status_code
            if status == 429:
                raise ProviderError("El modelo de visión alcanzó su límite de uso", retryable=False) from err
            raise ProviderError(f"El modelo de visión respondió {status}", retryable=status >= 500) from err
        except errors.APIError as err:
            raise ProviderError(f"El modelo de visión no respondió: {type(err).__name__}") from err
        text = next((str(getattr(b, "text", "")) for b in response.content if b.type == "text"), "")
        if not text:
            raise ProviderError("El modelo de visión devolvió una respuesta sin contenido", retryable=False)
        return _json_object(text)

    def close(self) -> None:
        self._client.close()
