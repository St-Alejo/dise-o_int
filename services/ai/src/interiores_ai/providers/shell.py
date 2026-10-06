"""Construcción del RoomShell "Manhattan" (paredes en ángulo recto, §6.0 del documento)."""

from ..contracts import Opening, RoomShell, Vector3, WallSegment


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
