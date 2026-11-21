#!/usr/bin/env python3
"""Draw placeholder 64x64 environment block textures and pack them into one atlas.

Purpose: programmer art for the cyberpunk / megacity block set (shapes, outlines and
composition only), so levels can be built and read before final art exists. The look
follows the dev atlas: mid grey panels, dark seams with round joints, a 1 px highlight
on the top / left edges and a 1 px shade on the bottom / right edges of raised parts.
Shapes were taken by eye from crops of the scene mockups (01b-surface-cyberpunk,
01-surface-megacity, 02-city-underbelly, 02b-lower-megacity); the mockups are not in the
repository and this script reads no files at all.

Usage (from any folder):
  python3 tools/blocks_placeholder.py            # write the PNG and JSON (default folder)
  python3 tools/blocks_placeholder.py --out DIR  # write them to DIR instead
  python3 tools/blocks_placeholder.py --check    # redraw in memory and compare with the
                                                 # files on disk; exit 1 on any difference

Output (default folder: ../public/content/textures/environment/, relative to this file):
  blocks-placeholder.png   448x256, palette ('P') PNG, 7 columns x 4 rows of 64x64 tiles,
                           row-major in TILES order, no padding
  blocks-placeholder.json  index: tileSize, columns, rows and, per tile name, x, y, w, h,
                           kind, tiles ("x", "y", "xy" or "none": the axes along which the
                           tile repeats seamlessly with itself) and a short note

Palette: the hex constants below are taken from the project's shared palette. Every pixel
is one of them; the PNG palette holds them in PALETTE order, so rebuilds are byte-identical.

Drawing: ImageDraw primitives on palette images only (no antialiasing, no resizing, no
filters). Tiles that repeat are drawn through a Pen that also draws every primitive one
tile away along the repeat axes, so shapes that cross an edge continue on the other side.
Randomness, where used, is random.Random(<fixed seed per tile>).
"""

import argparse
import hashlib
import io
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ----------------------------------------------------------------------------- palette

OUTLINE = 0x0E0D0F
SEAM = 0x1F1F1F
STEEL_DARK = 0x303232
STEEL = 0x3B3C3F
STEEL_MID = 0x4D4944
STEEL_LIGHT = 0x5D6059
STEEL_HI = 0x7B7A80
STEEL_SPEC = 0x9BA097
WHITE_HI = 0xCFCAD2
WARM_DARK = 0x473E35
WARM = 0x665851
WARM_LIGHT = 0x7D6C64
RUST_DARK = 0x654729
RUST = 0x7A4917
RUST_LIGHT = 0x9B6536
HAZARD_DIM = 0x8A6623
HAZARD = 0xB56D18
HAZARD_HI = 0xD78F33
LAMP_ORANGE = 0xDC7518
LAMP_AMBER = 0xEF9C20
LAMP_YELLOW = 0xF8C026
LAMP_PALE = 0xFBE154
LAMP_WHITE = 0xF4EFCD
RED_DARK = 0x5F1514
RED = 0x9F2B23
RED_HI = 0xE72D15
RED_PALE = 0xCE8282
MAGENTA_DARK = 0x521439
MAGENTA = 0xC2267D
MAGENTA_HI = 0xF629DA
MAGENTA_PALE = 0xD69EDC
TEAL_DARK = 0x233834
TEAL = 0x33564E
TEAL_LIGHT = 0x4B8279
CYAN = 0x55EBF1
CYAN_PALE = 0xAEE1E1
OLIVE_DARK = 0x3E483D
OLIVE = 0x4C5C47
OLIVE_LIGHT = 0x566641
BLUE_STEEL = 0x3E4D62
BLUE_STEEL_LIGHT = 0x4D5F77

PALETTE = (
    OUTLINE, SEAM, STEEL_DARK, STEEL, STEEL_MID, STEEL_LIGHT, STEEL_HI, STEEL_SPEC, WHITE_HI,
    WARM_DARK, WARM, WARM_LIGHT,
    RUST_DARK, RUST, RUST_LIGHT,
    HAZARD_DIM, HAZARD, HAZARD_HI,
    LAMP_ORANGE, LAMP_AMBER, LAMP_YELLOW, LAMP_PALE, LAMP_WHITE,
    RED_DARK, RED, RED_HI, RED_PALE,
    MAGENTA_DARK, MAGENTA, MAGENTA_HI, MAGENTA_PALE,
    TEAL_DARK, TEAL, TEAL_LIGHT, CYAN, CYAN_PALE,
    OLIVE_DARK, OLIVE, OLIVE_LIGHT,
    BLUE_STEEL, BLUE_STEEL_LIGHT,
)
INDEX = {c: i for i, c in enumerate(PALETTE)}
assert len(INDEX) == len(PALETTE), "palette constants must be distinct"

T = 64          # tile size
COLUMNS = 7
ROWS = 4
IMAGE_NAME = "blocks-placeholder.png"
INDEX_NAME = "blocks-placeholder.json"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "public/content/textures/environment"


# ----------------------------------------------------------------------------- pen

class Pen:
    """Draws palette colours (hex constants) on one 64x64 palette tile.

    wrap: "", "x", "y" or "xy" - each primitive is also drawn shifted by one tile along
    those axes, so a shape crossing an edge reappears on the opposite edge.
    transpose: swap x and y of every coordinate (used to draw vertical variants).
    """

    def __init__(self, img, wrap="", transpose=False):
        self.img = img
        self.draw = ImageDraw.Draw(img)
        self.wrap = wrap
        self.transpose = transpose
        xs = (-T, 0, T) if "x" in wrap else (0,)
        ys = (-T, 0, T) if "y" in wrap else (0,)
        if transpose:
            xs, ys = ys, xs
        self.offsets = [(ox, oy) for ox in xs for oy in ys]
        self.wrap_x, self.wrap_y = len(xs) > 1, len(ys) > 1  # image axes

    def _pt(self, x, y, ox, oy):
        if self.transpose:
            x, y = y, x
        return (x + ox, y + oy)

    def _box(self, x0, y0, x1, y1, ox, oy):
        a = self._pt(x0, y0, ox, oy)
        b = self._pt(x1, y1, ox, oy)
        return (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))

    def rect(self, x0, y0, x1, y1, c):
        """Filled rectangle, corners inclusive."""
        if x1 < x0 or y1 < y0:
            return
        for ox, oy in self.offsets:
            self.draw.rectangle(self._box(x0, y0, x1, y1, ox, oy), fill=INDEX[c])

    def frame(self, x0, y0, x1, y1, c):
        """1 px rectangle outline, corners inclusive."""
        for ox, oy in self.offsets:
            self.draw.rectangle(self._box(x0, y0, x1, y1, ox, oy), outline=INDEX[c])

    def hline(self, x0, x1, y, c):
        self.rect(min(x0, x1), y, max(x0, x1), y, c)

    def vline(self, x, y0, y1, c):
        self.rect(x, min(y0, y1), x, max(y0, y1), c)

    def line(self, pts, c, width=1):
        for ox, oy in self.offsets:
            self.draw.line([self._pt(x, y, ox, oy) for x, y in pts], fill=INDEX[c], width=width)

    def poly(self, pts, fill, outline=None):
        for ox, oy in self.offsets:
            self.draw.polygon([self._pt(x, y, ox, oy) for x, y in pts], fill=INDEX[fill],
                              outline=None if outline is None else INDEX[outline])

    def ellipse(self, x0, y0, x1, y1, fill=None, outline=None):
        for ox, oy in self.offsets:
            self.draw.ellipse(self._box(x0, y0, x1, y1, ox, oy),
                              fill=None if fill is None else INDEX[fill],
                              outline=None if outline is None else INDEX[outline])

    def px(self, x, y, c):
        if self.transpose:
            x, y = y, x
        if self.wrap_x:
            x %= T
        if self.wrap_y:
            y %= T
        if 0 <= x < T and 0 <= y < T:
            self.img.putpixel((x, y), INDEX[c])

    def get(self, x, y):
        if self.transpose:
            x, y = y, x
        return PALETTE[self.img.getpixel((x % T, y % T))]


