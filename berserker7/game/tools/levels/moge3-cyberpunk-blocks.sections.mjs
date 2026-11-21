// Authored extension of the moge3-cyberpunk-blocks test level: the sections to the right of the
// generated blockout (tools/moge3-cyberpunk-blocks.base.json), as data. tools/build-level.mjs adds
// them to the base and writes public/content/maps/moge3-cyberpunk-blocks.json (npm run build:level).
//
// Coordinates: one cell = one tile, [x, y, z]; the cell fills x..x+1, y..y+1. y up, z towards the
// camera; z = 0 is the play plane (collides), other z are drawn only. A floor with its top at y = t
// is a row of cells at y = t - 1.
// Player box 0.55 x 1.2 (crouch 0.6); jump peak about 2.5 tiles; at full speed a jump clears about
// 4 tiles of gap at the same height. Rules kept here: step-ups at most 2 tiles, gaps at the same
// height at most 3, standing headroom at least 2 (a crouch crawl has exactly 1), no cells at z > 0
// above walkway level (near-side cells would hide the player in 2.5D).
//
// Sections (x ranges, walkway tops):
//   A  11-24   outdoor walkway, top 0; deck supports, a 1-tile crate step, enemy at 22; also
//              two plasma pistol pickups at x 2 and 6 on the base walkway left of A (top 0,
//              between the player spawn at -4 and the first enemy), one per player
//   B  25-44   indoor station: ceiling at 3 (headroom 3), a crouch crawl at 34-37, enemy at 40
//   C  45-62   climb: lower walkway at 0, steps 2 and 4, a deck at 6 from 52 over the lower
//              walkway (a drop hole at 51); enemy on the deck at 60
//   D  63-84   gap at 6 crossed by the moving platform (63 to 76); pit at -3 below with a step
//              and slabs back up to the left side; landing ledge 79-84 at 6
//   E  80-104  the drop: from 6 down to the street at -2; an overhead bridge (underside 4) at
//              92-99; enemies at 95 and 100
//   F  105-121 underpass: street at -2, ceiling at 1 (headroom 3); the lift (top -2 to 6) in a
//              shaft at 114-118 is the only way up to the upper level at 6; enemy at 110
//   G  122-150 rooftop: 6, steps to 7 and 9, a 3-wide gap (2-deep pit) at 137-139, enemies at
//              135 and 145; the roof at 9 runs on through 150 into H (no end wall)
//   H  151-297 depth rows: a copy of the depth-rows-test layout (tools/levels/depth-rows-test.mjs)
//              moved by +151 in x and +9 in y (its floor top 0 is 9 here), without its start
//              wall; rows 0, +1 and -1, its nine transfer zones (TRANSFERS), end wall at 297;
//              enemies on row 0 at 201 and 249

import { depthRowsCells, depthRowsTransfers } from './depth-rows-test.mjs';

// Cells x0..x1, y0..y1 (inclusive) at depth z.
export function fill(x0, x1, y0, y1, z = 0) {
  const cells = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push([x, y, z]);
  return cells;
}

// fill() at each z of z0..z1.
export function slab(x0, x1, y0, y1, z0, z1) {
  const cells = [];
  for (let z = z0; z <= z1; z++) cells.push(...fill(x0, x1, y0, y1, z));
  return cells;
}

// A one-wide column at each x of `xs`, rows y0..y1, depth z.
export function columns(xs, y0, y1, z = 0) {
  return xs.flatMap((x) => fill(x, x, y0, y1, z));
}

// A building block behind the play plane: a body, then narrower tiers on top (each [inset, rows]),
// all at depth z.
export function building(x0, x1, y0, top, z, tiers = []) {
  const cells = fill(x0, x1, y0, top, z);
  let y = top + 1;
  for (const [inset, rows] of tiers) {
    cells.push(...fill(x0 + inset, x1 - inset, y, y + rows - 1, z));
    y += rows;
  }
  return cells;
}

