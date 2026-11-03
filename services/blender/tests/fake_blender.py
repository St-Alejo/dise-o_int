"""Doble de Blender para los tests: imprime lo mismo que render_scene.py y deja archivos falsos.

FAKE_BLENDER=ok (por defecto) | fail | hang | mute (termina bien pero sin RENDER_RESULT).
"""

import argparse
import json
import os
import sys
import time

args = argparse.ArgumentParser()
args.add_argument("--scene")
args.add_argument("--plan")
args.add_argument("--out")
args.add_argument("--save-blend", action="store_true")
opts = args.parse_args(sys.argv[sys.argv.index("--") + 1 :])
mode = os.environ.get("FAKE_BLENDER", "ok")

print("Read blend: (factory)", flush=True)
print("Fra:1 Mem:120M | Loading render kernels", flush=True)
if mode == "hang":
    time.sleep(60)
for i in range(1, 5):
    print(f"Fra:1 Mem:300M | Rendered 1/1 Tiles, Sample {i * 32}/128", flush=True)
if mode == "fail":
    print("Error: CUDA error: out of memory in cuMemAlloc", flush=True)
    sys.exit(1)

files = {"image": f"{opts.out}.png", "preview": f"{opts.out}.jpg"}
if opts.save_blend:
    files["blend"] = f"{opts.out}.blend"
for path in files.values():
    with open(path, "wb") as f:
        f.write(b"fake " + path.encode())
if mode != "mute":
    print("RENDER_RESULT " + json.dumps({"files": files, "device": "CPU", "seconds": 1.5}), flush=True)