def new_tile():
    return Image.new("P", (T, T), INDEX[OUTLINE])


# ----------------------------------------------------------------------------- helpers

def bevel(p, x0, y0, x1, y1, base, hi, sh, outline=None, round_corners=True):
    """Raised box: optional 1 px outline, base fill, highlight top/left, shade bottom/right."""
    if outline is not None:
        p.frame(x0, y0, x1, y1, outline)
        x0, y0, x1, y1 = x0 + 1, y0 + 1, x1 - 1, y1 - 1
    p.rect(x0, y0, x1, y1, base)
    p.hline(x0, x1, y0, hi)
    p.vline(x0, y0, y1, hi)
    p.hline(x0, x1, y1, sh)
    p.vline(x1, y0, y1, sh)
    if round_corners and outline is not None:
        for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
            p.px(x, y, outline)


def inset(p, x0, y0, x1, y1, base, dark=OUTLINE, lip=STEEL_HI):
    """Recessed box: dark rim top/left (shadow), light lip bottom/right."""
    p.rect(x0, y0, x1, y1, base)
    p.hline(x0, x1, y0, dark)
    p.vline(x0, y0, y1, dark)
    p.hline(x0, x1, y1, lip)
    p.vline(x1, y0, y1, lip)


def panel(p, x0=0, y0=0, x1=T - 1, y1=T - 1, base=STEEL_LIGHT, hi=STEEL_HI, sh=STEEL_MID,
          seam=SEAM, edges="tblr"):
    """Wall panel. Its border is a 1 px seam (half of a 2 px seam once tiles sit side by
    side), with a highlight / shade inside and a round joint dot at each corner.
    edges: which sides get a seam (t, b, l, r); a side without one runs on to the edge."""
    p.rect(x0, y0, x1, y1, base)
    t, b, l, r = ("t" in edges), ("b" in edges), ("l" in edges), ("r" in edges)
    ix0, iy0 = x0 + (1 if l else 0), y0 + (1 if t else 0)
    ix1, iy1 = x1 - (1 if r else 0), y1 - (1 if b else 0)
    if t:
        p.hline(x0, x1, y0, seam)
        p.hline(ix0, ix1, iy0, hi)
    if l:
        p.vline(x0, y0, y1, seam)
        p.vline(ix0, iy0, iy1, hi)
    if b:
        p.hline(x0, x1, y1, seam)
        p.hline(ix0, ix1, iy1, sh)
    if r:
        p.vline(x1, y0, y1, seam)
        p.vline(ix1, iy0, iy1, sh)
    # joint dots: a 3-pixel quarter disc in each seamed corner
    for cx, cy, sx, sy, on in ((x0, y0, 1, 1, t and l), (x1, y0, -1, 1, t and r),
                               (x0, y1, 1, -1, b and l), (x1, y1, -1, -1, b and r)):
        if on:
            for dx, dy in ((1, 0), (0, 1), (1, 1), (2, 0), (0, 2)):
                p.px(cx + sx * dx, cy + sy * dy, seam)


def rivet(p, x, y, base=STEEL_HI, hi=STEEL_SPEC, sh=STEEL_DARK):
    """3x3 round rivet head with light top-left and dark bottom-right."""
    p.px(x + 1, y, hi)
    p.px(x, y + 1, hi)
    p.px(x + 1, y + 1, base)
    p.px(x + 2, y + 1, sh)
    p.px(x + 1, y + 2, sh)


def bolt(p, x, y):
    """2x2 bolt."""
    p.px(x, y, STEEL_SPEC)
    p.px(x + 1, y, STEEL_HI)
    p.px(x, y + 1, STEEL_HI)
    p.px(x + 1, y + 1, OUTLINE)


def streaks(p, seed, count, colour, x0=3, x1=60, y0=3, y1=60, length=(3, 9)):
    """Short vertical rain / grime streaks."""
    rnd = random.Random(seed)
    for _ in range(count):
        x = rnd.randint(x0, x1)
        y = rnd.randint(y0, y1)
        p.vline(x, y, min(y1, y + rnd.randint(*length)), colour)


def stripes(p, x0, y0, x1, y1, period, width, colours, phase=0):
    """Diagonal 45-degree stripes ("/" direction) in a box, cell by cell.
    colours: (lead, body, trail) for each stripe; elsewhere the box is left as it is."""
    lead, body, trail = colours
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            k = (x + y + phase) % period
            if k == 0:
                p.px(x, y, lead)
            elif k < width - 1:
                p.px(x, y, body)
            elif k == width - 1:
                p.px(x, y, trail)


