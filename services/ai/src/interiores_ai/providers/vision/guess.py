"""Lo que un modelo de visión entiende de la foto de un cuarto, y cómo se le pregunta.

El modelo devuelve semántica y proporciones —tipo de cuarto, en qué pared hay una puerta, qué
muebles se ven, de qué color son las paredes—, nunca coordenadas: el cuarto lo arma después un
constructor determinista (`shell_spec.py`). La prueba con fotos reales que justifica este reparto
está en `docs/pruebas-vision/`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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
      "positionFraction": number,  // centre along the wall. Back wall: 0 = its left end, 1 = its right end.
                                   // Side walls: 0 = the far end (next to the back wall), 1 = next to the camera.
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
    category: str = Field(min_length=1, max_length=40)
    count: int = Field(default=1, ge=1, le=40)
    nearWall: Wall | Literal["center"] = "center"


class Palette(BaseModel):
    model_config = ConfigDict(extra="ignore")
    walls: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    floor: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    accent: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class RoomGuess(BaseModel):
    """La respuesta del modelo, validada. Lo que no cumple el esquema se trata como fallo del proveedor."""

    model_config = ConfigDict(extra="ignore")
    roomType: str = "other"
    shape: Literal["rect", "L", "T", "U"] = "rect"
    widthM: float = Field(gt=0.5, lt=30)
    depthM: float = Field(gt=0.5, lt=30)
    heightM: float = Field(gt=1.5, lt=8)
    openings: list[OpeningGuess] = Field(default_factory=list, max_length=24)
    objects: list[ObjectGuess] = Field(default_factory=list, max_length=40)
    palette: Palette | None = None
    floorMaterial: str = "other"
    style: str = "moderno"
    confidence: float = Field(default=0.5, ge=0, le=1)
    notes: str = ""
