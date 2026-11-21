"""blocks-subway: subway, mutant railway, monorail and doomsday door tiles (7 x 3).
See ../blocks_themed.py."""

import math
import random

from blocks_themes.common import *  # noqa: F401,F403  (palette constants and helpers)
from blocks_themes.common import (T, bevel, inset, panel, rivet, bolt, streaks, stripes,
                                  glow_dither, fill, hband, vband, speckle, disc, ring,
                                  hazard_band, vrail)

NAME = "subway"
COLUMNS = 7
ROWS = 3
NOTE = ("Placeholder programmer art for the subway / railway / monorail / doomsday door levels, "
        "drawn by tools/blocks_themed.py; shapes follow scene mockups that are not in the "
        "repository.")
SUBJECT = ("Placeholder environment block textures for the subway, mutant railway, monorail "
           "and doomsday door levels: rail track, platform edge and arches, station tiles, "
           "tunnel mouth, train window, door and bogie, pillars, bench, rubble, water, pipe "
           "bundle, monorail beam, wooden crate, quay drain, vault door hub and plate, mine "
           "cart, cracked ledge.")
VISUAL_APPROACH = ("Programmer pixel art: hard edges, no antialiasing, grimy concrete, rusty "
                   "steel and dark water with 1 px highlight / shade bevels and dark seams; "
                   "red stripes, amber hazard bands and green glows; colours from the "
                   "project's shared palette.")
SEED_NOTE = ("The script uses random.Random with fixed seeds (per-call seeds in the helpers, "
             "301-336 in this theme's tiles) for small details such as rust, grime, ballast "
             "stones, rubble chunks and water glints.")

CONCRETE_COLS = (CONCRETE_HI, CONCRETE_LIGHT, CONCRETE, CONCRETE, CONCRETE, CONCRETE_DARK,
                 CONCRETE_DARK, STEEL_DARK)
RUST_PIPE = (OUTLINE, RUST_LIGHT, HAZARD_HI, RUST_LIGHT, RUST, RUST, RUST, RUST, RUST_DARK,
             RUST_DARK, SEAM, OUTLINE)
STEEL_PIPE = (OUTLINE, STEEL_HI, STEEL_SPEC, STEEL_HI, STEEL_LIGHT, STEEL_LIGHT, STEEL_MID,
              STEEL_MID, STEEL, STEEL_DARK, SEAM, OUTLINE)
TEAL_PIPE = (OUTLINE, TEAL_LIGHT, CYAN_PALE, TEAL_LIGHT, TEAL, TEAL, TEAL_DARK, SEAM, OUTLINE)


