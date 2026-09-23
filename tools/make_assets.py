#!/usr/bin/env python3
"""Builds the site's images from the iSafeNet brand pack and the two app websites.

    python3 tools/make_assets.py [--pack ~/Downloads/iSafeNet_Digital_Assets_Pack]

Inputs (sibling folders of this repo, as on the build machine):
    the brand pack (logos, icons, favicons; PNGs with solid backgrounds)
    ../glpmgr-legal     GLPMGR's website (icon, photo panels, iPad and Watch screens)
    ../airreveal-legal  AirReveal's website (icon, photo panels, iPad screens)
Outputs, all committed, in assets/:
    img/mark.png, img/mark@2x.png    the "S" phone mark, cut out onto transparency
    favicon-*.png, apple-touch-icon.png
    img/og.png                       the 1200x630 social preview
    img/apps/...                     the app icons and screens used on the pages
    fonts/                           Plus Jakarta Sans (SIL Open Font License), from GLPMGR's site

Needs Pillow and numpy. Deterministic: the same inputs make the same files.
"""
import os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS = os.path.dirname(ROOT)
PACK = os.path.expanduser(sys.argv[sys.argv.index("--pack") + 1] if "--pack" in sys.argv
                          else "~/Downloads/iSafeNet_Digital_Assets_Pack")
GLPMGR = os.path.join(APPS, "glpmgr-legal")
AIRREVEAL = os.path.join(APPS, "airreveal-legal")
OUT = os.path.join(ROOT, "assets")
IMG = os.path.join(OUT, "img")

NAVY = (10, 21, 34)
CYAN = (0, 180, 253)
BLUE = (0, 129, 253)


def cut_mark():
    """The "S" phone mark from the light logo lockup, with its white background made transparent
    (colour-to-alpha, so the anti-aliased edge stays smooth on any background)."""
    im = Image.open(os.path.join(PACK, "isafenet_logo_light_create_ship_evolve.png")).convert("RGB")
    a = np.asarray(im).astype(float)
    nonwhite = a.min(axis=2) < 230
    cols = nonwhite.any(axis=0)
    x0 = int(np.argmax(cols))
    x1 = x0
    while cols[x1 + 1]:
        x1 += 1                                   # the mark is the first run of ink, left of the wordmark
    rows = np.where(nonwhite[:, x0:x1 + 1].any(axis=1))[0]
    y0, y1 = int(rows[0]), int(rows[-1])
    crop = a[y0 - 8:y1 + 9, x0 - 8:x1 + 9]
    alpha = np.clip((1 - crop.min(axis=2) / 255.0 - 0.02) / 0.98, 0, 1)
    safe = np.maximum(alpha[..., None], 1e-3)
    rgb = np.clip((crop - 255 * (1 - alpha[..., None])) / safe, 0, 255)
    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8))


def height(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def width(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def font(size, weight):
    f = ImageFont.truetype(os.path.join(APPS, "GLPMGR", "tools", "fonts", "PlusJakartaSans-Variable.ttf"), size)
    f.set_variation_by_axes([weight])
    return f


def rounded(size, radius):
    s = 4
    m = Image.new("L", (size[0] * s, size[1] * s), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] * s - 1, size[1] * s - 1), radius * s, fill=255)
    return m.resize(size, Image.LANCZOS)


