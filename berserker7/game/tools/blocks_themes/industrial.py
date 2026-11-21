"""blocks-industrial: industrial, shaft, walkway, street, chase, lift shaft, driller and
machine boss tiles (7 x 3). See ../blocks_themed.py."""

import math
import random

from blocks_themes.common import *  # noqa: F401,F403  (palette constants and helpers)
from blocks_themes.common import (T, bevel, inset, panel, rivet, bolt, streaks, stripes,
                                  glow_dither, fill, hband, vband, speckle, disc, ring,
                                  hazard_band, vrail)

NAME = "industrial"
COLUMNS = 7
ROWS = 3
NOTE = ("Placeholder programmer art for the industrial / shaft / street / machine levels, drawn "
        "by tools/blocks_themed.py; shapes follow scene mockups that are not in the repository.")
SUBJECT = ("Placeholder environment block textures for the industrial, shaft, walkway, street, "
           "chase, lift shaft, driller and machine boss levels: furnace drum, pipe outlet, valve "
           "wheel, large riveted pipe, lamp strip, lift cage and platform edge, cable spool, "
           "rusty girder, bridge deck and pier, road barriers, tank trap, banner, floodlight, "
           "shutter door, conveyor, drill face, crawler tread, battery rack.")
VISUAL_APPROACH = ("Programmer pixel art: hard edges, no antialiasing, rusty teal and steel "
                   "machinery with 1 px highlight / shade bevels, rivets and dark seams; amber "
                   "lamps and hazard stripes, red marker lamps; colours from the project's "
                   "shared palette.")
SEED_NOTE = ("The script uses random.Random with fixed seeds (per-call seeds in the helpers, "
             "201-223 in this theme's tiles) for small details such as rust spots, grime "
             "streaks and puddle glints.")

RUST_PIPE = (OUTLINE, RUST_LIGHT, HAZARD_HI, RUST_LIGHT, RUST_LIGHT, RUST, RUST, RUST, RUST,
             RUST, RUST, RUST_DARK, RUST_DARK, RUST_DARK, SEAM, OUTLINE)
TEAL_DRUM = (OUTLINE, TEAL_LIGHT, CYAN_PALE, TEAL_LIGHT, TEAL_LIGHT, TEAL_LIGHT, TEAL, TEAL,
             TEAL, TEAL, TEAL, TEAL, TEAL, TEAL, TEAL, TEAL_DARK, TEAL_DARK, TEAL_DARK,
             TEAL_DARK, STEEL_DARK, SEAM, OUTLINE)


