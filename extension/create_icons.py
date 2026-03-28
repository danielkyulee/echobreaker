"""
Run once to generate placeholder icons for the extension.
  python create_icons.py
Requires: pip install Pillow
"""

import os
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 48, 128]
BG_COLOR = (29, 155, 240)   # Twitter blue
TEXT_COLOR = (255, 255, 255)
OUT_DIR = os.path.join(os.path.dirname(__file__), "icons")


def make_icon(size: int):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Circle background
    draw.ellipse([0, 0, size - 1, size - 1], fill=BG_COLOR)

    # "E" letter centered
    font_size = max(int(size * 0.55), 8)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except Exception:
        font = ImageFont.load_default()

    text = "E"
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]),
        text,
        fill=TEXT_COLOR,
        font=font,
    )

    path = os.path.join(OUT_DIR, f"icon{size}.png")
    img.save(path)
    print(f"Created {path}")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        make_icon(size)
    print("Done. Icons saved to extension/icons/")
