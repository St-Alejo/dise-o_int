"""Utilidades de imagen compartidas por los proveedores."""

import io

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps

RGB = NDArray[np.uint8]


class InvalidImageError(ValueError):
    pass


def decode_rgb(data: bytes, max_side: int = 2048) -> RGB:
    """Decodifica a RGB uint8 (H, W, 3), aplica orientación EXIF y limita el tamaño."""
    try:
        opened = Image.open(io.BytesIO(data))
        img: Image.Image = ImageOps.exif_transpose(opened) or opened
        img = img.convert("RGB")
    except Exception as err:  # Pillow lanza varias clases distintas
        raise InvalidImageError("La imagen no se pudo decodificar") from err
    img.thumbnail((max_side, max_side))
    return np.asarray(img, dtype=np.uint8)


def encode_jpeg(rgb: RGB, quality: int = 88) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
