"""Leer el avance de Blender en su salida estándar."""

from __future__ import annotations

import re

_SAMPLE = re.compile(r"Sample (\d+)/(\d+)")
#: Lo que imprime render_scene.py al terminar, con el resumen en JSON.
RESULT_PREFIX = "RENDER_RESULT "
#: Entre estas dos líneas render_scene.py hace el pre-render que mide la luz: sus muestras no son avance.
MEASURE_START = "[render] midiendo la luz"
MEASURE_END = "[render] luz medida"
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


class ProgressReader:
    """`progress_pct` línea a línea, sin contar las muestras del pre-render que mide la luz."""

    def __init__(self) -> None:
        self._measuring = False

    def feed(self, line: str) -> int | None:
        if line.startswith(MEASURE_START):
            self._measuring = True
            return None
        if line.startswith(MEASURE_END):
            self._measuring = False
            return None
        return None if self._measuring else progress_pct(line)
