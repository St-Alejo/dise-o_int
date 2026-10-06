"""Contrato con el worker (espejo de packages/shared-types/src/ai-contract.ts).

tests/test_contract.py valida estos modelos contra el JSON Schema exportado desde zod,
así que si alguien cambia un lado sin el otro, CI falla.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

RoomType = Literal["living", "bedroom", "dining", "office"]
StyleId = Literal["escandinavo", "minimalista", "industrial", "bohemio", "moderno", "clasico"]
Category = Literal[
    "sofa",
    "table",
    "chair",
    "bed",
    "storage",
    "lighting",
    "decor",
    "kitchen",
    "bathroom",
    "wall-decor",
    "textile",
    "electronics",
]
Mount = Literal["floor", "ceiling", "wall", "surface"]
PlacementOrigin = Literal["user", "layout", "detected", "chat"]

Meters = Annotated[float, Field(gt=0, le=100)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Vector3(Model):
    x: float
    y: float
    z: float


class WallSegment(Model):
    id: str = Field(min_length=1, max_length=64)
    start: Vector3
    end: Vector3
    hasWindow: bool


class Opening(Model):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["door", "window"]
    wallId: str = Field(min_length=1, max_length=64)
    widthM: Meters
    heightM: Meters
    offsetM: float = Field(ge=0, le=100)
    sillHeightM: float = Field(default=0, ge=0, le=10)


class RoomShell(Model):
    id: str = Field(min_length=1, max_length=64)
    widthM: Meters
    depthM: Meters
    heightM: Meters
    walls: list[WallSegment] = Field(min_length=3, max_length=64)
    openings: list[Opening] = Field(max_length=64)
    scaleConfidence: float = Field(ge=0, le=1)
    needsCalibration: bool


class Dimensions(Model):
    x: Meters
    y: Meters
    z: Meters


class FurniturePlacement(Model):
    id: str = Field(min_length=1, max_length=64)
    catalogItemId: str = Field(min_length=1, max_length=64)
    position: Vector3
    rotationY: float
    lockedByUser: bool
    # v3: opcionales (los placements fijados por el usuario los traen y deben aceptarse).
    dimensionsM: Dimensions | None = None
    materials: dict[str, str] | None = None
    elevationM: float | None = Field(default=None, ge=0, le=10)
    wallId: str | None = Field(default=None, min_length=1, max_length=64)
    supportId: str | None = Field(default=None, min_length=1, max_length=64)
    origin: PlacementOrigin | None = None


class AnalyzeRoomRequest(Model):
    photoKey: str = Field(min_length=1)
    roomType: RoomType


class DetectedObject(Model):
    label: str
    confidence: float = Field(ge=0, le=1)
    bbox: tuple[float, float, float, float]


class AnalyzeRoomResponse(Model):
    roomShell: RoomShell
    detectedObjects: list[DetectedObject]
    provider: str
    durationMs: float = Field(ge=0)


class GenerateStyleRequest(Model):
    photoKey: str = Field(min_length=1)
    outputKey: str = Field(min_length=1)
    styleId: StyleId
    roomType: RoomType
    promptStrength: float = Field(ge=0, le=1)


class GenerateStyleResponse(Model):
    imageKey: str
    provider: str
    durationMs: float = Field(ge=0)


class LayoutCandidate(Model):
    id: str
    category: Category
    subcategory: str | None = None
    styleTags: list[StyleId]
    dimensionsM: Vector3
    mount: Mount
    price: float | None = None


class PlaceFurnitureRequest(Model):
    roomShell: RoomShell
    roomType: RoomType
    styleId: StyleId | None
    candidates: list[LayoutCandidate]
    locked: list[FurniturePlacement]
    seed: int | None = None


class PlaceFurnitureResponse(Model):
    placements: list[FurniturePlacement]
    unplaced: list[str]
    score: float
    engine: str
