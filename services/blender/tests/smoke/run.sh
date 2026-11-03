#!/bin/sh
# Humo del nodo Blender en CPU: arma la escena mínima, la renderiza a 64×64 y comprueba que salgan
# la imagen, la vista previa y el .blend. Corre dentro de la imagen `prod` (ver .github/workflows/ci.yml).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
blender -b --python "$here/make_scene.py" -- "$work/scene.glb" > "$work/export.log" 2>&1 || { cat "$work/export.log"; exit 1; }
CYCLES_DEVICE=CPU blender -b --python /app/blender/render_scene.py -- \
  --scene "$work/scene.glb" --plan "$here/plan.json" --out "$work/render" --save-blend | tee "$work/render.log"
grep -q '^RENDER_RESULT ' "$work/render.log"
# Los extras llegaron: la ventana se reconoce y lleva su luz portal.
grep -q ', 1 portales,' "$work/render.log"
for f in render.png render.jpg render.blend; do
  test -s "$work/$f" || { echo "falta $f"; exit 1; }
done
echo "humo OK: $(ls -s "$work" | tr '\n' ' ')"
