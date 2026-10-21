"""Zonas interiores (baño privado, vestidor, tocador) para el motor de distribución.

Cada zona cerrada se distribuye como un cuarto propio: sus paredes son su contorno, con los
tabiques metidos medio espesor (los muebles se apoyan en la cara del tabique, no en su eje) y su
puerta como una puerta más. El resto del cuarto la trata como un sitio vedado y deja libre el
paso delante de su puerta. Espejo de `packages/shared-types/src/zones.ts`.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from ..contracts import Opening, RoomShell, RoomType, Vector3, WallSegment, Zone, ZoneKind
from .geometry import Footprint, Point, angle_facing
from .polygon import distance_to_boundary, point_in_polygon, segments_cross, signed_area

PARTITION_THICKNESS_M = 0.08
ZONE_DOOR_HEIGHT_M = 2.05
# Un lado a menos de esto de una pared del cuarto se apoya en ella (no es tabique).
ON_WALL_M = 0.03
# Lo que se separa un mueble de fuera de la línea de un tabique: medio espesor y un pelo.
KEEP_OUT_M = PARTITION_THICKNESS_M / 2 + 0.02
DOOR_CLEARANCE_M = 0.9

# Qué tipo de cuarto se usa para distribuir cada clase de zona.
ZONE_ROOM_TYPE: dict[ZoneKind, RoomType] = {
    "bathroom": "bathroom",
    "closet": "bedroom",
    "vanity": "bedroom",
    "office-nook": "office",
}


@dataclass(frozen=True)
class ZoneEdge:
    a: Point
    b: Point
    partition: bool


def _room_poly(shell: RoomShell) -> list[Point]:
    return [(w.start.x, w.start.z) for w in shell.walls]


def zone_poly(zone: Zone) -> list[Point]:
    return [(p.x, p.z) for p in zone.outline]


def closed_zones(shell: RoomShell) -> list[Zone]:
    return [z for z in shell.zones or [] if not z.open]


def zone_edges(shell: RoomShell, zone: Zone) -> list[ZoneEdge]:
    room = _room_poly(shell)
    pts = zone_poly(zone)
    out: list[ZoneEdge] = []
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        on_wall = all(distance_to_boundary(p, room) < ON_WALL_M for p in (a, b, mid))
        out.append(ZoneEdge(a, b, partition=not zone.open and not on_wall))
    return out


def _inward(poly: Sequence[Point], a: Point, b: Point) -> Point:
    length = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    ux, uz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    sign = 1.0 if signed_area(poly) >= 0 else -1.0
    return -uz * sign, ux * sign


def _intersect(p: Point, d: Point, q: Point, e: Point) -> Point | None:
    """Cruce de las rectas p + t·d y q + s·e (None si son paralelas)."""
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-9:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return p[0] + d[0] * t, p[1] + d[1] * t


def _inset(poly: list[Point], edges: list[ZoneEdge]) -> list[Point]:
    """El contorno con cada tabique corrido medio espesor hacia dentro (las paredes no se mueven)."""
    n = len(poly)
    lines: list[tuple[Point, Point]] = []
    for e in edges:
        shift = PARTITION_THICKNESS_M / 2 if e.partition else 0.0
        nx, nz = _inward(poly, e.a, e.b)
        lines.append(((e.a[0] + nx * shift, e.a[1] + nz * shift), (e.b[0] - e.a[0], e.b[1] - e.a[1])))
    out: list[Point] = []
    for i in range(n):
        prev_p, prev_d = lines[(i - 1) % n]
        p, d = lines[i]
        out.append(_intersect(prev_p, prev_d, p, d) or p)
    return out


def zone_shell(shell: RoomShell, zone: Zone) -> RoomShell:
    """La zona como un cuarto: sus lados son paredes y la puerta de la zona, su puerta."""
    edges = zone_edges(shell, zone)
    pts = _inset(zone_poly(zone), edges)
    walls: list[WallSegment] = []
    openings: list[Opening] = []
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        wall_id = f"zone-{zone.id}-{i}"
        walls.append(WallSegment(id=wall_id, start=Vector3(x=a[0], y=0, z=a[1]), end=Vector3(x=b[0], y=0, z=b[1]), hasWindow=False))
        if zone.door is not None and zone.door.edge == i:
            # La puerta se midió sobre el contorno original: se proyecta sobre el lado ya corrido.
            src = edges[i]
            length = math.hypot(src.b[0] - src.a[0], src.b[1] - src.a[1]) or 1.0
            cx = src.a[0] + (src.b[0] - src.a[0]) * zone.door.offsetM / length
            cz = src.a[1] + (src.b[1] - src.a[1]) * zone.door.offsetM / length
            new_len = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
            offset = ((cx - a[0]) * (b[0] - a[0]) + (cz - a[1]) * (b[1] - a[1])) / new_len
            openings.append(
                Opening(
                    id=f"zone-door-{zone.id}",
                    type="door",
                    wallId=wall_id,
                    widthM=zone.door.widthM,
                    heightM=ZONE_DOOR_HEIGHT_M,
                    offsetM=max(0.0, offset),
                )
            )
        elif not edges[i].partition:
            openings.extend(_room_openings_on(shell, edges[i], a, b, wall_id))
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    return shell.model_copy(
        update={
            "id": f"{shell.id}-{zone.id}"[:64],
            "widthM": max(0.1, max(xs) - min(xs)),
            "depthM": max(0.1, max(zs) - min(zs)),
            "walls": walls,
            "openings": openings,
            "zones": None,
            "shape": None,
        }
    )


def _room_openings_on(shell: RoomShell, edge: ZoneEdge, a: Point, b: Point, wall_id: str) -> list[Opening]:
    """Las ventanas y puertas del cuarto que caen en un lado de la zona apoyado en una pared."""
    out: list[Opening] = []
    length = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    for o in shell.openings:
        wall = next((w for w in shell.walls if w.id == o.wallId), None)
        if wall is None:
            continue
        wlen = math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) or 1.0
        cx = wall.start.x + (wall.end.x - wall.start.x) * o.offsetM / wlen
        cz = wall.start.z + (wall.end.z - wall.start.z) * o.offsetM / wlen
        if distance_to_boundary((cx, cz), [edge.a, edge.b]) > ON_WALL_M:
            continue
        offset = ((cx - a[0]) * (b[0] - a[0]) + (cz - a[1]) * (b[1] - a[1])) / length
        if 0 < offset < length:
            out.append(o.model_copy(update={"id": f"{o.id}-{wall_id}"[:64], "wallId": wall_id, "offsetM": offset}))
    return out


def door_clearance_outside(shell: RoomShell, zone: Zone) -> Footprint | None:
    """Paso libre delante de la puerta de la zona, del lado del cuarto."""
    if zone.door is None:
        return None
    edge = zone_edges(shell, zone)[zone.door.edge]
    a, b = edge.a, edge.b
    length = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    ux, uz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    nx, nz = _inward(zone_poly(zone), a, b)
    # Hacia fuera de la zona es contra su normal interior.
    ox, oz = -nx, -nz
    depth = DOOR_CLEARANCE_M
    cx = a[0] + ux * zone.door.offsetM + ox * (KEEP_OUT_M + depth / 2)
    cz = a[1] + uz * zone.door.offsetM + oz * (KEEP_OUT_M + depth / 2)
    return Footprint.of(cx, cz, zone.door.widthM + 0.2, depth, angle_facing(ox, oz))


def touches_zone(fp: Footprint, poly: Sequence[Point], margin: float = KEEP_OUT_M) -> bool:
    """¿La huella invade la zona o queda a menos de `margin` de su contorno?"""
    corners = fp.corners
    if any(point_in_polygon(c, poly) for c in corners):
        return True
    if any(point_in_polygon(v, corners) for v in poly):
        return True
    for i, a in enumerate(corners):
        b = corners[(i + 1) % 4]
        for j, c in enumerate(poly):
            d = poly[(j + 1) % len(poly)]
            if segments_cross(a, b, c, d):
                return True
    # Cerca del contorno sin tocarlo: se mira desde las esquinas y los puntos medios de la huella.
    probes = list(corners) + [((corners[i][0] + corners[(i + 1) % 4][0]) / 2, (corners[i][1] + corners[(i + 1) % 4][1]) / 2) for i in range(4)]
    if any(distance_to_boundary(p, poly) < margin for p in probes):
        return True
    return any(distance_to_boundary(v, corners) < margin for v in poly)


def zone_of(shell: RoomShell, x: float, z: float) -> Zone | None:
    """Zona cerrada en la que cae un punto (None = espacio común)."""
    return next((zone for zone in closed_zones(shell) if point_in_polygon((x, z), zone_poly(zone))), None)
