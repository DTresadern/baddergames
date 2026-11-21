#!/usr/bin/env python3
"""Draw four themed placeholder atlases of 64x64 environment block textures.

Purpose: programmer art for the lab, industrial, subway and organic growth block sets
(shapes, outlines and composition only), so levels of those themes can be built and read
before final art exists. Same look as blocks-placeholder.png (tools/blocks_placeholder.py,
whose Pen, helpers and palette this script reuses): hard edges, a 1 px highlight on the
top / left and a 1 px shade on the bottom / right of raised parts, dark seams. Shapes were
taken by eye from crops of the scene mockups named in each tile's `refs`; the mockups are
not in the repository and this script reads no files except, with --check, its own
outputs and those of blocks_placeholder.py.

Usage (from any folder):
  python3 tools/blocks_themed.py                  # write all four atlases, indexes and records
  python3 tools/blocks_themed.py --theme lab      # only one theme (lab, industrial, subway, growth)
  python3 tools/blocks_themed.py --out DIR        # write to DIR instead
  python3 tools/blocks_themed.py --check          # redraw in memory, compare with the files on
                                                  # disk (all four atlases and indexes, and the
                                                  # blocks-placeholder files); exit 1 on any
                                                  # difference

Output (default folder: ../public/content/textures/environment/, relative to this file):
  blocks-<theme>.png      palette ('P') PNG, COLUMNS x ROWS tiles of 64x64, row-major in
                          the theme's TILES order, no padding
  blocks-<theme>.json     index in the blocks-placeholder.json format (image, tileSize,
                          columns, rows, note, tiles: {name: {x, y, w, h, kind, tiles, note}})
                          plus per tile `refs`: "<scene file name> <x>,<y> <w>x<h>" of the
                          mockup areas it was drawn after
  blocks-<theme>.png.generated.json
                          image record (written by a normal run, not compared by --check;
                          keys it does not produce, such as post_analysis, are kept)

Palette: blocks_placeholder.PALETTE followed by EXTRA (tools/blocks_themes/common.py), all
hex constants from the project's shared palette. Every themed PNG holds that full palette
in that order, so rebuilds are byte-identical.

Drawing: ImageDraw primitives and single pixels on palette images only (no antialiasing,
no resizing, no filters), through blocks_placeholder.Pen; tiles that repeat use the Pen's
wrap so shapes crossing an edge continue on the other side. Randomness, where used, is
random.Random(<fixed seed>).

Build checks (assertions): tile count == columns * rows; tile names unique per atlas; no
tile's pixels (as RGB) equal another tile's in any themed atlas or in blocks-placeholder
(as drawn by blocks_placeholder.build()); every pixel index < palette length.
"""

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

import blocks_placeholder as bp
from blocks_themes import growth, industrial, lab, subway
from blocks_themes.common import EXTRA, XPALETTE

THEMES = {m.NAME: m for m in (lab, industrial, subway, growth)}
T = bp.T
DEFAULT_OUT = bp.DEFAULT_OUT
TOOL = "berserker7/game/tools/blocks_themed.py"
REPO_DIR = "berserker7/game/public/content/textures/environment"
CREATED_AT = "2026-11-21"


def image_name(theme):
    return f"blocks-{theme}.png"


def index_name(theme):
    return f"blocks-{theme}.json"


def record_name(theme):
    return f"blocks-{theme}.png.generated.json"


def draw_tile(fn, tiles):
    img = Image.new("P", (T, T), 0)
    fn(bp.Pen(img, wrap="" if tiles == "none" else tiles, palette=XPALETTE))
    assert max(img.getdata()) < len(XPALETTE)
    return img


def flat_palette():
    flat = []
    for c in XPALETTE:
        flat += [(c >> 16) & 255, (c >> 8) & 255, c & 255]
    return flat


