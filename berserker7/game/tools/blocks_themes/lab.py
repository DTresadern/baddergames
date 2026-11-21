"""blocks-lab: lab, facility and prison tiles (6 x 3). See ../blocks_themed.py."""

import math
import random

from blocks_themes.common import *  # noqa: F401,F403  (palette constants and helpers)
from blocks_themes.common import (T, bevel, inset, panel, rivet, bolt, streaks, stripes,
                                  glow_dither, fill, hband, vband, speckle, disc, hazard_band,
                                  vrail)

NAME = "lab"
COLUMNS = 6
ROWS = 3
NOTE = ("Placeholder programmer art for the lab / facility / prison levels, drawn by "
        "tools/blocks_themed.py; shapes follow scene mockups that are not in the repository.")
SUBJECT = ("Placeholder environment block textures for the lab, facility and prison levels: "
           "observation and lab windows, specimen tanks, containment tube, bay, hazard and "
           "blast doors, cell bars and gate, lockers, ceiling light, terminal, lab tile wall, "
           "yellow stairs, ladder and railing, drain culvert.")
VISUAL_APPROACH = ("Programmer pixel art: hard edges, no antialiasing, steel frames with 1 px "
                   "highlight / shade bevels and dark seams; cool cyan lab light, amber and "
                   "red accents; colours from the project's shared palette.")
SEED_NOTE = ("The script uses random.Random with fixed seeds (per-call seeds in the helpers, "
             "101-144 in this theme's tiles) for small details such as grime streaks, "
             "bubbles and spots.")

YELLOW_RAIL = (OUTLINE, LAMP_PALE, LAMP_YELLOW, HAZARD_HI, HAZARD, OUTLINE)


def dark_wall(p, seed):
    panel(p, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK)
    streaks(p, seed, 8, STEEL_DARK)


def octagon(cx, cy, hw, hh, cut):
    """Points of an octagon centred on (cx, cy), half sizes hw, hh, corner cut `cut`."""
    return [(cx - hw + cut, cy - hh), (cx + hw - cut, cy - hh), (cx + hw, cy - hh + cut),
            (cx + hw, cy + hh - cut), (cx + hw - cut, cy + hh), (cx - hw + cut, cy + hh),
            (cx - hw, cy + hh - cut), (cx - hw, cy - hh + cut)]


def red_lamp(p, cx, y):
    """Small boxed red lamp 9 x 5 with its top-left at (cx - 4, y)."""
    p.rect(cx - 5, y - 1, cx + 5, y + 5, OUTLINE)
    p.rect(cx - 4, y, cx + 4, y + 4, RED)
    p.rect(cx - 3, y + 1, cx + 3, y + 3, RED_HI)
    p.hline(cx - 2, cx + 2, y + 2, RED_PALE)
    for x in (cx - 2, cx + 2):
        p.vline(x, y, y + 4, RED_DARK)


# ----------------------------------------------------------------------------- tiles

def t_observation_window(p):
    # wall above and below the glazing
    panel(p, 0, 0, T - 1, 9, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK, edges="tb")
    panel(p, 0, 54, T - 1, T - 1, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK, edges="tb")
    # interior: warm dark room, amber ceiling lights, back wall consoles
    p.rect(0, 10, T - 1, 53, WARM_DARK)
    p.rect(0, 10, T - 1, 13, SEAM)
    for x in (10, 42):
        p.rect(x, 14, x + 11, 15, LAMP_AMBER)
        p.hline(x + 1, x + 10, 14, LAMP_PALE)
        glow_dither(p, x - 3, 16, x + 14, 19, HAZARD_DIM, replace=(WARM_DARK,))
    p.rect(0, 26, T - 1, 37, RUST_DARK)
    for x in range(2, T, 8):
        p.rect(x, 28, x + 4, 31, HAZARD_DIM)
        p.px(x + 1, 29, LAMP_AMBER)
    # desks with lit monitors
    p.rect(0, 42, T - 1, 47, STEEL_DARK)
    p.hline(0, T - 1, 42, STEEL_HI)
    p.rect(0, 48, T - 1, 53, SEAM)
    for x in (4, 36):
        p.rect(x, 34, x + 8, 40, OUTLINE)
        p.rect(x + 1, 35, x + 7, 39, LAMP_AMBER)
        p.hline(x + 1, x + 7, 35, LAMP_PALE)
    # people: two seated, one standing in a pale lab coat
    for x, coat in ((18, WHITE_HI), (50, STEEL_SPEC)):
        p.rect(x, 33, x + 3, 36, WARM_LIGHT)          # head
        p.rect(x, 32, x + 3, 33, OUTLINE)             # hair
        p.rect(x - 2, 37, x + 5, 46, coat)
        p.vline(x + 5, 37, 46, STEEL_HI)
        p.rect(x - 3, 43, x + 6, 50, OUTLINE)         # chair back
        p.hline(x - 3, x + 6, 43, STEEL_MID)
    p.rect(29, 27, 31, 30, WARM_LIGHT)
    p.rect(28, 31, 32, 47, WHITE_HI)
    p.vline(32, 31, 47, STEEL_HI)
    p.vline(30, 32, 40, STEEL_SPEC)
    # glass glare
    for x in (6, 38):
        p.line([(x, 52), (x + 10, 12)], STEEL_MID)
    # slanted frame posts, leaning right going up
    for x in (0, 32):
        for y in range(10, 54):
            dx = (53 - y) // 6
            p.px(x + dx - 2, y, OUTLINE)
            p.px(x + dx - 1, y, STEEL_HI)
            p.px(x + dx, y, STEEL_LIGHT)
            p.px(x + dx + 1, y, STEEL_MID)
            p.px(x + dx + 2, y, OUTLINE)
    hband(p, 9, (OUTLINE, STEEL_HI))
    hband(p, 52, (STEEL_SPEC, OUTLINE))


