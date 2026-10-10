"""Del "qué se ve" del modelo de visión a un cuarto con paredes y aberturas (determinista).

El modelo dice en qué pared está cada puerta o ventana y qué parte ocupa; aquí se decide dónde
cae exactamente, con qué tamaño, y se descarta lo que no es físico (aberturas encimadas o que no
caben). Las mismas respuestas dan siempre el mismo cuarto.
"""

import math

from ...contracts import Opening, RoomShell
from ..shell import polygon_shell
from .guess import OpeningGuess, RoomGuess

# Límites del producto (los mismos de ROOM_LIMITS en TypeScript).
MIN_SIDE_M, MAX_SIDE_M = 2.2, 12.0
MIN_HEIGHT_M, MAX_HEIGHT_M = 2.2, 4.0
OPENING_MARGIN_M = 0.1
WALL_IDS = {"back": "w-back", "right": "w-right", "front": "w-front", "left": "w-left"}


def outline(shape: str, w: float, d: float) -> list[tuple[float, float]]:
    """Planta de cada forma con su muesca habitual (espejo de `ROOM_TEMPLATES` en TypeScript)."""
    if shape == "L":
        nw, nd = w * 0.4, d * 0.4
        return [(0, 0), (w, 0), (w, d - nd), (w - nw, d - nd), (w - nw, d), (0, d)]
    if shape == "T":
        nw, nd = w * 0.25, d * 0.45
        return [(0, 0), (w, 0), (w, d - nd), (w - nw, d - nd), (w - nw, d), (nw, d), (nw, d - nd), (0, d - nd)]
    if shape == "U":
        nw, nd = w * 0.34, d * 0.45
        arm = (w - nw) / 2
        return [(0, 0), (w, 0), (w, d), (w - arm, d), (w - arm, d - nd), (arm, d - nd), (arm, d), (0, d)]
    return [(0, 0), (w, 0), (w, d), (0, d)]


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _offset_from_start(wall: str, fraction: float, length: float) -> float:
    """Posición a lo largo de la pared, medida desde su `start`.

    El modelo mide la del fondo de izquierda a derecha y las laterales del fondo hacia la cámara.
    `w-back` y `w-right` empiezan justo ahí; `w-left` y `w-front` se recorren al revés.
    """
    return fraction * length if wall in ("back", "right") else (1 - fraction) * length


def _opening(guess: OpeningGuess, index: int, length: float, height: float) -> Opening | None:
    is_door = guess.type == "door"
    width = _clamp(guess.widthFraction * length, 0.7 if is_door else 0.6, 1.1 if is_door else length * 0.85)
    width = min(width, length - 2 * OPENING_MARGIN_M)
    if width < 0.5:
        return None
    half = width / 2
    offset = _clamp(_offset_from_start(guess.wall, guess.positionFraction, length), half + OPENING_MARGIN_M, length - half - OPENING_MARGIN_M)
    if is_door:
        sill, opening_height = 0.0, min(2.05, height * 0.85)
    elif guess.widthFraction >= 0.6:
        # Un ventanal que ocupa casi toda la pared suele ir casi de piso a techo.
        sill, opening_height = 0.3, height - 0.3 - 0.35
    else:
        sill, opening_height = 0.9, min(1.3, height - 0.9 - 0.3)
    return Opening(
        id=f"o-{guess.type}-{index}",
        type=guess.type,
        wallId=WALL_IDS[guess.wall],
        widthM=round(width, 3),
        heightM=round(opening_height, 3),
        offsetM=round(offset, 3),
        sillHeightM=round(sill, 3),
    )


def shell_from_guess(guess: RoomGuess, *, shell_id: str = "room") -> RoomShell:
    width = round(_clamp(guess.widthM, MIN_SIDE_M, MAX_SIDE_M), 2)
    depth = round(_clamp(guess.depthM, MIN_SIDE_M, MAX_SIDE_M), 2)
    height = round(_clamp(guess.heightM, MIN_HEIGHT_M, MAX_HEIGHT_M), 2)
    points = outline(guess.shape, width, depth)
    bare = polygon_shell(points, height)
    lengths = {w.id: math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) for w in bare.walls}

    openings: list[Opening] = []
    taken: dict[str, list[tuple[float, float]]] = {}
    for guessed in guess.openings:
        wall_id = WALL_IDS[guessed.wall]
        if wall_id not in lengths:
            continue
        opening = _opening(guessed, len(openings) + 1, lengths[wall_id], height)
        if opening is None:
            continue
        start, end = opening.offsetM - opening.widthM / 2, opening.offsetM + opening.widthM / 2
        # Dos aberturas encimadas no son físicas: gana la primera que nombró el modelo.
        if any(start < e + OPENING_MARGIN_M and s < end + OPENING_MARGIN_M for s, e in taken.get(wall_id, [])):
            continue
        taken.setdefault(wall_id, []).append((start, end))
        openings.append(opening)

    if not any(o.type == "door" for o in openings) and lengths.get("w-front", 0) >= 1.2:
        # Todo cuarto tiene entrada; si no se ve, lo habitual es que quede detrás de quien toma la foto.
        front = lengths["w-front"]
        door_w = min(0.9, front * 0.5)
        offset = _clamp(front * 0.8, door_w / 2 + 0.15, front - door_w / 2 - 0.15)
        start, end = offset - door_w / 2, offset + door_w / 2
        if not any(start < e + OPENING_MARGIN_M and s < end + OPENING_MARGIN_M for s, e in taken.get("w-front", [])):
            openings.append(
                Opening(id="o-door-0", type="door", wallId="w-front", widthM=round(door_w, 3), heightM=round(min(2.05, height * 0.85), 3), offsetM=round(offset, 3), sillHeightM=0)
            )

    # El modelo estima por objetos conocidos: mejor que la heurística, pero el usuario debe confirmar.
    return polygon_shell(points, height, openings=openings, shape=guess.shape, scale_confidence=round(0.35 + 0.3 * guess.confidence, 2), shell_id=shell_id)
