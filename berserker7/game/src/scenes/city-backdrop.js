// Background city blocks for the Sandbox's 2.5D view: three rows of box buildings at increasing
// depth behind the play plane. They test how much parallax the perspective camera gives for free:
// there is no scrolling code and no layer speed. Visual only (no collision), never in 2D.
// Deterministic: a fixed seed per layer, so the layout is the same on every load.

import { Color, InstancedMesh, Matrix4 } from 'three';

// Level cube colour and the renderer's clear colour (main.js), for the colour ramp.
const LEVEL_COLOR = '#6b7a8f';
const BACKGROUND_COLOR = '#1b1f2a';

// Per layer: z (tiles, centre of the row), depth (box thickness in z), building width and height
// ranges (tiles; height above the walkway level y = 0), gap range between buildings (tiles),
// `fade` (0 = level colour, 1 = background colour) and a seed.
export const CITY_LAYERS = Object.freeze(
  [
    { z: -15, depth: 4, width: [3, 7], height: [6, 16], gap: [6, 14], fade: 0.35, seed: 1 },
    { z: -40, depth: 6, width: [3, 8], height: [10, 30], gap: [2, 6], fade: 0.6, seed: 2 },
    { z: -90, depth: 10, width: [3, 9], height: [18, 55], gap: [0, 2], fade: 0.82, seed: 3 },
  ].map((layer) => Object.freeze({ ...layer, color: mixHex(LEVEL_COLOR, BACKGROUND_COLOR, layer.fade) })),
);
// The far plane reaches this far behind the play plane while the backdrop is shown, tiles.
export const CITY_FAR = 100;

// sRGB hex string between `a` and `b` (t = 0: a, t = 1: b), mixed per channel.
export function mixHex(a, b, t) {
  const ca = new Color(a).getHex();
  const cb = new Color(b).getHex();
  const channel = (shift) => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

// Small seeded generator (mulberry32): numbers in [0, 1).
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (next, [lo, hi]) => lo + Math.floor(next() * (hi - lo + 1));

// The buildings of one layer covering x from `left` to `right`: [{ x, width, height }] (x the left
// edge, whole tiles). Same layer and range, same buildings.
export function layerBuildings(layer, left, right) {
  const next = random(layer.seed);
  const buildings = [];
  let x = Math.floor(left) - between(next, layer.gap);
  while (x < right) {
    const width = between(next, layer.width);
    buildings.push({ x, width, height: between(next, layer.height) });
    x += width + between(next, layer.gap);
  }
  return buildings;
}

// Half the width the perspective camera sees at `behind` tiles behind the play plane, for the
// widest normal view: `fovDegrees` vertical, `tilesHigh` on the play plane, `aspect` width / height.
export function halfWidthAt(behind, { fovDegrees, tilesHigh, aspect }) {
  const t = Math.tan((fovDegrees * Math.PI) / 360);
  const distance = tilesHigh / 2 / t;
  return (distance + behind) * t * aspect;
}

// One InstancedMesh per layer (unit cube `geometry` scaled per building), added to `scene`.
// `bounds` is the level's { minX, maxX, minY } in tiles; `reach` is how far the camera can move
// past the level's ends (offset and aim follow), tiles; `view` is the widest normal view
// (halfWidthAt). Every building reaches down past the bottom of that view, so no lower edge shows.
export function addCityBackdrop(scene, { track, geometry, makeMaterial, bounds, reach, view }) {
  const meshes = [];
  const matrix = new Matrix4();
  for (const layer of CITY_LAYERS) {
    const behind = -layer.z + layer.depth / 2;
    const half = halfWidthAt(behind, view);
    const halfHigh = half / view.aspect;
    const buildings = layerBuildings(layer, bounds.minX - reach - half, bounds.maxX + reach + half);
    const bottom = bounds.minY - reach - halfHigh;
    const mesh = track(new InstancedMesh(geometry, track(makeMaterial(layer.color)), buildings.length));
    buildings.forEach(({ x, width, height }, i) => {
      const tall = height - bottom;
      matrix.makeScale(width, tall, layer.depth).setPosition(x + width / 2, bottom + tall / 2, layer.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
