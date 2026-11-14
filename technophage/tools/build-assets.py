#!/usr/bin/env python3
"""Convert the concept art in generated-art/ into game-ready assets in assets/.

Run from the repo root:  python3 tools/build-assets.py
Writes: assets/sprites/*.png, assets/bg/*.jpg, assets/manifest.json
Requires Pillow.
"""
import colorsys
import json
import os

from PIL import Image, ImageEnhance, ImageFilter

SRC = "generated-art"
OUT = "assets"


def load_clean(path):
    """Load RGBA, drop faint alpha, erode 2px to remove dark/red halos."""
    im = Image.open(path).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v > 60 else 0)
    a = a.filter(ImageFilter.MinFilter(5))
    im.putalpha(a)
    return ImageEnhance.Brightness(im).enhance(1.18)


def shrink(im, w=None, h=None):
    if w is None:
        w = round(im.width * h / im.height)
    if h is None:
        h = round(im.height * w / im.width)
    out = im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
    a = out.getchannel("A").point(lambda v: 255 if v > 110 else 0)
    out.putalpha(a)
    return out


def crop_bbox(im):
    bb = im.getchannel("A").getbbox()
    return im.crop(bb), bb


def recolor(im, hue_to):
    """Shift saturated warm highlights (orange/amber/yellow) to another hue."""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.03 < h < 0.17 and s > 0.45 and v > 0.35:
                nr, ng, nb = colorsys.hsv_to_rgb(hue_to, min(1, s * 0.9), v)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


def save(im, name):
    p = os.path.join(OUT, "sprites", name + ".png")
    im.save(p, optimize=True)
    return {"src": p, "w": im.width, "h": im.height}


