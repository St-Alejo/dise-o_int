"""Renderiza una escena exportada por la web con Cycles, siguiendo un BlenderPlan (ADR-0036).

Corre DENTRO de Blender (su Python 3.11, con bpy):

    blender -b --factory-startup --python render_scene.py -- \\
        --scene sala.glb --plan plan.json --out /tmp/out/render [--save-blend]

Deja `<out>.png`, `<out>.jpg` y, si se pide, `<out>.blend`, e imprime una línea
`RENDER_RESULT {...}` con el dispositivo y los segundos. Todo lo que decide el aspecto vive en
`interiores_blender.look` (puro, con pruebas); aquí solo se traduce a nodos de Blender.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import bpy  # type: ignore[import-not-found]
from mathutils import Vector  # type: ignore[import-not-found]

sys.path.insert(0, os.environ.get("INTERIORES_BLENDER_SRC", str(Path(__file__).resolve().parents[1] / "src")))
from interiores_blender.look import (
    DROP_NAMES,
    MaterialRecipe,
    camera_sees_through_back,
    clamp_roughness,
    hex_to_linear,
    kelvin_to_linear,
    portal_for,
    recipe_for,
    sun_rotation,
    to_blender,
)
from interiores_blender.progress import RESULT_PREFIX


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="render_scene")
    p.add_argument("--scene", required=True)
    p.add_argument("--plan", required=True)
    p.add_argument("--out", required=True, help="prefijo de salida, sin extensión")
    p.add_argument("--save-blend", action="store_true")
    return p.parse_args(argv)


# ---------------------------------------------------------------------------
# Escena
# ---------------------------------------------------------------------------


def import_scene(path: str) -> list[bpy.types.Object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = []
    for obj in list(bpy.data.objects):
        if obj.type in {"LIGHT", "CAMERA"} or obj.name.split(".")[0] in DROP_NAMES:
            bpy.data.objects.remove(obj, do_unlink=True)
        elif obj.type == "MESH":
            meshes.append(obj)
            # Paredes que el estudio recorta para ver dentro: no se ven, pero tapan la luz y rebotan.
            if obj.get("renderCameraHidden"):
                obj.visible_camera = False
    return meshes


def node(tree: bpy.types.NodeTree, kind: str, x: float, y: float) -> bpy.types.Node:
    n = tree.nodes.new(kind)
    n.location = (x, y)
    return n


def principled_of(material: bpy.types.Material) -> tuple[bpy.types.Node | None, bpy.types.Node | None]:
    if not material.use_nodes:
        material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or next(
        (n for n in nodes if n.type == "OUTPUT_MATERIAL"), None
    )
    return bsdf, out


def set_input(bsdf: bpy.types.Node, name: str, value: object) -> None:
    socket = bsdf.inputs.get(name)
    if socket is not None and not socket.is_linked:
        socket.default_value = value


def upgrade_material(material: bpy.types.Material, recipe: MaterialRecipe, see_through_back: bool = False) -> None:
    """Aplica la receta sobre el Principled BSDF que creó el importador glTF."""
    bsdf, out = principled_of(material)
    if bsdf is None or out is None:
        return
    tree = material.node_tree
    links = tree.links
    # Las luces son luces de verdad: el brillo fingido de pantallas y metales del visor sobra.
    set_input(bsdf, "Emission Strength", 0.0)
    rough = bsdf.inputs["Roughness"]
    if not rough.is_linked:
        rough.default_value = clamp_roughness(rough.default_value, recipe)
    if recipe.metallic is not None:
        set_input(bsdf, "Metallic", recipe.metallic)
    if recipe.sheen:
        set_input(bsdf, "Sheen Weight", recipe.sheen)
        set_input(bsdf, "Sheen Roughness", 0.5)
    if recipe.coat:
        set_input(bsdf, "Coat Weight", recipe.coat)
        set_input(bsdf, "Coat Roughness", recipe.coat_roughness)
    if recipe.transmission is not None:
        set_input(bsdf, "Transmission Weight", recipe.transmission)
        set_input(bsdf, "IOR", 1.45 if recipe.shadow_transparent else 1.5)
        set_input(bsdf, "Alpha", 1.0)

    # Normal: lo que ya viniera (mapa de normales) → bisel → micro-relieve → BSDF.
    normal_in = bsdf.inputs["Normal"]
    upstream = normal_in.links[0].from_socket if normal_in.is_linked else None
    x, y = bsdf.location.x - 300, bsdf.location.y - 400
    if recipe.bevel > 0:
        bevel = node(tree, "ShaderNodeBevel", x, y)
        bevel.samples = 6
        bevel.inputs["Radius"].default_value = recipe.bevel
        if upstream is not None:
            links.new(upstream, bevel.inputs["Normal"])
        upstream = bevel.outputs["Normal"]
    if recipe.micro_bump > 0:
        noise = node(tree, "ShaderNodeTexNoise", x - 400, y - 200)
        noise.inputs["Scale"].default_value = 180.0
        noise.inputs["Detail"].default_value = 6.0
        bump = node(tree, "ShaderNodeBump", x - 150, y - 200)
        bump.inputs["Strength"].default_value = recipe.micro_bump
        bump.inputs["Distance"].default_value = 0.0005
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        if upstream is not None:
            links.new(upstream, bump.inputs["Normal"])
        upstream = bump.outputs["Normal"]
    if upstream is not None and not (normal_in.is_linked and normal_in.links[0].from_socket == upstream):
        links.new(upstream, normal_in)

    surface = bsdf.outputs["BSDF"]
    if recipe.translucency > 0:
        translucent = node(tree, "ShaderNodeBsdfTranslucent", x, y + 300)
        base = bsdf.inputs["Base Color"]
        if base.is_linked:
            links.new(base.links[0].from_socket, translucent.inputs["Color"])
        else:
            translucent.inputs["Color"].default_value = base.default_value
        mix = node(tree, "ShaderNodeMixShader", out.location.x - 200, out.location.y)
        mix.inputs["Fac"].default_value = recipe.translucency
        links.new(surface, mix.inputs[1])
        links.new(translucent.outputs["BSDF"], mix.inputs[2])
        surface = mix.outputs["Shader"]
    if recipe.shadow_transparent:
        # Vidrio fino: para la cámara refleja y deja ver, para las sombras es transparente. Sin esto
        # el sol no entra por la ventana (un vidrio "de verdad" lo desviaría hacia ninguna parte).
        path = node(tree, "ShaderNodeLightPath", x, y + 500)
        clear = node(tree, "ShaderNodeBsdfTransparent", x, y + 650)
        mix = node(tree, "ShaderNodeMixShader", out.location.x - 200, out.location.y + 200)
        links.new(path.outputs["Is Shadow Ray"], mix.inputs["Fac"])
        links.new(surface, mix.inputs[1])
        links.new(clear.outputs["BSDF"], mix.inputs[2])
        surface = mix.outputs["Shader"]
    if see_through_back:
        # Como en el visor: un rayo de cámara que llega por el revés de techo o pared lo atraviesa.
        path = node(tree, "ShaderNodeLightPath", x, y + 850)
        geometry = node(tree, "ShaderNodeNewGeometry", x, y + 1050)
        both = node(tree, "ShaderNodeMath", x + 200, y + 900)
        both.operation = "MULTIPLY"
        clear = node(tree, "ShaderNodeBsdfTransparent", x + 200, y + 1100)
        mix = node(tree, "ShaderNodeMixShader", out.location.x - 200, out.location.y + 400)
        links.new(path.outputs["Is Camera Ray"], both.inputs[0])
        links.new(geometry.outputs["Backfacing"], both.inputs[1])
        links.new(both.outputs["Value"], mix.inputs["Fac"])
        links.new(surface, mix.inputs[1])
        links.new(clear.outputs["BSDF"], mix.inputs[2])
        surface = mix.outputs["Shader"]
    links.new(surface, out.inputs["Surface"])


def upgrade_materials(meshes: list[bpy.types.Object]) -> dict[str, int]:
    """Afina cada material una sola vez, con el papel de la primera malla que lo usa."""
    done: set[str] = set()
    roles: dict[str, int] = {}
    for obj in meshes:
        role = obj.get("renderRole")
        kind = obj.get("renderMaterial")
        roles[str(role)] = roles.get(str(role), 0) + 1
        for slot in obj.material_slots:
            material = slot.material
            if material is None or material.name in done:
                continue
            done.add(material.name)
            see_through = camera_sees_through_back(role, material.use_backface_culling)
            upgrade_material(material, recipe_for(role, kind), see_through)
    return roles


# ---------------------------------------------------------------------------
# Luz
# ---------------------------------------------------------------------------


def look_along(obj: bpy.types.Object, direction: Vector) -> None:
    """Orienta una luz o cámara para que su -Z apunte en `direction`."""
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_light(name: str, kind: str, energy: float, color: tuple[float, float, float]) -> bpy.types.Object:
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def room_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    floors = [o for o in meshes if o.get("renderRole") == "floor"] or meshes
    pts = [o.matrix_world @ Vector(c) for o in floors for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def build_lights(plan: dict, meshes: list[bpy.types.Object]) -> int:
    scene = bpy.context.scene
    world_plan = plan["world"]
    direction = Vector(to_blender(world_plan["sunDirection"])).normalized()

    world = bpy.data.worlds.new("Cielo")
    scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    background = tree.nodes["Background"]
    background.inputs["Strength"].default_value = world_plan["skyStrength"]
    if world_plan["sunStrength"] > 0:
        sky = tree.nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA"
        sky.sun_disc = False  # el sol lo pone la lámpara Sun (sombras nítidas y controlables)
        sky.sun_elevation = math.radians(max(2.0, world_plan["sunElevationDeg"]))
        sky.sun_rotation = sun_rotation(tuple(direction))
        sky.air_density = 1.0
        sky.dust_density = 1.5
        tree.links.new(sky.outputs["Color"], background.inputs["Color"])
        sun = add_light("Sol", "SUN", world_plan["sunStrength"], hex_to_linear(world_plan["sunColor"]))
        sun.data.angle = math.radians(1.2)  # el sol real mide ~0,5°; un poco más ablanda la sombra
        look_along(sun, direction)
    else:
        background.inputs["Color"].default_value = (*hex_to_linear(world_plan["sunColor"]), 1.0)

    # Luces portal en cada ventana: Cycles muestrea el cielo por ellas y el interior sale sin grano.
    lo, hi = room_bounds(meshes)
    centre = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
    portals = 0
    for obj in meshes:
        if obj.get("renderRole") != "window-glass":
            continue
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        portal = portal_for(
            (min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)),
            (max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)),
            centre,
        )
        if portal is None:
            continue
        light = add_light(f"Portal {portals + 1}", "AREA", 1.0, (1, 1, 1))
        light.data.shape = "RECTANGLE"
        light.data.size = portal.width
        light.data.size_y = portal.height
        light.data.cycles.is_portal = True
        facing = Vector(portal.facing)
        # Un pelo hacia dentro para no quedar dentro del vidrio.
        light.location = Vector(portal.center) + facing * 0.03
        look_along(light, facing)
        portals += 1

    lamps = plan["lamps"]
    lamp_color = kelvin_to_linear(lamps["kelvin"])
    for i, pos in enumerate(lamps["positions"]):
        lamp = add_light(f"Lámpara {i + 1}", "POINT", lamps["watts"], lamp_color)
        lamp.data.shadow_soft_size = 0.04
        lamp.location = to_blender(pos)

    ceiling = plan.get("ceiling")
    if ceiling:
        light = add_light("Techo", "AREA", ceiling["watts"], kelvin_to_linear(ceiling["kelvin"]))
        light.data.shape = "DISK"
        light.data.size = 0.35
        light.location = Vector(to_blender(ceiling["position"])) - Vector((0, 0, 0.05))
        look_along(light, Vector((0, 0, -1)))
    return portals


# ---------------------------------------------------------------------------
# Cámara y render
# ---------------------------------------------------------------------------


def build_camera(plan: dict) -> None:
    scene = bpy.context.scene
    cam_plan = plan["camera"]
    data = bpy.data.cameras.new("Cámara")
    data.lens = cam_plan["focalMm"]
    data.sensor_width = cam_plan["sensorMm"]
    data.sensor_height = cam_plan["sensorMm"]
    data.sensor_fit = cam_plan["sensorFit"]
    data.shift_y = cam_plan["shiftY"]
    data.clip_start = 0.05
    data.clip_end = 200
    cam = bpy.data.objects.new("Cámara", data)
    scene.collection.objects.link(cam)
    position = Vector(to_blender(cam_plan["position"]))
    cam.location = position
    look_along(cam, Vector(to_blender(cam_plan["target"])) - position)
    scene.camera = cam


def pick_device(scene: bpy.types.Scene) -> str:
    """OptiX si hay una NVIDIA RTX, luego CUDA y si no CPU. CYCLES_DEVICE lo fuerza."""
    wanted = os.environ.get("CYCLES_DEVICE", "AUTO").upper()
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA") if wanted == "AUTO" else (wanted,):
        if kind == "CPU":
            break
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
        except TypeError:
            continue
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            return f"{kind} ({gpus[0].name})"
    scene.cycles.device = "CPU"
    return "CPU"


def configure_render(plan: dict) -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    device = pick_device(scene)
    cycles = scene.cycles
    settings = plan["cycles"]
    cap = int(os.environ.get("BLENDER_MAX_SAMPLES", "0") or 0)
    cycles.samples = min(settings["samples"], cap) if cap > 0 else settings["samples"]
    cycles.use_adaptive_sampling = True
    cycles.adaptive_threshold = settings["adaptiveThreshold"]
    cycles.max_bounces = settings["maxBounces"]
    cycles.diffuse_bounces = min(6, settings["maxBounces"])
    cycles.glossy_bounces = min(6, settings["maxBounces"])
    cycles.transmission_bounces = settings["maxBounces"]
    cycles.transparent_max_bounces = 16
    cycles.caustics_reflective = False
    cycles.caustics_refractive = False
    cycles.sample_clamp_direct = 0.0
    cycles.sample_clamp_indirect = settings["clampIndirect"]
    cycles.blur_glossy = 1.0
    cycles.use_denoising = True
    cycles.denoiser = "OPTIX" if device.startswith("OPTIX") else "OPENIMAGEDENOISE"
    cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    cycles.denoising_prefilter = "ACCURATE"
    if hasattr(cycles, "denoising_use_gpu"):
        cycles.denoising_use_gpu = device != "CPU"
    scene.render.use_persistent_data = False
    scene.render.resolution_x = plan["width"]
    scene.render.resolution_y = plan["height"]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    view = scene.view_settings
    view.view_transform = "AgX"
    try:
        view.look = plan["world"]["look"]
    except TypeError:
        view.look = "None"
    view.exposure = plan["world"]["exposure"]
    scene.display_settings.display_device = "sRGB"
    add_glare(scene)
    return device


def add_glare(scene: bpy.types.Scene) -> None:
    """Un halo suave alrededor de lo muy brillante (bombillas, reflejos del sol), como una lente."""
    try:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        layers = tree.nodes.new("CompositorNodeRLayers")
        glare = tree.nodes.new("CompositorNodeGlare")
        composite = tree.nodes.new("CompositorNodeComposite")
        glare.glare_type = "FOG_GLOW"
        for attr, value in (("quality", "HIGH"), ("mix", -0.85), ("threshold", 1.2), ("size", 8)):
            if hasattr(glare, attr):
                setattr(glare, attr, value)
        tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], composite.inputs["Image"])
    except Exception as err:  # el posprocesado es un extra: sin él la imagen sigue siendo buena
        print(f"[render] sin halo de lente: {err}", flush=True)
        scene.use_nodes = False


def save_outputs(out: str, save_blend: bool) -> dict[str, str]:
    scene = bpy.context.scene
    files = {"image": f"{out}.png", "preview": f"{out}.jpg"}
    settings = scene.render.image_settings
    settings.file_format = "PNG"
    settings.color_mode = "RGB"
    settings.color_depth = "8"
    settings.compression = 40
    scene.render.filepath = files["image"]
    bpy.ops.render.render(write_still=True)
    result = bpy.data.images["Render Result"]
    settings.file_format = "JPEG"
    settings.quality = 90
    result.save_render(files["preview"], scene=scene)
    if save_blend:
        files["blend"] = f"{out}.blend"
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=files["blend"], compress=True, copy=True)
    return files


def main() -> None:
    args = parse_args()
    started = time.monotonic()
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    meshes = import_scene(args.scene)
    roles = upgrade_materials(meshes)
    portals = build_lights(plan, meshes)
    build_camera(plan)
    device = configure_render(plan)
    print(f"[render] {len(meshes)} mallas {roles}, {portals} portales, {device}", flush=True)
    files = save_outputs(args.out, args.save_blend)
    summary = {"files": files, "device": device, "seconds": round(time.monotonic() - started, 1)}
    print(RESULT_PREFIX + json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
