"""Geometría 2D del piso (espejo de packages/shared-types/src/geometry.ts).

Convención idéntica a Three.js: rotación alrededor de +Y, el vector local (1,0,0) rota a
(cos θ, −sin θ) en XZ y el frente de un mueble es su +Z local → mira hacia (sin θ, cos θ).
"""

import math
from dataclasses import dataclass

Point = tuple[float, float]


def rotate(lx: float, lz: float, rot: float) -> Point:
    c, s = math.cos(rot), math.sin(rot)
    return lx * c + lz * s, -lx * s + lz * c


def forward(rot: float) -> Point:
    """Dirección hacia la que mira el frente del mueble."""
    return math.sin(rot), math.cos(rot)


def right(rot: float) -> Point:
    return math.cos(rot), -math.sin(rot)


@dataclass(frozen=True)
class Footprint:
    corners: tuple[Point, Point, Point, Point]

    @staticmethod
    def of(x: float, z: float, w: float, d: float, rot: float) -> "Footprint":
        hw, hd = w / 2, d / 2
        pts = []
        for lx, lz in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)):
            rx, rz = rotate(lx, lz, rot)
            pts.append((x + rx, z + rz))
        return Footprint((pts[0], pts[1], pts[2], pts[3]))

    @staticmethod
    def rect(min_x: float, min_z: float, max_x: float, max_z: float) -> "Footprint":
        return Footprint(((min_x, min_z), (max_x, min_z), (max_x, max_z), (min_x, max_z)))

    def bounds(self) -> tuple[float, float, float, float]:
        xs = [c[0] for c in self.corners]
        zs = [c[1] for c in self.corners]
        return min(xs), min(zs), max(xs), max(zs)


def _project(corners: tuple[Point, ...], axis: Point) -> tuple[float, float]:
    vals = [c[0] * axis[0] + c[1] * axis[1] for c in corners]
    return min(vals), max(vals)


def overlaps(a: Footprint, b: Footprint, tolerance: float = 0.01) -> bool:
    """Teorema del eje separador para rectángulos orientados."""
    for fp in (a, b):
        for i in range(2):
            p0, p1 = fp.corners[i], fp.corners[i + 1]
            ex, ez = p1[0] - p0[0], p1[1] - p0[1]
            length = math.hypot(ex, ez) or 1.0
            axis = (-ez / length, ex / length)
            min_a, max_a = _project(a.corners, axis)
            min_b, max_b = _project(b.corners, axis)
            if max_a - tolerance <= min_b or max_b - tolerance <= min_a:
                return False
    return True


def inside(fp: Footprint, width: float, depth: float, tolerance: float = 0.005) -> bool:
    min_x, min_z, max_x, max_z = fp.bounds()
    return min_x >= -tolerance and min_z >= -tolerance and max_x <= width + tolerance and max_z <= depth + tolerance


def normalize_angle(rot: float) -> float:
    two_pi = 2 * math.pi
    return ((rot % two_pi) + two_pi) % two_pi


def angle_facing(dx: float, dz: float) -> float:
    """Rotación para que el frente (+Z local) apunte en la dirección (dx, dz)."""
    return normalize_angle(math.atan2(dx, dz))