def t_lab_window_cyan(p):
    panel(p, 0, 0, T - 1, 7, edges="tb")
    for x in (6, 38):
        rivet(p, x, 2)
    # lit room: ceiling with light bars, pale back wall, darker floor
    p.rect(0, 8, T - 1, 49, LAB_TEAL)
    p.rect(0, 8, T - 1, 15, LAB_SLATE)
    for x in (6, 38):
        p.rect(x, 13, x + 17, 15, WHITE_HI)
        p.hline(x, x + 17, 13, LAMP_WHITE)
        glow_dither(p, x - 2, 16, x + 19, 19, CYAN_PALE, replace=(LAB_TEAL,))
    p.rect(0, 30, T - 1, 31, LAB_TEAL_DARK)
    for x in range(4, T, 16):
        p.rect(x, 24, x + 1, 41, LAB_CYAN)
    p.rect(0, 42, T - 1, 49, LAB_TEAL_DARK)
    p.hline(0, T - 1, 42, LAB_CYAN)
    speckle(p, 102, 18, (LAB_CYAN, CYAN_PALE), y0=20, y1=40, only=(LAB_TEAL,))
    # mullion posts with chamfered corners
    for x in (0, 32):
        p.rect(x - 2, 8, x + 2, 49, STEEL_LIGHT)
        p.vline(x - 2, 8, 49, STEEL_HI)
        p.vline(x + 2, 8, 49, STEEL_DARK)
        for d in range(4):
            p.px(x + 3 + d, 8 + 3 - d, STEEL_LIGHT)
            p.px(x - 3 - d, 8 + 3 - d, STEEL_LIGHT)
            p.px(x + 3 + d, 49 - 3 + d, STEEL_LIGHT)
            p.px(x - 3 - d, 49 - 3 + d, STEEL_LIGHT)
    hband(p, 8, (OUTLINE,))
    # sill with hazard strip, wall below
    p.rect(0, 50, T - 1, 55, OUTLINE)
    hazard_band(p, 0, 51, T - 1, 54, period=8, width=4)
    p.hline(0, T - 1, 50, STEEL_SPEC)
    panel(p, 0, 56, T - 1, T - 1, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK, edges="tb")


