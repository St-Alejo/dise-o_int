"""Construcción del RoomShell: el rectangular "Manhattan" (§6.0 del documento) y el de forma libre."""

import math

from ..contracts import Opening, RoomShape, RoomShell, Vector3, WallSegment
from ..layout.polygon import signed_area


def rectangular_shell(
    width: float,
    depth: float,
    height: float,
    *,
    windows: list[tuple[float, float, float, float]] | None = None,
    door: bool = True,
    scale_confidence: float = 0.3,
    shell_id: str = "room",
) -> RoomShell:
    """Crea un cuarto rectangular.

    Paredes en sentido horario visto desde arriba: w-back (z=0, la que ve la cámara),
    w-right (x=width), w-front (z=depth, detrás de la cámara), w-left (x=0).
    `windows`: lista de (centro_x_normalizado, ancho_m, alto_m, alféizar_m) sobre w-back.
    """

    def p(x: float, z: float) -> Vector3:
        return Vector3(x=x, y=0, z=z)

    windows = windows or []
    walls = [
        WallSegment(id="w-back", start=p(0, 0), end=p(width, 0), hasWindow=bool(windows)),
        WallSegment(id="w-right", start=p(width, 0), end=p(width, depth), hasWindow=False),
        WallSegment(id="w-front", start=p(width, depth), end=p(0, depth), hasWindow=False),
        WallSegment(id="w-left", start=p(0, depth), end=p(0, 0), hasWindow=False),
    ]
    openings: list[Opening] = []
    placed: list[tuple[float, float]] = []  # (inicio, fin) de cada ventana sobre w-back
    for cx, w, h, sill in windows:
        w = min(w, width * 0.6)
        offset = min(max(cx * width, w / 2 + 0.1), width - w / 2 - 0.1)
        start, end = offset - w / 2, offset + w / 2
        # El detector puede devolver la misma ventana dos veces (o dos que el recorte junta):
        # una abertura que se solapa con otra no es física, así que se descarta.
        if any(start < e + 0.05 and s < end + 0.05 for s, e in placed):
            continue
        placed.append((start, end))
        openings.append(
            Opening(
                id=f"o-window-{len(placed)}",
                type="window",
                wallId="w-back",
                widthM=round(w, 3),
                heightM=round(min(h, height - sill - 0.1), 3),
                offsetM=round(offset, 3),
                sillHeightM=round(sill, 3),
            )
        )
    if door:
        # La puerta más habitual está detrás del fotógrafo; se usa como referencia de calibración.
        door_w = min(0.9, width * 0.3)
        openings.append(
            Opening(
                id="o-door-1",
                type="door",
                wallId="w-front",
                widthM=round(door_w, 3),
                heightM=round(min(2.05, height * 0.85), 3),
                offsetM=round(min(width * 0.8, max(0.6, width - 0.8)), 3),
                sillHeightM=0,
            )
        )
    return RoomShell(
        id=shell_id,
        widthM=round(width, 3),
        depthM=round(depth, 3),
        heightM=round(height, 3),
        walls=walls,
        openings=openings,
        scaleConfidence=scale_confidence,
        needsCalibration=True,
    )


_SIDE_IDS = {"back": "w-back", "right": "w-right", "front": "w-front", "left": "w-left"}


def polygon_shell(
    points: list[tuple[float, float]],
    height: float,
    *,
    openings: list[Opening] | None = None,
    shape: RoomShape | None = None,
    scale_confidence: float = 0.3,
    shell_id: str = "room",
) -> RoomShell:
    """Cuarto de forma libre a partir de su planta (espejo de `createPolygonShell` en TypeScript).

    La planta se lleva al origen y al orden canónico, empezando por la pared del fondo (z = 0).
    En cada lado de la caja, la pared más larga conserva el id histórico (`w-back`, `w-right`,
    `w-front`, `w-left`); las demás se numeran `w-2`, `w-3`… según su posición.
    """
    if len(points) < 3:
        raise ValueError("La planta del cuarto necesita al menos tres vértices")
    if signed_area(points) < 0:
        points = list(reversed(points))
    min_x, min_z = min(p[0] for p in points), min(p[1] for p in points)
    moved = [(round(x - min_x, 3), round(z - min_z, 3)) for x, z in points]
    width, depth = max(p[0] for p in moved), max(p[1] for p in moved)
    n = len(moved)
    first = next((i for i in range(n) if abs(moved[i][1]) < 1e-6 and abs(moved[(i + 1) % n][1]) < 1e-6 and moved[(i + 1) % n][0] > moved[i][0]), 0)
    poly = moved[first:] + moved[:first]

    def side_of(a: tuple[float, float], c: tuple[float, float]) -> str | None:
        if abs(a[1]) < 1e-6 and abs(c[1]) < 1e-6:
            return "back"
        if abs(a[0] - width) < 1e-6 and abs(c[0] - width) < 1e-6:
            return "right"
        if abs(a[1] - depth) < 1e-6 and abs(c[1] - depth) < 1e-6:
            return "front"
        if abs(a[0]) < 1e-6 and abs(c[0]) < 1e-6:
            return "left"
        return None

    edges = [(poly[i], poly[(i + 1) % n]) for i in range(n)]
    sides = [side_of(a, c) for a, c in edges]
    lengths = [math.hypot(c[0] - a[0], c[1] - a[1]) for a, c in edges]
    longest: dict[str, int] = {}
    for i, side in enumerate(sides):
        if side is not None and (side not in longest or lengths[i] > lengths[longest[side]] + 1e-9):
            longest[side] = i

    openings = openings or []
    walls: list[WallSegment] = []
    for i, ((ax, az), (cx, cz)) in enumerate(edges):
        side = sides[i]
        wall_id = _SIDE_IDS[side] if side is not None and longest[side] == i else f"w-{i + 1}"
        walls.append(
            WallSegment(
                id=wall_id,
                start=Vector3(x=ax, y=0, z=az),
                end=Vector3(x=cx, y=0, z=cz),
                hasWindow=any(o.wallId == wall_id and o.type == "window" for o in openings),
            )
        )
    return RoomShell(
        id=shell_id,
        widthM=width,
        depthM=depth,
        heightM=round(height, 3),
        shape=shape,
        walls=walls,
        openings=openings,
        scaleConfidence=scale_confidence,
        needsCalibration=True,
    )
