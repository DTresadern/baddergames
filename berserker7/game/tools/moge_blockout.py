#!/usr/bin/env python3
"""Block out a MoGe-3 mesh (GLB, camera space) as Sandbox tile cells.

Experiment tool for the Sandbox. Reads a GLB written by MoGe-3 (vertex positions in camera space:
camera at the origin looking down -z, so depth d = -z; TEXCOORD_0 maps each vertex to its pixel in
the source image) and writes a Sandbox cells map (content/maps/*.json):

  1. Depth scale: each vertex moves along its ray to depth m * (d / m) ** s (m = median depth,
     s = --depth-scale, 0.5 by default), which tames near / far distortion.
  2. Level: rotate about x by the camera pitch, so the floor is horizontal.
  3. Keep the playfield: drop points deeper than --max-depth (far skyline, towers, sky) and
     points in --exclude image boxes (characters, creatures, drones, shots).
  4. Scale to tiles: the reference figure (--figure-box, points within --figure-depth-band of
     its median depth) is --figure-tiles tall, measured from the floor (--floor-box) to the
     figure's top. The play plane z = 0 is at the figure's depth; the floor top is a tile
     boundary (y = 0). x right, y up, z towards the camera.
  5. Voxelise: a 1 x 1 x 1 cell is solid when at least --min-points points fall in it (a surface
     shell, not filled). Cells at z = 0 are the collision layer in the game.

Needs Python 3 and numpy only. Image boxes are in source image pixels: x0,x1,y0,y1 (y down).
The defaults are the values used for the "moge3-cyberpunk" mockup.

Usage: moge_blockout.py MESH.glb --out public/content/maps/NAME.json [options]
"""

import argparse
import json
import struct

import numpy as np


def read_glb(path):
    """POSITION and TEXCOORD_0 of the first primitive, as float64 arrays."""
    with open(path, 'rb') as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67:  # 'glTF'
        raise SystemExit(f'{path}: not a GLB file')
    json_length, json_type = struct.unpack_from('<II', data, 12)
    if json_type != 0x4E4F534A:  # 'JSON'
        raise SystemExit(f'{path}: first chunk is not JSON')
    gltf = json.loads(data[20:20 + json_length])
    bin_offset = 20 + json_length + 8  # BIN chunk header is 8 bytes

    def accessor(index):
        a = gltf['accessors'][index]
        view = gltf['bufferViews'][a['bufferView']]
        size = {'VEC3': 3, 'VEC2': 2}[a['type']]
        if a['componentType'] != 5126:
            raise SystemExit(f'{path}: accessor {index} is not float32')
        offset = bin_offset + view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', 4 * size)
        if stride != 4 * size:
            raise SystemExit(f'{path}: interleaved buffer views are not supported')
        return np.frombuffer(data, np.float32, a['count'] * size, offset).reshape(a['count'], size).astype(np.float64)

    attributes = gltf['meshes'][0]['primitives'][0]['attributes']
    return accessor(attributes['POSITION']), accessor(attributes['TEXCOORD_0'])