def og_image(mark):
    """1200x630 social card: navy with a soft brand glow, the mark and wordmark, and one screen from each app."""
    W, H = 1200, 630
    canvas = Image.new("RGB", (W, H), NAVY)
    glow = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(glow)
    d.ellipse((620, -260, 1420, 540), fill=(0, 92, 190))
    d.ellipse((-300, 380, 420, 1000), fill=(0, 70, 150))
    canvas = Image.blend(canvas, glow.filter(ImageFilter.GaussianBlur(160)), 0.85)
    canvas = canvas.convert("RGBA")
    m = height(mark, 150)
    canvas.alpha_composite(m, (80, 150))
    d = ImageDraw.Draw(canvas)
    f = font(92, 800)
    d.text((80 + m.width + 34, 150), "iSafe", font=f, fill="white")
    d.text((80 + m.width + 34 + d.textlength("iSafe", font=f), 150), "Net", font=f, fill=CYAN)
    d.text((80 + m.width + 38, 262), "Create. Ship. Evolve.", font=font(34, 600), fill=(190, 205, 222))
    d.text((80, 370), "Apps for iPhone, iPad", font=font(46, 800), fill="white")
    d.text((80, 426), "and Apple Watch", font=font(46, 800), fill="white")
    d.text((80, 500), "AirReveal  ·  GLPMGR", font=font(30, 600), fill=(150, 170, 195))
    # Two phones, tilted slightly, at the right.
    for i, src in enumerate([os.path.join(AIRREVEAL, "images", "panel-flight.webp"),
                             os.path.join(GLPMGR, "assets", "panels", "01-at-a-glance.webp")]):
        shot = width(Image.open(src).convert("RGB"), 205)
        card = Image.new("RGBA", shot.size, (0, 0, 0, 0))
        card.paste(shot, (0, 0), rounded(shot.size, 30))
        card = card.rotate(-6 if i == 0 else 5, resample=Image.BICUBIC, expand=True)
        canvas.alpha_composite(card, (805 + i * 150, 70 + i * 50))
    return canvas.convert("RGB")


def main():
    os.makedirs(os.path.join(IMG, "apps"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "fonts"), exist_ok=True)

    mark = cut_mark()
    height(mark, 96).save(os.path.join(IMG, "mark.png"), optimize=True)
    height(mark, 192).save(os.path.join(IMG, "mark@2x.png"), optimize=True)

    for size in (32, 192):
        shutil.copyfile(os.path.join(PACK, f"isafenet_favicon_light_{size}x{size}.png"), os.path.join(OUT, f"favicon-{size}.png"))
        shutil.copyfile(os.path.join(PACK, f"isafenet_favicon_dark_{size}x{size}.png"), os.path.join(OUT, f"favicon-{size}-dark.png"))
    shutil.copyfile(os.path.join(PACK, "isafenet_favicon_light_180x180.png"), os.path.join(OUT, "apple-touch-icon.png"))

    og_image(mark).save(os.path.join(IMG, "og.png"), optimize=True)

    # App icons and screens. The panels already carry their own headline, so they're shown as-is.
    copies = {
        "airreveal-icon.png": os.path.join(AIRREVEAL, "images", "app-icon.png"),
        "glpmgr-icon.png": os.path.join(GLPMGR, "assets", "icon-512.png"),
        "glpmgr-watch.webp": os.path.join(GLPMGR, "assets", "shots", "watch-home.webp"),
        "glpmgr-ipad.webp": os.path.join(GLPMGR, "assets", "shots", "ipad-today.webp"),
        "airreveal-ipad.webp": os.path.join(AIRREVEAL, "images", "ipad-flight.webp"),
    }
    for name in ("flight", "discover", "journal", "collection", "plan", "profile"):
        copies[f"airreveal-{name}.webp"] = os.path.join(AIRREVEAL, "images", f"panel-{name}.webp")
    for name in ("01-at-a-glance", "02-trends", "03-daily-habits", "04-scan-a-label", "05-private-photos",
                 "06-titration", "07-injection-areas", "08-reminders", "09-on-your-wrist"):
        copies[f"glpmgr-{name[3:]}.webp"] = os.path.join(GLPMGR, "assets", "panels", f"{name}.webp")
    for out, src in copies.items():
        shutil.copyfile(src, os.path.join(IMG, "apps", out))

    for f in ("pjs-700.woff2", "pjs-800.woff2"):
        shutil.copyfile(os.path.join(GLPMGR, "assets", "fonts", f), os.path.join(OUT, "fonts", f))
    print("assets written to", OUT)


if __name__ == "__main__":
    main()
