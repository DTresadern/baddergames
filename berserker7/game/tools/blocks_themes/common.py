"""Shared palette and helpers for the themed block atlases (see ../blocks_themed.py).

The extended palette is blocks_placeholder.PALETTE followed by the constants below, all
taken from the project's shared palette. Colours are only ever named constants.
"""

import math
import random

from blocks_placeholder import (  # noqa: F401  (re-exported for the theme modules)
    T, PALETTE, Pen, bevel, inset, panel, rivet, bolt, streaks, stripes, glow_dither,
    OUTLINE, SEAM, STEEL_DARK, STEEL, STEEL_MID, STEEL_LIGHT, STEEL_HI, STEEL_SPEC, WHITE_HI,
    WARM_DARK, WARM, WARM_LIGHT, RUST_DARK, RUST, RUST_LIGHT, HAZARD_DIM, HAZARD, HAZARD_HI,
    LAMP_ORANGE, LAMP_AMBER, LAMP_YELLOW, LAMP_PALE, LAMP_WHITE,
    RED_DARK, RED, RED_HI, RED_PALE, MAGENTA_DARK, MAGENTA, MAGENTA_HI, MAGENTA_PALE,
    TEAL_DARK, TEAL, TEAL_LIGHT, CYAN, CYAN_PALE, OLIVE_DARK, OLIVE, OLIVE_LIGHT,
    BLUE_STEEL, BLUE_STEEL_LIGHT,
)

# ----------------------------------------------------------------------------- extra colours

# toxic greens (slime, acid, specimen liquid, spores)
TOXIC_DARK = 0x3E4830
TOXIC = 0x70834C
TOXIC_LIGHT = 0x92A456
TOXIC_HI = 0xBBCB61
TOXIC_PALE = 0xF8E688
# flesh, burgundy and purple growth
GORE_DARK = 0x470D13
GORE = 0x5A1221
FLESH_DARK = 0x4A293B
FLESH = 0x7B2E41
FLESH_MID = 0xA03344
FLESH_LIGHT = 0x905558
FLESH_PINK = 0xAA5876
VEIN = 0x751756
POD_DARK = 0x6B3959
POD = 0x66434E
# bone
BONE_DARK = 0x9F7F82
BONE_MID = 0xC4A79A
BONE = 0xD4C8B2
BONE_WARM = 0xEDD89E
# rock
ROCK_DARK = 0x2F261F
ROCK = 0x3B3126
ROCK_MID = 0x4E3E2F
ROCK_LIGHT = 0x5C4330
ROCK_HI = 0x896C52
# cool lab colours
LAB_TEAL = 0x77C3B9
LAB_CYAN = 0x51B6C4
LAB_TEAL_DARK = 0x2E5E6A
LAB_SLATE = 0x36535B
LAB_DEEP = 0x1C2D2A
LAB_TILE = 0x7899A7
LAB_TILE_DARK = 0x637D93
# concrete greys
CONCRETE_DARK = 0x46474C
CONCRETE = 0x565357
CONCRETE_COOL = 0x545E66
CONCRETE_LIGHT = 0x6F6168
CONCRETE_HI = 0x878197
CONCRETE_PALE = 0xA89EAA
# wood
WOOD_DARK = 0x5D3814
WOOD = 0x7C522B
WOOD_LIGHT = 0x9A794A
# water and night
WATER_DARK = 0x1B231E
WATER = 0x28463F
NIGHT = 0x192328
# gold (banner emblem)
GOLD = 0xECB94D

EXTRA = (
    TOXIC_DARK, TOXIC, TOXIC_LIGHT, TOXIC_HI, TOXIC_PALE,
    GORE_DARK, GORE, FLESH_DARK, FLESH, FLESH_MID, FLESH_LIGHT, FLESH_PINK, VEIN, POD_DARK, POD,
    BONE_DARK, BONE_MID, BONE, BONE_WARM,
    ROCK_DARK, ROCK, ROCK_MID, ROCK_LIGHT, ROCK_HI,
    LAB_TEAL, LAB_CYAN, LAB_TEAL_DARK, LAB_SLATE, LAB_DEEP, LAB_TILE, LAB_TILE_DARK,
    CONCRETE_DARK, CONCRETE, CONCRETE_COOL, CONCRETE_LIGHT, CONCRETE_HI, CONCRETE_PALE,
    WOOD_DARK, WOOD, WOOD_LIGHT,
    WATER_DARK, WATER, NIGHT,
    GOLD,
)
XPALETTE = tuple(PALETTE) + EXTRA
assert len(set(XPALETTE)) == len(XPALETTE), "extended palette constants must be distinct"
assert len(XPALETTE) <= 256


