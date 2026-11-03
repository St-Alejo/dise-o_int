"""Escena mínima para el humo en CPU: un cuarto con piso, paredes, techo, una ventana y un mueble.

Se arma con bpy y se exporta a glTF con los mismos extras que pone la web (renderRole y
renderMaterial), así el humo no depende de un .glb binario en el repo. Uso:
    blender -b --python make_scene.py -- salida.glb
"""

import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)


Vec3 = tuple[float, float, float]


def box(name: str, size: Vec3, at: Vec3, role: str, kind: str) -> None:
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    obj["renderRole"] = role
    obj["renderMaterial"] = kind
    material = bpy.data.materials.new(name)
    material.use_backface_culling = True
    obj.data.materials.append(material)


# Blender: Z arriba. Cuarto de 3 × 3 × 2,5 m con la ventana en la pared del fondo.
box("floor", (3, 3, 0.02), (0, 0, -0.01), "floor", "wood")
box("ceiling", (3, 3, 0.02), (0, 0, 2.51), "ceiling", "paint")
box("wall-left", (0.1, 3, 2.5), (-1.55, 0, 1.25), "wall", "paint")
box("wall-right", (0.1, 3, 2.5), (1.55, 0, 1.25), "wall", "paint")
box("wall-back-low", (3, 0.1, 0.9), (0, 1.55, 0.45), "wall", "paint")
box("wall-back-high", (3, 0.1, 0.4), (0, 1.55, 2.3), "wall", "paint")
box("window-glass", (1.2, 0.01, 1.2), (0, 1.55, 1.5), "window-glass", "glass")
box("sofa", (1.6, 0.8, 0.45), (0, 0.6, 0.225), "furniture", "fabric")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_extras=True)