def main():
    os.makedirs(os.path.join(OUT, "sprites"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "bg"), exist_ok=True)
    manifest = {"sprites": {}, "bg": {}, "hunter": {}}

    # ---- hunter: split into legs + aiming torso -------------------------
    hunter = load_clean(f"{SRC}/characters/05-hunter.png")
    HEIGHT = 84
    top, bot = 25, 1150
    s = HEIGHT / (bot - top)
    full = hunter.crop((200, top, 1200, bot))  # common frame, x offset 200
    W = round(full.width * s)
    cut_upper, cut_lower = 545, 470  # source y (absolute)
    pivot = (650, 455)  # chest/shoulder pivot, source coords
    muzzle = (1180, 452)
    for tag, hue in (("p1", None), ("p2", 0.52)):
        f = full.copy()
        if hue is not None:
            f = recolor(f, hue)
        # Upper = head, torso, arms, rifle and its sling; lower = belt and legs.
        # Source x 800 (absolute) separates the hanging rifle sling from the hips.
        sx = 800 - 200
        up_mask = Image.new("L", f.size, 0)
        up_mask.paste(255, (0, 0, f.width, cut_upper - top))
        up_mask.paste(255, (sx, 0, f.width, 660 - top))
        lo_mask = Image.new("L", f.size, 0)
        lo_mask.paste(255, (0, cut_lower - top, sx, f.height))
        lo_mask.paste(255, (0, 660 - top, f.width, f.height))
        up = f.copy()
        up.putalpha(Image.composite(up.getchannel("A"), up_mask, up_mask))
        lo = f.copy()
        lo.putalpha(Image.composite(lo.getchannel("A"), lo_mask, lo_mask))
        manifest["sprites"][f"hunter_{tag}_upper"] = save(shrink(up, w=W), f"hunter_{tag}_upper")
        manifest["sprites"][f"hunter_{tag}_lower"] = save(shrink(lo, w=W), f"hunter_{tag}_lower")
        manifest["sprites"][f"hunter_{tag}_full"] = save(shrink(f, w=W), f"hunter_{tag}_full")
        # big portrait for menu
        manifest["sprites"][f"hunter_{tag}_portrait"] = save(shrink(crop_bbox(f)[0], h=360), f"hunter_{tag}_portrait")
    # Frame-relative coords (in game px), origin = top-left of the frame.
    manifest["hunter"] = {
        "frameW": W,
        "frameH": HEIGHT,
        "pivot": [round((pivot[0] - 200) * s, 1), round((pivot[1] - top) * s, 1)],
        "muzzle": [round((muzzle[0] - 200) * s, 1), round((muzzle[1] - top) * s, 1)],
        "feetY": HEIGHT,
        "bodyCenterX": round((640 - 200) * s, 1),
        # bounding box of the hunter's own rifle, used to place other weapons over it
        "rifleBox": [round((490 - 200) * s, 1), round((370 - top) * s, 1), round((1180 - 200) * s, 1), round((520 - top) * s, 1)],
    }
    # Direction each source image faces (sprites are flipped at runtime as needed).
    manifest["facing"] = {"stalker": -1}

    # ---- enemies, props, weapons ----------------------------------------
    specs = {
        "stalker": ("enemies/06-xenophage-stalker.png", {"w": 104}),
        "burster": ("enemies/07-wall-burster.png", {"h": 112}),
        "mould": ("enemies/08-sentient-mould.png", {"w": 96}),
        "swarm": ("enemies/09-nano-swarm.png", {"w": 72}),
        "insectoid": ("enemies/10-insectoid-mutant.png", {"w": 120}),
        "rat": ("enemies/11-techno-rat.png", {"w": 60}),
        "worm": ("enemies/12-sewer-worm.png", {"w": 132}),
        "enforcer": ("enemies/13-augmented-enforcer.png", {"h": 80}),
        "mech": ("enemies/14-industrial-mech.png", {"h": 132}),
        "drone": ("enemies/15-security-drone.png", {"w": 88}),
        "crate": ("props/19-cargo-crate.png", {"w": 60}),
        "door": ("props/20-pressure-door.png", {"w": 160}),
        "growth": ("props/21-biomechanical-growth.png", {"h": 96}),
        "w_coil": ("weapons/16-coil-rifle.png", {"w": 62}),
        "w_incin": ("weapons/17-incinerator.png", {"w": 60}),
        "w_plasma": ("weapons/18-plasma-cutter.png", {"w": 50}),
        # in-hand versions, sized to cover the hunter's own rifle
        "w_coil_hand": ("weapons/16-coil-rifle.png", {"w": 54}),
        "w_incin_hand": ("weapons/17-incinerator.png", {"w": 52}),
        "w_plasma_hand": ("weapons/18-plasma-cutter.png", {"w": 44}),
    }
    for name, (path, size) in specs.items():
        im, _ = crop_bbox(load_clean(f"{SRC}/{path}"))
        manifest["sprites"][name] = save(shrink(im, **size), name)
        if name in ("stalker", "insectoid", "mech", "worm", "drone", "burster"):
            big = {k: v * 2 for k, v in size.items()}
            manifest["sprites"][name + "_boss"] = save(shrink(im, **big), name + "_boss")

    # ---- backgrounds: darkened, softened far layers ---------------------
    scenes = {
        "upper": "01b-surface-cyberpunk",
        "upper_alt": "01-surface-megacity",
        "lower": "02b-lower-megacity",
        "underbelly": "02-city-underbelly",
        "caverns": "03-caverns",
        "caverns_alt": "03b-bio-terror-caverns",
        "depths": "04-infested-depths",
    }
    for key, stem in scenes.items():
        im = Image.open(f"{SRC}/scenes/{stem}.png").convert("RGB")
        h = 600
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        im = im.filter(ImageFilter.GaussianBlur(2.4))
        im = ImageEnhance.Brightness(im).enhance(0.55)
        im = ImageEnhance.Color(im).enhance(0.8)
        p = os.path.join(OUT, "bg", key + ".jpg")
        im.save(p, quality=82, optimize=True)
        manifest["bg"][key] = {"src": p, "w": im.width, "h": im.height}

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps(manifest["hunter"]))
    for k, v in manifest["sprites"].items():
        print(f"{k:22s} {v['w']}x{v['h']}")


if __name__ == "__main__":
    main()
