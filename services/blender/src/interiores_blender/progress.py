"""Leer el avance de Blender en su salida estándar."""

from __future__ import annotations

import re

_SAMPLE = re.compile(r"Sample (\d+)/(\d+)")
#: Lo que imprime render_scene.py al terminar, con el resumen en JSON.
RESULT_PREFIX = "RENDER_RESULT "
#: Fases previas al muestreo (cargar, compilar kernels, BVH): se cuentan como los primeros puntos.
_STAGES = (("Loading render kernels", 3), ("Updating Scene BVH", 5), ("Updating Images", 7), ("Loading denoising kernels", 95))
PREPARE_PCT = 8
DENOISE_PCT = 96


def progress_pct(line: str) -> int | None:
    """Porcentaje (0–100) que indica una línea de Blender, o None si no dice nada del avance.

    El muestreo ocupa del 8 % al 95 %; antes van la carga y el BVH, y al final el denoiser y el
    guardado. Con muestreo adaptativo Blender puede terminar antes de la última muestra.
    """
    match = _SAMPLE.search(line)
    if match:
        done, total = int(match.group(1)), int(match.group(2))
        if total <= 0:
            return None
        return PREPARE_PCT + round((DENOISE_PCT - 1 - PREPARE_PCT) * min(done, total) / total)
    for marker, pct in _STAGES:
        if marker in line:
            return pct
    return None