def t_specimen_tank_cyan(p):
    dark_wall(p, 103)
    x0, x1 = 16, 47
    # glass with liquid: column shading, lighter left
    shade = (LAB_TEAL_DARK, LAB_CYAN, CYAN_PALE, LAB_TEAL, LAB_CYAN, LAB_CYAN, LAB_CYAN,
             LAB_TEAL, LAB_TEAL, LAB_TEAL_DARK, LAB_SLATE)
    p.rect(x0 - 1, 10, x1 + 1, 53, OUTLINE)
    for x in range(x0, x1 + 1):
        p.vline(x, 11, 52, shade[(x - x0) * len(shade) // (x1 - x0 + 1)])
    p.rect(x0, 11, x1, 14, LAB_TEAL)          # air gap at the top
    p.hline(x0, x1, 15, CYAN_PALE)            # liquid surface
    # specimen silhouette: head, shoulders, body, legs
    disc(p, 31.5, 22, 3.5, LAB_DEEP)
    p.rect(26, 26, 37, 29, LAB_DEEP)
    p.rect(28, 29, 35, 40, LAB_DEEP)
    p.rect(24, 27, 25, 37, LAB_DEEP)
    p.rect(38, 27, 39, 37, LAB_DEEP)
    p.rect(28, 41, 30, 50, LAB_DEEP)
    p.rect(33, 41, 35, 50, LAB_DEEP)
    p.px(30, 21, LAB_CYAN)
    # bubbles
    rnd = random.Random(104)
    for _ in range(9):
        x, y = rnd.randint(x0 + 2, x1 - 2), rnd.randint(17, 50)
        p.px(x, y, CYAN_PALE)
        if rnd.random() < 0.4:
            p.px(x + 1, y - 2, WHITE_HI)
    p.vline(x0 + 2, 16, 50, WHITE_HI)
    # caps
    for y0, y1 in ((3, 10), (53, 61)):
        bevel(p, x0 - 4, y0, x1 + 4, y1, STEEL_LIGHT, STEEL_SPEC, STEEL_DARK, outline=OUTLINE)
        p.hline(x0 - 3, x1 + 3, (y0 + y1) // 2, STEEL_MID)
        for x in (x0, x1 - 1):
            bolt(p, x, y0 + 2)
    p.rect(28, 0, 35, 2, STEEL_MID)
    p.vline(28, 0, 2, STEEL_HI)
    p.vline(35, 0, 2, OUTLINE)


def t_specimen_tank_green(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    for cx in (0, 32):
        x0, x1 = cx + 4, cx + 27
        # cap
        bevel(p, x0 - 2, 2, x1 + 2, 8, STEEL_LIGHT, STEEL_SPEC, STEEL_DARK, outline=OUTLINE)
        # glass
        p.rect(x0 - 1, 9, x1 + 1, 50, OUTLINE)
        p.rect(x0, 9, x1, 49, TOXIC_LIGHT)
        p.rect(x0, 9, x1, 12, TOXIC)
        p.vline(x0, 13, 49, TOXIC)
        p.vline(x0 + 1, 13, 49, TOXIC_HI)
        p.vline(x0 + 2, 13, 49, TOXIC_PALE)
        p.rect(x1 - 4, 13, x1, 49, TOXIC)
        p.vline(x1, 13, 49, TOXIC_DARK)
        p.hline(x0, x1, 13, TOXIC_HI)
        # curled specimen: back, tucked head and limbs
        mx, my = cx + 16, 32
        disc(p, mx, my + 1, 7, TOXIC_DARK)
        disc(p, mx + 4, my - 6, 4, TOXIC_DARK)
        disc(p, mx + 1, my + 2, 3.5, OLIVE)
        p.rect(mx + 3, my + 5, mx + 8, my + 7, TOXIC_DARK)
        p.px(mx + 5, my - 7, HAZARD_DIM)
        for a in range(150, 260, 8):
            r = math.radians(a)
            p.px(int(round(mx + 7 * math.cos(r))), int(round(my + 1 + 7 * math.sin(r))), OLIVE_LIGHT)
        p.vline(mx - 1, 40, 49, TOXIC_DARK)
        speckle(p, 105 + cx, 6, (TOXIC_PALE,), x0=x0 + 3, x1=x1 - 5, y0=15, y1=47,
                only=(TOXIC_LIGHT,))
    # base with hazard dashes
    p.rect(0, 51, T - 1, T - 1, OUTLINE)
    p.rect(0, 52, T - 1, 62, STEEL_MID)
    p.hline(0, T - 1, 52, STEEL_HI)
    p.hline(0, T - 1, 62, STEEL_DARK)
    for x in range(0, T, 8):
        p.rect(x + 1, 55, x + 4, 59, HAZARD)
        p.hline(x + 1, x + 4, 55, HAZARD_HI)


def t_containment_tube_red(p):
    dark_wall(p, 106)
    # pipes into the top
    for x in (21, 39):
        vrail(p, x, 4, (OUTLINE, STEEL_HI, STEEL_MID, OUTLINE), 0, 8)
    vrail(p, 4, 5, (OUTLINE, RUST_LIGHT, RUST, RUST_DARK, OUTLINE))
    vrail(p, 55, 5, (OUTLINE, STEEL_HI, STEEL_MID, STEEL_DARK, OUTLINE))
    x0, x1 = 18, 45
    shade = (RED_DARK, RED, RED_PALE, RED_HI, RED_HI, RED, RED, RED, RED_DARK, GORE_DARK)
    p.rect(x0 - 1, 12, x1 + 1, 51, OUTLINE)
    for x in range(x0, x1 + 1):
        p.vline(x, 12, 51, shade[(x - x0) * len(shade) // (x1 - x0 + 1)])
    # specimen
    disc(p, 31.5, 21, 3.5, GORE_DARK)
    p.rect(27, 25, 36, 38, GORE_DARK)
    p.rect(25, 26, 26, 34, GORE_DARK)
    p.rect(37, 26, 38, 34, GORE_DARK)
    p.rect(28, 39, 30, 49, GORE_DARK)
    p.rect(33, 39, 35, 49, GORE_DARK)
    p.vline(x0 + 3, 14, 49, RED_PALE)
    # banded collars
    for y0 in (7, 48):
        p.rect(x0 - 4, y0, x1 + 4, y0 + 7, OUTLINE)
        p.rect(x0 - 3, y0 + 1, x1 + 3, y0 + 6, RUST)
        p.hline(x0 - 3, x1 + 3, y0 + 1, RUST_LIGHT)
        p.hline(x0 - 3, x1 + 3, y0 + 6, RUST_DARK)
        p.hline(x0 - 3, x1 + 3, y0 + 3, SEAM)
        for x in range(x0 - 1, x1 + 2, 6):
            rivet(p, x, y0 + 3, base=RUST_LIGHT, hi=HAZARD_HI, sh=RUST_DARK)
    bevel(p, x0 - 6, 56, x1 + 6, 62, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    glow_dither(p, x0 - 8, 12, x0 - 2, 47, RED_DARK, replace=(STEEL, STEEL_MID, STEEL_DARK))
    glow_dither(p, x1 + 2, 12, x1 + 8, 47, RED_DARK, replace=(STEEL, STEEL_MID, STEEL_DARK))


def t_bay_door_red(p):
    dark_wall(p, 107)
    red_lamp(p, 31, 2)
    # octagonal frame
    outer = octagon(31.5, 36, 30, 26, 9)
    inner = octagon(31.5, 36, 24, 20, 7)
    p.poly(outer, STEEL_LIGHT, OUTLINE)
    p.poly(inner, OUTLINE)
    p.line(outer[7:] + outer[:2], STEEL_HI)
    # recessed bay: red light falling from the top
    bay = octagon(31.5, 36, 23, 19, 6)
    p.poly(bay, RED_DARK)
    for y in range(17, 56):
        for x in range(8, 56):
            if p.get(x, y) == RED_DARK:
                if y < 24 or (y < 30 and (x + y) % 2 == 0):
                    p.px(x, y, RED)
                elif y > 46 and (x + y) % 2 == 0:
                    p.px(x, y, GORE_DARK)
    # bars
    for x in range(12, 54, 5):
        for y in range(17, 56):
            if p.get(x, y) in (RED_DARK, RED, GORE_DARK):
                p.px(x, y, STEEL_DARK)
                if p.get(x + 1, y) in (RED_DARK, RED, GORE_DARK):
                    p.px(x + 1, y, OUTLINE)
    p.hline(10, 53, 20, RED_HI)
    for x in (7, 54):
        bolt(p, x, 24)
        bolt(p, x, 46)


def t_hazard_door_octagon(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    outer = octagon(31.5, 31.5, 31, 31, 12)
    mid = octagon(31.5, 31.5, 25, 25, 9)
    p.poly(outer, OUTLINE)
    p.poly(octagon(31.5, 31.5, 30, 30, 12), HAZARD)
    # stripes on the frame ring only
    for y in range(T):
        for x in range(T):
            if p.get(x, y) == HAZARD and (x + y) % 10 < 5:
                p.px(x, y, OUTLINE)
    p.poly(mid, OUTLINE)
    # corridor: nested octagons getting darker / redder
    for i, (h, c) in enumerate(((24, STEEL), (19, RED_DARK), (14, STEEL_DARK), (9, RED_DARK),
                                (5, GORE_DARK))):
        p.poly(octagon(31.5, 33.5, h, h, max(2, h * 3 // 8)), c, OUTLINE)
    # red lights: top lamps of each ring, side lamps
    for y, w in ((10, 4), (16, 3), (21, 2), (26, 1)):
        p.rect(31 - w, y, 32 + w, y + 1, RED_HI)
        p.px(31, y, RED_PALE)
    for x in (9, 53):
        p.rect(x, 30, x + 1, 36, RED_HI)
        p.px(x, 32, RED_PALE)
    p.rect(26, 54, 37, 56, STEEL_MID)
    p.hline(26, 37, 54, STEEL_HI)
    for x, y in ((14, 3), (48, 3), (14, 59), (48, 59)):
        bolt(p, x, y)


def t_blast_door_diagonal(p):
    p.rect(0, 0, T - 1, T - 1, OUTLINE)
    bevel(p, 1, 1, 62, 62, STEEL_MID, STEEL_HI, STEEL_DARK)
    # frame rivets
    for v in range(5, 60, 8):
        rivet(p, v, 2)
        rivet(p, v, 59)
        rivet(p, 2, v)
        rivet(p, 59, v)
    # leaf
    bevel(p, 7, 7, 56, 56, STEEL_LIGHT, STEEL_SPEC, STEEL_DARK, outline=OUTLINE)
    # chevron panels: red diagonal bands pointing up the middle
    for y in range(8, 56):
        for x in range(8, 56):
            k = (abs(x - 31.5) + (55 - y)) % 16
            if 2 <= k < 9:
                p.px(x, y, RED if k > 2 else RED_HI)
            elif k == 9:
                p.px(x, y, RED_DARK)
    p.vline(31, 8, 55, OUTLINE)
    p.vline(32, 8, 55, STEEL_HI)
    p.hline(8, 55, 31, OUTLINE)
    p.hline(8, 55, 32, STEEL_HI)
    bevel(p, 26, 26, 37, 37, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    bolt(p, 31, 31)
    speckle(p, 108, 40, (RUST_DARK, STEEL_DARK), x0=8, x1=55, y0=8, y1=55)


def t_cell_bars(p):
    # amber-lit cell behind
    p.rect(0, 0, T - 1, 55, WARM_DARK)
    p.rect(0, 0, T - 1, 5, SEAM)
    for x in (12, 44):
        p.rect(x, 6, x + 7, 7, LAMP_AMBER)
        glow_dither(p, x - 8, 8, x + 15, 20, HAZARD_DIM, replace=(WARM_DARK,))
    p.rect(0, 30, T - 1, 31, RUST_DARK)
    streaks(p, 109, 10, RUST_DARK, y0=8, y1=50)
    # floor slab
    p.rect(0, 56, T - 1, T - 1, CONCRETE)
    p.hline(0, T - 1, 56, CONCRETE_PALE)
    p.hline(0, T - 1, 57, CONCRETE_LIGHT)
    p.hline(0, T - 1, T - 1, CONCRETE_DARK)
    speckle(p, 110, 14, (CONCRETE_DARK, CONCRETE_LIGHT), y0=58, y1=62)
    # bars every 8 px, crossbars
    for x in range(2, T, 8):
        vband(p, x, (OUTLINE, STEEL_HI, STEEL_LIGHT, STEEL_DARK, OUTLINE), 0, 55)
    for y in (16, 46):
        hband(p, y, (OUTLINE, STEEL_SPEC, STEEL_LIGHT, STEEL_MID, OUTLINE))
    for x in range(2, T, 8):
        bolt(p, x + 1, 17)
        bolt(p, x + 1, 47)


def t_cell_gate_arch(p):
    # stone / concrete block wall
    p.rect(0, 0, T - 1, T - 1, CONCRETE_DARK)
    for row, y in enumerate(range(0, T, 8)):
        off = 0 if row % 2 == 0 else 8
        for x in range(-off, T, 16):
            p.rect(x + 1, y + 1, x + 15, y + 7, CONCRETE)
            p.hline(x + 1, x + 15, y + 1, CONCRETE_LIGHT)
            p.vline(x + 15, y + 1, y + 7, SEAM)
    # arch: steel ring, dark inside with red glow, bars
    cx, cy = 31.5, 30
    for y in range(T):
        for x in range(T):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy) if dy < 0 else abs(dx)
            if r <= 20:
                p.px(x, y, OUTLINE if y < 30 else (RED_DARK if (x + y) % 2 == 0 else GORE_DARK))
            elif r <= 23:
                p.px(x, y, STEEL_LIGHT if r > 22 else STEEL_MID)
            elif r <= 24:
                p.px(x, y, OUTLINE)
    for y in range(12, 30):
        for x in range(12, 52):
            if p.get(x, y) == OUTLINE and math.hypot(x - cx, y - cy) < 19 and y > 18 and (x + y) % 2:
                p.px(x, y, RED_DARK)
    for x in range(14, 52, 5):
        for y in range(8, T):
            if p.get(x, y) in (OUTLINE, RED_DARK, GORE_DARK) and math.hypot(x - cx, min(0, y - cy)) < 20:
                p.px(x, y, RUST_LIGHT if y < 30 else RUST)
                p.px(x + 1, y, RUST_DARK)
    hband(p, 34, (OUTLINE, RUST_LIGHT, RUST, OUTLINE), 12, 51)
    red_lamp(p, 31, 1)


def t_locker(p):
    p.rect(0, 0, T - 1, T - 1, OUTLINE)
    for cx in (0, 32):
        bevel(p, cx + 1, 1, cx + 30, 62, STEEL_MID, STEEL_HI, STEEL_DARK)
        ajar = cx == 32
        if ajar:
            # open locker: dark inside, hanging suit, door swung to the right edge
            p.rect(cx + 3, 3, cx + 24, 60, SEAM)
            p.hline(cx + 3, cx + 24, 8, STEEL_HI)
            p.rect(cx + 9, 9, cx + 18, 13, HAZARD_DIM)
            p.rect(cx + 8, 13, cx + 19, 34, HAZARD)
            p.vline(cx + 8, 13, 34, HAZARD_HI)
            p.vline(cx + 19, 13, 34, HAZARD_DIM)
            p.rect(cx + 12, 16, cx + 15, 24, OUTLINE)
            p.rect(cx + 9, 35, cx + 18, 44, STEEL_DARK)
            p.rect(cx + 4, 52, cx + 23, 58, STEEL_DARK)
            p.hline(cx + 4, cx + 23, 52, STEEL_MID)
            bevel(p, cx + 25, 2, cx + 30, 61, STEEL_LIGHT, STEEL_SPEC, STEEL_DARK,
                  outline=OUTLINE, round_corners=False)
            p.rect(cx + 27, 30, cx + 28, 34, STEEL_SPEC)
        else:
            inset(p, cx + 4, 4, cx + 27, 59, STEEL_LIGHT, dark=OUTLINE, lip=STEEL_HI)
            for y in range(7, 16, 3):
                p.hline(cx + 8, cx + 23, y, OUTLINE)
                p.hline(cx + 8, cx + 23, y + 1, STEEL_HI)
            p.rect(cx + 22, 28, cx + 24, 36, OUTLINE)
            p.rect(cx + 22, 28, cx + 23, 35, STEEL_SPEC)
            p.rect(cx + 8, 20, cx + 15, 23, WHITE_HI)
            p.hline(cx + 9, cx + 14, 21, STEEL_DARK)
            streaks(p, 111, 5, STEEL_MID, x0=cx + 6, x1=cx + 25, y0=40, y1=55)
        speckle(p, 112 + cx, 6, (RUST_DARK,), x0=cx + 2, x1=cx + 29, y0=2, y1=61)


def t_ceiling_light_cyan(p):
    # dark ceiling panel
    panel(p, 0, 0, T - 1, 19, base=STEEL_DARK, hi=STEEL, sh=SEAM, edges="tb")
    for x in range(4, T, 16):
        bolt(p, x, 8)
    # fixture housing and tube
    p.rect(0, 20, T - 1, 27, OUTLINE)
    p.rect(0, 21, T - 1, 22, STEEL_MID)
    p.hline(0, T - 1, 21, STEEL_HI)
    p.rect(0, 23, T - 1, 26, CYAN_PALE)
    p.rect(0, 24, T - 1, 25, WHITE_HI)
    for x in (0, 32):
        p.rect(x, 21, x + 3, 27, STEEL_DARK)   # end caps / brackets
        p.vline(x + 3, 21, 27, OUTLINE)
    # dark wall below with light spill fading down
    p.rect(0, 28, T - 1, T - 1, NIGHT)
    for y in range(28, T):
        k = y - 28
        for x in range(T):
            if k < 6 and (x + y) % 2 == 0:
                p.px(x, y, LAB_TEAL)
            elif k < 6:
                p.px(x, y, LAB_TEAL_DARK)
            elif k < 14 and (x + y) % 2 == 0:
                p.px(x, y, LAB_TEAL_DARK)
            elif k < 24 and (x + y) % 4 == 0:
                p.px(x, y, LAB_SLATE)
    p.hline(0, T - 1, 28, LAB_CYAN)


def t_terminal(p):
    dark_wall(p, 113)
    # screen housing on top
    bevel(p, 10, 2, 53, 25, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    for x0 in (13, 33):
        inset(p, x0, 5, x0 + 17, 22, LAB_TEAL_DARK, dark=OUTLINE, lip=STEEL_HI)
        p.rect(x0 + 2, 7, x0 + 15, 20, LAB_CYAN)
        for y in range(8, 20, 3):
            p.hline(x0 + 3, x0 + 3 + (y * 5 + x0) % 10, y, CYAN_PALE)
        p.frame(x0 + 2, 7, x0 + 15, 20, LAB_TEAL)
    # slanted control desk
    p.poly([(6, 34), (12, 26), (51, 26), (57, 34)], STEEL_LIGHT, OUTLINE)
    p.hline(12, 51, 27, STEEL_SPEC)
    for i, c in enumerate((RED_HI, LAMP_AMBER, CYAN, RED_HI, LAMP_YELLOW, CYAN, LAMP_AMBER)):
        x = 14 + i * 5
        p.rect(x, 29, x + 2, 31, OUTLINE)
        p.rect(x, 29, x + 1, 30, c)
    # body
    bevel(p, 7, 35, 56, T - 1, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE,
          round_corners=False)
    for x0 in (10, 33):
        inset(p, x0, 39, x0 + 20, 58, STEEL, dark=OUTLINE, lip=STEEL_HI)
    for x, c in ((14, RED_HI), (20, TOXIC_HI), (26, LAMP_AMBER)):
        p.rect(x, 43, x + 3, 46, OUTLINE)
        p.rect(x, 43, x + 2, 45, c)
    for y in range(43, 56, 3):
        p.hline(37, 49, y, STEEL_DARK)


def t_lab_tile_wall(p):
    fill(p, LAB_SLATE)
    rnd = random.Random(114)
    for ty in range(0, T, 16):
        for tx in range(0, T, 16):
            base = rnd.choice((LAB_TILE, LAB_TILE, LAB_TILE, LAB_TILE_DARK))
            p.rect(tx + 1, ty + 1, tx + 15, ty + 15, base)
            p.hline(tx + 1, tx + 15, ty + 1, CYAN_PALE if base == LAB_TILE else LAB_TILE)
            p.vline(tx + 1, ty + 1, ty + 15, CYAN_PALE if base == LAB_TILE else LAB_TILE)
            p.hline(tx + 2, tx + 15, ty + 15, LAB_TILE_DARK if base == LAB_TILE else LAB_SLATE)
            p.vline(tx + 15, ty + 2, ty + 15, LAB_TILE_DARK if base == LAB_TILE else LAB_SLATE)
            if rnd.random() < 0.3:
                p.px(tx + 3, ty + 3, WHITE_HI)
    # light grime running down
    streaks(p, 115, 10, LAB_TILE_DARK, x0=0, x1=63, y0=0, y1=63, length=(4, 12))
    speckle(p, 116, 16, (LAB_SLATE, STEEL_SPEC), only=(LAB_TILE,))


def t_stairs_yellow(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 117, 6, STEEL)
    # treads: 8 steps of 8 x 8 px; the nosing line runs from (0, 63) to (63, 0), the
    # stringer hugs the line underneath
    for x in range(T):
        i = x // 8
        top = 56 - i * 8
        low = 63 - x + 6
        for y in range(top, min(T - 1, low) + 1):
            k = y - top
            d = low - y
            if k == 0:
                c = STEEL_SPEC
            elif k == 1:
                c = STEEL_HI
            elif d < 6:
                c = (OUTLINE, STEEL, STEEL_MID, STEEL_LIGHT, STEEL_HI, OUTLINE)[d]
            elif x % 8 == 0:
                c = STEEL_LIGHT
            else:
                c = STEEL_MID
            p.px(x, y, c)
        if x % 8 == 7:
            p.vline(x, top + 2, min(T - 1, 63 - x - 1), OUTLINE)
    # yellow handrail 16 px above the nosings, posts down to the treads
    for x in range(T):
        y = 63 - x - 18
        for d, c in enumerate((OUTLINE, LAMP_PALE, LAMP_YELLOW, HAZARD, OUTLINE)):
            if 0 <= y + d < T:
                p.px(x, y + d, c)
    for x in (12, 44):
        y = 63 - x - 14
        for yy in range(y, y + 14):
            p.px(x, yy, LAMP_YELLOW)
            p.px(x + 1, yy, HAZARD)


def t_ladder_yellow(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    for x in (0, 63):
        p.vline(x, 0, T - 1, SEAM)
    streaks(p, 118, 8, STEEL, x0=2, x1=61, y0=0, y1=63)
    # wall brackets
    for y in (4, 36):
        for x in (14, 46):
            p.rect(x, y, x + 3, y + 3, OUTLINE)
            p.rect(x, y, x + 2, y + 2, STEEL_HI)
    # rungs every 8 px
    for y in range(3, T, 8):
        hband(p, y, (LAMP_PALE, HAZARD_HI, HAZARD, OUTLINE), 22, 41)
    # rails
    for x in (17, 42):
        vrail(p, x, 5, (OUTLINE, LAMP_PALE, LAMP_YELLOW, HAZARD, OUTLINE))


def t_railing_yellow(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 119, 8, STEEL, y1=44)
    # posts every 32 px
    for x in (4, 36):
        vrail(p, x, 4, (OUTLINE, LAMP_YELLOW, HAZARD, OUTLINE), 8, 47)
    # top rail and mid rail
    hband(p, 8, YELLOW_RAIL)
    hband(p, 27, (OUTLINE, LAMP_YELLOW, HAZARD, OUTLINE))
    # toe board, then the walkway edge
    hband(p, 42, (OUTLINE, STEEL_HI, STEEL_LIGHT, STEEL_LIGHT, STEEL_MID, OUTLINE))
    p.rect(0, 48, T - 1, T - 1, STEEL_MID)
    p.hline(0, T - 1, 48, STEEL_SPEC)
    p.hline(0, T - 1, 49, STEEL_HI)
    p.hline(0, T - 1, 55, SEAM)
    p.hline(0, T - 1, T - 1, OUTLINE)
    for x in range(4, T, 16):
        bolt(p, x, 51)
        bolt(p, x + 8, 58)


def t_drain_culvert(p):
    panel(p, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK)
    for v in range(4, 60, 8):
        rivet(p, v, 3)
        rivet(p, 3, v)
        rivet(p, 58, v)
    cx, cy = 31.5, 30
    # arch ring
    for y in range(6, 52):
        for x in range(4, 60):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy) if dy < 0 else abs(dx)
            if r <= 18:
                p.px(x, y, OUTLINE if r < 17 or y > 50 else SEAM)
            elif r <= 23:
                p.px(x, y, (STEEL_HI, STEEL_LIGHT, STEEL_MID, STEEL_MID, STEEL_DARK)[min(4, int(r - 18))])
            elif r <= 24:
                p.px(x, y, OUTLINE)
    for a in range(-170, -5, 30):
        r = math.radians(a)
        bolt(p, int(cx + 20.5 * math.cos(r)) - 1, int(cy + 20.5 * math.sin(r)) - 1)
    # bars
    for x in range(16, 48, 4):
        for y in range(10, 52):
            if p.get(x, y) in (OUTLINE, SEAM) and math.hypot(x - cx, min(0, y - cy)) < 17:
                p.px(x, y, STEEL_MID)
    # water pouring from the bottom of the opening: falling streaks, foam at the bottom
    p.rect(14, 48, 49, T - 1, LAB_TEAL_DARK)
    for x in range(14, 50):
        c = (LAB_TEAL, CYAN_PALE, LAB_TEAL, LAB_CYAN, WHITE_HI, LAB_TEAL_DARK)[(x * 5) % 6]
        p.vline(x, 48, T - 1, c)
    rnd = random.Random(120)
    for _ in range(70):
        x, y = rnd.randint(12, 51), rnd.randint(57, T - 1)
        p.px(x, y, rnd.choice((WHITE_HI, CYAN_PALE, WHITE_HI)))
    p.hline(13, 50, 47, OUTLINE)


R1, R1_LAB2, R1_LAB3 = "01-lab-01.png", "01-lab-02.png", "01-lab-03.png"
F1, F2, F3 = "02-facility-01.png", "02-facility-02.png", "02-facility-03.png"
P1 = "04-prison-01.png"

# name, function, kind, tiles, note, refs
TILES = (
    ("observation-window", t_observation_window, "window", "x",
     "control-room glazing: slanted frame posts every 32 px, amber lit room, desks, monitors and staff",
     (f"{R1} 1376,60 410x121",)),
    ("lab-window-cyan", t_lab_window_cyan, "window", "x",
     "framed window band onto a pale cyan lit lab: ceiling light bars, mullions every 32 px, hazard strip on the sill",
     (f"{F1} 495,36 386x265",)),
    ("specimen-tank-cyan", t_specimen_tank_cyan, "tank", "none",
     "glass cylinder of cyan liquid with a dark specimen and bubbles, steel caps top and bottom",
     (f"{F1} 941,24 145x217",)),
    ("specimen-tank-green", t_specimen_tank_green, "tank", "x",
     "two green-yellow specimen tanks per tile with curled specimens, base with hazard dashes",
     (f"{R1_LAB2} 688,483 241x145",)),
    ("containment-tube-red", t_containment_tube_red, "tank", "none",
     "red-lit containment tube with a specimen, riveted rust collars, pipes into the top",
     (f"{R1_LAB3} 1979,0 145x265",)),
    ("bay-door-red", t_bay_door_red, "door", "none",
     "octagonal steel frame round a red-lit recessed bay behind bars, red lamp above",
     (f"{R1} 253,241 278x193",)),
    ("hazard-door-octagon", t_hazard_door_octagon, "door", "none",
     "octagonal door frame with amber / dark hazard stripes, dark corridor of nested frames and red lights",
     (f"{F1} 1907,145 193x217", f"{F2} 1726,241 362x241")),
    ("blast-door-diagonal", t_blast_door_diagonal, "door", "none",
     "heavy door leaf with red diagonal chevron panels, centre boss, riveted frame",
     (f"{F3} 1665,133 290x314",)),
    ("cell-bars", t_cell_bars, "bars", "x",
     "prison cell front: vertical bars every 8 px, two crossbars, amber-lit cell behind, floor slab",
     (f"{P1} 760,145 205x133",)),
    ("cell-gate-arch", t_cell_gate_arch, "bars", "none",
     "arched barred gate in a concrete block wall, dark red-lit inside, red lamp above",
     (f"{P1} 1870,434 157x145",)),
    ("locker", t_locker, "furniture", "x",
     "two grey steel lockers per tile: one shut (vents, handle, label), one open with a suit inside",
     (f"{F2} 712,302 314x181",)),
    ("ceiling-light-cyan", t_ceiling_light_cyan, "light", "x",
     "fluorescent tube strip under a dark ceiling panel, cyan-white light spilling down the wall",
     (f"{F2} 410,229 121x48",)),
    ("terminal", t_terminal, "console", "none",
     "standing console: two cyan screens, slanted desk of red / amber / cyan buttons, cabinet",
     (f"{F3} 1062,302 133x145",)),
    ("lab-tile-wall", t_lab_tile_wall, "panel", "xy",
     "clinical wall of 16 px pale grey-cyan tiles with dark grout and light grime",
     (f"{F1} 97,48 386x265",)),
    ("stairs-yellow", t_stairs_yellow, "stairs", "none",
     "steel stair flight at 45 degrees with a yellow handrail; the stair line enters at the bottom-left "
     "corner and leaves at the top-right corner, so tiles chain diagonally (place the next one up and right)",
     (f"{R1_LAB2} 1279,386 169x157",)),
    ("ladder-yellow", t_ladder_yellow, "ladder", "y",
     "yellow ladder rails with rungs every 8 px over a dark wall, wall brackets",
     (f"{R1} 193,446 60x145",)),
    ("railing-yellow", t_railing_yellow, "rail", "x",
     "thin yellow handrail and mid rail, posts every 32 px, toe board, walkway edge below",
     (f"{F2} 97,181 290x253",)),
    ("drain-culvert", t_drain_culvert, "vent", "none",
     "arched culvert with vertical bars in a riveted wall, water pouring from its bottom",
     (f"{R1} 410,495 121x133",)),
)
