"""blocks-growth: organic growth tiles for the pipe growth, subway, driller, doomsday door
and machine boss levels (6 x 3). See ../blocks_themed.py."""

import math
import random

from blocks_placeholder import PIPE_STEEL, PIPE_Y0
from blocks_themes.common import *  # noqa: F401,F403  (palette constants and helpers)
from blocks_themes.common import (T, bevel, inset, panel, rivet, bolt, streaks, stripes,
                                  glow_dither, fill, hband, vband, speckle, disc, ring, blob,
                                  vrail)

NAME = "growth"
COLUMNS = 6
ROWS = 3
NOTE = ("Placeholder programmer art for organic growth over the pipe growth / subway / driller / "
        "doomsday door / machine boss levels, drawn by tools/blocks_themed.py; shapes follow "
        "scene mockups that are not in the repository.")
SUBJECT = ("Placeholder environment block textures for organic growth: flesh wall, tendrils on a "
           "panel and hanging, egg sacs, pods, slime drips, acid pool and fall, flesh-wrapped "
           "pipe, honeycomb membrane, bone ribs, glowing fungus, cave rock, stalactites, spore "
           "crystals, eye pustule, flesh-crusted floor, sinew column.")
VISUAL_APPROACH = ("Programmer pixel art: hard edges, no antialiasing, burgundy and pink flesh "
                   "with dark crevices and wet highlights, toxic green slime and acid, pale bone, "
                   "brown rock; colours from the project's shared palette.")
SEED_NOTE = ("The script uses random.Random with fixed seeds (per-call seeds in the helpers, "
             "401-436 in this theme's tiles) for strand paths, egg and pod placement, rock "
             "cells, crystals, bubbles and drips.")

FLESH_RAMP = (GORE_DARK, GORE, FLESH, FLESH, FLESH_MID, FLESH_LIGHT, FLESH_PINK)
STRAND = (GORE_DARK, FLESH, FLESH_PINK)
TAU = 2 * math.pi


def flesh_field(x, y):
    """A smooth fold pattern, periodic over 64 px on both axes (-3..3)."""
    return (math.sin(TAU * (2 * x + y) / T) + math.sin(TAU * (x - 2 * y) / T * 1.0)
            + math.sin(TAU * (3 * y) / T + math.sin(TAU * x / T) * 1.5))


def flesh_mass(p, x0=0, y0=0, x1=T - 1, y1=T - 1, phase=0):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            v = flesh_field(x + phase, y)
            k = int((v + 3) / 6 * len(FLESH_RAMP))
            p.px(x, y, FLESH_RAMP[max(0, min(len(FLESH_RAMP) - 1, k))])


