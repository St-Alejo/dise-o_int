"""Motor de colocación de muebles por reglas + minimización greedy de costo (Track B, MVP).

Para cada "rol" de la plantilla del tipo de cuarto (sofá, mesa de centro, cama, ...):
  1. se eligen los muebles del catálogo que encajan (categoría + estilo + tamaño),
  2. se generan poses candidatas según el anclaje del rol (contra una pared, frente a otro
     mueble, alrededor de la mesa, en una esquina, en el techo...),
  3. se descartan las inválidas (fuera del cuarto, solapes, bloquear puertas) y
  4. se elige la de menor costo (preferencias del rol + penalizaciones).

Los muebles bloqueados por el usuario (`lockedByUser`) son obstáculos fijos y, si ya
cubren un rol, ese rol no se vuelve a llenar. La interfaz `LayoutEngine` permite
reemplazar este motor por uno aprendido tipo ATISS (v2) sin tocar el resto.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field, replace
from typing import Literal, Protocol

from ..contracts import (
    FurniturePlacement,
    InventoryItem,
    LayoutCandidate,
    PlaceFurnitureRequest,
    PlaceFurnitureResponse,
    RoomShell,
    RoomType,
    StyleId,
    Vector3,
    WallSegment,
)
from .geometry import Footprint, angle_facing, forward, normalize_angle, overlaps, right
from .polygon import RoomGeometry

# "wall" y "surface" no compiten por el piso: un cuadro o una lámpara de mesa no bloquean muebles.
Layer = Literal["floor", "rug", "ceiling", "wall", "surface"]
Anchor = Literal["wall", "front-of", "facing-wall", "beside", "around", "corner", "center", "over", "under"]

DOOR_CLEARANCE_M = 0.9
CAMERA_WALL_ID = "w-front"  # pared detrás del fotógrafo (ver providers/shell.py)
WALL_GAP_M = 0.02


class LayoutEngine(Protocol):
    name: str

    def place(self, req: PlaceFurnitureRequest) -> PlaceFurnitureResponse: ...


@dataclass(frozen=True)
class Role:
    name: str
    match: Callable[[LayoutCandidate], bool]
    anchor: Anchor
    required: bool = False
    count: int = 1
    ref: str | None = None
    gap: float = 0.45
    prefer_window: bool = False


def is_(category: str, *subs: str) -> Callable[[LayoutCandidate], bool]:
    return lambda c: c.category == category and (not subs or (c.subcategory or "") in subs)


TEMPLATES: dict[RoomType, list[Role]] = {
    "living": [
        Role("sofa", is_("sofa"), "wall", required=True),
        Role("coffee-table", is_("table", "coffee-table"), "front-of", required=True, ref="sofa", gap=0.45),
        Role("tv-stand", is_("storage", "tv-stand"), "facing-wall", ref="sofa"),
        Role("armchair", is_("chair", "armchair"), "beside", ref="coffee-table", gap=0.35),
        Role("rug", is_("decor", "rug"), "under", ref="coffee-table"),
        Role("shelf", is_("storage", "shelf"), "wall"),
        Role("floor-lamp", is_("lighting", "floor-lamp"), "corner", ref="sofa"),
        Role("pendant", is_("lighting", "pendant"), "over", ref="coffee-table"),
        Role("plant", is_("decor", "plant"), "corner"),
    ],
    "bedroom": [
        Role("bed", is_("bed"), "wall", required=True),
        Role("nightstand", is_("table", "nightstand"), "beside", ref="bed", count=2, gap=0.05),
        Role("rug", is_("decor", "rug"), "under", ref="bed"),
        Role("dresser", is_("storage", "dresser", "shelf"), "wall"),
        Role("wardrobe", is_("storage", "wardrobe"), "wall"),
        Role("armchair", is_("chair", "armchair", "ottoman"), "corner"),
        Role("pendant", is_("lighting", "pendant"), "over", ref="bed"),
        Role("floor-lamp", is_("lighting", "floor-lamp"), "corner"),
        Role("plant", is_("decor", "plant"), "corner"),
    ],
    "dining": [
        Role("dining-table", is_("table", "dining-table"), "center", required=True),
        Role("dining-chair", is_("chair", "dining-chair"), "around", ref="dining-table", count=6),
        Role("rug", is_("decor", "rug"), "under", ref="dining-table"),
        Role("sideboard", is_("storage", "sideboard", "dresser", "shelf"), "wall"),
        Role("pendant", is_("lighting", "pendant"), "over", ref="dining-table"),
        Role("plant", is_("decor", "plant"), "corner"),
    ],
    "office": [
        Role("desk", is_("table", "desk"), "wall", required=True, prefer_window=True),
        Role("desk-chair", is_("chair", "office-chair", "dining-chair", "armchair"), "front-of", ref="desk", gap=0.05),
        Role("shelf", is_("storage", "shelf"), "wall"),
        Role("rug", is_("decor", "rug"), "under", ref="desk"),
        Role("floor-lamp", is_("lighting", "floor-lamp"), "corner", ref="desk"),
        Role("pendant", is_("lighting", "pendant"), "center"),
        Role("plant", is_("decor", "plant"), "corner"),
    ],
}


# Cada rol, tal como lo define la primera plantilla que lo usa: para colocar algo que se vio en la
# foto aunque no sea típico de ese tipo de cuarto (un escritorio en el dormitorio).
ROLE_LIBRARY: dict[str, Role] = {}
for _roles in TEMPLATES.values():
    for _role in _roles:
        ROLE_LIBRARY.setdefault(_role.name, _role)

# Cómo llama un modelo de visión a cada rol. Lo que no está aquí (una nevera, una isla) no tiene
# rol todavía y se ignora.
INVENTORY_ROLES: dict[str, str] = {
    "sofa": "sofa",
    "couch": "sofa",
    "sectional": "sofa",
    "loveseat": "sofa",
    "coffee table": "coffee-table",
    "center table": "coffee-table",
    "tv stand": "tv-stand",
    "tv unit": "tv-stand",
    "media console": "tv-stand",
    "tv": "tv-stand",
    "television": "tv-stand",
    "armchair": "armchair",
    "lounge chair": "armchair",
    "ottoman": "armchair",
    "rug": "rug",
    "carpet": "rug",
    "shelf": "shelf",
    "shelve": "shelf",
    "bookshelf": "shelf",
    "bookshelve": "shelf",
    "bookcase": "shelf",
    "shelving": "shelf",
    "lamp": "floor-lamp",
    "floor lamp": "floor-lamp",
    "pendant": "pendant",
    "pendant lamp": "pendant",
    "pendant light": "pendant",
    "chandelier": "pendant",
    "ceiling lamp": "pendant",
    "plant": "plant",
    "bed": "bed",
    "nightstand": "nightstand",
    "bedside table": "nightstand",
    "side table": "nightstand",
    "dresser": "dresser",
    "chest of drawers": "dresser",
    "wardrobe": "wardrobe",
    "closet": "wardrobe",
    "dining table": "dining-table",
    "dining chair": "dining-chair",
    "sideboard": "sideboard",
    "buffet": "sideboard",
    "console": "sideboard",
    "desk": "desk",
    "office chair": "desk-chair",
    "desk chair": "desk-chair",
}
# Palabras genéricas cuyo rol depende del tipo de cuarto.
CONTEXT_ROLES: dict[str, dict[RoomType, str]] = {
    "chair": {"living": "armchair", "bedroom": "armchair", "dining": "dining-chair", "office": "desk-chair"},
    "table": {"living": "coffee-table", "dining": "dining-table", "office": "desk"},
    "cabinet": {"living": "shelf", "bedroom": "dresser", "dining": "sideboard", "office": "shelf"},
}


def inventory_role(category: str, room_type: RoomType) -> str | None:
    """Rol al que corresponde lo que nombró el modelo de visión, o None si no hay ninguno."""
    key = " ".join(category.lower().replace("-", " ").replace("_", " ").split())
    for candidate in (key, key[:-1] if key.endswith("s") else key):
        if candidate in CONTEXT_ROLES:
            return CONTEXT_ROLES[candidate].get(room_type)
        if candidate in INVENTORY_ROLES:
            return INVENTORY_ROLES[candidate]
    return None


def roles_for(room_type: RoomType, inventory: list[InventoryItem] | None) -> list[Role]:
    """Qué se coloca y cuántos.

    Sin inventario, la plantilla completa del tipo de cuarto. Con inventario (lo que se vio en la
    foto), los roles imprescindibles más los que estaban en la foto, incluidos los que no son
    típicos de ese cuarto: dos fotos distintas dan dos distribuciones distintas.
    """
    template = TEMPLATES[room_type]
    if not inventory:
        return template
    seen: dict[str, int] = {}
    for item in inventory:
        role = inventory_role(item.category, room_type)
        if role is not None:
            seen[role] = seen.get(role, 0) + item.count
    if not seen:
        return template

    def sized(role: Role) -> Role:
        # Un rol múltiple (mesitas de noche, sillas de comedor) pone tantos como se vieron.
        return replace(role, count=max(1, min(role.count, seen[role.name]))) if role.count > 1 and role.name in seen else role

    roles = [sized(r) for r in template if r.required or r.name in seen]
    placed = {r.name for r in roles}
    for name in seen:
        extra = ROLE_LIBRARY.get(name)
        if extra is None or name in placed:
            continue
        # Lo que se apoya en otra pieza (sillas alrededor de la mesa) solo va si esa pieza también va.
        if extra.ref is not None and extra.ref not in placed and extra.ref not in seen:
            continue
        roles.append(replace(sized(extra), required=False))
        placed.add(name)
    # Primero las piezas de referencia: una silla de comedor necesita su mesa ya colocada.
    return sorted(roles, key=lambda r: 0 if r.ref is None else 1 if r.ref in placed else 2)


@dataclass
class Placed:
    id: str
    item: LayoutCandidate
    x: float
    z: float
    rot: float
    layer: Layer
    role: str | None
    locked: bool = False
    wall_id: str | None = None

    @property
    def fp(self) -> Footprint:
        d = self.item.dimensionsM
        return Footprint.of(self.x, self.z, d.x, d.z, self.rot)


@dataclass
class Pose:
    x: float
    z: float
    rot: float
    wall_id: str | None = None
    base_cost: float = 0.0


@dataclass
class Scene:
    shell: RoomShell
    placed: list[Placed] = field(default_factory=list)
    room: RoomGeometry = field(init=False)

    def __post_init__(self) -> None:
        self.room = RoomGeometry(self.shell)

    def by_role(self, role: str) -> list[Placed]:
        return [p for p in self.placed if p.role == role]


def layer_of(item: LayoutCandidate) -> Layer:
    if item.mount in ("ceiling", "wall", "surface"):
        return item.mount
    if item.subcategory == "rug":
        return "rug"
    return "floor"


def wall_frame(
    wall: WallSegment, shell: RoomShell
) -> tuple[tuple[float, float], tuple[float, float, float, float], float]:
    """Origen, (dirección unitaria, normal hacia el interior) y longitud de una pared."""
    sx, sz = wall.start.x, wall.start.z
    ex, ez = wall.end.x, wall.end.z
    length = math.hypot(ex - sx, ez - sz) or 1.0
    ux, uz = (ex - sx) / length, (ez - sz) / length
    # La normal interior sale del sentido de giro de la planta: "hacia el centro de la caja" falla
    # en un cuarto en L o en U, donde ese centro puede quedar fuera del cuarto.
    nx, nz = RoomGeometry(shell).inward_normal(ux, uz)
    return (sx, sz), (ux, uz, nx, nz), length


class RulesLayoutEngine:
    name = "rules-greedy-v1"

    def place(self, req: PlaceFurnitureRequest) -> PlaceFurnitureResponse:
        rng = random.Random(req.seed if req.seed is not None else 7)
        shell = req.roomShell
        catalog = {c.id: c for c in req.candidates}
        scene = Scene(shell)

        for lp in req.locked:
            item = catalog.get(lp.catalogItemId)
            if item is None:
                continue
            if lp.dimensionsM is not None:  # el usuario cambió el tamaño de esta pieza
                d = lp.dimensionsM
                item = item.model_copy(update={"dimensionsM": Vector3(x=d.x, y=d.y, z=d.z)})
            scene.placed.append(
                Placed(lp.id, item, lp.position.x, lp.position.z, lp.rotationY, layer_of(item), self._role_of(item, req.roomType), locked=True)
            )

        blocked = self._door_zones(shell)
        new: list[Placed] = []
        unplaced: list[str] = []
        required_total = 0
        required_ok = 0

        for role in roles_for(req.roomType, req.inventory):
            if role.required:
                required_total += 1
            already = len(scene.by_role(role.name))
            if already >= role.count:
                required_ok += role.required
                continue
            # v1 del motor: solo piso/techo; los objetos de pared y superficie los coloca el usuario o el chat.
            floor_or_ceiling = [c for c in req.candidates if c.mount in ("floor", "ceiling")]
            options = self._select(role, floor_or_ceiling, req.styleId, shell)
            if not options:
                if role.required:
                    unplaced.append(role.name)
                continue

            placed_any = False
            for item in options[:4]:  # si el mejor no cabe, se prueba el siguiente
                for _ in range(role.count - already):
                    pose = self._best_pose(role, item, scene, blocked)
                    if pose is None:
                        break
                    placed = Placed(
                        f"auto-{rng.getrandbits(40):010x}", item, pose.x, pose.z, pose.rot, layer_of(item), role.name, wall_id=pose.wall_id
                    )
                    scene.placed.append(placed)
                    new.append(placed)
                    placed_any = True
                if placed_any:
                    break
            if placed_any:
                required_ok += role.required
            elif role.required:
                unplaced.append(role.name)

        placements = [
            FurniturePlacement(
                id=p.id,
                catalogItemId=p.item.id,
                position=Vector3(
                    x=round(p.x, 4),
                    y=round(max(0.0, shell.heightM - p.item.dimensionsM.y) if p.layer == "ceiling" else 0.0, 4),
                    z=round(p.z, 4),
                ),
                rotationY=round(normalize_angle(p.rot), 6),
                lockedByUser=False,
            )
            for p in new
        ]
        score = required_ok / required_total if required_total else 1.0
        return PlaceFurnitureResponse(placements=placements, unplaced=unplaced, score=round(score, 3), engine=self.name)

    # ------------------------------------------------------------------ selección
    @staticmethod
    def _role_of(item: LayoutCandidate, room_type: RoomType) -> str | None:
        for role in TEMPLATES[room_type]:
            if role.match(item):
                return role.name
        return None

    @staticmethod
    def _select(role: Role, candidates: list[LayoutCandidate], style: StyleId | None, shell: RoomShell) -> list[LayoutCandidate]:
        longest = max(shell.widthM, shell.depthM)
        shortest = min(shell.widthM, shell.depthM)

        def fits(c: LayoutCandidate) -> bool:
            d = c.dimensionsM
            if c.mount == "ceiling":
                return d.y < shell.heightM - 1.9  # deja paso bajo la lámpara
            return max(d.x, d.z) <= longest * 0.8 and min(d.x, d.z) <= shortest * 0.7

        def score(c: LayoutCandidate) -> tuple[float, str]:
            s = 3.0 if style and style in c.styleTags else 0.0
            s -= 0.1 * len(c.styleTags)  # más específico del estilo = mejor
            return (-s, c.id)

        return sorted((c for c in candidates if role.match(c) and fits(c)), key=score)

    # ------------------------------------------------------------------ poses
    def _best_pose(self, role: Role, item: LayoutCandidate, scene: Scene, blocked: list[Footprint]) -> Pose | None:
        best: tuple[float, Pose] | None = None
        layer = layer_of(item)
        d = item.dimensionsM
        for pose in self._poses(role, item, scene):
            fp = Footprint.of(pose.x, pose.z, d.x, d.z, pose.rot)
            if not scene.room.inside(fp):
                continue
            if layer == "floor" and any(overlaps(fp, zone, 0.0) for zone in blocked):
                continue
            if any(p.layer == layer and overlaps(fp, p.fp) for p in scene.placed):
                continue
            cost = pose.base_cost + self._role_cost(role, item, pose, scene)
            if best is None or cost < best[0]:
                best = (cost, pose)
        return best[1] if best else None

    def _poses(self, role: Role, item: LayoutCandidate, scene: Scene) -> Iterator[Pose]:
        d = item.dimensionsM
        shell = scene.shell
        refs = scene.by_role(role.ref) if role.ref else []
        ref = refs[0] if refs else None

        if role.anchor in ("wall", "facing-wall"):
            yield from self._wall_poses(item, shell)
        elif role.anchor == "front-of" and ref:
            fx, fz = forward(ref.rot)
            dist = ref.item.dimensionsM.z / 2 + role.gap + d.z / 2
            facing_ref = role.name == "desk-chair"
            rot = normalize_angle(ref.rot + math.pi) if facing_ref else ref.rot
            for extra in (0.0, 0.1, 0.2, 0.35, -0.05):
                for lateral in (0.0, -0.3, 0.3):
                    rx, rz = right(ref.rot)
                    yield Pose(ref.x + fx * (dist + extra) + rx * lateral, ref.z + fz * (dist + extra) + rz * lateral, rot, base_cost=abs(extra) + abs(lateral))
        elif role.anchor == "beside" and ref:
            yield from self._beside_poses(role, item, ref)
        elif role.anchor == "around" and ref:
            yield from self._around_poses(item, ref, scene)
        elif role.anchor in ("under", "over") and ref:
            yield from self._centered_on(ref, scene, item)
        elif role.anchor == "corner":
            yield from self._corner_poses(item, scene.room, ref)
        elif role.anchor == "center" or (role.anchor in ("under", "over", "front-of", "beside", "around") and not ref):
            cx, cz = scene.room.center
            rot = 0.0 if shell.widthM >= shell.depthM else math.pi / 2
            for dx in (0.0, -0.3, 0.3, -0.6, 0.6):
                for dz in (0.0, -0.3, 0.3):
                    yield Pose(cx + dx, cz + dz, rot, base_cost=abs(dx) + abs(dz))

    def _wall_poses(self, item: LayoutCandidate, shell: RoomShell) -> Iterator[Pose]:
        d = item.dimensionsM
        for wall in shell.walls:
            (sx, sz), (ux, uz, nx, nz), length = wall_frame(wall, shell)
            if length < d.x + 0.1:
                continue
            steps = max(1, int((length - d.x) / 0.1))
            rot = angle_facing(nx, nz)
            for i in range(steps + 1):
                t = d.x / 2 + (length - d.x) * i / steps
                x = sx + ux * t + nx * (d.z / 2 + WALL_GAP_M)
                z = sz + uz * t + nz * (d.z / 2 + WALL_GAP_M)
                centered = abs(t - length / 2) / length  # preferencia suave por el centro de la pared
                yield Pose(x, z, rot, wall_id=wall.id, base_cost=centered)

    @staticmethod
    def _beside_poses(role: Role, item: LayoutCandidate, ref: Placed) -> Iterator[Pose]:
        d = item.dimensionsM
        rd = ref.item.dimensionsM
        rx, rz = right(ref.rot)
        fx, fz = forward(ref.rot)
        if role.name == "nightstand":
            # A ambos lados de la cama, alineadas con la cabecera.
            back_offset = -rd.z / 2 + d.z / 2
            for side in (-1, 1):
                lateral = side * (rd.x / 2 + role.gap + d.x / 2)
                yield Pose(ref.x + rx * lateral + fx * back_offset, ref.z + rz * lateral + fz * back_offset, ref.rot)
            return
        # Butaca a un lado de la mesa de centro, girada hacia ella.
        for side in (-1, 1):
            lateral = side * (rd.x / 2 + role.gap + d.z / 2)
            for along in (0.0, -0.3, 0.3):
                x = ref.x + rx * lateral + fx * along
                z = ref.z + rz * lateral + fz * along
                rot = angle_facing(ref.x - x, ref.z - z)
                yield Pose(x, z, rot, base_cost=abs(along))

    @staticmethod
    def _around_poses(item: LayoutCandidate, ref: Placed, scene: Scene) -> Iterator[Pose]:
        d = item.dimensionsM
        rd = ref.item.dimensionsM
        rx, rz = right(ref.rot)
        fx, fz = forward(ref.rot)
        # (desplazamiento lateral, desplazamiento frontal, dirección hacia la mesa)
        seats: list[tuple[float, float, tuple[float, float]]] = []
        per_long = 1 if rd.x < 1.3 else 2 if rd.x < 2.0 else 3
        for side in (-1, 1):  # lados largos: la silla mira perpendicular al borde de la mesa
            for k in range(per_long):
                along = (k - (per_long - 1) / 2) * (rd.x / per_long)
                seats.append((along, side * (rd.z / 2 + d.z / 2 + 0.02), (-side * fx, -side * fz)))
        if rd.x >= 1.5:  # cabeceras
            for side in (-1, 1):
                seats.append((side * (rd.x / 2 + d.z / 2 + 0.02), 0.0, (-side * rx, -side * rz)))
        used = {(round(p.x, 2), round(p.z, 2)) for p in scene.by_role("dining-chair")}
        for lat, fwd, (dx, dz) in seats:
            x = ref.x + rx * lat + fx * fwd
            z = ref.z + rz * lat + fz * fwd
            if (round(x, 2), round(z, 2)) in used:
                continue
            yield Pose(x, z, angle_facing(dx, dz))

    @staticmethod
    def _centered_on(ref: Placed, scene: Scene, item: LayoutCandidate) -> Iterator[Pose]:
        rot = ref.rot
        if ref.role == "coffee-table":
            # La alfombra se centra entre el sofá y la mesa de centro (agrupa la zona de estar).
            sofas = scene.by_role("sofa")
            if sofas:
                s = sofas[0]
                yield Pose((s.x + ref.x) / 2, (s.z + ref.z) / 2, rot)
        if ref.role == "bed":
            fx, fz = forward(rot)
            off = ref.item.dimensionsM.z * 0.2
            yield Pose(ref.x + fx * off, ref.z + fz * off, rot)
        yield Pose(ref.x, ref.z, rot)
        for dx in (-0.2, 0.2):
            yield Pose(ref.x + dx, ref.z, rot, base_cost=abs(dx))

    @staticmethod
    def _corner_poses(item: LayoutCandidate, room: RoomGeometry, ref: Placed | None) -> Iterator[Pose]:
        d = item.dimensionsM
        half = max(d.x, d.z) / 2 + 0.05
        cx, cz = room.center
        # Los rincones son las esquinas salientes: en una L, la esquina de la muesca no lo es.
        for x, z in room.corners(half):
            cost = 0.0 if ref is None else math.hypot(ref.x - x, ref.z - z) * 0.3
            yield Pose(x, z, angle_facing(cx - x, cz - z), base_cost=cost)

    # ------------------------------------------------------------------ costos
    def _role_cost(self, role: Role, item: LayoutCandidate, pose: Pose, scene: Scene) -> float:
        shell = scene.shell
        cost = 0.0
        wall = next((w for w in shell.walls if w.id == pose.wall_id), None)
        if wall is not None:
            windows = [o for o in shell.openings if o.type == "window" and o.wallId == wall.id]
            doors = [o for o in shell.openings if o.type == "door" and o.wallId == wall.id]
            tall = any(item.dimensionsM.y > o.sillHeightM - 0.05 for o in windows)
            if windows and tall and not role.prefer_window:
                cost += 3.0  # no tapar la luz con muebles altos
            if role.prefer_window:
                cost += 0.0 if windows else 1.5
            if wall.id == CAMERA_WALL_ID and item.dimensionsM.y > 1.2:
                # La foto se toma desde esa pared: un mueble alto ahí tapa la vista del cuarto en 3D.
                cost += 2.5
            if role.name in ("sofa", "bed") and doors:
                cost += 2.0  # el sofá / la cama no van en la pared de la puerta
            if role.name in ("sofa", "bed", "desk"):
                length = math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)
                cost += 1.0 - length / max(shell.widthM, shell.depthM)  # preferir la pared más larga
        if role.anchor == "facing-wall":
            refs = scene.by_role(role.ref or "")
            if refs:
                ref = refs[0]
                fx, fz = forward(ref.rot)
                # Debe quedar delante del sofá y mirándolo: alineado con su eje frontal.
                vx, vz = pose.x - ref.x, pose.z - ref.z
                along = vx * fx + vz * fz
                lateral = abs(vx * fz - vz * fx)
                cost += (5.0 if along <= 0 else 0.0) + lateral * 1.5
        if role.name == "plant":
            # Lejos de otras plantas / cerca de ventanas: da vida sin estorbar.
            cost += sum(0.5 for p in scene.placed if p.role == "plant")
        return cost

    @staticmethod
    def _door_zones(shell: RoomShell) -> list[Footprint]:
        """Zona libre delante de cada puerta (paso de 0.9 m)."""
        zones: list[Footprint] = []
        for o in shell.openings:
            if o.type != "door":
                continue
            wall = next((w for w in shell.walls if w.id == o.wallId), None)
            if wall is None:
                continue
            (sx, sz), (ux, uz, nx, nz), _ = wall_frame(wall, shell)
            cx = sx + ux * o.offsetM + nx * DOOR_CLEARANCE_M / 2
            cz = sz + uz * o.offsetM + nz * DOOR_CLEARANCE_M / 2
            zones.append(Footprint.of(cx, cz, o.widthM + 0.2, DOOR_CLEARANCE_M, angle_facing(nx, nz)))
        return zones