def build_theme(mod):
    """Return (atlas image, png bytes, json bytes) for one theme module."""
    assert len(mod.TILES) == mod.COLUMNS * mod.ROWS, f"{mod.NAME}: tile count"
    names = [t[0] for t in mod.TILES]
    assert len(set(names)) == len(names), f"{mod.NAME}: tile names must be unique"
    atlas = Image.new("P", (mod.COLUMNS * T, mod.ROWS * T), 0)
    atlas.putpalette(flat_palette())
    index = {
        "image": image_name(mod.NAME),
        "tileSize": T,
        "columns": mod.COLUMNS,
        "rows": mod.ROWS,
        "note": mod.NOTE,
        "tiles": {},
    }
    for i, (name, fn, kind, tiles, note, refs) in enumerate(mod.TILES):
        assert tiles in ("x", "y", "xy", "none"), name
        x, y = (i % mod.COLUMNS) * T, (i // mod.COLUMNS) * T
        atlas.paste(draw_tile(fn, tiles), (x, y))
        index["tiles"][name] = {"x": x, "y": y, "w": T, "h": T, "kind": kind, "tiles": tiles,
                                "note": note, "refs": list(refs)}
    assert max(atlas.getdata()) < len(XPALETTE), f"{mod.NAME}: pixel index out of range"
    buf = io.BytesIO()
    atlas.save(buf, format="PNG", optimize=False)
    text = json.dumps(index, indent=2, sort_keys=False) + "\n"
    return atlas, buf.getvalue(), text.encode("utf-8")


def tile_pixels(png_bytes, columns, rows):
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    out = []
    for r in range(rows):
        for c in range(columns):
            out.append(img.crop((c * T, r * T, c * T + T, r * T + T)).tobytes())
    return out


def build_all():
    """Draw every theme; assert that no two tiles (themed or placeholder) are equal.
    Returns {theme: (png bytes, json bytes)}."""
    built = {}
    seen = {}
    ref_png, _ = bp.build()
    for k, px in enumerate(tile_pixels(ref_png, bp.COLUMNS, bp.ROWS)):
        seen.setdefault(px, f"blocks-placeholder/{bp.TILES[k][0]}")
    for name, mod in THEMES.items():
        _, png, js = build_theme(mod)
        for k, px in enumerate(tile_pixels(png, mod.COLUMNS, mod.ROWS)):
            label = f"blocks-{name}/{mod.TILES[k][0]}"
            assert px not in seen, f"{label} has the same pixels as {seen[px]}"
            seen[px] = label
        built[name] = (png, js)
    return built


def colours_used(png):
    img = Image.open(io.BytesIO(png))
    return sorted(f"{XPALETTE[i]:06x}" for i in set(img.getdata()))


def make_record(mod, png):
    scenes = []
    for t in mod.TILES:
        for ref in t[5]:
            scene = ref.split(" ")[0]
            if scene not in scenes:
                scenes.append(scene)
    role = ("visual reference for shapes, details and composition, read by eye from crops; "
            "not read by the script, no pixels copied")
    return {
        "schema_version": 1,
        "image": f"{REPO_DIR}/{image_name(mod.NAME)}",
        "image_sha256": hashlib.sha256(png).hexdigest(),
        "dimensions": {"width": mod.COLUMNS * T, "height": mod.ROWS * T},
        "format": f"PNG, palette mode ('P'), {mod.COLUMNS} x {mod.ROWS} tiles of {T} x {T} px",
        "created_at": CREATED_AT,
        "generator": {
            "tool": TOOL,
            "type": "deterministic script drawing (Python 3, Pillow ImageDraw primitives); "
                    "not an image generation model",
            "rebuild": f"python3 tools/blocks_themed.py --theme {mod.NAME} (from berserker7/game/); "
                       "verify with --check",
        },
        "prompt": None,
        "prompt_status": "No prompt: the image is drawn by a deterministic script, not "
                         "generated by a model. The script source is the full specification.",
        "references": [
            {"order": i + 1, "path": None, "name": s, "role": role,
             "note": "scene mockup, not in the repository"}
            for i, s in enumerate(scenes)
        ],
        "subject": mod.SUBJECT,
        "visual_approach": mod.VISUAL_APPROACH,
        "generation_settings": {
            "tile_size": T,
            "columns": mod.COLUMNS,
            "rows": mod.ROWS,
            "palette": f"{len(XPALETTE)} hex constants: the {len(bp.PALETTE)} of "
                       f"tools/blocks_placeholder.py followed by {len(EXTRA)} in "
                       "tools/blocks_themes/common.py, all from the project's shared palette "
                       "(not in the repository)",
            "palette_colours_used": colours_used(png),
            "index": index_name(mod.NAME),
        },
        "creative_seed": {
            "value": None,
            "source": None,
            "used_for_generation": False,
            "note": "No generator seed. " + mod.SEED_NOTE + " Every rebuild is identical.",
        },
        "revision_of": None,
        "style_inheritance": "follows blocks-placeholder.png (same tile size, bevel and seam "
                             "rules, palette extended from its palette)",
        "tiles": {
            t[0]: {"x": (i % mod.COLUMNS) * T, "y": (i // mod.COLUMNS) * T, "kind": t[2],
                   "tiles": t[3]}
            for i, t in enumerate(mod.TILES)
        },
    }


def compare(path, data, is_png):
    if not path.is_file():
        print(f"MISSING {path}")
        return False
    disk = path.read_bytes()
    if disk == data:
        print(f"OK {path.name}")
        return True
    msg = f"DIFFERS {path} (disk sha256 {hashlib.sha256(disk).hexdigest()[:12]}, " \
          f"drawn {hashlib.sha256(data).hexdigest()[:12]})"
    if is_png:
        try:
            a = Image.open(io.BytesIO(disk)).convert("RGB")
            b = Image.open(io.BytesIO(data)).convert("RGB")
            same = a.size == b.size and a.tobytes() == b.tobytes()
            msg += "; pixels equal" if same else "; pixels differ"
        except Exception as e:  # unreadable PNG
            msg += f"; cannot decode the file on disk: {e}"
    print(msg)
    return False


def check(out):
    ok = True
    built = build_all()
    for name, (png, js) in built.items():
        ok &= compare(out / image_name(name), png, True)
        ok &= compare(out / index_name(name), js, False)
    ref_png, ref_js = bp.build()
    ok &= compare(out / bp.IMAGE_NAME, ref_png, True)
    ok &= compare(out / bp.INDEX_NAME, ref_js, False)
    return 0 if ok else 1


def write(out, themes):
    built = build_all()
    out.mkdir(parents=True, exist_ok=True)
    for name in themes:
        png, js = built[name]
        (out / image_name(name)).write_bytes(png)
        (out / index_name(name)).write_bytes(js)
        rec_path = out / record_name(name)
        rec = make_record(THEMES[name], png)
        if rec_path.is_file():
            old = json.loads(rec_path.read_text())
            for k, v in old.items():
                rec.setdefault(k, v)
        rec_path.write_text(json.dumps(rec, indent=2) + "\n")
        for f in (image_name(name), index_name(name), record_name(name)):
            print(f"wrote {out / f}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT,
                    help="output folder (default: %(default)s)")
    ap.add_argument("--theme", choices=sorted(THEMES), help="write only this theme")
    ap.add_argument("--check", action="store_true",
                    help="compare a fresh drawing with the files in the output folder")
    args = ap.parse_args()
    if args.check:
        return check(args.out)
    return write(args.out, [args.theme] if args.theme else list(THEMES))


if __name__ == "__main__":
    sys.exit(main())
