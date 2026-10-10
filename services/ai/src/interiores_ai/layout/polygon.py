"""Geometría de polígonos en planta (espejo de packages/shared-types/src/polygon.ts).

Para cuartos que no son un rectángulo: en L, en T, en U o con paredes libres. Las dos
implementaciones se prueban contra los mismos casos (packages/shared-types/fixtures).

Convención de giro: un polígono "canónico" tiene área con signo positiva, que es el orden del
cuarto rectangular (0,0) → (ancho,0) → (ancho,fondo) → (0,fondo). Con ese orden, la normal
interior de un lado con dirección (dx, dz) es (−dz, dx).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cached_property

from ..contracts import RoomShell
from .geometry import Footprint, Point

EPS = 1e-9


def signed_area(poly: Sequence[Point]) -> float:
    """Área con signo (fórmula del cordón). Positiva en el orden canónico."""
    total = 0.0
    for i, (ax, az) in enumerate(poly):
        bx, bz = poly[(i + 1) % len(poly)]
        total += ax * bz - bx * az
    return total / 2


def closest_on_segment(p: Point, a: Point, b: Point) -> Point:
    dx, dz = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dz * dz
    if len2 < EPS:
        return a
    t = min(1.0, max(0.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
    return a[0] + dx * t, a[1] + dz * t


def distance_to_boundary(p: Point, poly: Sequence[Point]) -> float:
    best = math.inf
    for i, a in enumerate(poly):
        qx, qz = closest_on_segment(p, a, poly[(i + 1) % len(poly)])
        best = min(best, math.hypot(p[0] - qx, p[1] - qz))
    return best


def point_in_polygon(p: Point, poly: Sequence[Point], tolerance: float = 0.0) -> bool:
    """¿El punto está dentro? Estar sobre el borde (con `tolerance`) cuenta como dentro."""
    if distance_to_boundary(p, poly) <= tolerance + EPS:
        return True
    inside = False
    j = len(poly) - 1
    for i, (ax, az) in enumerate(poly):
        bx, bz = poly[j]
        if (az > p[1]) != (bz > p[1]) and p[0] < (bx - ax) * (p[1] - az) / (bz - az) + ax:
            inside = not inside
        j = i
    return inside


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_cross(a: Point, b: Point, c: Point, d: Point) -> bool:
    """¿Los segmentos se cruzan de verdad? Tocarse en un extremo o ir pegados no cuenta."""
    return _orient(a, b, c) * _orient(a, b, d) < -EPS and _orient(c, d, a) * _orient(c, d, b) < -EPS


def is_convex_vertex(poly: Sequence[Point], i: int) -> bool:
    """¿El vértice `i` es una esquina saliente? Las entrantes son las de la muesca de una L."""
    n = len(poly)
    turn = _orient(poly[(i - 1) % n], poly[i], poly[(i + 1) % n])
    return turn > EPS if signed_area(poly) >= 0 else turn < -EPS


def quad_inside_polygon(corners: Sequence[Point], center: Point, poly: Sequence[Point], tolerance: float = 0.005) -> bool:
    """¿La huella cabe entera? Además de las esquinas, ningún lado del polígono puede atravesarla."""
    if not all(point_in_polygon(c, poly, tolerance) for c in corners):
        return False
    shrunk: list[Point] = []
    for cx, cz in corners:
        d = math.hypot(center[0] - cx, center[1] - cz) or 1.0
        k = min(1.0, (tolerance + 0.002) / d)
        shrunk.append((cx + (center[0] - cx) * k, cz + (center[1] - cz) * k))
    for i, a in enumerate(shrunk):
        b = shrunk[(i + 1) % len(shrunk)]
        for j, c in enumerate(poly):
            if segments_cross(a, b, c, poly[(j + 1) % len(poly)]):
                return False
    return True


def interior_anchor(poly: Sequence[Point]) -> Point:
    """Punto interior más alejado de las paredes (rejilla): el "centro" útil de un cuarto cóncavo."""
    xs, zs = [p[0] for p in poly], [p[1] for p in poly]
    min_x, max_x, min_z, max_z = min(xs), max(xs), min(zs), max(zs)
    center = ((min_x + max_x) / 2, (min_z + max_z) / 2)
    steps = 40
    best, best_d, best_to_center = center, -1.0, math.inf
    for i in range(steps + 1):
        for j in range(steps + 1):
            p = (min_x + (max_x - min_x) * i / steps, min_z + (max_z - min_z) * j / steps)
            if not point_in_polygon(p, poly):
                continue
            d = distance_to_boundary(p, poly)
            to_center = math.hypot(p[0] - center[0], p[1] - center[1])
            # A igual holgura gana el más cercano al centro (en un rectángulo, su centro exacto).
            if d > best_d + 1e-6 or (abs(d - best_d) <= 1e-6 and to_center < best_to_center):
                best, best_d, best_to_center = p, d, to_center
    return best


@dataclass(frozen=True)
class RoomGeometry:
    """La planta de un cuarto para el motor de distribución: dónde cabe algo y dónde están sus rincones."""

    shell: RoomShell

    @cached_property
    def poly(self) -> list[Point]:
        return [(w.start.x, w.start.z) for w in self.shell.walls]

    @cached_property
    def canonical(self) -> bool:
        return signed_area(self.poly) >= 0

    @cached_property
    def is_box(self) -> bool:
        """El cuarto es exactamente su caja: va por el camino rápido de siempre."""
        s = self.shell
        if len(s.walls) != 4:
            return False

        def on_corner(x: float, z: float) -> bool:
            return (abs(x) < 1e-6 or abs(x - s.widthM) < 1e-6) and (abs(z) < 1e-6 or abs(z - s.depthM) < 1e-6)

        return all(
            on_corner(w.start.x, w.start.z)
            and on_corner(w.end.x, w.end.z)
            and (abs(w.start.x - w.end.x) < 1e-6 or abs(w.start.z - w.end.z) < 1e-6)
            for w in s.walls
        )

    def inside(self, fp: Footprint, tolerance: float = 0.005) -> bool:
        if self.is_box:
            min_x, min_z, max_x, max_z = fp.bounds()
            return min_x >= -tolerance and min_z >= -tolerance and max_x <= self.shell.widthM + tolerance and max_z <= self.shell.depthM + tolerance
        cx = sum(c[0] for c in fp.corners) / 4
        cz = sum(c[1] for c in fp.corners) / 4
        return quad_inside_polygon(fp.corners, (cx, cz), self.poly, tolerance)

    @cached_property
    def center(self) -> Point:
        if self.is_box:
            return self.shell.widthM / 2, self.shell.depthM / 2
        return interior_anchor(self.poly)

    def inward_normal(self, ux: float, uz: float) -> Point:
        """Normal interior de una pared con dirección unitaria (ux, uz) de start a end."""
        sign = 1.0 if self.canonical else -1.0
        return -uz * sign + 0.0, ux * sign + 0.0

    def corners(self, inset: float) -> list[Point]:
        """Rincones del cuarto (esquinas salientes), cada uno metido `inset` desde sus dos paredes."""
        poly = self.poly
        n = len(poly)
        out: list[Point] = []
        for i, (vx, vz) in enumerate(poly):
            if not is_convex_vertex(poly, i):
                continue
            px, pz = poly[(i - 1) % n]
            qx, qz = poly[(i + 1) % n]
            lp = math.hypot(vx - px, vz - pz) or 1.0
            ln = math.hypot(qx - vx, qz - vz) or 1.0
            n1 = self.inward_normal((vx - px) / lp, (vz - pz) / lp)
            n2 = self.inward_normal((qx - vx) / ln, (qz - vz) / ln)
            out.append((vx + (n1[0] + n2[0]) * inset, vz + (n1[1] + n2[1]) * inset))
        return out
