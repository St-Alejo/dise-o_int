"""Track A sin GPU: gradación de color determinista por estilo.

Sirve para desarrollo, demo, CI y como respaldo si el proveedor externo cae. No inventa
muebles (eso lo hace el proveedor de difusión); transforma la atmósfera de la foto con la
paleta de cada estilo y marca la imagen como "vista previa simulada" para ser honestos.
"""

from typing import ClassVar

import cv2
import numpy as np
from PIL import Image, ImageDraw

from ..contracts import RoomType, StyleId
from ..imaging import RGB, hex_to_rgb

PALETTES: dict[StyleId, tuple[str, str, str]] = {
    "escandinavo": ("#f4efe6", "#c8a97e", "#7d8c7a"),
    "minimalista": ("#f2f2f0", "#bfbcb6", "#3c3c3c"),
    "industrial": ("#3b3533", "#8a5a44", "#b7b1a8"),
    "bohemio": ("#d9a066", "#a0522d", "#6b8e23"),
    "moderno": ("#e8e6e1", "#2f4858", "#f26419"),
    "clasico": ("#efe3d0", "#6f4e37", "#8b1e3f"),
}

# (brillo, contraste, saturación, viñeta)
ADJUST: dict[StyleId, tuple[float, float, float, float]] = {
    "escandinavo": (0.10, 0.95, 0.80, 0.0),
    "minimalista": (0.12, 0.90, 0.55, 0.0),
    "industrial": (-0.08, 1.20, 0.60, 0.35),
    "bohemio": (0.03, 1.05, 1.25, 0.15),
    "moderno": (0.02, 1.15, 1.05, 0.10),
    "clasico": (-0.02, 1.05, 0.85, 0.30),
}


class MockStyleGenerator:
    name: ClassVar[str] = "mock-grading"

    def generate(self, image: RGB, style: StyleId, room_type: RoomType, strength: float) -> RGB:
        s = float(np.clip(strength, 0.0, 1.0))
        img: np.ndarray = image.astype(np.float32) / 255.0
        brightness, contrast, saturation, vignette = ADJUST[style]

        # Saturación en HSV
        hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * (1 + (saturation - 1) * s), 0, 1)
        img = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)

        # Contraste y brillo
        img = np.clip((img - 0.5) * (1 + (contrast - 1) * s) + 0.5 + brightness * s, 0, 1)

        # Split toning con la paleta: sombras → color medio, luces → color claro, acento en medios tonos.
        light, mid, accent = (np.array(hex_to_rgb(c), dtype=np.float32) / 255.0 for c in PALETTES[style])
        lum = (0.299 * img[:, :, 0] + 0.587 * img[:, :, 1] + 0.114 * img[:, :, 2])[..., None]
        tone = lum * light + (1 - lum) * mid
        accent_w = np.exp(-((lum - 0.5) ** 2) / 0.02) * 0.25
        tone = tone * (1 - accent_w) + accent * accent_w
        blend = 0.18 + 0.32 * s
        img = img * (1 - blend) + (img * tone * 1.6) * blend

        if vignette > 0:
            h, w = img.shape[:2]
            yy, xx = np.mgrid[0:h, 0:w]
            d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
            img *= (1 - vignette * s * np.clip(d - 0.4, 0, 1))[..., None]

        out = (np.clip(img, 0, 1) * 255).astype(np.uint8)
        return self._badge(out)

    @staticmethod
    def _badge(rgb: RGB) -> RGB:
        pil = Image.fromarray(rgb, "RGB")
        draw = ImageDraw.Draw(pil, "RGBA")
        text = "Vista previa simulada"
        w, h = pil.size
        pad = max(6, w // 160)
        box = draw.textbbox((0, 0), text)
        tw, th = box[2] - box[0], box[3] - box[1]
        x0, y0 = w - tw - 3 * pad, h - th - 3 * pad
        draw.rounded_rectangle((x0, y0, w - pad, h - pad), radius=pad, fill=(0, 0, 0, 120))
        draw.text((x0 + pad, y0 + pad // 2), text, fill=(255, 255, 255, 230))
        return np.asarray(pil, dtype=np.uint8)
