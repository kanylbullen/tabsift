#!/usr/bin/env python3
"""Draw the Tabsift icon in every size the browser and the stores need.

    python3 scripts/make-icons.py

The mark is three tab-shaped bars that get shorter top to bottom — tabs going
through a sieve. It is drawn once at 1024 px and scaled down, so every size is
the same picture.

Writes:
  icons/16.png 32.png 48.png 128.png   manifest icons (edge to edge)
  store/icon-128.png                   Chrome Web Store icon: 96 px mark with
                                       16 px transparent margin, per Google's guideline
  store/logo-300.png                   Edge Add-ons logo, 300 x 300

Needs Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024

TOP = (59, 130, 246)      # #3b82f6
BOTTOM = (29, 78, 216)    # #1d4ed8
BAR = (255, 255, 255)


def mark() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Vertical gradient, then cut to a rounded square.
    grad = Image.new("RGBA", (SIZE, SIZE))
    px = grad.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))
        for x in range(SIZE):
            px[x, y] = (*c, 255)
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=220, fill=255)
    img.paste(grad, (0, 0), mask)

    # Three bars, centred, each shorter than the one above.
    d = ImageDraw.Draw(img)
    bar_h = 150
    gap = 90
    widths = (700, 500, 300)
    total = len(widths) * bar_h + (len(widths) - 1) * gap
    y = (SIZE - total) // 2
    for w in widths:
        x = (SIZE - w) // 2
        d.rounded_rectangle((x, y, x + w, y + bar_h), radius=bar_h // 2, fill=BAR)
        y += bar_h + gap
    return img


def scaled(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    img = mark()

    icons = ROOT / "icons"
    icons.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        scaled(img, size).save(icons / f"{size}.png", optimize=True)

    store = ROOT / "store"
    store.mkdir(exist_ok=True)
    padded = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    padded.paste(scaled(img, 96), (16, 16))
    padded.save(store / "icon-128.png", optimize=True)
    scaled(img, 300).save(store / "logo-300.png", optimize=True)

    print("wrote icons/{16,32,48,128}.png, store/icon-128.png, store/logo-300.png")


if __name__ == "__main__":
    main()
