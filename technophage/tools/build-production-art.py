#!/usr/bin/env python3
"""Cut the usable parts of the art production pass into runtime assets.

Run from technophage/:  python3 tools/build-production-art.py
Reads generated-art/production-pass/ (see docs/art-production-handover.md).
Writes assets/pp/*.png|jpg and assets/pp/production.json. Separate from
tools/build-assets.py so the two pipelines do not overwrite each other.

Uses: backgrounds, pickups, checkpoint console, exit lift, breakable block states,
projectiles, mech walk cycle, hunter run legs. Other studies are not
grid-registered yet and are left out.
"""
import colorsys
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

SRC = 'generated-art/production-pass'
OUT = 'assets/pp'
HUNTER = json.load(open('assets/manifest.json'))['hunter']  # current hunter frame geometry


def rgba(path):
    return Image.open(os.path.join(SRC, path)).convert('RGBA')


def clean(im, thresh=60, erode=3):
    """Hard alpha, and shave the soft fringe where halos live."""
    a = im.getchannel('A').point(lambda v: 255 if v > thresh else 0)
    if erode:
        a = a.filter(ImageFilter.MinFilter(erode))
    im = im.copy()
    im.putalpha(a)
    return im


def shrink(im, w=None, h=None):
    if w is None:
        w = max(1, round(im.width * h / im.height))
    if h is None:
        h = max(1, round(im.height * w / im.width))
    out = im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    out.putalpha(out.getchannel('A').point(lambda v: 255 if v > 110 else 0))
    return out


def fit(im, box):
    """Scale to fit inside a box (w, h) keeping aspect."""
    s = min(box[0] / im.width, box[1] / im.height)
    return shrink(im, w=max(1, round(im.width * s)))