def stretch(colours, n):
    """Resample a list of row colours to n rows (nearest)."""
    return [colours[i * len(colours) // n] for i in range(n)]


def wet_ground(p, y0, seed):
    """Dark wet street from row y0 down, with amber reflection glints."""
    p.rect(0, y0, T - 1, T - 1, NIGHT)
    p.hline(0, T - 1, y0, CONCRETE_LIGHT)
    rnd = random.Random(seed)
    for _ in range(14):
        x, y = rnd.randint(0, T - 1), rnd.randint(y0 + 2, T - 1)
        n = rnd.randint(2, 6)
        p.hline(x, x + n, y, rnd.choice((LAMP_AMBER, HAZARD_DIM, CONCRETE, CONCRETE_COOL)))


def red_marker(p, x, y):
    p.rect(x - 1, y - 1, x + 3, y + 3, OUTLINE)
    p.rect(x, y, x + 2, y + 2, RED_HI)
    p.px(x, y, RED_PALE)


# ----------------------------------------------------------------------------- tiles

def t_furnace_drum(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    rows = stretch(TEAL_DRUM, 48)
    for i, c in enumerate(rows):
        p.hline(0, T - 1, 6 + i, c)
    # rust patches on the teal
    rnd = random.Random(201)
    for _ in range(60):
        x, y = rnd.randint(0, T - 1), rnd.randint(9, 50)
        if p.get(x, y) in (TEAL, TEAL_LIGHT, TEAL_DARK):
            p.px(x, y, rnd.choice((RUST_DARK, RUST, RUST_DARK)))
            p.px(x + 1, y, RUST_DARK)
    # glowing amber grille window
    x0, x1, y0, y1 = 36, 59, 14, 45
    p.rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2, OUTLINE)
    p.rect(x0, y0, x1, y1, LAMP_AMBER)
    p.rect(x0, y0 + 4, x1, y1 - 4, LAMP_YELLOW)
    p.rect(x0 + 3, y0 + 10, x1 - 3, y1 - 10, LAMP_PALE)
    for x in range(x0 + 2, x1, 4):
        p.vline(x, y0, y1, RUST_DARK)
    for y in range(y0 + 3, y1, 6):
        p.hline(x0, x1, y, RUST_DARK)
    p.hline(x0 - 1, x1 + 1, y0 - 1, HAZARD_DIM)
    # bands with rivets every 32 px
    for bx in (6, 22):
        for i, c in enumerate(stretch(RUST_PIPE, 52)):
            p.hline(bx, bx + 5, 4 + i, c)
        p.vline(bx, 4, 55, OUTLINE)
        p.vline(bx + 5, 4, 55, OUTLINE)
        for y in range(9, 52, 7):
            rivet(p, bx + 1, y, base=RUST_LIGHT, hi=HAZARD_HI, sh=RUST_DARK)
    # base with hazard dashes
    p.rect(0, 56, T - 1, T - 1, OUTLINE)
    hazard_band(p, 0, 57, T - 1, 62, period=12, width=6)


def t_pipe_outlet(p):
    # riveted rusty wall
    panel(p, base=RUST_DARK, hi=RUST, sh=SEAM)
    for v in range(5, 60, 9):
        rivet(p, v, 3, base=RUST_LIGHT, hi=HAZARD_HI, sh=OUTLINE)
    speckle(p, 202, 40, (TEAL_DARK, TEAL, RUST))
    # pipe body coming out of the wall towards the viewer, to the lower right
    for i, c in enumerate(stretch(TEAL_DRUM, 30)):
        p.line([(0, 12 + i), (18, 12 + i)], c)
    cx, cy = 30, 26
    # flange ring and dark mouth
    ring(p, cx, cy, 15.5, 19, OUTLINE)
    ring(p, cx, cy, 15.5, 18, RUST)
    ring(p, cx, cy, 17, 18, RUST_LIGHT)
    for a in range(0, 360, 36):
        r = math.radians(a)
        bolt(p, int(cx + 16.5 * math.cos(r)) - 1, int(cy + 16.5 * math.sin(r)) - 1)
    disc(p, cx, cy, 15, TEAL)
    disc(p, cx + 1, cy + 1, 12.5, OUTLINE)
    disc(p, cx + 2, cy + 2, 8, SEAM)
    # dirty water pouring from the lower lip
    for x in range(22, 42):
        top = 37 if 24 <= x <= 39 else 40
        c = (TOXIC, TOXIC_LIGHT, WOOD_LIGHT, TOXIC, TOXIC_DARK, TOXIC_LIGHT)[(x * 3) % 6]
        p.vline(x, top, T - 1, c)
    rnd = random.Random(203)
    for _ in range(40):
        x, y = rnd.randint(18, 46), rnd.randint(54, T - 1)
        p.px(x, y, rnd.choice((BONE, TOXIC_HI, WHITE_HI)))
    for y in range(40, 54, 3):
        p.px(26 + (y % 5), y, TOXIC_HI)


def t_valve_wheel(p):
    # steamy grey backdrop
    fill(p, CONCRETE)
    for y in range(T):
        for x in range(T):
            k = (x * 7 + y * 3 + (x * y) % 5) % 9
            if k == 0:
                p.px(x, y, CONCRETE_LIGHT)
            elif k == 1 and y > 30:
                p.px(x, y, CONCRETE_DARK)
    # pipe across the bottom
    for i, c in enumerate(stretch(RUST_PIPE, 22)):
        p.hline(0, T - 1, 42 + i, c)
    for bx in (4, 52):
        p.rect(bx, 40, bx + 5, T - 1, OUTLINE)
        p.rect(bx + 1, 41, bx + 4, 62, RUST)
        p.vline(bx + 1, 41, 62, RUST_LIGHT)
    # stem
    vrail(p, 29, 6, (OUTLINE, STEEL_HI, STEEL_MID, STEEL, STEEL_DARK, OUTLINE), 18, 41)
    p.rect(25, 36, 38, 41, OUTLINE)
    p.rect(26, 37, 37, 40, RUST)
    p.hline(26, 37, 37, RUST_LIGHT)
    # handwheel seen from slightly above: an ellipse rim with spokes
    cx, cy, rx, ry = 31.5, 17, 25, 9
    for y in range(4, 31):
        for x in range(3, 61):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if 0.72 <= d <= 1.0:
                p.px(x, y, RUST_LIGHT if y < cy - 2 else (RUST if y < cy + 4 else RUST_DARK))
            elif 0.6 <= d < 0.72 or 1.0 < d <= 1.2:
                p.px(x, y, OUTLINE)
    for a in range(0, 360, 60):
        r = math.radians(a + 30)
        p.line([(int(cx), int(cy)), (int(round(cx + rx * 0.8 * math.cos(r))),
                                     int(round(cy + ry * 0.8 * math.sin(r))))], RUST_DARK, width=2)
    disc(p, cx, cy, 3.5, OUTLINE)
    disc(p, cx, cy, 2.5, RUST_LIGHT)
    p.px(31, 16, HAZARD_HI)


def t_pipe_large_riveted(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    rows = stretch(RUST_PIPE, 56)
    for i, c in enumerate(rows):
        p.hline(0, T - 1, 4 + i, c)
    rnd = random.Random(204)
    for _ in range(50):
        x, y = rnd.randint(0, T - 1), rnd.randint(8, 54)
        p.px(x, y, rnd.choice((TEAL_DARK, TEAL, RUST_DARK, STEEL_MID)))
    # rivet rows along the pipe
    for y in (12, 46):
        for x in range(2, T, 8):
            rivet(p, x, y, base=RUST_LIGHT, hi=HAZARD_HI, sh=RUST_DARK)
    # flange bands every 32 px, proud of the pipe
    for bx in (12, 44):
        p.rect(bx, 1, bx + 7, 62, OUTLINE)
        for i, c in enumerate(stretch(RUST_PIPE, 60)):
            p.hline(bx + 1, bx + 6, 2 + i, c)
        p.vline(bx + 1, 2, 61, HAZARD_HI)
        p.vline(bx + 6, 2, 61, SEAM)
        for y in range(6, 58, 8):
            bolt(p, bx + 3, y)


def t_lamp_strip_v(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    streaks(p, 205, 10, STEEL_DARK, x0=0, x1=63, y0=0, y1=63)
    # side rails
    for x in (20, 41):
        vrail(p, x, 3, (OUTLINE, STEEL_MID, OUTLINE))
    # lamp column: two lamp segments per tile with dark gaps
    vrail(p, 24, 16, (OUTLINE, STEEL_HI, STEEL_LIGHT, STEEL_MID, STEEL_MID, STEEL_MID,
                      STEEL_MID, STEEL_MID, STEEL_MID, STEEL_MID, STEEL_MID, STEEL_MID,
                      STEEL, STEEL_DARK, SEAM, OUTLINE))
    for y0 in (4, 36):
        p.rect(26, y0, 37, y0 + 17, OUTLINE)
        p.rect(27, y0 + 1, 36, y0 + 16, LAMP_ORANGE)
        p.rect(28, y0 + 2, 35, y0 + 15, LAMP_AMBER)
        p.rect(30, y0 + 3, 33, y0 + 14, LAMP_YELLOW)
        p.vline(31, y0 + 4, y0 + 13, LAMP_PALE)
        glow_dither(p, 14, y0 + 2, 19, y0 + 15, HAZARD_DIM, replace=(NIGHT, STEEL_DARK))
        glow_dither(p, 45, y0 + 2, 50, y0 + 15, HAZARD_DIM, replace=(NIGHT, STEEL_DARK))
        bolt(p, 30, y0 + 20)


def t_lift_cage(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # cable and hook
    vrail(p, 30, 4, (OUTLINE, STEEL_SPEC, STEEL_MID, OUTLINE), 0, 6)
    # roof beam
    bevel(p, 2, 6, 61, 11, STEEL_LIGHT, STEEL_SPEC, STEEL_DARK, outline=OUTLINE)
    # amber-lit windows behind a bar grid
    p.rect(6, 12, 57, 45, OUTLINE)
    p.rect(8, 13, 55, 44, LAMP_AMBER)
    p.rect(8, 13, 55, 16, LAMP_PALE)
    p.rect(8, 30, 55, 44, HAZARD)
    p.rect(8, 38, 55, 44, HAZARD_DIM)
    for x in range(8, 56, 6):
        p.vline(x, 13, 44, RUST_DARK)
    for y in (21, 29, 37):
        p.hline(8, 55, y, RUST_DARK)
    # frame posts and door split
    for x in (2, 57):
        bevel(p, x, 11, x + 4, 55, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE,
              round_corners=False)
    vrail(p, 30, 4, (OUTLINE, STEEL_HI, STEEL_MID, OUTLINE), 12, 46)
    # hazard band and floor
    p.rect(2, 46, 61, 55, OUTLINE)
    hazard_band(p, 3, 47, 60, 54, period=10, width=5)
    bevel(p, 0, 56, 63, 62, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    p.hline(0, 63, 63, OUTLINE)
    for x in (4, 58):
        bolt(p, x, 58)


def t_lift_platform_edge(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # deck top
    hband(p, 0, (STEEL_SPEC, STEEL_HI, STEEL_LIGHT, OUTLINE))
    # hazard stripe band
    p.rect(0, 4, T - 1, 21, OUTLINE)
    hazard_band(p, 0, 5, T - 1, 20, period=16, width=8)
    hband(p, 21, (OUTLINE, STEEL_SPEC))
    # riveted beam
    p.rect(0, 23, T - 1, 30, STEEL_MID)
    hband(p, 23, (STEEL_HI,))
    hband(p, 30, (STEEL_DARK, OUTLINE))
    for x in range(3, T, 8):
        rivet(p, x, 25)
    # underside: lamp housings every 32 px, struts
    p.rect(0, 32, T - 1, 41, STEEL_DARK)
    p.hline(0, T - 1, 41, OUTLINE)
    for x in (8, 40):
        p.rect(x, 33, x + 15, 39, OUTLINE)
        p.rect(x + 1, 34, x + 14, 38, LAMP_ORANGE)
        p.rect(x + 2, 35, x + 13, 37, LAMP_AMBER)
        p.hline(x + 3, x + 12, 36, LAMP_PALE)
        glow_dither(p, x, 42, x + 15, 46, HAZARD_DIM, replace=(NIGHT,))
    for x in (0, 32):
        p.line([(x, 42), (x + 12, T - 1)], STEEL_MID, width=3)
        p.line([(x + 31, 42), (x + 19, T - 1)], STEEL_MID, width=3)
    for x in (0, 32):
        red_marker(p, x + 29, 35)


def t_cable_spool(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 206, 6, STEEL)
    # frame: base and two uprights with the axle
    bevel(p, 0, 56, 63, 63, STEEL_MID, STEEL_HI, OUTLINE, outline=OUTLINE)
    for x in (2, 56):
        bevel(p, x, 4, x + 5, 56, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE,
              round_corners=False)
        bolt(p, x + 2, 29)
    # drum with wound cable rings (vertical ridges), round shading top to bottom
    rows = stretch((OUTLINE, RUST_LIGHT, HAZARD_HI, RUST_LIGHT, RUST, RUST, RUST, RUST, RUST_DARK,
                    RUST_DARK, SEAM, OUTLINE), 40)
    for i, c in enumerate(rows):
        p.hline(13, 50, 10 + i, c)
    for x in range(14, 50, 2):
        for y in range(11, 49):
            c = p.get(x, y)
            p.px(x, y, {RUST_LIGHT: RUST, HAZARD_HI: RUST_LIGHT, RUST: RUST_DARK,
                        RUST_DARK: SEAM}.get(c, c))
    # end flanges, taller than the drum
    for x in (8, 51):
        p.rect(x, 5, x + 4, 54, OUTLINE)
        for i, c in enumerate(stretch((STEEL_SPEC, STEEL_HI, STEEL_LIGHT, STEEL_MID, STEEL,
                                       STEEL_DARK), 48)):
            p.hline(x + 1, x + 3, 6 + i, c)
    # cable leading off the drum
    p.line([(32, 10), (36, 0)], OUTLINE, width=3)
    p.line([(32, 10), (36, 0)], RUST_LIGHT)


def t_girder_rust_v(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # X bracing, period 64 in y
    for a, b in (((12, -2), (51, 65)), ((51, -2), (12, 65))):
        p.line([a, b], OUTLINE, width=6)
        p.line([a, b], RUST, width=4)
    p.line([(12, -1), (51, 64)], RUST_LIGHT)
    p.line([(51, -1), (12, 64)], RUST_DARK)
    # horizontal tie at the tile edge
    hband(p, 0, (RUST_DARK, OUTLINE), 12, 51)
    hband(p, 62, (OUTLINE, RUST_LIGHT), 12, 51)
    # posts
    for x in (4, 52):
        vrail(p, x, 8, (OUTLINE, HAZARD_HI, RUST_LIGHT, RUST, RUST, RUST_DARK, SEAM, OUTLINE))
        for y in range(4, T, 10):
            rivet(p, x + 2, y, base=RUST_LIGHT, hi=HAZARD_HI, sh=RUST_DARK)
    bevel(p, 27, 27, 36, 36, RUST, RUST_LIGHT, RUST_DARK, outline=OUTLINE)
    bolt(p, 31, 31)
    speckle(p, 207, 30, (TEAL_DARK, RUST_DARK), only=(RUST, RUST_LIGHT))


def t_bridge_deck(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # top slab
    p.rect(0, 0, T - 1, 9, CONCRETE)
    hband(p, 0, (CONCRETE_PALE, CONCRETE_HI))
    hband(p, 8, (CONCRETE_DARK, OUTLINE))
    speckle(p, 208, 16, (CONCRETE_DARK, CONCRETE_LIGHT), y0=2, y1=7)
    # deep girder: web with stiffeners every 16 px, flanges
    p.rect(0, 10, T - 1, 41, STEEL)
    hband(p, 10, (STEEL_HI, STEEL_LIGHT, STEEL_MID, OUTLINE))
    hband(p, 38, (OUTLINE, STEEL_HI, STEEL_MID, OUTLINE))
    for x in range(6, T, 16):
        vrail(p, x, 4, (OUTLINE, STEEL_LIGHT, STEEL_MID, OUTLINE), 14, 37)
        bolt(p, x + 1, 16)
        bolt(p, x + 1, 33)
    streaks(p, 209, 8, STEEL_DARK, y0=15, y1=36)
    speckle(p, 210, 20, (RUST_DARK, RUST), y0=14, y1=37)
    # amber strip light under the slab
    p.rect(22, 14, 41, 16, LAMP_AMBER)
    p.hline(23, 40, 15, LAMP_PALE)
    # red marker lamps underneath, hanging rods
    for x in (14, 46):
        p.vline(x + 1, 42, 45, STEEL_MID)
        red_marker(p, x, 46)
        glow_dither(p, x - 4, 50, x + 6, 54, RED_DARK, replace=(NIGHT,))


def t_bridge_pier(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # concrete column
    for x in range(10, 54):
        k = (x - 10) * 8 // 44
        p.vline(x, 0, T - 1, (CONCRETE_HI, CONCRETE_LIGHT, CONCRETE, CONCRETE, CONCRETE,
                              CONCRETE_DARK, CONCRETE_DARK, STEEL_DARK)[k])
    p.vline(9, 0, T - 1, OUTLINE)
    p.vline(54, 0, T - 1, OUTLINE)
    streaks(p, 211, 12, CONCRETE_DARK, x0=11, x1=52, y0=0, y1=63, length=(4, 14))
    speckle(p, 212, 10, (RUST_DARK,), x0=11, x1=52)
    # steel bands every 32 px
    for y in (6, 38):
        p.rect(7, y, 56, y + 6, OUTLINE)
        p.rect(8, y + 1, 55, y + 5, STEEL_MID)
        p.hline(8, 55, y + 1, STEEL_HI)
        p.hline(8, 55, y + 5, STEEL_DARK)
        for x in range(10, 54, 8):
            bolt(p, x, y + 2)
    # red lamp on the side
    p.rect(4, 22, 9, 28, OUTLINE)
    p.rect(5, 23, 8, 27, RED_HI)
    p.px(5, 23, RED_PALE)
    glow_dither(p, 0, 18, 3, 32, RED_DARK, replace=(NIGHT,))


def t_jersey_barrier(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    speckle(p, 213, 10, (CONCRETE_DARK, STEEL_DARK), y1=20)
    # barrier profile: narrow top, sloped lower faces (side view of a run of blocks)
    p.rect(0, 22, T - 1, 57, CONCRETE)
    hband(p, 22, (OUTLINE, CONCRETE_PALE, CONCRETE_HI, BONE_MID))
    hband(p, 46, (CONCRETE_LIGHT, CONCRETE_HI))
    hband(p, 56, (CONCRETE_DARK, OUTLINE))
    # stripes on the upper face
    for y in range(26, 46):
        for x in range(T):
            k = (x + y) % 16
            if k < 8:
                p.px(x, y, HAZARD_HI if k == 0 else (HAZARD_DIM if k == 7 else HAZARD))
            else:
                p.px(x, y, SEAM if k > 8 else OUTLINE)
    # block joints every 32 px and lifting slots
    for x in (31, 63):
        p.vline(x, 23, 57, OUTLINE)
        p.vline(x - 1, 23, 57, CONCRETE_DARK)
    for x in (12, 44):
        p.rect(x, 50, x + 6, 53, OUTLINE)
    speckle(p, 214, 18, (CONCRETE_DARK, CONCRETE_LIGHT), y0=47, y1=55)
    wet_ground(p, 58, 215)


def t_barrier_red_white(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # block body
    p.rect(0, 14, T - 1, 57, CONCRETE_PALE)
    for y in range(17, 55):
        for x in range(T):
            k = (x - y) % 32
            if k < 14:
                p.px(x, y, RED if k > 1 else RED_HI)
            elif k == 14:
                p.px(x, y, RED_DARK)
    hband(p, 14, (OUTLINE, WHITE_HI, CONCRETE_PALE))
    hband(p, 55, (CONCRETE_LIGHT, CONCRETE_DARK, OUTLINE))
    # chips and grime
    rnd = random.Random(216)
    for _ in range(36):
        x, y = rnd.randint(0, T - 1), rnd.randint(17, 54)
        p.px(x, y, rnd.choice((CONCRETE, CONCRETE_LIGHT, RED_DARK, CONCRETE_HI)))
    for x in (0, 32):
        p.vline(x, 15, 57, OUTLINE)
        p.vline(x + 1, 15, 57, CONCRETE_HI)
    wet_ground(p, 58, 217)


def t_tank_trap(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    for y in range(0, 50, 2):
        p.hline(0, T - 1, y, STEEL_DARK if y % 6 == 0 else NIGHT)
    wet_ground(p, 52, 218)
    # three steel beams: two crossing (X) and one lying across the front
    beams = (((10, 52), (54, 8)), ((10, 8), (54, 52)), ((2, 46), (61, 46)))
    for a, b in beams[:2]:
        p.line([a, b], OUTLINE, width=8)
        p.line([a, b], STEEL_MID, width=6)
    p.line([(11, 51), (53, 9)], STEEL_HI)
    p.line([(11, 9), (53, 51)], STEEL_HI)
    p.line([(13, 52), (55, 10)], STEEL_DARK)
    p.line([(13, 8), (55, 50)], STEEL_DARK)
    # front beam (I-section seen side on)
    p.rect(4, 42, 59, 51, OUTLINE)
    p.rect(5, 43, 58, 50, STEEL_LIGHT)
    hband(p, 43, (STEEL_SPEC, STEEL_HI), 5, 58)
    hband(p, 49, (STEEL, STEEL_DARK), 5, 58)
    p.hline(5, 58, 46, STEEL_MID)
    for x in (10, 30, 50):
        bolt(p, x, 44)
    speckle(p, 219, 25, (RUST, RUST_DARK), x0=6, x1=57, y0=10, y1=50,
            only=(STEEL_MID, STEEL_LIGHT))
    # puddle reflections of the beams
    for x in range(8, 56, 3):
        p.px(x, 56, STEEL_MID)
        p.px(x + 1, 59, STEEL_DARK)


def t_banner_red(p):
    p.rect(0, 0, T - 1, T - 1, CONCRETE_DARK)
    for x in range(0, T, 16):
        p.vline(x, 0, T - 1, STEEL_DARK)
    # rod with end caps
    p.rect(8, 3, 55, 6, OUTLINE)
    p.hline(9, 54, 4, STEEL_SPEC)
    p.hline(9, 54, 5, STEEL_MID)
    for x in (7, 54):
        p.rect(x, 2, x + 2, 7, GOLD)
        p.px(x, 2, LAMP_PALE)
    # banner cloth with a swallowtail bottom and a fold
    cloth = [(13, 7), (50, 7), (50, 58), (31, 50), (13, 58)]
    p.poly(cloth, RED, OUTLINE)
    for y in range(8, 58):
        p.px(14, y, RED_HI)
        if y < 55:
            p.px(49, y, RED_DARK)
            p.px(48, y, RED_DARK)
    for y in range(8, 50):
        if (y // 10) % 2 == 0:
            p.px(22, y, RED_DARK)
            p.px(41, y, RED_DARK)
    hband(p, 8, (RED_DARK,), 14, 49)
    # gold emblem: spread wings (chevrons), body and head
    for i in range(7):
        y = 22 + i * 2
        p.hline(18 + i * 2, 26 + i, y, GOLD)
        p.hline(37 - i, 45 - i * 2, y, GOLD)
        p.hline(18 + i * 2, 26 + i, y + 1, HAZARD)
        p.hline(37 - i, 45 - i * 2, y + 1, HAZARD)
    p.rect(29, 21, 34, 38, GOLD)
    p.vline(34, 21, 38, HAZARD)
    p.rect(30, 16, 33, 20, GOLD)
    p.px(33, 17, OUTLINE)
    p.poly([(27, 39), (36, 39), (31, 45)], GOLD, HAZARD)


def t_floodlight(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # light rays
    for y in range(28, T):
        w = (y - 28) // 2
        for x in range(6 - w // 3, 58 + w // 3):
            if (x + y) % 3 == 0 and 0 <= x < T and (x * 3 + y) % 7 < 3:
                p.px(x, y, LAB_SLATE)
    # lattice mast
    vrail(p, 25, 3, (OUTLINE, STEEL_HI, OUTLINE), 26, T - 1)
    vrail(p, 36, 3, (OUTLINE, STEEL_MID, OUTLINE), 26, T - 1)
    for y in range(28, T, 8):
        p.line([(27, y), (36, y + 7)], STEEL_MID)
        p.line([(36, y), (27, y + 7)], STEEL_DARK)
    # lamp head: housing with 3 x 2 lamps
    bevel(p, 8, 3, 55, 26, STEEL_MID, STEEL_HI, STEEL_DARK, outline=OUTLINE)
    for row in range(2):
        for col in range(3):
            x, y = 11 + col * 15, 6 + row * 10
            p.rect(x, y, x + 12, y + 8, OUTLINE)
            p.rect(x + 1, y + 1, x + 11, y + 7, LAMP_YELLOW)
            p.rect(x + 2, y + 2, x + 10, y + 6, LAMP_PALE)
            p.rect(x + 4, y + 3, x + 8, y + 5, LAMP_WHITE)
    glow_dither(p, 2, 0, 63, 30, HAZARD_DIM, replace=(NIGHT,))


def t_shutter_door(p):
    # header box
    p.rect(0, 0, T - 1, 7, STEEL_MID)
    hband(p, 0, (STEEL_HI,))
    hband(p, 6, (STEEL_DARK, OUTLINE))
    for x in range(4, T, 16):
        bolt(p, x, 2)
    # slats lit amber from behind: light leaks through the gaps
    for y in range(8, 58, 5):
        hband(p, y, (LAMP_AMBER, HAZARD_HI, HAZARD, HAZARD_DIM, RUST_DARK))
    for y in range(8, 58, 5):
        for x in range(2, T, 8):
            p.px(x, y, LAMP_PALE)
    speckle(p, 220, 30, (RUST_DARK, RUST), y0=9, y1=56, only=(HAZARD, HAZARD_HI))
    # frame posts every 32 px (guide rails)
    for x in (0, 32):
        p.rect(x - 3, 0, x + 3, 57, OUTLINE)
        p.rect(x - 2, 0, x + 2, 57, STEEL_LIGHT)
        p.vline(x - 2, 0, 57, STEEL_HI)
        p.vline(x + 2, 0, 57, STEEL_DARK)
    # bottom bar and floor lip
    hband(p, 56, (OUTLINE, STEEL_SPEC, STEEL_MID, OUTLINE))
    p.rect(0, 60, T - 1, T - 1, CONCRETE_DARK)
    p.hline(0, T - 1, 60, CONCRETE_LIGHT)


def t_conveyor(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 221, 6, STEEL, y0=46, y1=62)
    # belt top with treads
    hband(p, 12, (OUTLINE, STEEL_MID, STEEL, STEEL, STEEL_DARK, OUTLINE))
    for x in range(0, T, 8):
        p.rect(x, 12, x + 2, 14, STEEL_HI)
        p.px(x, 12, STEEL_SPEC)
    # side frame: rollers visible through the frame, riveted rail
    p.rect(0, 18, T - 1, 37, SEAM)
    for cx in range(8, T, 16):
        disc(p, cx, 26.5, 7.5, OUTLINE)
        disc(p, cx, 26.5, 6.5, STEEL_LIGHT)
        disc(p, cx - 1, 25.5, 4, STEEL_HI)
        disc(p, cx, 26.5, 2, STEEL_DARK)
        p.px(cx - 3, 22, STEEL_SPEC)
    hband(p, 36, (OUTLINE, HAZARD_HI, HAZARD, HAZARD, HAZARD_DIM, OUTLINE))
    for x in range(4, T, 8):
        rivet(p, x, 37, base=HAZARD_HI, hi=LAMP_PALE, sh=HAZARD_DIM)
    # legs every 32 px
    for x in (12, 44):
        vrail(p, x, 6, (OUTLINE, STEEL_HI, STEEL_LIGHT, STEEL_MID, STEEL_DARK, OUTLINE), 42, T - 1)
        p.line([(x + 6, 46), (x + 18, 58)], STEEL_MID, width=2)


def t_drill_face(p):
    p.rect(0, 0, T - 1, T - 1, TOXIC_DARK)
    speckle(p, 222, 120, (OLIVE_DARK, TOXIC, ROCK))
    cx = cy = 31.5
    disc(p, cx, cy, 31, OUTLINE)
    # rings with teeth
    for r0, r1, base in ((25, 30.5, STEEL_MID), (18, 24, STEEL_LIGHT), (11, 17, STEEL_MID)):
        ring(p, cx, cy, r0, r1, base)
        ring(p, cx, cy, r1 - 1, r1, STEEL_HI)
        ring(p, cx, cy, r0, r0 + 0.8, OUTLINE)
        n = int(r1 * 0.9)
        for k in range(n):
            a = 2 * math.pi * k / n
            for t in range(3):
                rr = r1 - 1 - t
                x = int(round(cx + rr * math.cos(a)))
                y = int(round(cy + rr * math.sin(a)))
                p.px(x, y, STEEL_SPEC if t == 0 else (STEEL_HI if t == 1 else STEEL_DARK))
    # green glow in the gaps
    for y in range(T):
        for x in range(T):
            d = math.hypot(x - cx, y - cy)
            if p.get(x, y) == OUTLINE and d < 31 and (x + y) % 2 == 0:
                p.px(x, y, TOXIC)
    # hub
    disc(p, cx, cy, 9, OUTLINE)
    disc(p, cx, cy, 8, STEEL_LIGHT)
    disc(p, cx - 1, cy - 1, 5, STEEL_HI)
    disc(p, cx, cy, 2.5, TOXIC_HI)
    for a in range(0, 360, 60):
        r = math.radians(a)
        bolt(p, int(cx + 6 * math.cos(r)) - 1, int(cy + 6 * math.sin(r)) - 1)


def t_tread(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # inner body
    p.rect(0, 14, T - 1, 49, SEAM)
    # road wheels every 32 px and a return roller between them
    for cx in (16, 48):
        disc(p, cx, 31.5, 13, OUTLINE)
        disc(p, cx, 31.5, 12, STEEL_MID)
        ring(p, cx, 31.5, 10.5, 12, STEEL_HI)
        disc(p, cx, 31.5, 7, STEEL_DARK)
        disc(p, cx, 31.5, 3, STEEL_LIGHT)
        for a in range(0, 360, 72):
            r = math.radians(a)
            p.px(int(cx + 5 * math.cos(r)), int(31.5 + 5 * math.sin(r)), STEEL_SPEC)
    for cx in (0, 32):
        disc(p, cx, 18, 3.5, OUTLINE)
        disc(p, cx, 18, 2.5, STEEL_LIGHT)
    # track links on top and bottom: 8 px plates with grousers
    for y0, gy in ((4, 4), (48, 58)):
        p.rect(0, y0, T - 1, y0 + 11, OUTLINE)
        for x in range(0, T, 8):
            bevel(p, x + 1, y0 + 2, x + 7, y0 + 9, STEEL_LIGHT, STEEL_HI, STEEL_DARK)
            p.px(x + 4, y0 + 5, OUTLINE)
            p.rect(x + 2, gy, x + 5, gy + 1, STEEL_MID)
    speckle(p, 223, 30, (RUST_DARK, ROCK_LIGHT), only=(STEEL_LIGHT, STEEL_MID))


def t_server_rack(p):
    p.rect(0, 0, T - 1, T - 1, SEAM)
    # rack posts
    for x in (1, 57):
        vrail(p, x, 6, (OUTLINE, STEEL_HI, STEEL_LIGHT, STEEL_MID, STEEL_DARK, OUTLINE))
        for y in range(3, T, 8):
            p.px(x + 2, y, OUTLINE)
    # two shelves per tile, each with four lit cells
    for y0 in (0, 32):
        hband(p, y0 + 26, (OUTLINE, STEEL_SPEC, STEEL_MID, STEEL_DARK, OUTLINE), 7, 56)
        for i in range(4):
            x = 9 + i * 12
            p.rect(x, y0 + 5, x + 9, y0 + 25, OUTLINE)
            p.rect(x + 1, y0 + 6, x + 8, y0 + 24, LAMP_ORANGE)
            p.rect(x + 2, y0 + 7, x + 7, y0 + 23, LAMP_AMBER)
            p.rect(x + 3, y0 + 9, x + 5, y0 + 20, LAMP_PALE)
            hband(p, y0 + 6, (STEEL_HI, STEEL_MID), x + 1, x + 8)
            hband(p, y0 + 23, (STEEL_MID, STEEL_DARK), x + 1, x + 8)
        # cables running between cells
        p.line([(12, y0 + 2), (24, y0 + 4), (36, y0 + 2), (50, y0 + 4)], TOXIC_DARK, width=2)
        p.line([(10, y0 + 31), (30, y0 + 30), (52, y0 + 31)], TOXIC, width=1)
    # cyan status light on the right post
    p.rect(58, 14, 61, 17, OUTLINE)
    p.rect(59, 15, 60, 16, CYAN)
    glow_dither(p, 56, 12, 63, 19, LAB_TEAL_DARK, replace=(SEAM,))


W1, I1, I2, I3 = "03-walkway-01.png", "05-industrial-01.png", "05-industrial-02.png", "05-industrial-03.png"
SH1, ST1, ST2, CH2 = "06-shaft-01.png", "07-streets-01.png", "07-streets-02.png", "08-chase-02.png"
PG3, LS3, DR1, DR2 = "pipe-growth-03.png", "lift-shaft-03.png", "driller-01.png", "driller-02.png"
MB2, MB3 = "machine-boss-02.png", "machine-boss-03.png"

# name, function, kind, tiles, note, refs
TILES = (
    ("furnace-drum", t_furnace_drum, "machine", "x",
     "horizontal teal drum with rust patches, rust bands every 32 px, glowing amber grille window, hazard base",
     (f"{I1} 615,362 265x169",)),
    ("pipe-outlet", t_pipe_outlet, "pipe", "none",
     "large teal pipe mouth with a bolted rust flange out of a riveted wall, dirty water pouring down",
     (f"{I2} 784,434 181x181",)),
    ("valve-wheel", t_valve_wheel, "pipe", "none",
     "rust handwheel with six spokes on a stem over a rust pipe, steam behind",
     (f"{I1} 36,531 145x121",)),
    ("pipe-large-riveted", t_pipe_large_riveted, "pipe", "x",
     "56 px riveted rusty steel pipe (rows 4-59) with bolted flange bands every 32 px",
     (f"{PG3} 1665,0 507x193",)),
    ("lamp-strip-v", t_lamp_strip_v, "light", "y",
     "vertical shaft rail with two amber lamp segments per tile and dark gaps, side rails",
     (f"{SH1} 712,24 72x652",)),
    ("lift-cage", t_lift_cage, "lift", "none",
     "lift car: cable, roof beam, steel posts, amber-lit windows behind bars, hazard band, floor",
     (f"{I3} 1894,193 241x483", f"{LS3} 1738,97 217x410")),
    ("lift-platform-edge", t_lift_platform_edge, "floor", "x",
     "heavy platform edge: deck top, wide hazard stripe band, riveted beam, amber underside lamps, struts",
     (f"{SH1} 784,326 627x169",)),
    ("cable-spool", t_cable_spool, "machine", "none",
     "big cable drum with wound cable ridges and end flanges in a steel frame",
     (f"{SH1} 1014,483 265x133",)),
    ("girder-rust-v", t_girder_rust_v, "girder", "y",
     "rusty vertical lattice tower: two riveted posts with X bracing and a centre plate",
     (f"{LS3} 471,24 169x676",)),
    ("bridge-deck", t_bridge_deck, "girder", "x",
     "bridge deck: concrete top slab, deep riveted girder with stiffeners, red marker lamps underneath",
     (f"{W1} 1183,386 386x193",)),
    ("bridge-pier", t_bridge_pier, "girder", "y",
     "concrete pier column with bolted steel bands every 32 px and a red lamp on its side",
     (f"{W1} 1074,434 109x241",)),
    ("jersey-barrier", t_jersey_barrier, "barrier", "x",
     "run of concrete road barriers with amber / dark stripes, wet top, joints every 32 px, wet street",
     (f"{ST1} 1038,579 241x84",)),
    ("barrier-red-white", t_barrier_red_white, "barrier", "x",
     "concrete barrier blocks with red and white diagonal stripes, chips, wet street",
     (f"{CH2} 1581,386 217x133",)),
    ("tank-trap", t_tank_trap, "barrier", "none",
     "steel hedgehog: crossed I-beams on a wet street",
     (f"{ST1} 869,579 121x84",)),
    ("banner-red", t_banner_red, "sign", "none",
     "hanging red banner with a swallowtail bottom and a gold spread-wing emblem, rod at the top",
     (f"{ST1} 760,422 109x145",)),
    ("floodlight", t_floodlight, "light", "none",
     "lattice mast top with a 3 x 2 lamp head, yellow light and rays",
     (f"{ST2} 459,145 121x241",)),
    ("shutter-door", t_shutter_door, "door", "x",
     "rolling shutter: horizontal slats lit amber from behind, guide posts every 32 px, header box",
     (f"{W1} 1846,217 193x241",)),
    ("conveyor", t_conveyor, "floor", "x",
     "conveyor: belt with treads, rollers every 16 px, amber riveted side rail, legs",
     (f"{MB2} 217,217 627x109",)),
    ("drill-face", t_drill_face, "machine", "none",
     "tunnel boring cutter face: three toothed rings, hub with bolts, green glow in the gaps",
     (f"{DR1} 1424,145 241x386",)),
    ("tread", t_tread, "machine", "x",
     "crawler track: link plates top and bottom, road wheels every 32 px and return rollers",
     (f"{DR2} 422,555 567x109",)),
    ("server-rack", t_server_rack, "machine", "y",
     "rack of amber-lit cells / batteries on two shelves per tile, cables, cyan status light",
     (f"{MB3} 1216,183 213x256",)),
)
