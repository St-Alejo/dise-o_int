"""Puntuación de una distribución: cuánto se parece a lo que haría un diseñador.

El motor por reglas ya descarta lo inválido (solapes, salirse del cuarto, tapar la puerta). Entre
varias distribuciones válidas, esta nota elige: que no falte nada imprescindible, que quede paso
entre los muebles, que nada alto tape una ventana y que el peso no se amontone en un lado.

Cada criterio es una clase con un peso (patrón Strategy): añadir uno no toca a los demás.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

from ..contracts import FurniturePlacement, LayoutCandidate, RoomShell
from .geometry import Footprint

# Paso mínimo cómodo entre dos muebles (o entre un mueble y la pared).
WALKWAY_M = 0.6
# Por debajo de esto dos muebles "se tocan": van juntos a propósito (mesa y sillas, cama y mesitas).
TOUCHING_M = 0.08
# A partir de esta altura un mueble delante de una ventana le quita luz.
TALL_M = 1.2


@dataclass(frozen=True)
class Piece:
    """Un mueble de piso ya colocado, con lo que la nota necesita de él."""

    id: str
    fp: Footprint
    height: float
    area: float

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return self.fp.bounds()

    @property
    def centre(self) -> tuple[float, float]:
        min_x, min_z, max_x, max_z = self.bounds
        return (min_x + max_x) / 2, (min_z + max_z) / 2


def floor_pieces(placements: list[FurniturePlacement], catalog: dict[str, LayoutCandidate]) -> list[Piece]:
    """Los muebles que pisan el suelo (sin alfombras, que no estorban el paso)."""
    pieces: list[Piece] = []
    for p in placements:
        item = catalog.get(p.catalogItemId)
        if item is None or item.mount != "floor" or item.subcategory == "rug":
            continue
        d = item.dimensionsM
        pieces.append(Piece(p.id, Footprint.of(p.position.x, p.position.z, d.x, d.z, p.rotationY), d.y, d.x * d.z))
    return pieces


def gap_between(a: Piece, b: Piece) -> float:
    """Separación entre las cajas de dos muebles (0 si se solapan en planta)."""
    ax0, az0, ax1, az1 = a.bounds
    bx0, bz0, bx1, bz1 = b.bounds
    dx = max(bx0 - ax1, ax0 - bx1, 0.0)
    dz = max(bz0 - az1, az0 - bz1, 0.0)
    return math.hypot(dx, dz)


class LayoutCriterion(Protocol):
    name: str
    weight: float

    def rate(self, shell: RoomShell, pieces: list[Piece]) -> float:
        """Nota de 0 (mal) a 1 (bien)."""
        ...


class Walkways:
    """Entre dos muebles o se tocan o se pasa: un hueco de 20 cm no sirve para nada."""

    name = "pasillos"
    weight = 2.0

    def rate(self, shell: RoomShell, pieces: list[Piece]) -> float:
        pairs = [(a, b) for i, a in enumerate(pieces) for b in pieces[i + 1 :]]
        if not pairs:
            return 1.0
        awkward = sum(1 for a, b in pairs if TOUCHING_M < gap_between(a, b) < WALKWAY_M)
        return 1.0 - awkward / len(pairs)


class WindowsClear:
    """Nada alto pegado a una ventana."""

    name = "ventanas"
    weight = 1.5

    def rate(self, shell: RoomShell, pieces: list[Piece]) -> float:
        windows = [o for o in shell.openings if o.type == "window"]
        if not windows:
            return 1.0
        walls = {w.id: w for w in shell.walls}
        blocked = 0
        for window in windows:
            wall = walls.get(window.wallId)
            if wall is None:
                continue
            length = math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) or 1.0
            ux, uz = (wall.end.x - wall.start.x) / length, (wall.end.z - wall.start.z) / length
            wx, wz = wall.start.x + ux * window.offsetM, wall.start.z + uz * window.offsetM
            for piece in pieces:
                if piece.height < TALL_M:
                    continue
                min_x, min_z, max_x, max_z = piece.bounds
                # Distancia del centro de la ventana a la caja del mueble.
                dx = max(min_x - wx, wx - max_x, 0.0)
                dz = max(min_z - wz, wz - max_z, 0.0)
                if math.hypot(dx, dz) < 0.45:
                    blocked += 1
                    break
        return 1.0 - blocked / len(windows)


class Balance:
    """El peso de los muebles, repartido: su centro no queda lejos del centro del cuarto."""

    name = "equilibrio"
    weight = 1.0

    def rate(self, shell: RoomShell, pieces: list[Piece]) -> float:
        total = sum(p.area for p in pieces)
        if total <= 0:
            return 1.0
        cx = sum(p.centre[0] * p.area for p in pieces) / total
        cz = sum(p.centre[1] * p.area for p in pieces) / total
        off = math.hypot(cx - shell.widthM / 2, cz - shell.depthM / 2)
        return max(0.0, 1.0 - off / (max(shell.widthM, shell.depthM) / 2))


CRITERIA: tuple[LayoutCriterion, ...] = (Walkways(), WindowsClear(), Balance())
# Lo imprescindible pesa más que todo lo demás junto: una distribución bonita sin cama no vale.
REQUIRED_WEIGHT = 6.0


def layout_quality(
    shell: RoomShell,
    placements: list[FurniturePlacement],
    catalog: dict[str, LayoutCandidate],
    required_score: float = 1.0,
) -> float:
    """Nota de 0 a 1 de una distribución; `required_score` es la parte de lo imprescindible que cupo."""
    pieces = floor_pieces(placements, catalog)
    weighted = REQUIRED_WEIGHT * required_score + sum(c.weight * c.rate(shell, pieces) for c in CRITERIA)
    return weighted / (REQUIRED_WEIGHT + sum(c.weight for c in CRITERIA))