def components(im, thresh=40, scale=4, dilate=3, min_px=200):
    """Bounding boxes of separate opaque regions, ordered top-to-bottom then left-to-right."""
    a = np.array(im.getchannel('A'))[::scale, ::scale] > thresh
    if dilate:
        m = Image.fromarray((a * 255).astype('uint8')).filter(ImageFilter.MaxFilter(dilate * 2 + 1))
        a = np.array(m) > 0
    h, w = a.shape
    seen = np.zeros_like(a, bool)
    boxes = []
    for y in range(h):
        for x in range(w):
            if a[y, x] and not seen[y, x]:
                q = deque([(y, x)])
                seen[y, x] = True
                x0 = x1 = x
                y0 = y1 = y
                n = 0
                while q:
                    cy, cx = q.popleft()
                    n += 1
                    x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and a[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                if n * scale * scale >= min_px:
                    boxes.append((x0 * scale, y0 * scale, (x1 + 1) * scale, (y1 + 1) * scale))
    # drop fragments (droplets, sparks) that sit inside a larger part's box
    def inside(a, b):
        return a != b and a[0] >= b[0] - 8 and a[1] >= b[1] - 8 and a[2] <= b[2] + 8 and a[3] <= b[3] + 8
    boxes = [a for a in boxes if not any(inside(a, b) for b in boxes)]
    # rows: group boxes whose vertical centres are close
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows, cur = [], []
    for b in boxes:
        if cur and (b[1] + b[3]) / 2 - (cur[-1][1] + cur[-1][3]) / 2 > (b[3] - b[1]) * 0.5:
            rows.append(cur)
            cur = []
        cur.append(b)
    if cur:
        rows.append(cur)
    return [b for r in rows for b in sorted(r, key=lambda b: b[0])]


def tight(im):
    bb = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    return im.crop(bb) if bb else im


def recolor(im, hue_to):
    """Shift warm highlights (amber lights) to another hue: player 2 variant."""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.03 < h < 0.17 and s > 0.45 and v > 0.35:
                nr, ng, nb = colorsys.hsv_to_rgb(hue_to, min(1, s * 0.9), v)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


def save(im, name, man):
    p = os.path.join(OUT, name + '.png')
    im.save(p, optimize=True)
    man['sprites'][name] = {'src': p, 'w': im.width, 'h': im.height}
    return im


def frames_from_strip(path, count, height, anchor_top=0.5):
    """Cut an evenly spaced pose strip into registered frames.

    Each pose is aligned so its feet (lowest opaque row) sit on the frame bottom and the
    centre of its upper part (body/chassis/belt) is at the frame centre, which removes
    the drift between hand-placed poses. All frames share one size and scale.
    """
    im = clean(rgba(path), erode=3)
    W = im.width
    poses = []
    for i in range(count):
        cell = im.crop((round(i * W / count), 0, round((i + 1) * W / count), im.height))
        # keep only the main pose; specks from neighbouring poses are dropped
        parts = components(cell, min_px=50)
        main = max(parts, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        mask = Image.new('L', cell.size, 0)
        mask.paste(255, main)
        cell.putalpha(Image.composite(cell.getchannel('A'), mask, mask))
        bb = cell.getchannel('A').getbbox()
        poses.append(cell.crop(bb))
    # common scale from the median pose height
    hs = sorted(p.height for p in poses)
    s = height / hs[len(hs) // 2]
    out = []
    for p in poses:
        q = shrink(p, w=max(1, round(p.width * s)), h=max(1, round(p.height * s)))
        top = q.crop((0, 0, q.width, max(1, round(q.height * anchor_top))))
        tb = top.getchannel('A').getbbox() or (0, 0, q.width, 1)
        out.append((q, (tb[0] + tb[2]) / 2))
    fw = max(max(cx, q.width - cx) for q, cx in out) * 2 + 4
    fh = max(q.height for q, _ in out)
    frames = []
    for q, cx in out:
        f = Image.new('RGBA', (round(fw), fh), (0, 0, 0, 0))
        f.alpha_composite(q, (round(fw / 2 - cx), fh - q.height))
        frames.append(f)
    return frames


def strip(frames):
    w, h = frames[0].size
    s = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.alpha_composite(f, (i * w, 0))
    return s


def main():
    os.makedirs(OUT, exist_ok=True)
    man = {'note': 'Generated by tools/build-production-art.py', 'sprites': {}, 'bg': {}, 'anims': {}, 'points': {}}

    # Backgrounds: far layers. Lighter treatment than the old scenes, which had
    # characters and walkways baked in.
    for z in ['upper', 'lower', 'underbelly', 'caverns', 'depths']:
        im = Image.open(os.path.join(SRC, f'background/{z}-study.png')).convert('RGB')
        im = im.resize((round(im.width * 600 / im.height), 600), Image.LANCZOS)
        im = im.filter(ImageFilter.GaussianBlur(1.0))
        im = ImageEnhance.Brightness(im).enhance(0.78)
        p = os.path.join(OUT, f'bg_{z}.jpg')
        im.save(p, quality=84, optimize=True)
        man['bg'][f'pp_{z}'] = {'src': p, 'w': im.width, 'h': im.height}

    # Pickups (row 1: medkit, coil, fuel; row 2: cell, disc, camo, overdrive)
    sheet = clean(rgba('objects/pickups-study.png'))
    names = ['medkit', 'ammo_coil', 'ammo_fuel', 'ammo_cell', 'ammo_disc', 'camo', 'overdrive']
    boxes = components(sheet)
    assert len(boxes) == 7, f'pickups: expected 7 parts, found {len(boxes)}'
    for n, b in zip(names, boxes):
        save(fit(tight(sheet.crop(b)), (26, 22)), 'pickup_' + n, man)

    # Checkpoint console, plus where its screen is (for the active tint)
    cp = tight(clean(rgba('objects/checkpoint-study.png')))
    arr = np.array(cp)
    amber = (arr[:, :, 0] > 200) & (arr[:, :, 1] > 120) & (arr[:, :, 2] < 90) & (arr[:, :, 3] > 0)
    rows = np.where(amber.sum(1) > amber.shape[1] * 0.25)[0]
    cols = np.where(amber[rows.min():rows.max() + 1].sum(0) > (rows.max() - rows.min()) * 0.5)[0]
    small = save(fit(cp, (32, 48)), 'checkpoint', man)
    sx, sy = small.width / cp.width, small.height / cp.height
    man['points']['checkpoint_screen'] = [round(cols.min() * sx), round(rows.min() * sy), round((cols.max() - cols.min()) * sx), round((rows.max() - rows.min()) * sy)]

    # Exit lift (doors and deck), 160 px wide like the gameplay area
    lift = save(shrink(tight(clean(rgba('objects/exit-lift-study.png'))), w=168), 'exit_lift', man)
    a = np.array(lift)
    red = (a[:, :, 0] > 170) & (a[:, :, 1] < 90) & (a[:, :, 2] < 90) & (a[:, :, 3] > 0)
    red[lift.height // 3:] = False  # only the lamp above the doors
    ys, xs = np.where(red)
    man['points']['lift_light'] = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)] if len(xs) else None

    # Breakable block: four damage states, each squared to one 32 px tile
    br = clean(rgba('objects/breakable-study.png'))
    boxes = components(br)
    assert len(boxes) == 4, f'breakable: expected 4 parts, found {len(boxes)}'
    for i, b in enumerate(boxes):
        part = tight(br.crop(b))
        save(shrink(part, w=32, h=32), f'breakable_{i}', man)

    # Projectiles (row order on the sheet): pulse bolt, coil slug, enemy bolt,
    # heavy bolt (unused), acid glob, mortar shell, disc charge
    pr = clean(rgba('effects/projectiles-study.png'), erode=0)
    boxes = components(pr, dilate=4)
    names = ['pulse', 'coil', 'ebolt', 'heavy', 'acid', 'mortar', 'disc']
    widths = {'pulse': 26, 'coil': 46, 'ebolt': 28, 'heavy': 30, 'acid': 36, 'mortar': 50, 'disc': 30}
    assert len(boxes) == 7, f'projectiles: expected 7 parts, found {len(boxes)}'
    for n, b in zip(names, boxes):
        save(shrink(tight(pr.crop(b)), w=widths[n]), 'proj_' + n, man)

    # Mech walk cycle, regular and boss size (current sprites are 132 and 264 px tall)
    for name, h in (('mech', 132), ('mech_boss', 264)):
        fr = frames_from_strip('animation/mech-walk-study.png', 8, h, anchor_top=0.45)
        s = save(strip(fr), f'anim_{name}_walk', man)
        man['anims'][f'{name}_walk'] = {'sprite': f'anim_{name}_walk', 'frames': 8, 'w': fr[0].width, 'h': fr[0].height, 'fps': 8 if name == 'mech' else 7, 'facing': 1}

    # Hunter run legs, scaled so belt-top-to-feet matches the current legs image
    legs_h = HUNTER['frameH'] - 33  # the current lower body starts about 33 px down the frame
    fr = frames_from_strip('animation/hunter-run-study.png', 8, legs_h, anchor_top=0.25)
    for tag, hue in (('p1', None), ('p2', 0.52)):
        fs = [recolor(f.copy(), hue) if hue else f for f in fr]
        save(strip(fs), f'anim_hunter_{tag}_run', man)
    man['anims']['hunter_run'] = {'frames': 8, 'w': fr[0].width, 'h': fr[0].height, 'fps': 16}

    with open(os.path.join(OUT, 'production.json'), 'w') as f:
        json.dump(man, f, indent=1)
    for k, v in man['sprites'].items():
        print(f'{k:24s} {v["w"]}x{v["h"]}')
    print('points', man['points'])


if __name__ == '__main__':
    main()