# ----------------------------------------------------------------------------- helpers

def fill(p, c):
    p.rect(0, 0, T - 1, T - 1, c)


def hband(p, y, colours, x0=0, x1=T - 1):
    """Horizontal rows of colours starting at row y (round shading for rails, beams)."""
    for i, c in enumerate(colours):
        p.hline(x0, x1, y + i, c)


def vband(p, x, colours, y0=0, y1=T - 1):
    for i, c in enumerate(colours):
        p.vline(x + i, y0, y1, c)


def speckle(p, seed, count, colours, x0=0, x1=T - 1, y0=0, y1=T - 1, only=None):
    """Single random pixels (grime, rust spots, glints); only on `only` colours if given."""
    rnd = random.Random(seed)
    for _ in range(count):
        x, y = rnd.randint(x0, x1), rnd.randint(y0, y1)
        c = rnd.choice(colours)
        if only is None or p.get(x, y) in only:
            p.px(x, y, c)


def disc(p, cx, cy, r, c):
    """Filled disc from pixel centres (hard edged)."""
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                p.px(x, y, c)


def ring(p, cx, cy, r0, r1, c):
    for y in range(int(cy - r1) - 1, int(cy + r1) + 2):
        for x in range(int(cx - r1) - 1, int(cx + r1) + 2):
            d = math.hypot(x - cx, y - cy)
            if r0 <= d <= r1:
                p.px(x, y, c)


def blob(p, cx, cy, rx, ry, base, hi, sh, outline=None):
    """Glossy ellipse: outline, base, shade on the lower right, highlight top-left."""
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx, dy = (x - cx) / rx, (y - cy) / ry
            d = dx * dx + dy * dy
            if d > 1:
                continue
            if outline is not None and d > 0.78:
                c = outline
            elif dx + dy > 0.55:
                c = sh
            else:
                c = base
            p.px(x, y, c)
    for y in range(int(cy - ry * 0.6), int(cy - ry * 0.25) + 1):
        for x in range(int(cx - rx * 0.55), int(cx - rx * 0.15) + 1):
            dx, dy = (x - cx + rx * 0.35) / (rx * 0.25), (y - cy + ry * 0.42) / (ry * 0.2)
            if dx * dx + dy * dy <= 1:
                p.px(x, y, hi)


def vrail(p, x, w, colours, y0=0, y1=T - 1):
    """Vertical bar w px wide coloured per column from `colours` (left to right)."""
    for i in range(w):
        p.vline(x + i, y0, y1, colours[min(i, len(colours) - 1)])


def hazard_band(p, x0, y0, x1, y1, period=12, width=6, dark=OUTLINE, phase=0):
    """Box of 45-degree amber / dark hazard stripes."""
    p.rect(x0, y0, x1, y1, dark)
    stripes(p, x0, y0, x1, y1, period, width, (HAZARD_HI, HAZARD, HAZARD_DIM), phase=phase)


def wavy(p, pts, c, width=1):
    p.line(pts, c, width=width)


def tendril(p, seed, x, y, length, step_y, colours, sway=1, thin_at=None):
    """A hanging / crawling strand: walks `length` steps, moving step_y each step in y
    (+1 down) and swaying +-sway in x. colours: (dark edge, body, highlight)."""
    rnd = random.Random(seed)
    dark, body, hi = colours
    w = 3
    for i in range(length):
        if thin_at is not None and i >= thin_at:
            w = 2 if i < thin_at + (length - thin_at) // 2 else 1
        if w >= 3:
            p.px(x - 1, y, dark)
            p.px(x, y, body)
            p.px(x + 1, y, dark)
            if i % 3 == 0:
                p.px(x, y, hi)
        elif w == 2:
            p.px(x, y, body)
            p.px(x + 1, y, dark)
        else:
            p.px(x, y, body)
        y += step_y
        if rnd.random() < 0.35:
            x += rnd.choice((-sway, sway))
    return x, y