def glow_dither(p, x0, y0, x1, y1, colour, replace=None):
    """Checkerboard dither of `colour` over a box (only on pixels whose colour is in
    `replace`, when given) - a hard-edged stand-in for light spill."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x + y) % 2 == 0 and (replace is None or p.get(x, y) in replace):
                p.px(x, y, colour)


# Horizontal pipe, 24 px thick, rows 20..43: colour per row (round shading, light on top).
PIPE_Y0 = 20
PIPE_STEEL = (OUTLINE, STEEL_HI, STEEL_SPEC, WHITE_HI, STEEL_SPEC, STEEL_HI, STEEL_HI,
              STEEL_LIGHT, STEEL_LIGHT, STEEL_LIGHT, STEEL_LIGHT, STEEL_MID, STEEL_MID,
              STEEL_MID, STEEL_MID, STEEL, STEEL, STEEL, STEEL, STEEL_DARK, STEEL_DARK,
              STEEL_DARK, SEAM, OUTLINE)
PIPE_TEAL = (OUTLINE, TEAL_LIGHT, CYAN_PALE, TEAL_LIGHT, TEAL_LIGHT, TEAL_LIGHT, TEAL,
             TEAL, TEAL, TEAL, TEAL, TEAL, TEAL, TEAL, TEAL_DARK, TEAL_DARK, TEAL_DARK,
             TEAL_DARK, TEAL_DARK, STEEL_DARK, STEEL_DARK, SEAM, SEAM, OUTLINE)
assert len(PIPE_STEEL) == 24 and len(PIPE_TEAL) == 24


def pipe_backing(p):
    """Darker wall behind pipes, with seams on all edges."""
    panel(p, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK)
    streaks(p, 11, 10, STEEL_DARK)


def pipe_run(p, shades, x0=0, x1=T - 1):
    """Straight horizontal pipe body plus its drop shadow."""
    for i, c in enumerate(shades):
        p.hline(x0, x1, PIPE_Y0 + i, c)
    p.hline(x0, x1, PIPE_Y0 + 24, OUTLINE)
    p.hline(x0, x1, PIPE_Y0 + 25, SEAM)


def collar(p, x, w, base=STEEL_LIGHT, hi=STEEL_SPEC, sh=STEEL_DARK):
    """Flange collar around a horizontal pipe at columns x..x+w-1, 3 px proud of it."""
    y0, y1 = PIPE_Y0 - 3, PIPE_Y0 + 26
    p.rect(x, y0, x + w - 1, y1, OUTLINE)
    p.rect(x + 1, y0 + 1, x + w - 2, y1 - 1, base)
    p.hline(x + 1, x + w - 2, y0 + 1, hi)
    p.vline(x + 1, y0 + 1, y1 - 1, hi)
    p.rect(x + 1, y0 + 13, x + w - 2, y1 - 1, STEEL_MID)
    p.hline(x + 1, x + w - 2, y0 + 2, WHITE_HI)
    p.vline(x + w - 2, y0 + 1, y1 - 1, sh)
    p.hline(x + 1, x + w - 2, y1 - 1, sh)
    p.vline(x + w // 2, y0 + 1, y1 - 1, SEAM)
    for yy in (y0 + 4, y0 + 13, y0 + 22):
        bolt(p, x + 2, yy)


# ----------------------------------------------------------------------------- tiles

def t_panel_plain(p):
    panel(p)
    streaks(p, 1, 9, STEEL_MID)
    streaks(p, 2, 4, STEEL_HI, length=(2, 4))


def t_panel_riveted(p):
    panel(p)
    streaks(p, 3, 6, STEEL_MID, x0=8, x1=55, y0=8, y1=55)
    for v in range(4, 60, 9):
        rivet(p, v, 3)
        rivet(p, v, 58)
        if 4 < v < 58:
            rivet(p, 3, v)
            rivet(p, 58, v)


def t_panel_quad(p):
    for x0, y0 in ((0, 0), (32, 0), (0, 32), (32, 32)):
        panel(p, x0, y0, x0 + 31, y0 + 31)
    streaks(p, 4, 8, STEEL_MID)
    for x, y in ((14, 14), (46, 14), (14, 46), (46, 46)):
        bolt(p, x, y)


def t_tile_wall(p):
    rnd = random.Random(4)
    p.rect(0, 0, T - 1, T - 1, WARM_DARK)
    for ty in range(0, T, 8):
        for tx in range(0, T, 8):
            base = rnd.choice((WARM, WARM, WARM, WARM_LIGHT, WARM_DARK))
            if base == WARM_DARK:
                base = WARM
                stain = True
            else:
                stain = False
            p.rect(tx + 1, ty + 1, tx + 7, ty + 7, base)
            p.hline(tx + 1, tx + 7, ty + 1, WARM_LIGHT if base == WARM else STEEL_SPEC)
            p.vline(tx + 1, ty + 1, ty + 7, WARM_LIGHT if base == WARM else STEEL_SPEC)
            p.hline(tx + 2, tx + 7, ty + 7, WARM_DARK if base == WARM else WARM)
            if stain:
                p.vline(tx + rnd.randint(2, 6), ty + 2, ty + 7, RUST_DARK)
    # grout is the WARM_DARK left at every 8th row / column (0, 8, ..., 56) - period 8.


def t_vent_louvre(p):
    panel(p)
    streaks(p, 5, 4, STEEL_MID, y0=50)
    # frame
    bevel(p, 6, 8, 57, 55, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    p.rect(10, 12, 53, 51, OUTLINE)
    # glow behind the slats, slats in front
    glow = (LAMP_ORANGE, LAMP_AMBER, LAMP_YELLOW, LAMP_PALE, LAMP_YELLOW, LAMP_AMBER)
    for i, y in enumerate(range(13, 51, 6)):
        c = glow[i % len(glow)]
        p.rect(11, y, 52, y + 1, c)
        p.hline(13, 50, y + 1, LAMP_WHITE if c == LAMP_PALE else c)
        p.hline(11, 52, y + 2, STEEL_HI)
        p.rect(11, y + 3, 52, y + 4, STEEL)
        p.hline(11, 52, y + 5, OUTLINE)
    p.vline(10, 12, 51, SEAM)
    p.vline(53, 12, 51, SEAM)
    for x, y in ((8, 10), (54, 10), (8, 52), (54, 52)):
        bolt(p, x, y)


def t_vent_grille(p):
    panel(p, 0, 0, T - 1, 19)
    panel(p, 0, 44, T - 1, T - 1)
    # slot: frame lip, dark interior, vertical bars every 4 px
    p.hline(0, T - 1, 20, OUTLINE)
    p.hline(0, T - 1, 21, STEEL_DARK)
    p.rect(0, 22, T - 1, 41, OUTLINE)
    p.hline(0, T - 1, 42, STEEL_HI)
    p.hline(0, T - 1, 43, STEEL_SPEC)
    for x in range(1, T, 4):
        p.vline(x, 22, 41, STEEL_MID)
        p.vline(x + 1, 22, 41, STEEL)
        p.px(x, 22, STEEL_HI)
    # faint warm light deep inside the slot
    for x in range(3, T, 4):
        p.vline(x, 34, 40, RUST_DARK)


def t_grille_panel(p):
    panel(p)
    bevel(p, 8, 8, 55, 55, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    inset(p, 12, 12, 51, 51, OUTLINE, dark=OUTLINE, lip=STEEL_HI)
    # glow behind the mesh: amber in the lower part
    p.rect(13, 30, 50, 50, HAZARD_DIM)
    p.rect(17, 36, 46, 50, LAMP_ORANGE)
    p.rect(22, 41, 41, 50, LAMP_AMBER)
    p.rect(13, 13, 50, 29, SEAM)
    # diamond mesh: two families of diagonal lines, period 6
    for y in range(13, 51):
        for x in range(13, 51):
            a, b = (x + y) % 6, (x - y) % 6
            if a == 0 or b == 0:
                p.px(x, y, STEEL_HI if a == 0 else STEEL_MID)
    for x, y in ((10, 10), (52, 10), (10, 52), (52, 52)):
        bolt(p, x, y)


def t_grating(p):
    p.rect(0, 0, T - 1, T - 1, OUTLINE)
    for cy in range(0, T, 8):
        for cx in range(0, T, 8):
            # bars along the top and left of each 8x8 cell
            p.hline(cx, cx + 7, cy, STEEL_HI)
            p.hline(cx, cx + 7, cy + 1, STEEL_LIGHT)
            p.hline(cx, cx + 7, cy + 2, STEEL_MID)
            p.vline(cx, cy, cy + 7, STEEL_HI)
            p.vline(cx + 1, cy + 1, cy + 7, STEEL_LIGHT)
            p.vline(cx + 2, cy + 3, cy + 7, STEEL_MID)
            # hole: dark, with a glimpse of the support below
            p.rect(cx + 3, cy + 3, cx + 7, cy + 7, OUTLINE)
            p.hline(cx + 4, cx + 7, cy + 6, SEAM)
            p.px(cx + 1, cy + 1, STEEL_SPEC)


def t_pipe_h(p):
    pipe_backing(p)
    pipe_run(p, PIPE_STEEL)
    collar(p, 8, 8)


def t_pipe_v(p):
    # same drawing as pipe-h through a transposed pen: light band on the left
    t_pipe_h(p)


def t_pipe_elbow(p):
    pipe_backing(p)
    # quarter ring centred on the corner point (64, 64), measured to pixel centres:
    # radius r maps to pipe-h row round(63.5 - r), so the right edge matches pipe-h
    # (rows 20-45, shadow included) and the bottom edge matches pipe-v
    for y in range(T):
        for x in range(T):
            r = math.hypot(63.5 - x, 63.5 - y)
            row = int(math.floor(63.5 - r + 0.5))
            i = row - PIPE_Y0
            if 0 <= i < 24:
                p.px(x, y, PIPE_STEEL[i])
            elif i in (24, 25):
                p.px(x, y, OUTLINE if i == 24 else SEAM)
    # collar across the bend at 45 degrees: a band 9 px wide, 3 px proud of the pipe
    for y in range(T):
        for x in range(T):
            dx, dy = 63.5 - x, 63.5 - y
            r = math.hypot(dx, dy)
            across = (dx - dy) / math.sqrt(2)   # distance from the 45-degree line
            if 16.5 <= r <= 47.5 and abs(across) <= 4.5:
                if r > 46.5 or r < 17.5 or abs(across) > 3.5:
                    c = OUTLINE
                elif r > 45.5:
                    c = WHITE_HI
                elif r > 42.5:
                    c = STEEL_SPEC
                elif r > 31.5:
                    c = STEEL_LIGHT
                elif r > 22.5:
                    c = STEEL_MID
                else:
                    c = STEEL_DARK
                if abs(across) < 0.75 and 17.5 <= r <= 46.5:
                    c = SEAM
                p.px(x, y, c)
    for r in (40, 30, 21):
        k = r / math.sqrt(2)
        bolt(p, int(round(63.5 - k)) - 2, int(round(63.5 - k)) + 2)


def t_pipe_teal_h(p):
    pipe_backing(p)
    pipe_run(p, PIPE_TEAL)
    rnd = random.Random(12)
    for _ in range(40):
        x = rnd.randint(0, T - 1)
        y = rnd.randint(PIPE_Y0 + 3, PIPE_Y0 + 20)
        p.px(x, y, rnd.choice((RUST_DARK, RUST, RUST_DARK)))
        if rnd.random() < 0.5:
            p.px(x + 1, y, RUST_DARK)
    rust = (OUTLINE, RUST_LIGHT, HAZARD_HI, RUST_LIGHT, RUST_LIGHT, RUST, RUST, RUST, RUST,
            RUST, RUST, RUST, RUST, RUST, RUST_DARK, RUST_DARK, RUST_DARK, RUST_DARK,
            RUST_DARK, RUST_DARK, SEAM, SEAM, SEAM, SEAM, SEAM, SEAM, OUTLINE, OUTLINE)
    for bx in (10, 42):
        for i, c in enumerate(rust):
            p.hline(bx, bx + 5, PIPE_Y0 - 2 + i, c)
        p.vline(bx, PIPE_Y0 - 2, PIPE_Y0 + 25, OUTLINE)
        p.vline(bx + 5, PIPE_Y0 - 2, PIPE_Y0 + 25, OUTLINE)
        for yy in (PIPE_Y0 + 2, PIPE_Y0 + 10, PIPE_Y0 + 18):
            rivet(p, bx + 1, yy, base=RUST_LIGHT, hi=HAZARD_HI, sh=RUST_DARK)


def t_pipe_rail(p):
    panel(p, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK, edges="tb")
    p.rect(0, 1, T - 1, 51, STEEL_DARK)
    # posts every 32 px
    for x in (6, 38):
        bevel(p, x, 10, x + 4, 52, STEEL_LIGHT, STEEL_HI, STEEL_MID, outline=OUTLINE,
              round_corners=False)
        p.rect(x - 2, 48, x + 6, 52, OUTLINE)
        p.rect(x - 1, 49, x + 5, 51, STEEL_MID)
        p.hline(x - 1, x + 5, 49, STEEL_HI)
    # top rail 6 px and mid rail 4 px, round shading
    for y, c in zip(range(10, 16), (OUTLINE, STEEL_SPEC, STEEL_HI, STEEL_LIGHT, STEEL_MID, OUTLINE)):
        p.hline(0, T - 1, y, c)
    for y, c in zip(range(29, 33), (OUTLINE, STEEL_HI, STEEL_MID, OUTLINE)):
        p.hline(0, T - 1, y, c)
    # walkway edge below the rail: amber-lit kick plate
    p.rect(0, 52, T - 1, 62, STEEL_LIGHT)
    p.hline(0, T - 1, 52, OUTLINE)
    p.hline(0, T - 1, 53, STEEL_SPEC)
    p.hline(0, T - 1, 62, STEEL_MID)
    for x in range(2, T, 8):
        p.rect(x, 56, x + 3, 58, HAZARD)
        p.hline(x, x + 3, 56, HAZARD_HI)


def t_fan(p):
    panel(p)
    bevel(p, 3, 3, 60, 60, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    for x, y in ((5, 5), (57, 5), (5, 57), (57, 57)):
        bolt(p, x, y)
    # round frame and dark interior
    p.ellipse(6, 6, 57, 57, fill=OUTLINE)
    p.ellipse(7, 7, 56, 56, fill=STEEL_HI)
    p.ellipse(8, 8, 55, 55, fill=STEEL_LIGHT)
    p.ellipse(10, 10, 53, 53, fill=STEEL_DARK)
    p.ellipse(11, 11, 52, 52, fill=OUTLINE)
    cx = cy = 31.5
    # five blades, each a quadrilateral swept a little
    for k in range(5):
        a = math.radians(-90 + k * 72)
        pts = []
        for ang, rad in ((-0.25, 6), (0.30, 6), (0.55, 20), (0.10, 21), (-0.35, 19)):
            pts.append((int(round(cx + rad * math.cos(a + ang))),
                        int(round(cy + rad * math.sin(a + ang)))))
        p.poly(pts, STEEL_HI, OUTLINE)
        lead = (int(round(cx + 8 * math.cos(a - 0.12))), int(round(cy + 8 * math.sin(a - 0.12))))
        tip = (int(round(cx + 17 * math.cos(a - 0.22))), int(round(cy + 17 * math.sin(a - 0.22))))
        p.line([lead, tip], STEEL_SPEC)
    # hub
    p.ellipse(25, 25, 38, 38, fill=OUTLINE)
    p.ellipse(26, 26, 37, 37, fill=STEEL_HI)
    p.ellipse(28, 28, 36, 36, fill=STEEL_MID)
    p.ellipse(30, 30, 33, 33, fill=OUTLINE)
    p.px(28, 28, STEEL_SPEC)
    # cage: two rings and a cross
    p.ellipse(16, 16, 47, 47, outline=STEEL_MID)
    p.ellipse(21, 21, 42, 42, outline=STEEL_MID)
    p.line([(12, 31), (24, 31)], STEEL_MID)
    p.line([(39, 31), (51, 31)], STEEL_MID)
    p.line([(31, 12), (31, 24)], STEEL_MID)
    p.line([(31, 39), (31, 51)], STEEL_MID)


def t_hazard_stripe(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    stripes(p, 0, 0, T - 1, T - 1, 16, 8, (HAZARD_HI, HAZARD, HAZARD_DIM))
    # dark stripes: a shade line after each amber stripe
    for y in range(T):
        for x in range(T):
            if (x + y) % 16 == 8:
                p.px(x, y, OUTLINE)
    rnd = random.Random(15)
    for _ in range(30):
        x, y = rnd.randint(0, T - 1), rnd.randint(0, T - 1)
        if p.get(x, y) == HAZARD:
            p.px(x, y, HAZARD_DIM)


def t_hazard_edge(p):
    # walkway face: light lip, dark band with amber dashes, panel below
    p.rect(0, 0, T - 1, 17, STEEL_DARK)
    p.hline(0, T - 1, 0, STEEL_SPEC)
    p.hline(0, T - 1, 1, STEEL_HI)
    p.hline(0, T - 1, 2, STEEL_MID)
    for y in range(4, 14):
        for x in range(T):
            k = (x + y) % 16
            if 4 <= k < 12:
                p.px(x, y, HAZARD_HI if k == 4 else (HAZARD_DIM if k == 11 else HAZARD))
    p.hline(0, T - 1, 14, SEAM)
    p.hline(0, T - 1, 15, STEEL_MID)
    p.hline(0, T - 1, 16, STEEL)
    p.hline(0, T - 1, 17, OUTLINE)
    panel(p, 0, 18, T - 1, T - 1)
    streaks(p, 16, 6, STEEL_MID, y0=21)
    for x in (8, 40):
        rivet(p, x, 21)


def t_walkway_top(p):
    # top surface plate
    p.rect(0, 0, T - 1, 13, STEEL_LIGHT)
    p.hline(0, T - 1, 0, WHITE_HI)
    p.hline(0, T - 1, 1, STEEL_SPEC)
    p.hline(0, T - 1, 2, STEEL_HI)
    for x in (0, 31, 32, 63):
        p.vline(x, 2, 13, SEAM)
    rnd = random.Random(17)
    for _ in range(12):
        x, y = rnd.randint(1, 62), rnd.randint(4, 11)
        n = rnd.randint(3, 9)
        p.hline(x, x + n, y, rnd.choice((BLUE_STEEL_LIGHT, STEEL_HI, CYAN_PALE, BLUE_STEEL_LIGHT)))
    for x in range(T):
        if p.get(x, 1) == STEEL_SPEC and x % 5 == 0:
            p.px(x, 1, CYAN_PALE)
    # front lip and face
    p.hline(0, T - 1, 14, OUTLINE)
    p.hline(0, T - 1, 15, STEEL_SPEC)
    p.rect(0, 16, T - 1, 22, STEEL_MID)
    p.hline(0, T - 1, 22, STEEL_DARK)
    p.hline(0, T - 1, 23, OUTLINE)
    for x in (5, 21, 37, 53):
        bolt(p, x, 18)
    panel(p, 0, 24, T - 1, T - 1)
    streaks(p, 18, 6, STEEL_MID, y0=27)


def t_truss(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 19, 10, STEEL, y0=1, y1=62)
    # diagonals: zigzag with period 32, drawn thick then lit
    pts = [(0, 16), (16, 47), (32, 16), (48, 47), (64, 16)]
    p.line(pts, OUTLINE, width=6)
    p.line(pts, STEEL_MID, width=4)
    p.line([(x - 1, y) for x, y in pts], STEEL_HI, width=1)
    # verticals at the nodes
    for x in (14, 46):
        bevel(p, x, 16, x + 4, 47, STEEL_MID, STEEL_HI, STEEL, outline=OUTLINE, round_corners=False)
    # chords: I-beam look
    for y0 in (8, 44):
        p.hline(0, T - 1, y0, OUTLINE)
        p.hline(0, T - 1, y0 + 1, STEEL_SPEC)
        p.rect(0, y0 + 2, T - 1, y0 + 8, STEEL_LIGHT)
        p.hline(0, T - 1, y0 + 2, STEEL_HI)
        p.hline(0, T - 1, y0 + 6, STEEL_MID)
        p.hline(0, T - 1, y0 + 7, STEEL)
        p.hline(0, T - 1, y0 + 8, OUTLINE)
        p.hline(0, T - 1, y0 + 9, SEAM)
        for x in range(2, T, 8):
            bolt(p, x, y0 + 3)


def t_cross_brace(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 20, 6, STEEL, x0=8, x1=55, y0=8, y1=55)
    # X brace corner to corner (continues into neighbouring tiles)
    for a, b in (((0, 0), (63, 63)), ((63, 0), (0, 63))):
        p.line([a, b], OUTLINE, width=8)
        p.line([a, b], STEEL_LIGHT, width=5)
    p.line([(1, 0), (63, 62)], STEEL_HI)
    p.line([(62, 0), (0, 62)], STEEL_HI)
    p.line([(0, 2), (61, 63)], STEEL_MID)
    p.line([(63, 2), (2, 63)], STEEL_MID)
    # centre plate
    bevel(p, 27, 27, 36, 36, STEEL_LIGHT, STEEL_SPEC, STEEL, outline=OUTLINE)
    bolt(p, 31, 31)
    # corner gussets
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        cx = 0 if sx == 1 else 63
        cy = 0 if sy == 1 else 63
        pts = [(cx, cy), (cx + sx * 15, cy), (cx, cy + sy * 15)]
        p.poly(pts, STEEL_MID, OUTLINE)
        bolt(p, cx + sx * 6 - (1 if sx < 0 else 0), cy + sy * 6 - (1 if sy < 0 else 0))
    # frame: 3 px half-beams on every edge (6 px where tiles meet)
    for y, c in ((0, STEEL_HI), (1, STEEL_LIGHT), (2, STEEL_MID), (3, OUTLINE)):
        p.hline(0, T - 1, y, c)
    for y, c in ((60, OUTLINE), (61, STEEL_HI), (62, STEEL_LIGHT), (63, STEEL_MID)):
        p.hline(0, T - 1, y, c)
    for x, c in ((0, STEEL_HI), (1, STEEL_LIGHT), (2, STEEL_MID), (3, OUTLINE)):
        p.vline(x, 4, 59, c)
    for x, c in ((60, OUTLINE), (61, STEEL_HI), (62, STEEL_LIGHT), (63, STEEL_MID)):
        p.vline(x, 4, 59, c)
    for v in range(10, 56, 12):
        p.px(v, 1, STEEL_SPEC)
        p.px(v, 62, STEEL_SPEC)
        p.px(1, v, STEEL_SPEC)
        p.px(62, v, STEEL_SPEC)


def hazard_corner(p, cx, cy, sx, sy, size=13):
    """Amber / dark striped triangle in a crate corner (sx, sy point inwards)."""
    for dy in range(size):
        for dx in range(size - dy):
            x, y = cx + sx * dx, cy + sy * dy
            k = (dx - dy) % 6
            p.px(x, y, HAZARD if k < 3 else OUTLINE)
            if k == 0:
                p.px(x, y, HAZARD_HI)
    for i in range(size):
        p.px(cx + sx * (size - 1 - i), cy + sy * i, OUTLINE)


def t_crate(p):
    p.rect(0, 0, T - 1, T - 1, OUTLINE)
    bevel(p, 1, 1, 62, 62, STEEL_LIGHT, STEEL_SPEC, STEEL_DARK)
    p.rect(2, 2, 61, 61, STEEL_LIGHT)
    p.hline(2, 61, 2, STEEL_HI)
    p.vline(2, 2, 61, STEEL_HI)
    # recessed face
    inset(p, 8, 8, 55, 55, STEEL, dark=OUTLINE, lip=STEEL_HI)
    streaks(p, 21, 6, STEEL_DARK, x0=10, x1=53, y0=10, y1=50)
    # X strap
    for a, b in (((9, 9), (54, 54)), ((54, 9), (9, 54))):
        p.line([a, b], OUTLINE, width=6)
        p.line([a, b], STEEL_LIGHT, width=4)
    p.line([(10, 9), (54, 53)], STEEL_HI)
    p.line([(53, 9), (9, 53)], STEEL_HI)
    bevel(p, 26, 26, 37, 37, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    bolt(p, 31, 31)
    # amber hazard corners on the frame
    hazard_corner(p, 2, 2, 1, 1)
    hazard_corner(p, 61, 2, -1, 1)
    hazard_corner(p, 2, 61, 1, -1)
    hazard_corner(p, 61, 61, -1, -1)
    for x, y in ((30, 3), (30, 58), (3, 30), (58, 30)):
        bolt(p, x, y)


def t_crate_green(p):
    p.rect(0, 0, T - 1, T - 1, OUTLINE)
    bevel(p, 1, 1, 62, 62, OLIVE, OLIVE_LIGHT, OLIVE_DARK)
    # raised rim top and bottom, horizontal ribs between
    for y0, y1 in ((2, 8), (55, 61)):
        p.rect(2, y0, 61, y1, OLIVE_LIGHT)
        p.hline(2, 61, y0, STEEL_HI)
        p.hline(2, 61, y1, OLIVE_DARK)
        p.hline(1, 62, y1 + 1 if y1 < 61 else y0 - 1, OUTLINE)
    for y in (20, 43):
        p.hline(2, 61, y, OLIVE_DARK)
        p.hline(2, 61, y + 1, OLIVE_LIGHT)
    p.vline(31, 10, 53, OLIVE_DARK)
    p.vline(32, 10, 53, OLIVE_LIGHT)
    # stencil block: lighter plate with dark blocky glyphs
    inset(p, 8, 25, 27, 38, WARM_LIGHT, dark=OLIVE_DARK, lip=STEEL_HI)
    for gx, gy, gw, gh in ((10, 28, 2, 7), (10, 28, 5, 2), (10, 31, 4, 1), (17, 28, 2, 7),
                           (17, 33, 5, 2), (24, 28, 2, 7), (21, 28, 1, 2)):
        p.rect(gx, gy, gx + gw - 1, gy + gh - 1, OLIVE_DARK)
    # latches on both sides, plus a hazard band on the lid edge
    for x in (36, 52):
        bevel(p, x, 26, x + 6, 37, STEEL_MID, STEEL_SPEC, STEEL_DARK, outline=OUTLINE)
        p.rect(x + 2, 30, x + 4, 33, OUTLINE)
        p.hline(x + 2, x + 4, 33, STEEL_HI)
    for x in range(4, 60, 6):
        p.rect(x, 4, x + 2, 6, HAZARD)
        p.px(x, 4, HAZARD_HI)
    for x, y in ((3, 10), (59, 10), (3, 50), (59, 50)):
        bolt(p, x, y)


def t_barrel(p):
    panel(p, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK)
    streaks(p, 22, 8, STEEL_DARK)
    x0, x1 = 12, 51
    body = {}
    # vertical cylinder shading per column (light band left of centre)
    shades = (STEEL_MID, STEEL_LIGHT, STEEL_HI, STEEL_SPEC, STEEL_HI, STEEL_LIGHT,
              STEEL_LIGHT, STEEL_MID, STEEL_MID, STEEL, STEEL_DARK)
    reds = (RED_DARK, RED, RED_HI, RED_PALE, RED_HI, RED, RED, RED, RED_DARK, RED_DARK, SEAM)
    n = x1 - x0 + 1
    for x in range(x0, x1 + 1):
        i = min(len(shades) - 1, (x - x0) * len(shades) // n)
        body[x] = (shades[i], reds[i])
    p.rect(x0 - 1, 6, x1 + 1, 61, OUTLINE)
    for x in range(x0, x1 + 1):
        s, r = body[x]
        p.vline(x, 7, 60, s)
        p.vline(x, 16, 24, r)
        p.vline(x, 43, 51, r)
    for y in (16, 43):
        p.hline(x0, x1, y, OUTLINE)
        p.hline(x0, x1, y + 8, OUTLINE)
    # ribs
    for y in (31, 36):
        p.hline(x0, x1, y, STEEL_DARK)
        p.hline(x0, x1, y + 1, STEEL_SPEC)
    # lid: ellipse rim at the top, chime ring at the bottom
    p.ellipse(x0 - 1, 2, x1 + 1, 11, fill=OUTLINE)
    p.ellipse(x0, 3, x1, 10, fill=STEEL_HI)
    p.ellipse(x0 + 2, 4, x1 - 2, 9, fill=STEEL_MID)
    p.ellipse(x0 + 4, 5, x0 + 8, 7, fill=STEEL_DARK)
    p.hline(x0 - 1, x1 + 1, 61, OUTLINE)
    p.hline(x0, x1, 59, STEEL_HI)
    # label on the red band
    p.rect(20, 18, 27, 22, WHITE_HI)
    p.rect(21, 19, 22, 21, RED_DARK)
    p.rect(24, 19, 26, 19, RED_DARK)
    p.hline(x1 + 2, x1 + 3, 61, SEAM)


def t_lit_sign(p):
    panel(p)
    streaks(p, 23, 6, STEEL_MID, y0=48)
    # light spill above and below the box
    glow_dither(p, 4, 12, 59, 15, HAZARD_DIM, replace=(STEEL_LIGHT, STEEL_MID))
    glow_dither(p, 4, 48, 59, 53, HAZARD_DIM, replace=(STEEL_LIGHT, STEEL_MID))
    bevel(p, 2, 16, 61, 47, STEEL_DARK, STEEL_HI, OUTLINE, outline=OUTLINE)
    p.rect(5, 19, 58, 44, LAMP_ORANGE)
    p.rect(6, 20, 57, 43, LAMP_AMBER)
    p.rect(7, 22, 56, 41, LAMP_YELLOW)
    p.rect(8, 28, 55, 35, LAMP_PALE)
    p.hline(9, 54, 31, LAMP_WHITE)
    p.hline(9, 54, 32, LAMP_WHITE)
    # dark glyph blocks: five pseudo characters
    glyphs = (
        ((0, 0, 6, 2), (2, 0, 2, 12), (0, 6, 6, 2), (0, 10, 6, 2)),
        ((0, 0, 2, 12), (4, 0, 2, 12), (0, 5, 6, 2)),
        ((0, 0, 6, 2), (0, 0, 2, 7), (0, 5, 6, 2), (4, 5, 2, 7), (0, 10, 6, 2)),
        ((2, 0, 2, 12), (0, 3, 6, 2), (0, 8, 2, 4), (4, 8, 2, 4)),
        ((0, 0, 6, 2), (4, 0, 2, 12), (0, 6, 4, 2), (0, 10, 6, 2)),
    )
    for i, g in enumerate(glyphs):
        gx, gy = 10 + i * 9, 26
        for x, y, w, h in g:
            p.rect(gx + x, gy + y, gx + x + w - 1, gy + y + h - 1, RUST_DARK)
    # mounting brackets
    for x in (12, 49):
        p.rect(x, 47, x + 2, 50, OUTLINE)
        p.rect(x, 13, x + 2, 16, OUTLINE)


def t_lit_window(p):
    p.rect(0, 0, T - 1, T - 1, WARM_DARK)
    lit = (LAMP_AMBER, LAMP_YELLOW, LAMP_ORANGE, HAZARD_DIM, LAMP_YELLOW, LAMP_AMBER)
    rows = ((0, 21), (21, 42), (42, 64))
    k = 0
    for ry0, ry1 in rows:
        for cx0 in (0, 32):
            # wall cell with seams on its edges (half seam on tile edges)
            panel(p, cx0, ry0, cx0 + 31, ry1 - 1, base=WARM, hi=WARM_LIGHT, sh=WARM_DARK)
            # window: frame, pane, mullion cross
            wx0, wy0, wx1, wy1 = cx0 + 5, ry0 + 4, cx0 + 26, ry1 - 6
            p.rect(wx0 - 1, wy0 - 1, wx1 + 1, wy1 + 1, OUTLINE)
            c = lit[k]
            p.rect(wx0, wy0, wx1, wy1, c)
            if c != HAZARD_DIM:
                p.rect(wx0, wy0, wx1, wy0 + 2, LAMP_PALE if c != LAMP_ORANGE else LAMP_AMBER)
                p.rect(wx0, wy1 - 1, wx1, wy1, LAMP_ORANGE)
                p.px(wx0 + 2, wy0 + 1, LAMP_WHITE)
            else:
                p.rect(wx0, wy0, wx1, wy0 + 1, RUST)
            mx, my = (wx0 + wx1) // 2, (wy0 + wy1) // 2
            p.vline(mx, wy0, wy1, STEEL_DARK)
            p.hline(wx0, wx1, my, STEEL_DARK)
            # sill
            p.hline(wx0 - 2, wx1 + 2, wy1 + 2, STEEL_HI)
            p.hline(wx0 - 2, wx1 + 2, wy1 + 3, STEEL_DARK)
            k += 1


def t_lit_screen(p):
    panel(p)
    glow_dither(p, 3, 3, 8, 60, MAGENTA_DARK, replace=(STEEL_LIGHT, STEEL_HI))
    glow_dither(p, 55, 3, 60, 60, MAGENTA_DARK, replace=(STEEL_LIGHT, STEEL_MID))
    bevel(p, 9, 3, 54, 60, STEEL_DARK, STEEL_HI, OUTLINE, outline=OUTLINE)
    p.rect(12, 6, 51, 57, MAGENTA)
    p.frame(12, 6, 51, 57, MAGENTA_DARK)
    # scan lines every 3 rows
    for y in range(8, 57, 3):
        p.hline(13, 50, y, MAGENTA_DARK)
    # bright core and readout bars
    p.rect(16, 12, 47, 14, MAGENTA_HI)
    for i, w in enumerate((24, 16, 28, 12, 20)):
        y = 20 + i * 6
        p.hline(16, 16 + w, y, MAGENTA_PALE)
        p.hline(16, 16 + w, y + 1, MAGENTA_HI)
    p.rect(36, 44, 47, 53, MAGENTA_HI)
    p.frame(36, 44, 47, 53, MAGENTA_PALE)
    # glass glare: a diagonal pale line
    p.line([(40, 7), (50, 17)], MAGENTA_PALE)
    p.line([(13, 50), (19, 56)], MAGENTA_PALE)


def t_wall_light(p):
    panel(p)
    streaks(p, 26, 5, STEEL_MID, y1=18)
    # light cone on the wall below the lamp (checker dither, widening)
    for i, y in enumerate(range(42, 61)):
        x0, x1 = 10 - i // 2, 53 + i // 2
        glow_dither(p, max(2, x0), y, min(61, x1), y, HAZARD_DIM if i < 10 else WARM_LIGHT,
                    replace=(STEEL_LIGHT, STEEL_MID, STEEL_HI))
    glow_dither(p, 10, 18, 53, 21, HAZARD_DIM, replace=(STEEL_LIGHT,))
    # housing and lens
    bevel(p, 6, 22, 57, 41, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    p.rect(10, 26, 53, 37, OUTLINE)
    p.rect(11, 27, 52, 36, LAMP_ORANGE)
    p.rect(12, 28, 51, 35, LAMP_AMBER)
    p.rect(13, 29, 50, 34, LAMP_YELLOW)
    p.rect(14, 30, 49, 33, LAMP_PALE)
    p.rect(16, 31, 47, 32, LAMP_WHITE)
    for x in range(18, 48, 6):
        p.vline(x, 27, 36, LAMP_ORANGE)
    for x, y in ((7, 23), (55, 23), (7, 38), (55, 38)):
        bolt(p, x, y)


def t_warning_lamp(p):
    panel(p)
    # red halo on the wall
    for y in range(4, 56):
        for x in range(6, 58):
            dx, dy = x - 31.5, y - 28.5
            if dx * dx + dy * dy < 26 * 26 and (x + y) % 2 == 0 and p.get(x, y) in (STEEL_LIGHT, STEEL_MID):
                p.px(x, y, RED_DARK)
    # wall mount plate
    bevel(p, 16, 46, 47, 57, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    bolt(p, 19, 50)
    bolt(p, 43, 50)
    # base collar
    bevel(p, 20, 40, 43, 46, STEEL_LIGHT, STEEL_SPEC, STEEL, outline=OUTLINE, round_corners=False)
    # glass dome
    p.ellipse(19, 12, 44, 48, fill=OUTLINE)
    p.rect(19, 28, 44, 40, OUTLINE)
    p.ellipse(20, 13, 43, 47, fill=RED_DARK)
    p.rect(20, 28, 43, 39, RED_DARK)
    p.ellipse(22, 15, 41, 45, fill=RED)
    p.rect(22, 28, 41, 39, RED)
    p.ellipse(25, 19, 38, 41, fill=RED_HI)
    p.rect(25, 28, 38, 38, RED_HI)
    p.rect(28, 22, 35, 36, RED_PALE)
    p.rect(30, 24, 33, 34, LAMP_WHITE)
    p.px(24, 18, RED_PALE)
    p.px(23, 19, RED_PALE)
    # cage: vertical bars and rings
    for x in (23, 27, 31, 36, 40):
        for y in range(12, 40):
            if p.get(x, y) in (RED_DARK, RED, RED_HI, RED_PALE, LAMP_WHITE):
                p.px(x, y, STEEL_DARK)
    for y in (22, 31):
        for x in range(19, 45):
            if p.get(x, y) in (RED_DARK, RED, RED_HI, RED_PALE, LAMP_WHITE):
                p.px(x, y, STEEL_DARK)
    # cap
    bevel(p, 27, 9, 36, 13, STEEL_LIGHT, STEEL_SPEC, STEEL, outline=OUTLINE, round_corners=False)


def t_control_box(p):
    panel(p)
    bevel(p, 5, 5, 58, 58, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    # screen
    inset(p, 10, 10, 33, 27, TEAL_DARK, dark=OUTLINE, lip=STEEL_HI)
    for y in (13, 16, 19, 22):
        p.hline(12, 12 + (y * 7) % 17 + 4, y, CYAN if y != 19 else TEAL_LIGHT)
    p.px(29, 13, CYAN_PALE)
    p.rect(26, 21, 31, 25, TEAL)
    # status LEDs
    for i, c in enumerate((LAMP_AMBER, LAMP_AMBER, RED_HI)):
        p.rect(39 + i * 5, 11, 41 + i * 5, 13, OUTLINE)
        p.px(40 + i * 5, 12, c)
    # big buttons: red stop, green-ish go (palette has no green: cyan stands in)
    for (bx, by), (dark, body, hi) in (((38, 18), (RED_DARK, RED_HI, RED_PALE)),
                                       ((48, 18), (TEAL_DARK, CYAN, CYAN_PALE))):
        p.ellipse(bx, by, bx + 8, by + 8, fill=OUTLINE)
        p.ellipse(bx + 1, by + 1, bx + 7, by + 7, fill=dark)
        p.ellipse(bx + 1, by + 1, bx + 6, by + 6, fill=body)
        p.px(bx + 3, by + 2, hi)
        p.px(bx + 2, by + 3, hi)
    # keypad
    for row in range(3):
        for col in range(4):
            x, y = 11 + col * 6, 33 + row * 6
            p.rect(x, y, x + 3, y + 3, OUTLINE)
            p.rect(x, y, x + 2, y + 2, STEEL_HI)
            p.px(x, y, STEEL_SPEC)
    # toggle switch: base plate and lever
    inset(p, 39, 32, 53, 52, STEEL_DARK, dark=OUTLINE, lip=STEEL_HI)
    p.rect(44, 40, 48, 44, OUTLINE)
    p.rect(45, 41, 47, 43, STEEL_MID)
    p.line([(46, 42), (49, 35)], STEEL_SPEC, width=2)
    p.rect(48, 34, 50, 36, RED)
    p.px(48, 34, RED_PALE)
    # hazard tape along the bottom
    for x in range(10, 54, 6):
        p.rect(x, 54, x + 2, 55, HAZARD)


# name, function, kind, tiles, note
TILES = (
    ("panel-plain", t_panel_plain, "panel", "xy", "plain wall panel, seams on the tile edges, rain streaks"),
    ("panel-riveted", t_panel_riveted, "panel", "xy", "wall panel with rivets at the corners and along the edges"),
    ("panel-quad", t_panel_quad, "panel", "xy", "wall panel split into 2x2 sub-panels with seams and joint dots"),
    ("tile-wall", t_tile_wall, "panel", "xy", "warm concrete wall of 8 px tiles with grout lines and rust stains"),
    ("vent-louvre", t_vent_louvre, "vent", "none", "framed louvre vent, horizontal slats lit amber from behind"),
    ("vent-grille", t_vent_grille, "vent", "x", "dark slot vent with vertical bars across a wall panel"),
    ("grille-panel", t_grille_panel, "vent", "none", "panel with an inset diamond mesh window, amber glow behind"),
    ("grating", t_grating, "floor", "xy", "square-mesh floor grating with dark gaps"),
    ("pipe-h", t_pipe_h, "pipe", "x", "horizontal steel pipe, 24 px (rows 20-43), flange collar near the left end"),
    ("pipe-v", t_pipe_v, "pipe", "y", "vertical steel pipe, 24 px (columns 20-43), flange collar near the top"),
    ("pipe-elbow", t_pipe_elbow, "pipe", "none", "90-degree steel pipe bend joining the right and bottom edges, collar on the bend"),
    ("pipe-teal-h", t_pipe_teal_h, "pipe", "x", "horizontal teal pipe with rust bands, rivets and rust spots"),
    ("pipe-rail", t_pipe_rail, "pipe", "x", "railing: top and mid rail pipes, posts every 32 px, kick plate"),
    ("fan", t_fan, "fan", "none", "square fan housing, round frame, five blades, hub and cage"),
    ("hazard-stripe", t_hazard_stripe, "stripe", "xy", "45-degree amber and dark hazard stripes, period 16 px"),
    ("hazard-edge", t_hazard_edge, "stripe", "x", "walkway face: dark band with amber stripe dashes on top, panel below"),
    ("walkway-top", t_walkway_top, "floor", "x", "walkway top plate with light edge line, plate seams and wet sheen, face below"),
    ("truss", t_truss, "girder", "x", "horizontal truss: top and bottom chords with a diagonal lattice"),
    ("cross-brace", t_cross_brace, "girder", "xy", "square frame with an X brace, corner gussets and bolts"),
    ("crate", t_crate, "crate", "none", "dark steel crate: raised frame, X strap, amber hazard corners"),
    ("crate-green", t_crate_green, "crate", "none", "olive military crate with ribs, latches and a stencil block"),
    ("barrel", t_barrel, "crate", "none", "steel drum with red bands on a dark wall panel"),
    ("lit-sign", t_lit_sign, "sign", "none", "wide amber lit sign box with dark glyph blocks"),
    ("lit-window", t_lit_window, "window", "xy", "warm wall with 2x3 lit windows (one dim) and mullions"),
    ("lit-screen", t_lit_screen, "sign", "none", "magenta glowing screen with scan lines, readout bars and frame"),
    ("wall-light", t_wall_light, "light", "none", "amber lamp strip in a housing, light spill on the panel below"),
    ("warning-lamp", t_warning_lamp, "light", "none", "red caged warning lamp on a mount plate, red halo"),
    ("control-box", t_control_box, "panel", "none", "control box: screen, red and cyan buttons, keypad, toggle switch"),
)
assert len(TILES) == COLUMNS * ROWS


# ----------------------------------------------------------------------------- build

def draw_tile(name, fn, tiles):
    img = new_tile()
    pen = Pen(img, wrap="" if tiles == "none" else tiles, transpose=False)
    if name == "pipe-v":
        # drawn as pipe-h through a transposed pen; its repeat axis is y
        pen = Pen(img, wrap="x", transpose=True)
    fn(pen)
    return img


def build():
    """Return (png_bytes, json_bytes)."""
    atlas = Image.new("P", (COLUMNS * T, ROWS * T), INDEX[OUTLINE])
    flat = []
    for c in PALETTE:
        flat += [(c >> 16) & 255, (c >> 8) & 255, c & 255]
    atlas.putpalette(flat)
    index = {
        "image": IMAGE_NAME,
        "tileSize": T,
        "columns": COLUMNS,
        "rows": ROWS,
        "note": "Placeholder programmer art, drawn by tools/blocks_placeholder.py; shapes follow "
                "scene mockups that are not in the repository.",
        "tiles": {},
    }
    for i, (name, fn, kind, tiles, note) in enumerate(TILES):
        x, y = (i % COLUMNS) * T, (i // COLUMNS) * T
        atlas.paste(draw_tile(name, fn, tiles), (x, y))
        index["tiles"][name] = {"x": x, "y": y, "w": T, "h": T, "kind": kind, "tiles": tiles,
                                "note": note}
    assert len(index["tiles"]) == len(TILES), "tile names must be unique"
    buf = io.BytesIO()
    atlas.save(buf, format="PNG", optimize=False)
    text = json.dumps(index, indent=2, sort_keys=False) + "\n"
    return buf.getvalue(), text.encode("utf-8")


def check(out):
    png, js = build()
    ok = True
    for fname, data in ((IMAGE_NAME, png), (INDEX_NAME, js)):
        path = out / fname
        if not path.is_file():
            print(f"MISSING {path}")
            ok = False
            continue
        disk = path.read_bytes()
        if disk == data:
            continue
        ok = False
        msg = f"DIFFERS {path} (disk sha256 {hashlib.sha256(disk).hexdigest()[:12]}, "\
              f"drawn {hashlib.sha256(data).hexdigest()[:12]})"
        if fname == IMAGE_NAME:
            try:
                a = Image.open(io.BytesIO(disk)).convert("RGB")
                b = Image.open(io.BytesIO(data)).convert("RGB")
                same = a.size == b.size and a.tobytes() == b.tobytes()
                msg += "; pixels equal" if same else "; pixels differ"
            except Exception as e:  # unreadable PNG
                msg += f"; cannot decode the file on disk: {e}"
        print(msg)
    if ok:
        print("OK")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT,
                    help="output folder (default: %(default)s)")
    ap.add_argument("--check", action="store_true",
                    help="compare a fresh drawing with the files in the output folder")
    args = ap.parse_args()
    if args.check:
        return check(args.out)
    png, js = build()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / IMAGE_NAME).write_bytes(png)
    (args.out / INDEX_NAME).write_bytes(js)
    print(f"wrote {args.out / IMAGE_NAME} ({len(png)} bytes)")
    print(f"wrote {args.out / INDEX_NAME} ({len(js)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