def stretch(colours, n):
    return [colours[i * len(colours) // n] for i in range(n)]


def grime(p, seed, x0=0, x1=T - 1, y0=0, y1=T - 1):
    speckle(p, seed, 40, (RUST_DARK, CONCRETE_DARK, RUST), x0, x1, y0, y1)
    streaks(p, seed + 1, 8, RUST_DARK, x0, x1, y0, y1, length=(3, 10))


def rounded_window(p, x0, y0, x1, y1, glass, frame=OUTLINE, r=3):
    """Window with corners cut on a 45-degree step (rounded look)."""
    p.rect(x0, y0, x1, y1, frame)
    p.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, glass)
    cut_corners(p, x0, y0, x1, y1, frame, r)


def cut_corners(p, x0, y0, x1, y1, frame=OUTLINE, r=3):
    for x, y, sx, sy in ((x0 + 1, y0 + 1, 1, 1), (x1 - 1, y0 + 1, -1, 1),
                         (x0 + 1, y1 - 1, 1, -1), (x1 - 1, y1 - 1, -1, -1)):
        for d in range(r):
            for e in range(r - d):
                p.px(x + sx * d, y + sy * e, frame)


# ----------------------------------------------------------------------------- tiles

def t_rail_track(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    for y in range(0, 34, 3):
        p.hline(0, T - 1, y, STEEL_DARK if y % 9 == 0 else NIGHT)
    # ballast bed
    p.rect(0, 46, T - 1, T - 1, ROCK_DARK)
    rnd = random.Random(301)
    for _ in range(90):
        x, y = rnd.randint(0, T - 1), rnd.randint(47, T - 1)
        c = rnd.choice((ROCK, ROCK_MID, ROCK_LIGHT, CONCRETE_DARK))
        p.px(x, y, c)
        p.px(x + 1, y, c)
    # sleepers every 16 px
    for x in range(2, T, 16):
        p.rect(x, 42, x + 11, 50, OUTLINE)
        p.rect(x + 1, 43, x + 10, 49, WOOD_DARK)
        p.hline(x + 1, x + 10, 43, WOOD)
        p.vline(x + 10, 44, 49, ROCK_DARK)
    # rail: head, web, foot
    hband(p, 33, (OUTLINE, WHITE_HI, STEEL_SPEC, STEEL_HI, STEEL_MID, OUTLINE))
    hband(p, 39, (STEEL_DARK, STEEL_DARK, OUTLINE))
    hband(p, 42, (STEEL_MID, OUTLINE))
    for x in range(10, T, 16):
        bolt(p, x, 40)
    # puddle glints
    for x, y, n in ((6, 55, 5), (30, 58, 7), (50, 53, 4), (20, 61, 3)):
        p.hline(x, x + n, y, LAB_TEAL_DARK)
        p.px(x + 1, y, LAB_CYAN)


def t_platform_edge(p):
    # platform top surface
    p.rect(0, 0, T - 1, 14, CONCRETE)
    hband(p, 0, (CONCRETE_HI, CONCRETE_LIGHT))
    speckle(p, 302, 20, (CONCRETE_DARK, CONCRETE_LIGHT), y0=2, y1=13)
    # yellow safety line and tactile strip
    hband(p, 3, (HAZARD, LAMP_YELLOW, LAMP_YELLOW, HAZARD))
    for x in range(1, T, 4):
        for y in (9, 12):
            p.px(x, y, BONE_MID)
            p.px(x + 1, y, CONCRETE_DARK)
    for x in range(3, T, 4):
        p.px(x, 10, BONE_MID)
        p.px(x + 1, 11, CONCRETE_DARK)
    # edge lip
    hband(p, 15, (OUTLINE, CONCRETE_PALE, CONCRETE_LIGHT, CONCRETE_DARK, OUTLINE))
    # front face
    p.rect(0, 20, T - 1, T - 1, CONCRETE_DARK)
    for y in range(28, T, 12):
        p.hline(0, T - 1, y, STEEL_DARK)
    for x in (0, 32):
        p.vline(x, 20, T - 1, SEAM)
    grime(p, 303, y0=21)
    streaks(p, 305, 6, TOXIC_DARK, y0=20, y1=40)


def t_platform_arch(p):
    # wall face
    p.rect(0, 0, T - 1, T - 1, CONCRETE_DARK)
    # top beam with drips
    p.rect(0, 0, T - 1, 9, CONCRETE)
    hband(p, 0, (CONCRETE_HI, CONCRETE_LIGHT))
    hband(p, 9, (STEEL_DARK, OUTLINE))
    for x, n in ((14, 8), (19, 5), (40, 10), (44, 4)):
        p.vline(x, 10, 10 + n, TOXIC)
        p.px(x, 10 + n, TOXIC_HI)
    # arched recess, period 64
    cx, cy = 31.5, 30
    for y in range(12, T):
        for x in range(T):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy) if dy < 0 else abs(dx)
            if r <= 24:
                p.px(x, y, OUTLINE if r < 22 else SEAM)
            elif r <= 25:
                p.px(x, y, CONCRETE_LIGHT)
    for y in range(14, T):
        for x in range(T):
            if p.get(x, y) == OUTLINE and (x + y) % 2 == 0 and y < 26:
                p.px(x, y, STEEL_DARK)
    # pipe across the recess with a flange, and a vertical drop pipe
    for i, c in enumerate(stretch(RUST_PIPE, 8)):
        p.hline(8, 55, 38 + i, c)
    vband(p, 40, stretch(RUST_PIPE, 7), 22, 37)
    p.rect(38, 36, 48, 47, OUTLINE)
    p.rect(39, 37, 47, 46, RUST)
    p.vline(39, 37, 46, RUST_LIGHT)
    # rubble on the recess floor
    rnd = random.Random(306)
    for _ in range(12):
        x, y = rnd.randint(9, 52), rnd.randint(55, 60)
        p.rect(x, y, x + 2, y + 1, rnd.choice((CONCRETE, CONCRETE_LIGHT, ROCK_MID)))
    p.hline(8, 55, T - 1, ROCK_DARK)
    grime(p, 307, y0=10, y1=20)


def t_station_tile_wall(p):
    fill(p, CONCRETE_DARK)
    rnd = random.Random(308)
    for row, y in enumerate(range(0, T, 8)):
        off = 0 if row % 2 == 0 else 4
        for x in range(-off, T, 8):
            base = rnd.choice((CONCRETE_PALE, CONCRETE_PALE, BONE_MID, CONCRETE_HI))
            p.rect(x + 1, y + 1, x + 7, y + 7, base)
            p.hline(x + 1, x + 7, y + 1, WHITE_HI if base != CONCRETE_HI else CONCRETE_PALE)
            p.hline(x + 2, x + 7, y + 7, CONCRETE_LIGHT)
            p.vline(x + 7, y + 2, y + 7, CONCRETE_LIGHT)
            if rnd.random() < 0.15:
                p.rect(x + 2, y + 3, x + 4, y + 5, CONCRETE_DARK)   # chipped tile
    # rust streaks and grime running down from the joints
    for x0, y0, n in ((5, 2, 22), (21, 36, 18), (38, 10, 30), (54, 44, 26)):
        for y in range(y0, y0 + n):
            p.px(x0, y, RUST)
            if y % 3:
                p.px(x0 + 1, y, RUST_DARK)
    speckle(p, 309, 40, (CONCRETE_LIGHT, RUST_DARK, BONE_DARK))


def t_tunnel_arch(p):
    p.rect(0, 0, T - 1, T - 1, CONCRETE_DARK)
    grime(p, 310)
    cx, cy = 31.5, 36
    # dark inside with a far green glow and converging rails
    for y in range(T):
        for x in range(T):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy) if dy < 0 else abs(dx)
            if r <= 22:
                d = math.hypot(dx, (y - 44) * 1.4)
                if d < 4:
                    c = TOXIC_HI
                elif d < 8:
                    c = TOXIC
                elif d < 13 and (x + y) % 2 == 0:
                    c = TOXIC_DARK
                else:
                    c = OUTLINE if d > 17 else WATER_DARK
                p.px(x, y, c)
            elif r <= 30:
                # ribbed ring: segments every 15 degrees
                ang = math.degrees(math.atan2(dy, dx)) if dy < 0 else (180 if dx < 0 else 0)
                rib = int(ang) % 15 < 2
                c = (CONCRETE_HI, CONCRETE_LIGHT, CONCRETE, CONCRETE, CONCRETE, CONCRETE_DARK,
                     STEEL_DARK, OUTLINE)[min(7, int(r - 22))]
                p.px(x, y, SEAM if rib else c)
    for a, b in (((20, T - 1), (30, 47)), ((43, T - 1), (33, 47))):
        p.line([a, b], STEEL_MID)
    for y in range(50, T, 4):
        k = (y - 47) * 10 // 17
        p.hline(30 - k, 33 + k, y, WOOD_DARK)


