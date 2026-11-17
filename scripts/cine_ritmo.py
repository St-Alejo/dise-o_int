"""Calcula el ritmo de la película de la portada (apps/web/public/cine/{desk,mob}).

Mide cuánto cambia la imagen entre fotogramas seguidos y reparte el scroll en proporción: los
tramos quietos avanzan a ritmo normal y los cambios bruscos (el salto de un estilo a otro) reciben
hasta MAX_STRETCH veces más recorrido, para que se vean como un fundido y no como un parpadeo.
Escribe `ritmo.json` junto a los fotogramas: la posición (0..1) de cada uno en el recorrido.

Uso: python scripts/cine_ritmo.py   (necesita Pillow y numpy)
"""

import json
import statistics
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "cine"
MAX_STRETCH = 5.0


def positions(folder: Path) -> list[float]:
    frames = sorted(folder.glob("f*.webp"))
    prev = None
    diffs: list[float] = []
    for f in frames:
        a = np.asarray(Image.open(f).convert("L").resize((96, 96)), dtype=float)
        if prev is not None:
            diffs.append(float(np.abs(a - prev).mean()))
        prev = a
    calm = statistics.median(diffs)
    weights = [min(MAX_STRETCH, max(1.0, d / calm)) for d in diffs]
    total = sum(weights)
    pos, acc = [0.0], 0.0
    for w in weights:
        acc += w
        pos.append(round(acc / total, 5))
    pos[-1] = 1.0
    return pos


for name in ("desk", "mob"):
    folder = ROOT / name
    pos = positions(folder)
    (folder / "ritmo.json").write_text(json.dumps({"count": len(pos), "pos": pos}, separators=(",", ":")))
    print(name, len(pos), "fotogramas")