def strand_path(p, pts, colours=STRAND, width=3):
    """Strand through points: dark edge, body, highlight on the upper side."""
    dark, body, hi = colours
    p.line(pts, dark, width=width + 2)
    p.line(pts, body, width=width)
    p.line([(x, y - (width // 2)) for x, y in pts], hi)


def periodic_points(seed, n, period=T):
    rnd = random.Random(seed)
    return [(rnd.uniform(0, period), rnd.uniform(0, period)) for _ in range(n)]


def wrap_dist(ax, ay, bx, by):
    dx = abs(ax - bx)
    dy = abs(ay - by)
    dx, dy = min(dx, T - dx), min(dy, T - dy)
    return math.hypot(dx, dy)


# ----------------------------------------------------------------------------- tiles

def t_flesh_wall(p):
    flesh_mass(p)
    # wet highlights on the fold crests, dark pores in the crevices
    for y in range(T):
        for x in range(T):
            v = flesh_field(x, y)
            if v > 2.35 and (x + 2 * y) % 5 == 0:
                p.px(x, y, RED_PALE)
            elif v < -2.4 and (x * 3 + y) % 4 == 0:
                p.px(x, y, OUTLINE)
    speckle(p, 401, 30, (VEIN, GORE_DARK, FLESH_PINK))


def t_tendrils_on_panel(p):
    panel(p, base=STEEL_MID, hi=STEEL_HI, sh=STEEL_DARK)
    streaks(p, 402, 8, STEEL)
    for v in (8, 56):
        bolt(p, v, 8)
        bolt(p, v, 52)
    # wavy strands that wrap across the tile: y = a + A sin(2 pi k x / 64)
    for a, amp, k, ph, w in ((14, 5, 1, 0.0, 3), (36, 7, 2, 1.3, 3), (52, 4, 1, 2.6, 2)):
        pts = [(x, a + amp * math.sin(TAU * k * x / T + ph)) for x in range(-2, T + 3, 2)]
        pts = [(x, int(round(y))) for x, y in pts]
        strand_path(p, pts, width=w)
    # a strand climbing down: x = a + A sin(2 pi y / 64)
    for a, ph in ((22, 0.4), (47, 2.0)):
        pts = [(int(round(a + 6 * math.sin(TAU * y / T + ph))), y) for y in range(-2, T + 3, 2)]
        p.line(pts, GORE_DARK, width=4)
        p.line(pts, FLESH, width=2)
    speckle(p, 403, 20, (VEIN, FLESH_PINK), only=(FLESH,))


def t_tendrils_hanging(p):
    p.rect(0, 0, T - 1, T - 1, SEAM)
    for y in range(0, T, 16):
        p.hline(0, T - 1, y, STEEL_DARK)
    # flesh mass along the top edge
    flesh_mass(p, 0, 0, T - 1, 8)
    rnd = random.Random(404)
    for x in range(0, T, 4):
        d = rnd.randint(0, 4)
        flesh_mass(p, x, 9, x + 3, 9 + d, phase=7)
    # hanging strands thinning down, drips at their ends
    rnd = random.Random(405)
    for x0 in range(2, T, 6):
        length = rnd.randint(18, 52)
        x = x0
        for i in range(length):
            y = 9 + i
            w = 3 if i < length * 0.4 else (2 if i < length * 0.75 else 1)
            if w == 3:
                p.px(x - 1, y, GORE_DARK)
                p.px(x, y, FLESH if i % 4 else FLESH_PINK)
                p.px(x + 1, y, GORE_DARK)
            elif w == 2:
                p.px(x, y, FLESH)
                p.px(x + 1, y, GORE_DARK)
            else:
                p.px(x, y, GORE)
            if rnd.random() < 0.15:
                x += rnd.choice((-1, 1))
        p.px(x, 9 + length + 2, FLESH_PINK)
        p.px(x, 9 + length + 3, GORE)


def t_egg_sacs(p):
    flesh_mass(p, phase=13)
    glow_dither(p, 0, 0, T - 1, T - 1, GORE_DARK)
    # webbing strands
    for a, b in (((0, 10), (63, 30)), ((8, 63), (50, 0)), ((0, 48), (63, 54)), ((30, 63), (63, 20))):
        p.line([a, b], TOXIC_DARK, width=2)
        p.line([a, b], TOXIC_LIGHT)
    # glowing translucent sacs
    for cx, cy, rx, ry in ((20, 22, 13, 15), (45, 18, 10, 11), (42, 44, 14, 13),
                           (14, 50, 9, 9)):
        blob(p, cx, cy, rx, ry, TOXIC_LIGHT, TOXIC_PALE, TOXIC, outline=TOXIC_DARK)
        disc(p, cx + rx * 0.15, cy + ry * 0.15, min(rx, ry) * 0.35, TOXIC)
        p.px(int(cx + rx * 0.15), int(cy + ry * 0.15), TOXIC_DARK)
        # veins on the sac
        p.line([(int(cx - rx * 0.6), int(cy + ry * 0.2)), (int(cx), int(cy + ry * 0.7))], TOXIC)
    glow_dither(p, 0, 0, T - 1, T - 1, TOXIC_DARK, replace=(GORE_DARK, GORE))
    # strands over the sacs
    p.line([(4, 0), (26, 36), (34, 63)], TOXIC_HI)
    p.line([(63, 34), (30, 30)], TOXIC_HI)


def t_pod_cluster(p):
    flesh_mass(p, phase=29)
    glow_dither(p, 0, 0, T - 1, T - 1, FLESH_DARK)
    for cx, cy, rx, ry in ((16, 16, 13, 13), (44, 14, 11, 12), (30, 38, 15, 14),
                           (54, 44, 9, 11), (10, 50, 9, 9)):
        blob(p, cx, cy, rx, ry, POD, BONE_MID, POD_DARK, outline=OUTLINE)
        # glossy rim light
        for a in range(200, 260, 8):
            r = math.radians(a)
            p.px(int(round(cx + (rx - 2) * math.cos(r))), int(round(cy + (ry - 2) * math.sin(r))),
                 FLESH_LIGHT)
    # webbing over the pods
    for pts in (((0, 30), (14, 28), (30, 22), (48, 28), (63, 26)),
                ((20, 63), (24, 50), (40, 40), (52, 30), (63, 32)),
                ((34, 0), (30, 12), (38, 24))):
        p.line(list(pts), FLESH_DARK, width=3)
        p.line(list(pts), FLESH)
    # drips of green from the bottom pods
    for x in (28, 33, 52):
        p.vline(x, 52, 58 + x % 5, TOXIC_LIGHT)
        p.px(x, 59 + x % 5, TOXIC_HI)


def t_slime_drip(p):
    panel(p, base=STEEL, hi=STEEL_MID, sh=STEEL_DARK, edges="lr")
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    for x in (0, 32):
        p.vline(x, 0, T - 1, SEAM)
        p.vline(x + 1, 0, T - 1, STEEL)
    streaks(p, 406, 8, STEEL)
    # slime band along the top
    p.rect(0, 0, T - 1, 5, TOXIC)
    p.hline(0, T - 1, 0, TOXIC_DARK)
    p.hline(0, T - 1, 1, TOXIC_LIGHT)
    p.hline(0, T - 1, 2, TOXIC_HI)
    # drips running down, bulb at the end
    rnd = random.Random(407)
    for x in range(1, T, 5):
        n = rnd.randint(6, 50)
        w = 2 if rnd.random() < 0.5 else 1
        p.rect(x, 6, x + w - 1, 6 + n, TOXIC_LIGHT)
        p.vline(x, 6, 6 + n, TOXIC_HI)
        if w == 2:
            p.vline(x + 1, 6, 6 + n, TOXIC)
        p.rect(x - 1 + (w == 1), 6 + n, x + w - (w == 1), 8 + n, TOXIC_LIGHT)
        p.px(x, 6 + n, TOXIC_PALE)
        p.hline(x - 1, x + w, 6 + n // 3, TOXIC)
    speckle(p, 408, 12, (TOXIC,), y0=10, only=(STEEL_DARK, STEEL))


def t_acid_pool(p):
    p.rect(0, 0, T - 1, 21, NIGHT)
    glow_dither(p, 0, 12, T - 1, 21, TOXIC_DARK, replace=(NIGHT,))
    # surface and body
    for y in range(22, T):
        k = y - 22
        c = TOXIC_HI if k < 2 else (TOXIC_LIGHT if k < 12 else (TOXIC if k < 28 else TOXIC_DARK))
        p.hline(0, T - 1, y, c)
    p.hline(0, T - 1, 22, TOXIC_PALE)
    # ripples
    for y, ph in ((27, 0), (33, 11), (40, 23), (49, 37)):
        for x in range(T):
            if (x + ph) % 16 < 6:
                p.px(x, y, TOXIC_HI if y < 36 else TOXIC_LIGHT)
    # bubbles breaking the surface and rising
    rnd = random.Random(409)
    for _ in range(6):
        x = rnd.randint(2, 60)
        ring(p, x, 21, 1.5, 2.6, TOXIC_HI)
    for _ in range(14):
        x, y = rnd.randint(0, T - 1), rnd.randint(26, 60)
        ring(p, x, y, 0.8, 1.8, TOXIC_PALE if y < 40 else TOXIC_HI)


def t_acid_fall(p):
    p.rect(0, 0, T - 1, T - 1, STEEL_DARK)
    for x in (0, 63):
        p.vline(x, 0, T - 1, SEAM)
    streaks(p, 410, 6, STEEL)
    glow_dither(p, 6, 0, 13, T - 1, TOXIC_DARK, replace=(STEEL_DARK, STEEL))
    glow_dither(p, 50, 0, 57, T - 1, TOXIC_DARK, replace=(STEEL_DARK, STEEL))
    # stream: per column a base colour, with bright streak segments repeating every 64 px
    cols = (TOXIC_DARK, TOXIC, TOXIC_LIGHT, TOXIC_HI, TOXIC_LIGHT, TOXIC, TOXIC_LIGHT,
            TOXIC_HI, TOXIC_PALE, TOXIC_HI, TOXIC_LIGHT, TOXIC_LIGHT, TOXIC, TOXIC_LIGHT,
            TOXIC_HI, TOXIC_LIGHT, TOXIC, TOXIC_LIGHT, TOXIC_HI, TOXIC_LIGHT, TOXIC, TOXIC,
            TOXIC_LIGHT, TOXIC, TOXIC_LIGHT, TOXIC_HI, TOXIC_LIGHT, TOXIC, TOXIC_LIGHT, TOXIC,
            TOXIC, TOXIC_DARK)
    rnd = random.Random(411)
    for i, c in enumerate(cols):
        x = 16 + i
        p.vline(x, 0, T - 1, c)
        for _ in range(2):
            y0, n = rnd.randint(0, T - 1), rnd.randint(4, 14)
            for y in range(y0, y0 + n):
                p.px(x, y, TOXIC_PALE if c in (TOXIC_HI, TOXIC_PALE) else TOXIC_HI)
    p.vline(15, 0, T - 1, OUTLINE)
    p.vline(48, 0, T - 1, OUTLINE)
    # spray specks beside the stream
    speckle(p, 412, 18, (TOXIC_HI, TOXIC_LIGHT), x0=10, x1=14)
    speckle(p, 413, 18, (TOXIC_HI, TOXIC_LIGHT), x0=49, x1=54)


def t_flesh_pipe(p):
    p.rect(0, 0, T - 1, T - 1, SEAM)
    for y in range(0, T, 12):
        p.hline(0, T - 1, y, STEEL_DARK)
    for i, c in enumerate(PIPE_STEEL):
        p.hline(0, T - 1, PIPE_Y0 + i, c)
    p.hline(0, T - 1, PIPE_Y0 + 24, OUTLINE)
    speckle(p, 414, 40, (RUST_DARK, RUST), y0=PIPE_Y0 + 2, y1=PIPE_Y0 + 21)
    # flesh wraps around the pipe: two bulging cuffs per tile
    for cx, w in ((10, 14), (44, 10)):
        for y in range(PIPE_Y0 - 6, PIPE_Y0 + 30):
            bulge = int(3 * math.sin(TAU * (y - PIPE_Y0) / 36))
            for x in range(cx - w // 2 - bulge, cx + w // 2 + bulge + 1):
                v = flesh_field(x, y)
                k = int((v + 3) / 6 * len(FLESH_RAMP))
                p.px(x, y, FLESH_RAMP[max(0, min(len(FLESH_RAMP) - 1, k))])
            p.px(cx - w // 2 - bulge - 1, y, OUTLINE)
            p.px(cx + w // 2 + bulge + 1, y, OUTLINE)
    # tendrils running along and around the pipe
    for a, amp, ph in ((PIPE_Y0 + 4, 4, 0.0), (PIPE_Y0 + 17, 5, 2.0)):
        pts = [(x, int(round(a + amp * math.sin(TAU * x / T + ph)))) for x in range(-2, T + 3, 2)]
        strand_path(p, pts, width=2)
    # strands hanging below
    for x, n in ((6, 14), (16, 9), (40, 16), (50, 7)):
        p.vline(x, PIPE_Y0 + 28, PIPE_Y0 + 28 + n, FLESH)
        p.vline(x + 1, PIPE_Y0 + 28, PIPE_Y0 + 26 + n, GORE_DARK)
        p.px(x, PIPE_Y0 + 30 + n, FLESH_PINK)


def t_honeycomb(p):
    p.rect(0, 0, T - 1, T - 1, POD)
    flesh_mass(p, phase=41)
    for y in range(T):
        for x in range(T):
            if p.get(x, y) in (FLESH, FLESH_MID):
                p.px(x, y, POD)
            elif p.get(x, y) in (FLESH_LIGHT, FLESH_PINK):
                p.px(x, y, FLESH_LIGHT)
    # cells on a 16 x 16 grid, odd rows shifted by 8 (period 64 on both axes)
    rnd = random.Random(415)
    for row in range(4):
        for col in range(4):
            cx = col * 16 + (8 if row % 2 else 0) + 7.5 + rnd.uniform(-1, 1)
            cy = row * 16 + 7.5 + rnd.uniform(-1, 1)
            rx, ry = rnd.uniform(4.5, 6), rnd.uniform(4, 5.5)
            for y in range(int(cy - ry) - 2, int(cy + ry) + 3):
                for x in range(int(cx - rx) - 2, int(cx + rx) + 3):
                    d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                    if d <= 1:
                        p.px(x, y, OUTLINE if d < 0.5 else GORE_DARK)
                    elif d <= 1.6:
                        p.px(x, y, FLESH_PINK if (x < cx and y < cy) else (FLESH_DARK if y > cy else POD_DARK))
    speckle(p, 416, 24, (BONE_DARK, VEIN), only=(POD,))


def t_bone_ribs(p):
    flesh_mass(p, phase=53)
    glow_dither(p, 0, 0, T - 1, T - 1, OUTLINE)
    # ribs curving down from the spine, every 16 px
    for x0 in range(4, T, 16):
        pts = [(x0 + int(round(9 * math.sin(t / 10 * 1.4))), 18 + t * 4) for t in range(11)]
        p.line(pts, OUTLINE, width=5)
        p.line(pts, BONE_MID, width=3)
        p.line([(x - 1, y) for x, y in pts], BONE)
        p.line([(x + 1, y) for x, y in pts], BONE_DARK)
    # spine: vertebrae every 8 px
    hband(p, 10, (OUTLINE, BONE_DARK, BONE_MID, BONE_MID, BONE_DARK, OUTLINE))
    for x in range(0, T, 8):
        p.rect(x + 1, 6, x + 6, 19, OUTLINE)
        p.rect(x + 2, 7, x + 5, 18, BONE_MID)
        p.hline(x + 2, x + 5, 7, BONE_WARM)
        p.vline(x + 2, 7, 18, BONE)
        p.vline(x + 5, 8, 18, BONE_DARK)
        p.px(x + 4, 3, BONE_DARK)
        p.vline(x + 4, 4, 5, BONE_MID)


def t_glow_fungus(p):
    p.rect(0, 0, T - 1, T - 1, FLESH_DARK)
    glow_dither(p, 20, 0, T - 1, T - 1, GORE_DARK)
    # pillar edge on the left
    for x in range(0, 20):
        p.vline(x, 0, T - 1, (CONCRETE_LIGHT, CONCRETE, CONCRETE, CONCRETE_DARK, CONCRETE_DARK,
                              STEEL_DARK, OUTLINE)[min(6, x * 7 // 20)])
    speckle(p, 417, 24, (RUST_DARK, CONCRETE_DARK), x1=18)
    # shelf caps: pale top, pink-lit gills underneath, glow below
    for y0, w in ((10, 30), (30, 38), (48, 24)):
        x0 = 14
        x1 = x0 + w
        for x in range(x0, x1 + 1):
            t = (x - x0) / w
            h = int(round(6 * math.sqrt(max(0.0, 1 - t * t))))
            p.vline(x, y0 - h, y0, BONE)
            p.px(x, y0 - h, OUTLINE)
            if h > 1:
                p.px(x, y0 - h + 1, BONE_WARM)
            p.px(x, y0 + 1, FLESH_PINK)
            p.px(x, y0 + 2, MAGENTA_PALE if x % 3 else FLESH_PINK)
            p.px(x, y0 + 3, OUTLINE)
        glow_dither(p, x0, y0 + 4, x1, y0 + 9, FLESH_PINK, replace=(FLESH_DARK, GORE_DARK))
    # drips from the caps
    for x, y, n in ((24, 14, 8), (38, 34, 10), (30, 52, 7)):
        p.vline(x, y, y + n, FLESH_PINK)
        p.px(x, y + n + 2, MAGENTA_PALE)


def rock_cells(p, seed, y0=0, y1=T - 1, n=14):
    """Angular rock: periodic Voronoi cells shaded per cell, dark cracks on the borders."""
    pts = periodic_points(seed, n)
    rnd = random.Random(seed + 1)
    shades = [rnd.choice((ROCK, ROCK_MID, ROCK_MID, ROCK_LIGHT)) for _ in pts]
    for y in range(y0, y1 + 1):
        for x in range(T):
            ds = sorted((wrap_dist(x, y, px_, py_), i) for i, (px_, py_) in enumerate(pts))
            (d1, i1), (d2, _) = ds[0], ds[1]
            if d2 - d1 < 1.0:
                c = ROCK_DARK if (x + y) % 3 else OUTLINE
            else:
                cx, cy = pts[i1]
                dx = ((x - cx + T / 2) % T) - T / 2
                dy = ((y - cy + T / 2) % T) - T / 2
                c = shades[i1]
                if d2 - d1 < 2.2 and dx + dy < 0:
                    c = ROCK_HI if c == ROCK_LIGHT else ROCK_LIGHT
                elif d2 - d1 < 2.2:
                    c = ROCK_DARK if c == ROCK else ROCK
            p.px(x, y, c)


def t_rock_wall(p):
    rock_cells(p, 418)
    speckle(p, 420, 40, (ROCK_DARK, ROCK_HI))


def t_stalactite(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    rock_cells(p, 421, 0, 13, n=8)
    hband(p, 14, (ROCK_DARK, OUTLINE))
    rnd = random.Random(423)
    x = 1
    while x < T:
        w = rnd.randint(3, 7)
        n = rnd.randint(10, 44)
        for i in range(n):
            half = max(0, int(round(w * (1 - i / n))))
            y = 14 + i
            p.hline(x - half, x + half, y, ROCK_MID)
            p.px(x - half, y, ROCK_LIGHT)
            p.px(x + half, y, ROCK_DARK)
            if half == 0:
                p.px(x, y, ROCK_LIGHT)
        p.px(x, 14 + n + 3, LAB_TEAL_DARK)
        p.px(x, 14 + n + 6, LAB_TEAL)
        x += w + rnd.randint(4, 8)


def t_spore_growth(p):
    rock_cells(p, 424, n=10)
    glow_dither(p, 0, 0, T - 1, T - 1, TOXIC_DARK, replace=(ROCK, ROCK_DARK))
    # pale green crystals: small upright diamonds
    rnd = random.Random(426)
    for _ in range(18):
        cx, cy = rnd.randint(4, 59), rnd.randint(6, 59)
        h = rnd.randint(3, 7)
        for i in range(h):
            w = min(i, h - i) // 2 + 0
            p.hline(cx - w, cx + w, cy - h + i, TOXIC_HI if i < h // 2 else TOXIC_LIGHT)
            p.px(cx - w, cy - h + i, TOXIC_PALE)
        p.px(cx, cy - h, TOXIC_PALE)
    # spore dust
    speckle(p, 427, 60, (TOXIC_HI, TOXIC_LIGHT, TOXIC_PALE))


def t_eye_pustule(p):
    flesh_mass(p, phase=61)
    cx, cy = 31.5, 31.5
    # swollen socket rings
    for r, c in ((29, OUTLINE), (28, FLESH_DARK), (26, FLESH), (23, FLESH_MID), (21, GORE),
                 (20, OUTLINE)):
        disc(p, cx, cy, r, c)
    for a in range(200, 280, 6):
        rr = math.radians(a)
        p.px(int(round(cx + 25 * math.cos(rr))), int(round(cy + 25 * math.sin(rr))), FLESH_PINK)
    # iris: orange to yellow towards the centre, veined
    for r, c in ((19, RED), (16, LAMP_ORANGE), (12, LAMP_AMBER), (7, LAMP_YELLOW)):
        disc(p, cx, cy, r, c)
    for a in range(0, 360, 20):
        rr = math.radians(a)
        p.line([(int(cx + 8 * math.cos(rr)), int(cy + 8 * math.sin(rr))),
                (int(cx + 18 * math.cos(rr)), int(cy + 18 * math.sin(rr)))], RED_DARK)
    # slit pupil
    for y in range(int(cy) - 17, int(cy) + 19):
        w = max(0, int(round(2.5 * (1 - abs(y - cy) / 18))))
        p.hline(int(cx) - w, int(cx) + 1 + w, y, OUTLINE)
    # wet highlight
    p.rect(21, 20, 23, 21, LAMP_WHITE)
    p.px(24, 22, LAMP_PALE)
    p.px(20, 22, LAMP_PALE)


def t_flesh_floor(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # slab: top face and front face
    p.rect(0, 6, T - 1, 13, CONCRETE)
    hband(p, 6, (CONCRETE_HI, CONCRETE_LIGHT))
    hband(p, 14, (OUTLINE, CONCRETE_PALE, CONCRETE_LIGHT))
    p.rect(0, 17, T - 1, 40, CONCRETE_DARK)
    hband(p, 40, (STEEL_DARK, OUTLINE))
    for x in (0, 32):
        p.vline(x, 17, 40, SEAM)
    # flesh crust on the top, bumpy
    rnd = random.Random(428)
    for x in range(0, T, 2):
        h = rnd.randint(2, 7)
        flesh_mass(p, x, 8 - h, x + 1, 9, phase=71)
        p.px(x, 7 - h, GORE_DARK)
        p.px(x + 1, 7 - h, GORE_DARK)
    # tendrils draping over the front edge and below
    rnd = random.Random(429)
    for x0 in range(3, T, 8):
        n = rnd.randint(16, 46)
        x = x0
        for i in range(n):
            y = 10 + i
            p.px(x - 1, y, GORE_DARK)
            p.px(x, y, FLESH if i % 5 else FLESH_PINK)
            if i < n * 0.6:
                p.px(x + 1, y, GORE)
            if rnd.random() < 0.2:
                x += rnd.choice((-1, 1))
        p.px(x, 10 + n + 1, FLESH_PINK)


def t_tendril_column(p):
    p.rect(0, 0, T - 1, T - 1, NIGHT)
    # concrete pillar
    for x in range(16, 48):
        p.vline(x, 0, T - 1, (CONCRETE_HI, CONCRETE_LIGHT, CONCRETE, CONCRETE, CONCRETE,
                              CONCRETE_DARK, CONCRETE_DARK, STEEL_DARK)[(x - 16) * 8 // 32])
    p.vline(15, 0, T - 1, OUTLINE)
    p.vline(48, 0, T - 1, OUTLINE)
    speckle(p, 430, 20, (RUST_DARK, CONCRETE_DARK), x0=17, x1=46)
    # sinews wrapping the pillar: diagonal bands that repeat every 32 px in y
    for y in range(T):
        for x in range(12, 52):
            k = (y - (x - 12) * 0.6) % 32
            if 0 <= k < 5:
                p.px(x, y, (GORE_DARK, FLESH_PINK, FLESH_MID, FLESH, GORE_DARK)[int(k)])
    # main trunk on the left, swaying with period 64
    for y in range(T):
        cx = 13 + int(round(3 * math.sin(TAU * y / T)))
        for dx, c in ((-3, OUTLINE), (-2, GORE), (-1, FLESH_MID), (0, FLESH_PINK), (1, FLESH),
                      (2, FLESH), (3, GORE), (4, OUTLINE)):
            p.px(cx + dx, y, c)
    # a thinner strand on the right
    for y in range(T):
        cx = 50 + int(round(2 * math.sin(TAU * 2 * y / T + 1)))
        p.px(cx - 1, y, GORE_DARK)
        p.px(cx, y, FLESH)
        p.px(cx + 1, y, GORE_DARK)


PG1, PG3, PG4 = "pipe-growth-01.png", "pipe-growth-03.png", "pipe-growth-04.png"
CT2, MD4, IC5, FT6 = ("02-collapsed-tunnel.png", "04-maintenance-depot.png",
                      "05-interchange.png", "06-forgotten-terminus.png")
DR1, DR2, DR4 = "driller-01.png", "driller-02.png", "driller-04.png"
DD3, MB1 = "doomsday-door-03.png", "machine-boss-01.png"

# name, function, kind, tiles, note, refs
TILES = (
    ("flesh-wall", t_flesh_wall, "organic", "xy",
     "wet flesh mass: burgundy and pink folds, dark crevices and pores, wet highlights",
     (f"{MD4} 1255,217 459x217",)),
    ("tendrils-on-panel", t_tendrils_on_panel, "organic", "xy",
     "steel wall panel with dark red tendrils crawling across it",
     (f"{CT2} 48,24 434x265",)),
    ("tendrils-hanging", t_tendrils_hanging, "organic", "x",
     "flesh mass along the top edge with strands hanging down, thinning, drips at their ends",
     (f"{IC5} 386,48 338x169",)),
    ("egg-sacs", t_egg_sacs, "organic", "none",
     "cluster of glowing green-yellow translucent egg sacs with embryos in flesh webbing",
     (f"{DR4} 1882,97 290x386",)),
    ("pod-cluster", t_pod_cluster, "organic", "none",
     "purple-grey glossy pods in flesh webbing, green drips",
     (f"{PG1} 603,0 290x265",)),
    ("slime-drip", t_slime_drip, "organic", "x",
     "green slime band along the top with drips running down over a dark panel",
     (f"{PG4} 422,12 193x362",)),
    ("acid-pool", t_acid_pool, "liquid", "x",
     "green toxic liquid from row 22 down: bright surface line, ripples, bubbles, glow above",
     (f"{PG1} 700,627 555x97",)),
    ("acid-fall", t_acid_fall, "liquid", "y",
     "vertical green toxic stream (columns 16-47) with bright streaks and spray on a dark wall",
     (f"{MB1} 941,507 290x169",)),
    ("flesh-pipe", t_flesh_pipe, "organic", "x",
     "horizontal steel pipe (rows 20-43, as pipe-h) wrapped in flesh cuffs and tendrils, strands hanging",
     (f"{PG3} 1665,0 507x193",)),
    ("honeycomb", t_honeycomb, "organic", "xy",
     "flesh honeycomb membrane: rounded cells with dark holes and pink rims, 16 px grid",
     (f"{DD3} 241,514 290x210",)),
    ("bone-ribs", t_bone_ribs, "organic", "x",
     "spine of pale vertebrae along the top with curved ribs every 16 px over dark flesh",
     (f"{FT6} 821,24 676x241",)),
    ("glow-fungus", t_glow_fungus, "organic", "none",
     "pale shelf fungus caps with pink-lit gills and glow, on a concrete pillar edge at the left",
     (f"{IC5} 1255,362 145x121",)),
    ("rock-wall", t_rock_wall, "rock", "xy",
     "cave rock: angular cells in browns with dark cracks and lit edges",
     (f"{DR2} 1931,241 241x410",)),
    ("stalactite", t_stalactite, "rock", "x",
     "rock ceiling along the top with hanging stalactites and drips",
     (f"{DD3} 241,0 386x133",)),
    ("spore-growth", t_spore_growth, "organic", "none",
     "rock with pale green spore crystals and spore dust",
     (f"{DR1} 1641,290 265x290",)),
    ("eye-pustule", t_eye_pustule, "organic", "none",
     "large glowing orange eye with a slit pupil in a swollen flesh socket",
     (f"{MB1} 965,145 241x241",)),
    ("flesh-floor", t_flesh_floor, "organic", "x",
     "concrete floor slab with a flesh crust on top and tendrils draping over its front face",
     (f"{MD4} 362,398 483x84",)),
    ("tendril-column", t_tendril_column, "organic", "y",
     "concrete pillar wrapped by diagonal sinews, a thick trunk on the left and a strand on the right",
     (f"{IC5} 615,97 157x290",)),
)