def t_train_window(p):
    # carriage body
    p.rect(0, 0, T - 1, T - 1, STEEL_MID)
    hband(p, 0, (OUTLINE, STEEL_HI, STEEL_LIGHT))
    for x in range(2, T, 6):
        p.px(x, 4, STEEL_SPEC)
        p.px(x, 50, STEEL_SPEC)
    # window with rounded corners
    rounded_window(p, 6, 8, 57, 35, NIGHT)
    p.rect(8, 10, 55, 33, TEAL_DARK)
    p.rect(8, 10, 55, 13, LAB_DEEP)
    for x in (12, 28, 44):
        p.rect(x, 22, x + 5, 33, LAB_DEEP)
    p.line([(40, 11), (52, 23)], LAB_SLATE)
    p.line([(44, 11), (54, 21)], LAB_SLATE)
    cut_corners(p, 6, 8, 57, 35)
    # red stripe below
    hband(p, 40, (OUTLINE, RED_HI, RED, RED, RED_DARK, OUTLINE))
    # skirt
    p.rect(0, 54, T - 1, T - 1, STEEL_DARK)
    hband(p, 54, (OUTLINE, STEEL_MID))
    grime(p, 311)
    for x in (0, 63):
        p.vline(x, 0, T - 1, STEEL_DARK)


def t_train_door(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_MID)
    hband(p, 0, (OUTLINE, STEEL_HI))
    # door opening frame
    p.rect(6, 3, 57, T - 1, OUTLINE)
    for x0 in (7, 33):
        bevel(p, x0, 4, x0 + 23, T - 1, STEEL_LIGHT, STEEL_HI, STEEL_DARK)
        rounded_window(p, x0 + 4, 10, x0 + 19, 32, NIGHT)
        p.rect(x0 + 5, 11, x0 + 18, 31, TEAL_DARK)
        p.line([(x0 + 12, 12), (x0 + 17, 17)], LAB_SLATE)
        cut_corners(p, x0 + 4, 10, x0 + 19, 32)
        hband(p, 44, (RED_HI, RED, RED_DARK), x0 + 1, x0 + 22)
        p.rect(x0 + 9, 50, x0 + 14, 52, STEEL_DARK)
    # rubber seal line between the leaves
    p.vline(31, 4, T - 1, OUTLINE)
    p.vline(32, 4, T - 1, SEAM)
    # body stripe either side
    hband(p, 44, (RED_HI, RED, RED_DARK), 0, 5)
    hband(p, 44, (RED_HI, RED, RED_DARK), 58, 63)
    grime(p, 312)


