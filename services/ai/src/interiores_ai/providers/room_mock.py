"""Room Understanding sin GPU (heurísticas clásicas de visión con OpenCV).

No pretende ser preciso: estima una caja plausible del cuarto a partir de la foto y deja
`needsCalibration=True` con `scaleConfidence` bajo, exactamente como pide la sección 8.1
del documento (la escala monocular es relativa; el usuario la confirma con un gesto).

Heurísticas:
- Proporción ancho/profundidad a partir del aspecto de la foto y de la posición de la
  línea piso-pared (líneas horizontales dominantes en la mitad inferior).
- Ventanas: regiones grandes y muy luminosas en la mitad superior con forma rectangular.
- Objetos: contornos de tamaño medio en la mitad inferior (muebles existentes).
"""

from typing import ClassVar

import cv2
import numpy as np

from ..contracts import DetectedObject, RoomType
from ..imaging import RGB
from .base import RoomAnalysis
from .shell import rectangular_shell

DEFAULT_DIMS: dict[RoomType, tuple[float, float, float]] = {
    "living": (4.4, 3.8, 2.6),
    "bedroom": (3.6, 3.4, 2.5),
    "dining": (3.8, 3.4, 2.6),
    "office": (3.2, 3.0, 2.5),
}


class MockRoomAnalyzer:
    name: ClassVar[str] = "mock-opencv"

    def analyze(self, image: RGB, room_type: RoomType) -> RoomAnalysis:
        h, w = image.shape[:2]
        scale = 640 / max(w, h)
        small = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
        sh, sw = gray.shape

        base_w, base_d, base_h = DEFAULT_DIMS[room_type]
        aspect = sw / sh
        horizon = self._floor_line(gray)  # 0..1 (fracción de la altura)

        # Fotos más panorámicas → cuarto más ancho; línea de piso más alta → cuarto más profundo.
        width = float(np.clip(base_w * (0.85 + 0.25 * (aspect - 1.33)), 2.4, 7.0))
        depth = float(np.clip(base_d * (0.8 + 0.6 * (0.75 - horizon)), 2.2, 7.0))
        windows = self._windows(small)
        objects = self._objects(gray, horizon)

        shell = rectangular_shell(
            round(width, 2),
            round(depth, 2),
            base_h,
            windows=[(cx, ww * width, hh * base_h, 0.9) for cx, ww, hh in windows],
            scale_confidence=0.3,
        )
        return RoomAnalysis(shell=shell, objects=objects)

    @staticmethod
    def _floor_line(gray: np.ndarray) -> float:
        edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 60, 160)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=60, minLineLength=gray.shape[1] // 5, maxLineGap=12)
        h = gray.shape[0]
        ys: list[float] = []
        if lines is not None:
            for x1, y1, x2, y2 in lines[:, 0]:
                angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
                mid = (y1 + y2) / 2
                if (angle < 12 or angle > 168) and mid > h * 0.45:
                    ys.append(mid / h)
        return float(np.median(ys)) if ys else 0.72

    @staticmethod
    def _windows(small: np.ndarray) -> list[tuple[float, float, float]]:
        """Devuelve (centro_x_norm, ancho_norm, alto_norm) de hasta 2 ventanas."""
        hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
        value = hsv[:, :, 2]
        upper = np.asarray(value[: int(value.shape[0] * 0.65), :])
        thr = max(200, int(np.percentile(upper, 97)))
        raw_mask = ((upper >= thr) * 255).astype(np.uint8)
        mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        H, W = value.shape
        found: list[tuple[float, float, float, float]] = []
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            area = cw * ch
            fill = cv2.contourArea(c) / max(area, 1)
            if area > 0.015 * W * H and fill > 0.55 and 0.3 < cw / max(ch, 1) < 3.5:
                found.append((area, (x + cw / 2) / W, cw / W, ch / H))
        found.sort(reverse=True)
        return [(cx, max(0.18, ww), max(0.3, hh)) for _, cx, ww, hh in found[:2]]

    @staticmethod
    def _objects(gray: np.ndarray, horizon: float) -> list[DetectedObject]:
        H, W = gray.shape
        edges = cv2.Canny(cv2.GaussianBlur(gray, (7, 7), 0), 40, 120)
        edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out: list[DetectedObject] = []
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:6]:
            x, y, cw, ch = cv2.boundingRect(c)
            rel = (cw * ch) / (W * H)
            if 0.02 < rel < 0.5 and (y + ch) / H > horizon - 0.1:
                out.append(
                    DetectedObject(
                        label="mueble",
                        confidence=0.3,
                        bbox=(round(x / W, 3), round(y / H, 3), round((x + cw) / W, 3), round((y + ch) / H, 3)),
                    )
                )
        return out
