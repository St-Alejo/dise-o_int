"""Convierte las capturas de e2e/shots/landing en las imágenes que sirve la web.

    python scripts/landing-images.py

Las capturas las genera `npx playwright test -c playwright.shots.config.ts` (carpeta e2e). De cada
plantilla sale su miniatura para la galería; de la primera, además, las del encabezado de la
landing (día, tarde, noche y por dentro) en dos anchos. Requiere Pillow con WebP.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "e2e" / "shots" / "landing"
PUBLIC = ROOT / "apps" / "web" / "public"
HERO_WIDTHS = (800, 1600)
HERO_RATIO = 16 / 10
THUMB = (960, 640)


def cover(image: Image.Image, ratio: float) -> Image.Image:
    """Recorta al centro hasta la proporción pedida, sin deformar."""
    width, height = image.size
    if width / height > ratio:
        crop = round(height * ratio)
        left = (width - crop) // 2
        return image.crop((left, 0, left + crop, height))
    crop = round(width / ratio)
    top = (height - crop) // 2
    return image.crop((0, top, width, top + crop))


def save(image: Image.Image, target: Path, width: int, quality: int = 80) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    height = round(width * image.height / image.width)
    image.resize((width, height), Image.Resampling.LANCZOS).save(target, "WEBP", quality=quality, method=6)
    print(f"{target.relative_to(ROOT)}  {target.stat().st_size / 1024:.0f} kB")


def main() -> None:
    shots = sorted(SHOTS.glob("*.png"))
    if not shots:
        raise SystemExit(f"No hay capturas en {SHOTS}")
    hero = shots[0].stem.rsplit("-", 1)[0] if not (SHOTS / "sala-escandinava-tarde.png").exists() else "sala-escandinava"
    for shot in shots:
        template, variant = shot.stem.rsplit("-", 1)
        image = Image.open(shot).convert("RGB")
        if variant == "tarde":
            save(cover(image, THUMB[0] / THUMB[1]), PUBLIC / "escenas" / f"{template}.webp", THUMB[0])
        if template == hero:
            for width in HERO_WIDTHS:
                save(cover(image, HERO_RATIO), PUBLIC / "landing" / f"cuarto-{variant}-{width}.webp", width)


if __name__ == "__main__":
    main()
