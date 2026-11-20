// Background city blocks for the Sandbox's 2.5D view: three rows of box buildings at increasing
// depth behind the play plane. They test how much parallax the perspective camera gives for free:
// there is no scrolling code and no layer speed. Visual only (no collision), never in 2D.
// Each building is a few boxes: a body, sometimes 2-3 narrower tiers on top, a thin antenna, a
// signboard (a thin box in front of the face, in a neon colour); some neighbours are joined by a
// skyway, and now and then a much wider gap opens up.
// Deterministic: a fixed seed per layer, so the layout is the same on every load.

import { Color, InstancedMesh, Matrix4 } from 'three';

// Level cube colour and the renderer's clear colour (main.js), for the colour ramp.
const LEVEL_COLOR = '#6b7a8f';
const BACKGROUND_COLOR = '#1b1f2a';

// Signboard colours before the layer's fade.
export const NEON_COLORS = Object.freeze(['#ff2bd6', '#2bf0ff', '#ffd02b', '#7dff4a', '#ff5a2b']);

// Per layer: z (tiles, centre of the row), depth (box thickness in z), building width and height
// ranges (tiles; height above the walkway level y = 0), gap range between buildings (tiles),
// `wideGap` [chance, [min, max]] (a much wider gap instead), `fade` (0 = level colour, 1 =
// background colour) and a seed. Details: `tiers` [chance, [min, max] tier height] (2-3 narrower
// tiers on top), `antenna` [chance, [min, max] height, thickness], `sign` chance, `bridge`
// [chance, longest gap bridged, thickness] (a skyway to the next building).
export const CITY_LAYERS = Object.freeze(
  [
    { z: -15, depth: 4, width: [3, 7], height: [6, 16], gap: [6, 14], wideGap: [0, [0, 0]], fade: 0.35, seed: 1,
      tiers: [0.5, [1, 3]], antenna: [0.3, [2, 5], 0.3], sign: 0.45, bridge: [0.3, 10, 1] },
    { z: -40, depth: 6, width: [3, 8], height: [10, 30], gap: [2, 6], wideGap: [0.12, [8, 14]], fade: 0.6, seed: 2,
      tiers: [0.6, [2, 5]], antenna: [0.35, [3, 8], 0.5], sign: 0.35, bridge: [0.3, 8, 1.5] },
    { z: -90, depth: 10, width: [3, 9], height: [18, 55], gap: [0, 2], wideGap: [0.18, [6, 14]], fade: 0.82, seed: 3,
      tiers: [0.6, [3, 8]], antenna: [0.4, [5, 12], 0.8], sign: 0.25, bridge: [0.2, 6, 2] },
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

// The buildings of one layer covering x from `left` to `right`: [{ x, width, height, tiers,
// antenna, sign }] (x the left edge, whole tiles; `height` the body's top). `tiers` are
// [{ x, width, height }] stacked on the body, each narrower; `antenna` is null or { x, height }
// (on the top box); `sign` is null or { x, y, width, height, color }. Same layer and range, same
// buildings.
export function layerBuildings(layer, left, right) {
  const next = random(layer.seed);
  const gap = () => (next() < layer.wideGap[0] ? between(next, layer.wideGap[1]) : between(next, layer.gap));
  const buildings = [];
  let x = Math.floor(left) - gap();
  while (x < right) {
    const width = between(next, layer.width);
    const height = between(next, layer.height);
    const building = { x, width, height, tiers: [], antenna: null, sign: null };
    // Stepped top: 2 or 3 tiers, each inset 1 or more on both sides.
    if (next() < layer.tiers[0]) {
      let inset = 0;
      const count = 2 + Math.floor(next() * 2);
      for (let i = 0; i < count; i++) {
        inset += 1 + Math.floor(next() * Math.max(1, width / 6));
        if (width - 2 * inset < 1) break;
        building.tiers.push({ x: x + inset, width: width - 2 * inset, height: between(next, layer.tiers[1]) });
      }
    }
    const top = building.tiers.reduce((sum, t) => sum + t.height, height);
    const topBox = building.tiers.at(-1) ?? building;
    if (next() < layer.antenna[0]) building.antenna = { x: topBox.x + topBox.width * (0.25 + next() * 0.5), y: top, height: between(next, layer.antenna[1]) };
    if (next() < layer.sign) {
      const vertical = next() < 0.5;
      const w = vertical ? 1 : Math.min(width - 1, 2 + Math.floor(next() * 3));
      const h = vertical ? 3 + Math.floor(next() * 4) : 1 + Math.floor(next() * 2);
      if (w >= 1 && h < height - 2) {
        const color = mixHex(NEON_COLORS[Math.floor(next() * NEON_COLORS.length)], BACKGROUND_COLOR, layer.fade);
        building.sign = { x: x + Math.floor(next() * (width - w + 1)), y: height - h - 1 - Math.floor(next() * 4), width: w, height: h, color };
      }
    }
    buildings.push(building);
    x += width + gap();
  }
  return buildings;
}

// Every box of one layer, bottom at `bottom` (below the view): [{ x, y, width, height, depth, z,
// color }] (x, y the lower-left corner; z the box's centre). Bodies, tiers and antennas take the
// layer colour; signs sit just in front of the face; skyways join some neighbours (their own seed,
// so they never change the buildings).
export function layerParts(layer, buildings, bottom) {
  const parts = [];
  const box = (x, y, width, height, depth, z, color = layer.color) => parts.push({ x, y, width, height, depth, z, color });
  const front = layer.z + layer.depth / 2;
  for (const b of buildings) {
    box(b.x, bottom, b.width, b.height - bottom, layer.depth, layer.z);
    let y = b.height;
    for (const t of b.tiers) {
      box(t.x, y, t.width, t.height, layer.depth * 0.8, layer.z);
      y += t.height;
    }
    const thick = layer.antenna[2];
    if (b.antenna) box(b.antenna.x - thick / 2, b.antenna.y, thick, b.antenna.height, thick, layer.z);
    if (b.sign) box(b.sign.x, b.sign.y, b.sign.width, b.sign.height, 0.3, front + 0.15, b.sign.color);
  }
  const next = random(layer.seed + 1000);
  const [chance, longest, thickness] = layer.bridge;
  for (let i = 0; i + 1 < buildings.length; i++) {
    const a = buildings[i];
    const b = buildings[i + 1];
    const span = b.x - (a.x + a.width);
    if (span < 1 || span > longest || next() >= chance) continue;
    const y = Math.min(a.height, b.height) - 2 - Math.floor(next() * 5);
    box(a.x + a.width, y, span, thickness, layer.depth * 0.5, layer.z);
  }
  return parts;
}

// Half the width the perspective camera sees at `behind` tiles behind the play plane, for the
// widest normal view: `fovDegrees` vertical, `tilesHigh` on the play plane, `aspect` width / height.
export function halfWidthAt(behind, { fovDegrees, tilesHigh, aspect }) {
  const t = Math.tan((fovDegrees * Math.PI) / 360);
  const distance = tilesHigh / 2 / t;
  return (distance + behind) * t * aspect;
}

// One InstancedMesh per layer (unit cube `geometry` scaled per box), added to `scene`. The
// material is white (`makeMaterial('#ffffff')`) and every instance has its own colour
// (setColorAt). `bounds` is the level's { minX, maxX, minY } in tiles; `reach` is how far the
// camera can move past the level's ends (offset and aim follow), tiles; `view` is the widest normal
// view (halfWidthAt). Every building reaches down past the bottom of that view, so no lower edge
// shows.
export function addCityBackdrop(scene, { track, geometry, makeMaterial, bounds, reach, view }) {
  const meshes = [];
  const matrix = new Matrix4();
  const color = new Color();
  for (const layer of CITY_LAYERS) {
    const behind = -layer.z + layer.depth / 2;
    const half = halfWidthAt(behind, view);
    const halfHigh = half / view.aspect;
    const buildings = layerBuildings(layer, bounds.minX - reach - half, bounds.maxX + reach + half);
    const parts = layerParts(layer, buildings, bounds.minY - reach - halfHigh);
    const mesh = track(new InstancedMesh(geometry, track(makeMaterial('#ffffff')), parts.length));
    parts.forEach((p, i) => {
      matrix.makeScale(p.width, p.height, p.depth).setPosition(p.x + p.width / 2, p.y + p.height / 2, p.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
