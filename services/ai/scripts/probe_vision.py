"""Sonda de visión: ¿un modelo multimodal distingue un cuarto de otro a partir de una foto?

Manda cada foto de `e2e/fixtures/rooms/` a Groq (API compatible con OpenAI) y guarda lo que
entiende en `docs/pruebas-vision/<foto>.json`. Pensada para una capa gratuita:

- una sola llamada por foto, con la imagen reducida a 1024 px;
- si ya existe el JSON de una foto, no se vuelve a llamar (caché en disco);
- ante un 429 se detiene, sin reintentos.

Uso (desde la raíz del repo, con GROQ_API_KEY en el entorno o en `.env`):

    python services/ai/scripts/probe_vision.py --list-models
    python services/ai/scripts/probe_vision.py
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Literal

import httpx
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, ValidationError

ROOT = Path(__file__).resolve().parents[3]
PHOTOS_DIR = ROOT / "e2e" / "fixtures" / "rooms"
OUT_DIR = ROOT / "docs" / "pruebas-vision"
API_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "qwen/qwen3.8-27b"
MAX_SIDE = 1024
# Cada foto gasta ~2.850 tokens y la capa gratuita da ~8.000 por minuto: dos fotos por minuto.
PAUSE_S = 30.0

Wall = Literal["back", "left", "right", "front"]

PROMPT = """You are measuring a room from a single interior photo to rebuild it as a simple 3D model.
Describe ONLY what the photo supports. Wall names are relative to the camera: "back" is the far
wall the camera looks at, "left" and "right" are the side walls as seen in the photo, and "front"
is the wall behind the camera (not visible).