def box_arg(text):
    values = [float(v) for v in text.split(',')]
    if len(values) != 4:
        raise argparse.ArgumentTypeError('a box is x0,x1,y0,y1')
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('glb', help='MoGe-3 mesh in camera space (.glb)')
    parser.add_argument('--out', required=True, help='map file to write (.json)')
    parser.add_argument('--name', default='moge3-cyberpunk', help='map name')
    parser.add_argument('--image-size', default='1920,819', help='source image width,height in px')
    parser.add_argument('--median-depth', type=float, default=25.27, help='median depth m, metres')
    parser.add_argument('--depth-scale', type=float, default=0.5, help='depth exponent s')
    parser.add_argument('--fov-y', type=float, default=36.7, help='vertical field of view, degrees (for the report)')
    parser.add_argument('--pitch', type=float, default=-8.7, help='camera pitch, degrees (negative = looking down)')
    parser.add_argument('--max-depth', type=float, default=32.0, help='drop points deeper than this (after depth scale), metres')
    parser.add_argument('--figure-box', type=box_arg, default=[520, 665, 350, 470], help='reference figure (the hunter)')
    parser.add_argument('--figure-depth-band', type=float, default=3.5, help='figure points within this many metres of its median depth')
    parser.add_argument('--figure-tiles', type=float, default=2.0, help='figure height in tiles')
    parser.add_argument('--floor-box', type=box_arg, default=[400, 1400, 470, 500], help='floor top surface the figure stands on')
    parser.add_argument(
        '--exclude',
        type=box_arg,
        action='append',
        help='image box to drop (repeatable); default: the cyberpunk characters, creatures, drones and shots',
    )
    parser.add_argument('--min-points', type=int, default=20, help='points needed for a solid cell')
    parser.add_argument('--color', default='#6b7a8f', help='cell colour')
    args = parser.parse_args()
    excludes = args.exclude or [
        # Characters stop above the walkway (y 466) so its far top surface, the play plane, stays.
        [510, 680, 340, 466],  # hunter
        [815, 965, 350, 466],  # second hunter
        [660, 710, 385, 410],  # muzzle flash
        [950, 1065, 395, 415],  # shot
        [1045, 1295, 390, 468],  # creature on the walkway
        [1205, 1475, 580, 712],  # creature below
        [785, 935, 200, 290],  # drone, left
        [1535, 1645, 265, 325],  # drone, right
        [1125, 1170, 328, 358],  # small drone
    ]
    width, height = (float(v) for v in args.image_size.split(','))

    positions, uv = read_glb(args.glb)
    px, py = uv[:, 0] * width, uv[:, 1] * height

    # 1. Depth scale along each ray.
    depth = -positions[:, 2]
    positions = positions * ((depth / args.median_depth) ** (args.depth_scale - 1))[:, None]
    # 2. Level: rotate about x by the pitch.
    t = np.radians(args.pitch)
    x = positions[:, 0]
    y = positions[:, 1] * np.cos(t) - positions[:, 2] * np.sin(t)
    z = positions[:, 1] * np.sin(t) + positions[:, 2] * np.cos(t)
    depth = -z

    def in_box(b):
        return (px >= b[0]) & (px < b[1]) & (py >= b[2]) & (py < b[3])

    # 4. Scale from the figure: its depth (the play plane) and its top above the floor.
    figure = in_box(args.figure_box) & (depth < args.max_depth)
    figure_depth = float(np.median(depth[figure]))
    figure = figure & (np.abs(depth - figure_depth) < args.figure_depth_band)
    figure_depth = float(np.median(depth[figure]))
    figure_top = float(np.percentile(y[figure], 99))
    floor = in_box(args.floor_box) & (np.abs(depth - figure_depth) < args.figure_depth_band)
    # The 98th percentile of the floor surface, so almost all floor points fall in the row below y = 0.
    floor_top = float(np.percentile(y[floor], 98))
    tiles_per_metre = args.figure_tiles / (figure_top - floor_top)
    image_tiles_high = 2 * figure_depth * np.tan(np.radians(args.fov_y / 2)) * tiles_per_metre

    # 3. Keep the playfield.
    keep = depth < args.max_depth
    for b in excludes:
        keep &= ~in_box(b)

    # 5. Voxelise.
    tx = x[keep] * tiles_per_metre
    ty = (y[keep] - floor_top) * tiles_per_metre
    tz = (z[keep] + figure_depth) * tiles_per_metre
    cells = np.stack([np.floor(tx), np.floor(ty), np.floor(tz + 0.5)], axis=1).astype(np.int64)
    unique, counts = np.unique(cells, axis=0, return_counts=True)
    solid = unique[counts >= args.min_points]
    solid = solid[np.lexsort((solid[:, 0], solid[:, 1], solid[:, 2]))]

    # Spawn: the figure's column, standing on the floor (y = 0).
    spawn_x = int(np.floor(np.median(x[figure]) * tiles_per_metre))
    report = {
        'points': int(len(depth)),
        'kept': int(keep.sum()),
        'figureDepthM': round(figure_depth, 2),
        'figureTopM': round(figure_top, 2),
        'floorTopM': round(floor_top, 2),
        'tilesPerMetre': round(float(tiles_per_metre), 4),
        'imageTilesHighAtPlayPlane': round(float(image_tiles_high), 2),
        'cells': int(len(solid)),
        'playPlaneCells': int((solid[:, 2] == 0).sum()),
        'bounds': {'min': solid.min(0).tolist(), 'max': solid.max(0).tolist()},
        'spawn': [spawn_x, 0],
    }
    out = {
        'format': 1,
        'kind': 'cells',
        'name': args.name,
        'tileSize': 64,
        'tile': {'type': 'solid', 'color': args.color},
        'source': {
            'tool': 'tools/moge_blockout.py',
            'depthScale': args.depth_scale,
            'medianDepthM': args.median_depth,
            'pitchDeg': args.pitch,
            'maxDepthM': args.max_depth,
            'minPoints': args.min_points,
            'tilesPerMetre': report['tilesPerMetre'],
            'playPlaneDepthM': report['figureDepthM'],
            'imageTilesHighAtPlayPlane': report['imageTilesHighAtPlayPlane'],
        },
        'spawns': [{'type': 'player', 'x': spawn_x, 'y': 0}],
        'cells': solid.tolist(),
    }
    with open(args.out, 'w') as f:
        f.write('{\n')
        for key in ('format', 'kind', 'name', 'tileSize', 'tile', 'source', 'spawns'):
            f.write(f'  {json.dumps(key)}: {json.dumps(out[key])},\n')
        f.write('  "cells": [\n')
        f.write(',\n'.join('    ' + json.dumps(c, separators=(',', ':')) for c in out['cells']))
        f.write('\n  ]\n}\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