const enemy = (x, y) => ({ type: 'enemy', x, y });
const pickup = (item, x, y) => ({ type: 'pickup', item, x, y });

export const SECTIONS = [
  {
    name: 'A outdoor walkway',
    x: [11, 24],
    cells: [
      ...slab(11, 24, -1, -1, -1, 0), // deck, top 0
      ...fill(11, 24, -2, -2, 1), // near-side rail under the deck
      ...columns([14, 20], -6, -2, 0), // deck supports
      ...columns([14, 20], -6, -3, 1),
      ...fill(18, 19, 0, 0, 0), // crate step, 1 tile
      ...building(12, 16, 0, 9, -3, [[1, 2], [2, 2]]),
      ...building(19, 23, 0, 6, -3, [[1, 1]]),
      ...fill(11, 24, 3, 3, -2), // pipe run
      ...fill(21, 23, 8, 9, -2), // signboard
    ],
    // The pickups lie left of A, on the base blockout's walkway (x -6 to 10, top 0).
    spawns: [pickup('plasmaPistol', 2, 0), pickup('plasmaPistol', 6, 0), enemy(22, 0)],
  },
  {
    name: 'B indoor station',
    x: [25, 44],
    cells: [
      ...slab(25, 44, -1, -1, -2, 0), // floor, top 0
      ...fill(25, 44, -2, -2, 1), // near-side rail under the floor
      ...slab(25, 44, 3, 3, -2, 0), // ceiling: headroom 3
      ...slab(34, 37, 1, 2, -1, 0), // crawl: ceiling down to 1, headroom 1 (crouch only)
      ...columns([25, 44], 4, 9, 0), // facade: entrance and exit walls from the ceiling up to 9
      ...fill(26, 43, 9, 9, 0), // roof edge
      ...fill(26, 43, 4, 8, -1), // recessed facade between them
      ...fill(25, 44, 0, 2, -2), // back wall
      ...columns([28, 32, 39, 43], 0, 2, -1), // pillars
      ...fill(30, 31, 0, 0, -1), // consoles
      ...fill(41, 42, 0, 0, -1),
    ],
    spawns: [enemy(40, 0)],
  },
  {
    name: 'C climb and stacked walkways',
    x: [45, 62],
    cells: [
      ...slab(45, 62, -1, -1, -1, 0), // lower walkway, top 0
      ...fill(45, 62, -2, -2, 1), // near-side rail under it
      ...fill(47, 48, 0, 1, 0), // step, top 2
      ...fill(49, 50, 0, 3, 0), // step, top 4 (x 51 open: a drop to the lower walkway)
      ...slab(52, 62, 5, 5, -1, 0), // upper walkway (deck), top 6, over the lower walkway
      ...columns([52, 57, 62], 0, 4, -1), // deck supports
      ...columns([52, 54, 56, 58, 60, 62], 6, 6, -1), // railing posts
      ...fill(52, 62, 7, 7, -1), // railing
      ...fill(62, 62, -4, -2, 0), // the pit's left wall
      ...building(45, 50, 0, 13, -3, [[1, 2]]),
      ...building(53, 61, 0, 16, -3, [[1, 2], [3, 2]]),
      ...fill(45, 50, 6, 6, -2), // balconies
      ...fill(53, 61, 10, 10, -2),
    ],
    spawns: [enemy(60, 6)],
  },
  {
    name: 'D platform gap and pit',
    x: [63, 84],
    cells: [
      ...slab(63, 78, -4, -4, -1, 0), // pit floor, top -3
      ...fill(70, 71, -3, -2, 0), // a step (top -1) and slabs (tops 1, 3, 5) back up to the left
      // side; x 69 stays open above the pit floor, so the step can be climbed from under the slabs
      ...fill(67, 68, 0, 0, 0),
      ...fill(65, 66, 2, 2, 0),
      ...fill(63, 64, 4, 4, 0),
      ...fill(79, 79, -4, 5, 0), // the pit's right wall
      ...slab(79, 84, 5, 5, -1, 0), // landing ledge, top 6
      ...fill(84, 84, -2, 4, -1), // ledge support
      ...fill(63, 78, 9, 9, -2), // gantry
      ...columns([63, 78], -4, 8, -2),
      ...fill(63, 78, -2, -2, -1), // pipe in the pit
    ],
    spawns: [],
  },
  {
    name: 'E drop and street',
    x: [80, 104],
    cells: [
      ...slab(80, 104, -3, -3, -1, 0), // street, top -2
      ...fill(80, 104, -3, -3, 1), // near-side kerb (below walkway level)
      ...slab(92, 99, 4, 4, -2, 0), // overhead bridge, underside 4
      ...columns([92, 99], -2, 3, -2), // bridge pylons (mid-ground)
      ...fill(80, 112, 10, 10, -3), // monorail
      ...columns([86, 106], -2, 9, -3),
      ...building(88, 91, -2, 7, -3, [[1, 2]]),
      ...building(100, 103, -2, 12, -3, [[1, 3]]),
      ...fill(101, 103, 6, 7, -2), // signboard
    ],
    spawns: [enemy(95, -2), enemy(100, -2)],
  },
  {
    name: 'F underpass and lift',
    x: [105, 121],
    cells: [
      ...fill(105, 114, -3, -3, 0), // street, top -2, with the lift pit at 115-117
      ...fill(118, 121, -3, -3, 0),
      ...fill(105, 121, -3, -3, -1),
      ...fill(105, 114, -3, -3, 1), // near-side kerb (below walkway level; not in front of the pit)
      ...fill(118, 121, -3, -3, 1),
      ...fill(115, 117, -5, -5, 0), // lift pit floor, top -4
      ...columns([114, 118], -5, -4, 0),
      ...fill(105, 113, 1, 5, 0), // ceiling block (headroom 3); its top is the upper level, 6
      ...fill(119, 121, 1, 5, 0), // (the shaft at 114-118 is open)
      ...fill(121, 121, -2, 0, 0), // end of the underpass
      ...fill(105, 121, 1, 1, -1), // ceiling depth
      ...fill(105, 121, -2, 5, -2), // back wall and shaft wall
      ...columns([108, 112, 120], -2, 0, -1), // pillars
    ],
    spawns: [enemy(110, -2)],
  },
  {
    name: 'G rooftop',
    x: [122, 150],
    cells: [
      ...fill(122, 127, 5, 5, 0), // roof, top 6
      ...fill(128, 132, 5, 6, 0), // step, top 7
      ...fill(133, 136, 5, 8, 0), // step, top 9
      ...fill(137, 139, 5, 6, 0), // gap: a pit 2 deep, top 7
      ...fill(140, 150, 5, 8, 0), // top 9, running on into H at 151
      ...fill(122, 149, 5, 5, -1),
      ...fill(122, 149, -3, -3, 0), // ground below (out of reach)
      ...columns([126, 138, 146], -2, 4, 0), // supports
      ...columns([126, 138, 146], -3, 4, 1),
      ...building(123, 129, 6, 14, -3, [[1, 2]]),
      ...building(131, 135, 9, 18, -3, [[1, 2]]),
      ...fill(133, 133, 21, 24, -3), // antenna
      ...building(141, 148, 9, 16, -3, [[2, 3]]),
      ...fill(142, 146, 13, 14, -2), // signboard
    ],
    spawns: [enemy(135, 9), enemy(145, 9)],
  },
  {
    name: 'H depth rows',
    x: [151, 297],
    cells: depthRowsCells({ dx: 151, dy: 9, startWall: false }),
    spawns: [enemy(201, 9), enemy(249, 9)], // depth-rows-test x 50 and 98, row 0
  },
];