Answer with one JSON object and nothing else:
{
  "roomType": "living" | "bedroom" | "dining" | "office" | "kitchen" | "bathroom" | "other",
  "shape": "rect" | "L" | "T" | "U",
  "widthM": number,   // left-to-right size of the room, metres
  "depthM": number,   // camera-to-back-wall size, metres
  "heightM": number,  // floor to ceiling, metres
  "openings": [       // every door and window you can see
    { "wall": "back" | "left" | "right" | "front", "type": "door" | "window",
      "positionFraction": number,  // centre along the wall, 0 = its left end as seen, 1 = right end
      "widthFraction": number }    // share of that wall it covers, 0..1
  ],
  "objects": [        // furniture and decor actually present
    { "category": string,          // e.g. sofa, bed, dining table, chair, desk, tv stand, shelf, rug, lamp, plant, picture
      "count": integer,
      "nearWall": "back" | "left" | "right" | "front" | "center" }
  ],
  "palette": { "walls": "#rrggbb", "floor": "#rrggbb", "accent": "#rrggbb" },
  "floorMaterial": "wood" | "tile" | "carpet" | "concrete" | "other",
  "style": "escandinavo" | "minimalista" | "industrial" | "bohemio" | "moderno" | "clasico",
  "confidence": number,  // 0..1, how sure you are about shape and sizes
  "notes": string        // one short sentence on what is uncertain
}
Estimate sizes from familiar objects (a door is about 2.0 m tall, a double bed about 1.5 m wide).
Use "L", "T" or "U" only when the floor plan clearly is not a rectangle."""


class OpeningGuess(BaseModel):
    model_config = ConfigDict(extra="ignore")
    wall: Wall
    type: Literal["door", "window"]
    positionFraction: float = Field(ge=0, le=1)
    widthFraction: float = Field(ge=0, le=1)


class ObjectGuess(BaseModel):
    model_config = ConfigDict(extra="ignore")
    category: str
    count: int = Field(default=1, ge=1, le=40)
    nearWall: Wall | Literal["center"] = "center"


class Palette(BaseModel):
    model_config = ConfigDict(extra="ignore")
    walls: str
    floor: str
    accent: str


class RoomGuess(BaseModel):
    """Lo que el modelo dice del cuarto: semántica y proporciones, nunca coordenadas."""

    model_config = ConfigDict(extra="ignore")
    roomType: str
    shape: Literal["rect", "L", "T", "U"]
    widthM: float = Field(gt=0.5, lt=30)
    depthM: float = Field(gt=0.5, lt=30)
    heightM: float = Field(gt=1.5, lt=8)
    openings: list[OpeningGuess] = Field(default_factory=list)
    objects: list[ObjectGuess] = Field(default_factory=list)
    palette: Palette | None = None
    floorMaterial: str = "other"
    style: str = "moderno"
    confidence: float = Field(default=0.5, ge=0, le=1)
    notes: str = ""


def api_key() -> str:
    key = os.environ.get("GROQ_API_KEY", "")
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("GROQ_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        sys.exit("Falta GROQ_API_KEY (en el entorno o en .env).")
    return key


def encode(photo: Path) -> str:
    image = Image.open(photo).convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def list_models(client: httpx.Client) -> None:
    response = client.get("/models")
    response.raise_for_status()
    for model in sorted(response.json()["data"], key=lambda m: m["id"]):
        print(f"{model['id']}  ctx={model.get('context_window')}")


def probe(client: httpx.Client, photo: Path, model: str) -> bool:
    """Analiza una foto. Devuelve False si hay que detenerse (límite o error de la API)."""
    started = time.monotonic()
    response = client.post(
        "/chat/completions",
        json={
            "model": model,
            "temperature": 0.2,
            "max_completion_tokens": 900,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encode(photo)}"}},
                    ],
                }
            ],
        },
    )
    if response.status_code == 429:
        print(f"  límite alcanzado (429); reintentar en {response.headers.get('retry-after', '?')} s. Me detengo.")
        return False
    if response.status_code >= 400:
        print(f"  error {response.status_code}: {response.text[:300]}. Me detengo.")
        return False

    body = response.json()
    text = body["choices"][0]["message"]["content"]
    meta = {
        "photo": photo.name,
        "model": model,
        "elapsedS": round(time.monotonic() - started, 2),
        "usage": body.get("usage", {}),
        "remainingRequests": response.headers.get("x-ratelimit-remaining-requests"),
        "remainingTokens": response.headers.get("x-ratelimit-remaining-tokens"),
    }
    try:
        guess = RoomGuess.model_validate_json(text)
    except ValidationError as error:
        (OUT_DIR / f"{photo.stem}.invalido.txt").write_text(f"{error}\n\n{text}", encoding="utf-8")
        print(f"  respuesta inválida ({error.error_count()} errores); guardada sin reintentar.")
        return True

    (OUT_DIR / f"{photo.stem}.json").write_text(
        json.dumps({"meta": meta, "room": guess.model_dump()}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"  {guess.roomType} {guess.shape} {guess.widthM}×{guess.depthM}×{guess.heightM} m, "
        f"{len(guess.openings)} aberturas, {len(guess.objects)} tipos de objeto "
        f"({meta['elapsedS']} s, quedan {meta['remainingRequests']} llamadas)"
    )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list-models", action="store_true", help="solo lista los modelos disponibles")
    parser.add_argument("--model", default=os.environ.get("VISION_MODEL", DEFAULT_MODEL))
    args = parser.parse_args()

    with httpx.Client(base_url=API_URL, headers={"Authorization": f"Bearer {api_key()}"}, timeout=60) as client:
        if args.list_models:
            list_models(client)
            return
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        photos = sorted(PHOTOS_DIR.glob("*.jpg"))
        for index, photo in enumerate(photos):
            if (OUT_DIR / f"{photo.stem}.json").exists():
                print(f"{photo.name}: en caché, no se llama.")
                continue
            print(f"{photo.name}:")
            if not probe(client, photo, args.model):
                break
            if index < len(photos) - 1:
                time.sleep(PAUSE_S)


if __name__ == "__main__":
    main()
