"""Contrato con el worker (espejo de packages/shared-types/src/ai-contract.ts).

tests/test_contract.py valida estos modelos contra el JSON Schema exportado desde zod,
así que si alguien cambia un lado sin el otro, CI falla.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

RoomType = Literal["living", "bedroom", "dining", "office", "kitchen", "bathroom"]
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


RoomShape = Literal["rect", "L", "T", "U", "free"]
ZoneKind = Literal["bathroom", "closet", "vanity", "office-nook"]


class Point2(Model):
    x: float
    z: float


class ZoneDoor(Model):
    # Lado del contorno (outline[edge] -> outline[edge + 1]) donde va la puerta: siempre un tabique.
    edge: int = Field(ge=0, le=15)
    offsetM: float = Field(ge=0, le=100)
    widthM: float = Field(ge=0.5, le=2)


class Zone(Model):
    """Zona interior del cuarto (baño privado, vestidor, rincón del tocador)."""

    id: str = Field(min_length=1, max_length=64)
    kind: ZoneKind
    name: str | None = Field(default=None, min_length=1, max_length=60)
    outline: list[Point2] = Field(min_length=3, max_length=16)
    open: bool = False
    door: ZoneDoor | None = None


class RoomShell(Model):
    id: str = Field(min_length=1, max_length=64)
    # Caja que envuelve al cuarto; la planta real son las paredes, en orden y cerrando.
    widthM: Meters
    depthM: Meters
    heightM: Meters
    shape: RoomShape | None = None
    walls: list[WallSegment] = Field(min_length=3, max_length=64)
    openings: list[Opening] = Field(max_length=64)
    scaleConfidence: float = Field(ge=0, le=1)
    needsCalibration: bool
    # Zonas interiores; sin valor = el cuarto es un solo espacio.
    zones: list[Zone] | None = Field(default=None, max_length=4)


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
    # Lo que aporta un modelo de visión: qué es, cuántos hay y junto a qué pared (vista desde la cámara).
    category: str | None = Field(default=None, min_length=1, max_length=40)
    count: int | None = Field(default=None, ge=1, le=40)
    nearWall: Literal["back", "left", "right", "front", "center"] | None = None


HexColor = Annotated[str, Field(pattern=r"^#[0-9a-f]{6}$")]


class RoomSuggestions(Model):
    """Lo que la foto sugiere además de la geometría: colores, estilo y tipo de cuarto."""

    roomType: str | None = Field(default=None, max_length=40)
    styleId: StyleId | None = None
    wallColor: HexColor | None = None
    floorColor: HexColor | None = None
    accentColor: HexColor | None = None
    floorMaterial: Literal["wood", "tile", "carpet", "concrete", "other"] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    notes: str | None = Field(default=None, max_length=300)


class AnalyzeRoomResponse(Model):
    roomShell: RoomShell
    detectedObjects: list[DetectedObject]
    provider: str
    durationMs: float = Field(ge=0)
    suggestions: RoomSuggestions | None = None


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


class InventoryItem(Model):
    """Un tipo de mueble visto en la foto (en palabras del modelo de visión) y cuántos hay."""

    category: str = Field(min_length=1, max_length=40)
    count: int = Field(default=1, ge=1, le=40)


class PlaceFurnitureRequest(Model):
    roomShell: RoomShell
    roomType: RoomType
    styleId: StyleId | None
    candidates: list[LayoutCandidate]
    locked: list[FurniturePlacement]
    seed: int | None = None
    # Lo que había en la foto: si viene, la distribución coloca eso en vez de la plantilla completa.
    inventory: list[InventoryItem] | None = Field(default=None, max_length=40)
    # Subcategorías que la persona pidió (Brief): se colocan aunque la plantilla no las traiga.
    mustHave: list[str] | None = Field(default=None, max_length=20)


class PlaceFurnitureResponse(Model):
    placements: list[FurniturePlacement]
    unplaced: list[str]
    score: float
    engine: str


# ----------------------------------------------------------------- modelo local del chat (NLU)
NluIntent = Literal[
    "set_floor",
    "set_walls",
    "set_wall_tiles",
    "set_ceiling",
    "add_item",
    "remove_item",
    "move_item",
    "set_lighting",
    "set_style",
    "recommend",
    "pin",
    "unpin",
    "add_zone",
    "avoid_item",
    "replicate_image",
    "room_size",
    "other",
]
Hex = Annotated[str, Field(pattern=r"^#[0-9a-f]{6}$")]
FinishKind = Literal["tile", "wood", "stone", "paint", "carpet", "brick", "concrete"]
FloorKind = Literal["tile", "wood", "stone", "carpet", "concrete"]
Pattern = Literal["plain", "grid", "checker", "subway", "herringbone", "hex", "mosaic", "planks"]
Mood = Literal["calida", "neutra", "fria"]
Level = Literal["tenue", "media", "alta"]


class NluParseRequest(Model):
    text: str = Field(min_length=1, max_length=500)


class NluColor(Model):
    name: str
    hex: Hex


class NluSlots(Model):
    colors: list[NluColor] = Field(default_factory=list, max_length=3)
    surface: Literal["floor", "walls", "ceiling", "wallTiles"] | None = None
    finishKind: FinishKind | None = None
    base: str | None = None
    pattern: Pattern | None = None
    gloss: float | None = Field(default=None, ge=0, le=1)
    tileSizeM: float | None = Field(default=None, gt=0)
    heightM: float | None = Field(default=None, gt=0)
    fullHeight: bool = False
    subcategory: str | None = None
    quantity: int | None = Field(default=None, gt=0)
    style: StyleId | None = None
    mood: Mood | None = None
    level: Level | None = None
    zoneKind: Literal["bathroom", "closet", "vanity", "office-nook"] | None = None
    preset: str | None = None
    intensity: Literal["suave", "total"] | None = None
    pinTarget: Literal["floor", "walls", "ceiling", "wallTiles", "style", "lighting", "palette"] | None = None
    widthM: float | None = Field(default=None, gt=0)
    depthM: float | None = Field(default=None, gt=0)


class NluAlternative(Model):
    intent: NluIntent
    confidence: float = Field(ge=0, le=1)


class NluParseResponse(Model):
    intent: NluIntent
    confidence: float = Field(ge=0, le=1)
    alternatives: list[NluAlternative]
    slots: NluSlots
    model: str


# ------------------------------------------------------------------- ranking de propuestas
FeedbackAction = Literal["shown", "like", "dislike", "kept", "undone"]


class RankCandidate(Model):
    id: str = Field(min_length=1, max_length=64)
    features: dict[str, float]
    prior: float


class RankSample(Model):
    features: dict[str, float]
    action: FeedbackAction


class RankRecommendationsRequest(Model):
    candidates: list[RankCandidate] = Field(min_length=1, max_length=20)
    history: list[RankSample] = Field(default_factory=list, max_length=500)


class RankRecommendationsResponse(Model):
    scores: dict[str, float]
    model: Literal["prior", "logreg"]
    samples: int = Field(ge=0)


# ------------------------------------------------------------------- imagen de referencia
class AnalyzeReferenceRequest(Model):
    imageKey: str = Field(min_length=1, max_length=512)


class ReferenceFloor(Model):
    kind: FloorKind
    pattern: Pattern
    colors: list[Hex] = Field(min_length=1, max_length=3)
    gloss: float = Field(ge=0, le=1)


class AnalyzeReferenceResponse(Model):
    style: StyleId | None = None
    palette: list[Hex] = Field(max_length=5)
    floor: ReferenceFloor | None = None
    wallColor: Hex | None = None
    objects: list[str] = Field(default_factory=list, max_length=8)
    mood: Mood | None = None
    level: Level | None = None
    source: Literal["vision", "colors"]