// The block atlas the level is drawn with (map field `atlas`; manifest keys `atlas.<name>` and
// `atlas.<name>.index`). The Sandbox picks a tile per block face from it (scenes/block-decor.js).
export const ATLAS = 'blocks-placeholder';

// The level's lighting (map field `lighting`; the Sandbox applies it in the atlas shader, see
// scenes/level-lights.js and scenes/atlas-material.js). Measured from the scene mockup and its
// depth mesh (depth in blocks = 0.21 x metres). Colours are sRGB hex; lengths in tiles (blocks).
// - background: the scene background colour (replaces the clear colour for this map). Median
//   colour of the mockup pixels with no depth or deeper than 35 blocks.
// - ambient: light multiplier [r, g, b] on every level face no lamp reaches. Mean linear colour of
//   non-emissive mockup surfaces 3 to 6.5 blocks deep and more than 0.7 blocks from any light,
//   divided by (mean linear colour of the atlas wall panels x the front face shade 0.8). 0.17 to
//   0.23 depending on the distance kept from lights.
// - nearShade: brightness of cells in front of the player's row (z > row). Mean luminance of unlit
//   mockup surfaces nearer than 3 blocks / the same at 3 to 6.5 blocks (0.21; 0.27 with a 1-block
//   margin from lights).
// - fog: `color`; `density` k in the fog factor 1 - e^(-k d); `eye` the mockup camera's distance
//   from the play plane. In game d = eye + (player row depth - z): the distance from a virtual
//   camera `eye` tiles in front of the player's row, so the fog does not depend on zoom or FOV.
//   Fitted to the mean linear colour of non-emissive mockup pixels in 26 log-spaced depth bins (1.8
//   to 56 blocks) as surface x e^(-k d) + fog x (1 - e^(-k d)): RMS error 0.009 (linear) against
//   a spread of 0.021 (a linear near/far fit: 0.0096).
// - lights: per atlas tile name, `color`, `intensity` (multiplier added at the light's own face,
//   before falloff) and `radius` (where the light reaches 0). From the light pools below lamps,
//   signs and windows in the mockup (painted, so estimates): wall lamps add 1.0 to 3.0 times the
//   surface colour next to the lamp and fall to 0 within 0.55 to 0.96 blocks of its edge; signs
//   about 1.3 over at least 0.95 blocks; lit windows about 1.0 over at least 1.25 blocks beyond the
//   window. The game light sits on the tile centre, so radius = edge distance + 0.5 (windows: one
//   light per wall patch, centred on it, radius = 2 + 1.25), and intensity makes the light at the
//   tile edge (0.5) match the measured pool. lit-screen's spill could not be measured (mixed with
//   neon rim light): the sign values with the measured screen colour. warning-lamp has no source in
//   the mockup: the atlas tile colour with the wall-lamp values.
export const LIGHTING = {
  background: '#344a4c',
  ambient: [0.205, 0.218, 0.232],
  nearShade: 0.21,
  fog: { color: '#324f5c', density: 0.035, eye: 4.48 },
  lights: {
    'wall-light': { color: '#ffc144', intensity: 2.5, radius: 1.5 },
    'warning-lamp': { color: '#ff9d96', intensity: 2.5, radius: 1.5 },
    'lit-sign': { color: '#ffc862', intensity: 1.6, radius: 1.5 },
    'lit-screen': { color: '#ff28d7', intensity: 1.6, radius: 1.5 },
    'lit-window': { color: '#ffba35', intensity: 2.6, radius: 3.25 },
  },
};

// Transfer zones between depth rows (world/rows.js): section H's, the depth-rows-test zones at +151.
export const TRANSFERS = depthRowsTransfers(151);

// Moving platforms: { width, height, speed (tiles/s), mode, path: [[x, y], ...] } (bottom-left).
export const PLATFORMS = [
  // D: across the gap at top 6, from the left side (63) to the landing ledge (76 + 3 = 79).
  { width: 3, height: 0.5, speed: 3, mode: 'pingpong', path: [[63, 5.5], [76, 5.5]] },
  // F: the lift, top -2 (flush with the street) to top 6 (the upper level), in the shaft.
  { width: 3, height: 0.5, speed: 2, mode: 'pingpong', path: [[115, -2.5], [115, 5.5]] },
];