def t_train_bogie(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # car body underside and skirt
    p.rect(0, 0, T - 1, 9, STEEL_MID)
    hband(p, 7, (STEEL_DARK, OUTLINE, SEAM, SEAM))
    for x in range(4, T, 16):
        p.rect(x, 11, x + 7, 15, STEEL_DARK)
    # bogie frame
    p.rect(0, 20, T - 1, 29, OUTLINE)
    p.rect(0, 21, T - 1, 28, STEEL)
    hband(p, 21, (STEEL_HI, STEEL_LIGHT), 0, T - 1)
    for x in range(6, T, 16):
        bolt(p, x, 24)
    # wheels every 32 px
    for cx in (16, 48):
        disc(p, cx, 40.5, 12, OUTLINE)
        disc(p, cx, 40.5, 11, STEEL_MID)
        ring(p, cx, 40.5, 9.5, 11, STEEL_HI)
        disc(p, cx, 40.5, 6, STEEL_DARK)
        disc(p, cx, 40.5, 3, STEEL_LIGHT)
        p.px(cx - 1, 39, STEEL_SPEC)
        # axle box
        p.rect(cx - 4, 26, cx + 4, 34, OUTLINE)
        p.rect(cx - 3, 27, cx + 3, 33, RUST)
        p.hline(cx - 3, cx + 3, 27, RUST_LIGHT)
    speckle(p, 313, 30, (RUST_DARK, RUST), only=(STEEL, STEEL_MID))
    # rail below
    hband(p, 53, (OUTLINE, STEEL_SPEC, STEEL_HI, STEEL_MID, OUTLINE))
    p.rect(0, 58, T - 1, T - 1, ROCK_DARK)
    speckle(p, 314, 20, (ROCK, ROCK_MID), y0=58)


def t_concrete_pillar(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    for x in range(14, 50):
        p.vline(x, 0, T - 1, CONCRETE_COLS[(x - 14) * 8 // 36])
    p.vline(13, 0, T - 1, OUTLINE)
    p.vline(50, 0, T - 1, OUTLINE)
    # rust stains
    rnd = random.Random(315)
    for _ in range(7):
        x, y = rnd.randint(16, 46), rnd.randint(0, 63)
        n = rnd.randint(6, 18)
        p.vline(x, y, y + n, RUST_DARK)
        p.vline(x + 1, y + 2, y + n - 3, RUST)
    speckle(p, 316, 30, (CONCRETE_DARK, CONCRETE_HI), x0=15, x1=48)
    # red band and a joint line
    for y in range(40, 47):
        for x in range(14, 50):
            p.px(x, y, RED if x < 40 else RED_DARK)
    hband(p, 40, (RED_HI,), 14, 39)
    hband(p, 47, (OUTLINE,), 14, 49)
    hband(p, 8, (SEAM,), 14, 49)


def t_pillar_hazard(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # steel cladding, panel joints every 32 px
    for x in range(14, 50):
        p.vline(x, 0, T - 1, (STEEL_HI, STEEL_LIGHT, STEEL_LIGHT, STEEL_MID, STEEL_MID,
                              STEEL_MID, STEEL, STEEL_DARK)[(x - 14) * 8 // 36])
    p.vline(13, 0, T - 1, OUTLINE)
    p.vline(50, 0, T - 1, OUTLINE)
    for y in (0, 32):
        p.hline(14, 49, y, SEAM)
        for x in (17, 45):
            rivet(p, x, y + 3)
    p.vline(31, 0, T - 1, STEEL_DARK)
    # hazard band
    p.rect(14, 44, 49, 57, OUTLINE)
    hazard_band(p, 15, 45, 48, 56, period=12, width=6)
    speckle(p, 317, 30, (RUST_DARK, RUST), x0=15, x1=48)
    streaks(p, 318, 6, RUST_DARK, x0=15, x1=48)


def t_bench(p):
    panel(p, base=CONCRETE_DARK, hi=CONCRETE, sh=STEEL_DARK)
    grime(p, 319)
    # back rest and seat: perforated metal (holes every 3 px)
    for y0, y1 in ((14, 31), (36, 43)):
        p.rect(4, y0, 59, y1, OUTLINE)
        p.rect(5, y0 + 1, 58, y1 - 1, STEEL_LIGHT)
        p.hline(5, 58, y0 + 1, STEEL_SPEC)
        p.hline(5, 58, y1 - 1, STEEL_MID)
        for y in range(y0 + 3, y1 - 1, 3):
            for x in range(7, 57, 3):
                p.px(x, y, STEEL_DARK)
    # seat dividers
    for x in (18, 31, 45):
        p.vline(x, 14, 43, OUTLINE)
    # frame and legs
    p.rect(3, 32, 60, 35, STEEL_DARK)
    for x in (8, 52):
        vrail(p, x, 4, (OUTLINE, STEEL_HI, STEEL_MID, OUTLINE), 44, 60)
        p.rect(x - 2, 60, x + 5, 61, OUTLINE)
    p.rect(0, 62, T - 1, T - 1, CONCRETE)


def t_rubble(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    p.rect(0, 56, T - 1, T - 1, CONCRETE_DARK)
    hband(p, 56, (CONCRETE_LIGHT,))
    rnd = random.Random(320)
    # chunks: quads, bigger at the bottom of the pile
    for k in range(34):
        cx = rnd.randint(0, T - 1)
        cy = rnd.randint(30, 58)
        s = rnd.randint(3, 8)
        pts = [(cx - s + rnd.randint(0, 2), cy), (cx + rnd.randint(-2, 2), cy - s),
               (cx + s - rnd.randint(0, 2), cy - rnd.randint(0, 3)), (cx + rnd.randint(-1, 1), cy + 3)]
        base = rnd.choice((CONCRETE, CONCRETE_LIGHT, CONCRETE, ROCK_MID, CONCRETE_DARK))
        p.poly(pts, base, OUTLINE)
        p.px(pts[1][0], pts[1][1] + 1, CONCRETE_HI)
    # rebar
    for a, b in (((6, 34), (22, 26)), ((38, 40), (58, 30)), ((26, 44), (34, 22))):
        p.line([a, b], RUST)
        p.line([(a[0], a[1] + 1), (b[0], b[1] + 1)], RUST_DARK)


def t_water_surface(p):
    p.rect(0, 0, T - 1, 19, NIGHT)
    for y in range(0, 18, 3):
        p.hline(0, T - 1, y, STEEL_DARK if y % 6 == 0 else NIGHT)
    p.rect(0, 20, T - 1, T - 1, WATER)
    p.rect(0, 40, T - 1, T - 1, WATER_DARK)
    hband(p, 20, (TOXIC_LIGHT, TOXIC, LAB_TEAL_DARK))
    # reflection streaks
    rnd = random.Random(321)
    for _ in range(26):
        x, y = rnd.randint(0, T - 1), rnd.randint(24, 62)
        n = rnd.randint(3, 12)
        c = rnd.choice((LAB_TEAL_DARK, TOXIC_DARK, TEAL, LAB_SLATE))
        p.hline(x, x + n, y, c)
    for x in range(4, T, 16):
        p.hline(x, x + 5, 25, LAMP_AMBER)
        p.hline(x + 1, x + 3, 29, HAZARD_DIM)


def t_pipe_bundle(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    streaks(p, 322, 8, STEEL)
    for y0, n, cols, flanges in ((4, 10, RUST_PIPE, (10, 42)), (17, 16, STEEL_PIPE, (26,)),
                                 (36, 7, TEAL_PIPE, (4, 36)), (46, 12, RUST_PIPE, (50,))):
        rows = stretch(cols, n)
        for i, c in enumerate(rows):
            p.hline(0, T - 1, y0 + i, c)
        for fx in flanges:
            p.rect(fx, y0 - 2, fx + 4, y0 + n + 1, OUTLINE)
            for i, c in enumerate(stretch(STEEL_PIPE, n + 2)):
                p.hline(fx + 1, fx + 3, y0 - 1 + i, c)
            p.vline(fx + 1, y0 - 1, y0 + n, STEEL_SPEC)
    speckle(p, 323, 30, (RUST_DARK, TEAL_DARK), only=(RUST, STEEL_MID, STEEL_LIGHT))
    # brackets
    for x in (22, 54):
        p.vline(x, 0, T - 1, OUTLINE)
        p.vline(x + 1, 0, T - 1, STEEL)


def t_monorail_beam(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # rail on top
    hband(p, 4, (OUTLINE, STEEL_SPEC, STEEL_HI, STEEL_MID, STEEL_DARK, OUTLINE), 0, T - 1)
    for x in range(0, T, 16):
        p.rect(x + 2, 10, x + 6, 12, STEEL_DARK)
    # concrete beam
    p.rect(0, 12, T - 1, 47, CONCRETE)
    hband(p, 12, (CONCRETE_PALE, CONCRETE_HI, CONCRETE_LIGHT))
    hband(p, 44, (CONCRETE_DARK, STEEL_DARK, OUTLINE, OUTLINE))
    for x in (0, 32):
        p.vline(x, 13, 46, SEAM)
    grime(p, 324, y0=15, y1=44)
    streaks(p, 326, 8, TOXIC_DARK, y0=30, y1=46)
    # dark underside with a hanger bracket every 32 px
    p.rect(0, 48, T - 1, T - 1, LAB_DEEP)
    for x in (12, 44):
        p.rect(x, 48, x + 7, 55, STEEL_DARK)
        p.hline(x, x + 7, 48, STEEL_MID)
    for x, n in ((5, 6), (27, 9), (52, 5)):
        p.vline(x, 48, 48 + n, TOXIC_DARK)


def t_wood_crate(p):
    p.rect(0, 0, T - 1, T - 1, OUTLINE)
    # planks
    for i, y in enumerate(range(2, 62, 10)):
        p.rect(2, y, 61, y + 8, WOOD if i % 2 == 0 else WOOD_DARK)
        p.hline(2, 61, y, WOOD_LIGHT)
        p.hline(2, 61, y + 8, ROCK_DARK)
        for x in (12 + i * 7 % 30, 40 + i * 5 % 14):
            p.hline(x, x + 4, y + 4, ROCK_MID)
    # frame
    for x0, y0, x1, y1 in ((1, 1, 62, 6), (1, 57, 62, 62), (1, 1, 6, 62), (57, 1, 62, 62)):
        p.rect(x0, y0, x1, y1, WOOD)
        p.hline(x0, x1, y0, WOOD_LIGHT)
        p.vline(x0, y0, y1, WOOD_LIGHT)
    p.frame(1, 1, 62, 62, OUTLINE)
    p.frame(6, 6, 57, 57, ROCK_DARK)
    # diagonal brace
    p.line([(7, 56), (56, 7)], OUTLINE, width=6)
    p.line([(7, 56), (56, 7)], WOOD, width=4)
    p.line([(7, 54), (54, 7)], WOOD_LIGHT)
    # metal corner braces
    for cx, cy, sx, sy in ((1, 1, 1, 1), (62, 1, -1, 1), (1, 62, 1, -1), (62, 62, -1, -1)):
        for d in range(9):
            for e in range(9 - d):
                p.px(cx + sx * d, cy + sy * e, STEEL_MID if d and e else STEEL_HI)
        bolt(p, cx + sx * 3 - (1 if sx < 0 else 0), cy + sy * 3 - (1 if sy < 0 else 0))


def t_quay_drain(p):
    p.rect(0, 0, T - 1, T - 1, CONCRETE_DARK)
    for y in range(0, T, 16):
        p.hline(0, T - 1, y, STEEL_DARK)
    grime(p, 327)
    # dark opening with a concrete lip
    p.rect(8, 10, 55, 48, CONCRETE_LIGHT)
    p.rect(9, 11, 54, 47, CONCRETE)
    p.rect(11, 13, 52, 47, OUTLINE)
    p.rect(12, 14, 51, 20, SEAM)
    # bars
    for x in range(14, 52, 6):
        vrail(p, x, 3, (RUST_LIGHT, RUST, RUST_DARK), 13, 47)
    hband(p, 16, (OUTLINE, RUST, RUST_DARK), 12, 51)
    # trickle out of the bottom and the water line
    for y in range(47, 56):
        p.px(30 + (y % 2), y, LAB_TEAL)
        p.px(32, y, CYAN_PALE)
    p.rect(0, 56, T - 1, T - 1, WATER_DARK)
    hband(p, 56, (LAB_TEAL_DARK, WATER))
    for x in (24, 28, 34, 38):
        p.px(x, 57, CYAN_PALE)


def t_vault_door_hub(p):
    # plate background, slightly curved seams
    p.rect(0, 0, T - 1, T - 1, STEEL)
    speckle(p, 328, 80, (RUST_DARK, STEEL_DARK, RUST))
    cx = cy = 31.5
    # spokes out to the edges
    for a in range(0, 360, 45):
        r = math.radians(a)
        end = (cx + 46 * math.cos(r), cy + 46 * math.sin(r))
        p.line([(cx, cy), end], OUTLINE, width=8)
        p.line([(cx, cy), end], RUST, width=6)
        p.line([(cx - 1, cy - 1), (end[0] - 1, end[1] - 1)], RUST_LIGHT)
    # hub rings
    disc(p, cx, cy, 22, OUTLINE)
    disc(p, cx, cy, 21, STEEL_MID)
    ring(p, cx, cy, 19, 21, STEEL_HI)
    disc(p, cx, cy, 16, OUTLINE)
    disc(p, cx, cy, 15, RUST)
    ring(p, cx, cy, 13.5, 15, RUST_LIGHT)
    disc(p, cx, cy, 11, STEEL_DARK)
    for a in range(0, 360, 30):
        r = math.radians(a)
        bolt(p, int(cx + 18 * math.cos(r)) - 1, int(cy + 18 * math.sin(r)) - 1)
    # green light slit
    p.rect(28, 20, 35, 43, OUTLINE)
    p.rect(29, 21, 34, 42, TOXIC)
    p.rect(30, 22, 33, 41, TOXIC_HI)
    p.vline(31, 23, 40, TOXIC_PALE)
    glow_dither(p, 24, 18, 39, 45, TOXIC_DARK, replace=(STEEL_DARK,))
    streaks(p, 329, 10, LAB_SLATE, y0=40)


def t_vault_door_plate(p):
    # rusty steel plate
    fill(p, STEEL_MID)
    speckle(p, 330, 160, (RUST_DARK, RUST, STEEL, STEEL_LIGHT))
    # diagonal hazard band (period 64 along both axes)
    for y in range(T):
        for x in range(T):
            if (x - y) % 64 < 22:
                k = (x + y) % 12
                p.px(x, y, (HAZARD_HI if k == 0 else HAZARD) if k < 6 else OUTLINE)
    speckle(p, 331, 60, (RUST_DARK, HAZARD_DIM), only=(HAZARD,))
    # seams every 32 px and rivet rows beside them
    for v in (0, 32):
        p.hline(0, T - 1, v, SEAM)
        p.vline(v, 0, T - 1, SEAM)
        p.hline(0, T - 1, v + 1, STEEL_HI)
        p.vline(v + 1, 0, T - 1, STEEL_HI)
        for w in range(4, T, 8):
            rivet(p, w, v + 3)
            rivet(p, v + 3, w)
    streaks(p, 332, 10, RUST_DARK)


def t_mine_cart(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # rock load
    rnd = random.Random(333)
    for _ in range(40):
        x, y = rnd.randint(8, 55), rnd.randint(12, 22)
        disc(p, x, y, rnd.choice((1.5, 2, 2.5)), rnd.choice((ROCK, ROCK_MID, ROCK_LIGHT)))
    # cart body: trapezoid, ribs, rim
    body = [(4, 20), (59, 20), (54, 48), (9, 48)]
    p.poly(body, RUST, OUTLINE)
    hband(p, 21, (RUST_LIGHT, HAZARD_HI, RUST_LIGHT), 5, 58)
    for x in (16, 31, 46):
        p.line([(x, 23), (x - 1 if x < 31 else x + 1 if x > 31 else x, 46)], RUST_DARK, width=2)
    speckle(p, 334, 30, (RUST_DARK, ROCK_MID), x0=8, x1=55, y0=24, y1=46, only=(RUST,))
    p.hline(10, 53, 46, RUST_DARK)
    # wheels on the rail
    for cx in (17, 46):
        disc(p, cx, 52, 6.5, OUTLINE)
        disc(p, cx, 52, 5.5, STEEL_MID)
        disc(p, cx, 52, 2, STEEL_DARK)
        p.px(cx - 2, 49, STEEL_SPEC)
    hband(p, 58, (OUTLINE, STEEL_HI, STEEL_MID, OUTLINE))
    p.rect(0, 62, T - 1, T - 1, ROCK_DARK)


def t_cracked_ledge(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # ledge top slab
    p.rect(0, 0, T - 1, 18, CONCRETE)
    hband(p, 0, (CONCRETE_PALE, CONCRETE_HI, CONCRETE_LIGHT))
    grime(p, 335, y0=3, y1=17)
    # jagged broken underside, wrapped on x
    rnd = random.Random(336)
    x = 0
    pts = []
    while x < T:
        pts.append((x, 19 + rnd.randint(0, 14)))
        x += rnd.randint(3, 7)
    pts.append((T, pts[0][1]))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        for xx in range(x0, x1):
            yb = y0 + (y1 - y0) * (xx - x0) // max(1, x1 - x0)
            p.vline(xx, 18, yb, CONCRETE_DARK)
            p.px(xx, yb, OUTLINE)
            p.px(xx, yb - 1, STEEL_DARK)
    # rebar ends and drips
    for xx, yy in ((10, 28), (37, 30), (55, 25)):
        p.vline(xx, yy - 6, yy + 3, RUST)
    for xx in (6, 22, 41, 58):
        y = 20
        while p.get(xx, y) != NIGHT and y < T - 1:
            y += 1
        p.vline(xx, y, y + 5, LAB_TEAL_DARK)
        p.px(xx, y + 8, LAB_TEAL)
    # cracks in the top
    p.line([(14, 3), (18, 9), (16, 17)], OUTLINE)
    p.line([(44, 4), (40, 10), (45, 16), (47, 18)], OUTLINE)
    p.line([(15, 3), (19, 9)], CONCRETE_HI)


R1 = "01-abandoned-platform.png"
CT2, FS3, IC5, FT6 = ("02-collapsed-tunnel.png", "03-flooded-station.png",
                      "05-interchange.png", "06-forgotten-terminus.png")
DD1, DD2, MR1, MR2 = ("doomsday-door-01.png", "doomsday-door-02.png", "mutant-railway-01.png",
                      "mutant-railway-02.png")
MS1, MS2, LS2 = "monorail-stalker-01.png", "monorail-stalker-02.png", "lift-shaft-02.png"

# name, function, kind, tiles, note, refs
TILES = (
    ("rail-track", t_rail_track, "floor", "x",
     "side view: rail on wooden sleepers every 16 px over dark ballast, puddle glints",
     (f"{R1} 724,603 531x84",)),
    ("platform-edge", t_platform_edge, "floor", "x",
     "platform top with a yellow safety line and tactile strip, edge lip, grimy front face",
     (f"{R1} 483,446 386x72",)),
    ("platform-arch", t_platform_arch, "wall", "x",
     "platform front face: top beam with drips, one arched recess per tile with a rust pipe and rubble",
     (f"{R1} 845,471 338x145",)),
    ("station-tile-wall", t_station_tile_wall, "panel", "xy",
     "grimy white / grey 8 px glazed station tiles in offset rows, chips and rust streaks",
     (f"{FS3} 821,36 362x217",)),
    ("tunnel-arch", t_tunnel_arch, "wall", "none",
     "tunnel mouth: ribbed concrete arch, dark inside with converging rails and a far green glow",
     (f"{IC5} 1689,145 459x410", f"{MR1} 1665,72 483x386")),
    ("train-window", t_train_window, "train", "x",
     "carriage side: dark window with rounded corners, red stripe below, rivets, rust, skirt",
     (f"{R1} 857,157 278x193",)),
    ("train-door", t_train_door, "train", "none",
     "carriage double door: two leaves with rounded windows, rubber seal line, red stripe",
     (f"{R1} 652,229 157x181",)),
    ("train-bogie", t_train_bogie, "train", "x",
     "undercarriage: body skirt, bogie frame with axle boxes, wheels every 32 px on a rail",
     (f"{MR2} 217,519 531x121",)),
    ("concrete-pillar", t_concrete_pillar, "pillar", "y",
     "square concrete column with rust stains, a red band and a joint line",
     (f"{R1} 398,97 109x374",)),
    ("pillar-hazard", t_pillar_hazard, "pillar", "y",
     "steel-clad column, panel joints every 32 px, amber / dark hazard band",
     (f"{IC5} 640,145 97x217",)),
    ("bench", t_bench, "furniture", "none",
     "perforated metal station bench with seat dividers, on two legs",
     (f"{IC5} 736,459 145x72",)),
    ("rubble", t_rubble, "debris", "x",
     "pile of broken concrete chunks with bent rebar on the floor",
     (f"{CT2} 748,483 290x109",)),
    ("water-surface", t_water_surface, "liquid", "x",
     "dark green water from row 20 down: lighter top line, reflection streaks, amber lamp glints",
     (f"{FS3} 193,531 821x193",)),
    ("pipe-bundle", t_pipe_bundle, "pipe", "x",
     "four horizontal pipes of mixed size (rust, steel, teal) with flanges and brackets on a dark wall",
     (f"{FS3} 1834,217 169x193",)),
    ("monorail-beam", t_monorail_beam, "girder", "x",
     "concrete monorail track beam with a steel rail on top, dark underside with hangers and drips",
     (f"{MS1} 724,84 1448x229",)),
    ("wood-crate", t_wood_crate, "crate", "none",
     "wooden crate: planks, frame, diagonal brace, bolted steel corner plates",
     (f"{MS2} 374,446 145x145",)),
    ("quay-drain", t_quay_drain, "vent", "none",
     "dark rectangular drain with rust bars in a concrete quay wall, trickle into the water below",
     (f"{MS2} 760,615 157x97",)),
    ("vault-door-hub", t_vault_door_hub, "door", "none",
     "centre of a giant round vault door: hub rings, bolts, eight spokes, green light slit",
     (f"{DD1} 1448,217 386x290",)),
    ("vault-door-plate", t_vault_door_plate, "door", "xy",
     "vault door plate: rusty riveted steel, seams every 32 px, diagonal amber hazard band",
     (f"{DD2} 1211,90 314x247",)),
    ("mine-cart", t_mine_cart, "vehicle", "none",
     "ore cart side view loaded with rock, rust body with ribs, two wheels on a rail",
     (f"{DD1} 302,567 314x97",)),
    ("cracked-ledge", t_cracked_ledge, "floor", "x",
     "broken concrete ledge: cracked top slab, jagged underside, rebar ends and drips",
     (f"{FT6} 845,459 603x109", f"{LS2} 355,493 532x177")),
)
