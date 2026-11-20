// Builds the depth-rows-test map (issue #98): a short level for trying depth rows and transfer
// zones (world/rows.js). Writes public/content/maps/depth-rows-test.json: one line per top-level
// field, one line per cell; cells deduplicated and sorted by z, then y, then x.
//
// Usage (from berserker7/game/): npm run build:depth-rows  (or: node tools/levels/depth-rows-test.mjs [--check])
// --check writes nothing and exits 1 when the committed map differs from the build output.
// No dependencies beyond Node.
//
// Coordinates as in moge3-cyberpunk-blocks.sections.mjs: [x, y, z], y up, z towards the camera; a
// floor with its top at y = t is a row of cells at y = t - 1. Rows: 0 (the play plane), +1 (front),
// -1 (back).
//
//   x       row 0                          row +1 (front)        row -1 (back)
//   -1      start wall y -1..6
//   0-12    floor top 0
//   5, 33                                  walls y -2..-1
//   6-32                                   floor top -2
//   13-26   tall wall y -1..5
//   27-69   floor top 0; crate x 45
//   34-61                                                        branch, top 2; pit 47-48 at top 0
//   62                                                           wall y -4..3
//   63-92                                                        low path, top -3
//   70      wall y -4..5
//   73-74, 78-79  pillars y -4..4
//   84      lip y 0..1
//   85-100  floor top 0
//   93                                                           wall y -3..0
//   101     end wall y 0..6
//
// Transfer zones (x0..x1, low, high):
//   A 8-11  +1 / 0   descend towards the camera (0 -> +1); back up possible
//   B 28-31 +1 / 0   ascend away from the camera (+1 -> 0)
//   C 35-37  0 / -1  ascend away (0 -> -1, onto the branch)
//   (38-56: rows 0 and -1 side by side, no zone)
//   D 57-60  0 / -1  descend towards the camera (-1 -> 0, rejoin)
//   E 64-67 -1 / 0   descend away (0 -> -1, the low back path, drop 3)
//   (70-84: the low path runs behind row 0's wall and pillars)
//   F 87-90 -1 / 0   ascend towards the camera (-1 -> 0, rise 3)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { columns, fill } from './moge3-cyberpunk-blocks.sections.mjs';

const OUT = new URL('../../public/content/maps/depth-rows-test.json', import.meta.url);

export const TRANSFERS = [
  { x0: 8, x1: 11, low: 1, high: 0 }, // A
  { x0: 28, x1: 31, low: 1, high: 0 }, // B
  { x0: 35, x1: 37, low: 0, high: -1 }, // C
  { x0: 57, x1: 60, low: 0, high: -1 }, // D
  { x0: 64, x1: 67, low: -1, high: 0 }, // E
  { x0: 87, x1: 90, low: -1, high: 0 }, // F
];

// Cells x0..x1 at one floor top `top` (one cell thick), depth z.
const floor = (x0, x1, top, z) => fill(x0, x1, top - 1, top - 1, z);

function cells() {
  const pit = new Set([47, 48]);
  const list = [
    // Row 0
    ...fill(-1, -1, -1, 6),
    ...floor(0, 12, 0, 0),
    ...fill(13, 26, -1, 5),
    ...floor(27, 69, 0, 0),
    [45, 0, 0],
    ...fill(70, 70, -4, 5),
    ...columns([73, 74, 78, 79], -4, 4),
    ...fill(84, 84, 0, 1),
    ...floor(85, 100, 0, 0),
    ...fill(101, 101, 0, 6),
    // Row +1 (front)
    ...columns([5, 33], -2, -1, 1),
    ...floor(6, 32, -2, 1),
    // Row -1 (back)
    ...fill(34, 61, -2, 1, -1).filter(([x, y]) => !(pit.has(x) && y > -1)),
    ...fill(62, 62, -4, 3, -1),
    ...floor(63, 92, -3, -1),
    ...fill(93, 93, -3, 0, -1),
  ];
  const seen = new Set();
  const out = [];
  for (const cell of list) {
    const key = cell.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cell);
  }
  return out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
}

// The map object.
export function buildDepthRowsTest() {
  return {
    format: 1,
    kind: 'cells',
    name: 'depth-rows-test',
    tileSize: 64,
    tile: { type: 'solid', color: '#6f7f99' },
    player: { width: 0.55, height: 1.2, crouchHeight: 0.6 },
    spawns: [{ type: 'player', x: 2, y: 0 }],
    transfers: TRANSFERS.map((t) => ({ ...t })),
    platforms: [],
    cells: cells(),
  };
}

// The file text: one line per top-level field, one line per cell.
export function depthRowsText(map = buildDepthRowsTest()) {
  const lines = ['{'];
  for (const [name, value] of Object.entries(map)) {
    if (name !== 'cells') lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
  }
  lines.push('  "cells": [');
  lines.push(map.cells.map((c) => `    ${JSON.stringify(c)}`).join(',\n'));
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = depthRowsText();
  if (process.argv.includes('--check')) {
    let same = false;
    try {
      same = readFileSync(OUT, 'utf8') === text;
    } catch {
      same = false;
    }
    console.log(same ? 'depth-rows-test: the committed map matches the build output' : 'depth-rows-test: the committed map differs; run npm run build:depth-rows');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  console.log(`depth-rows-test: wrote public/content/maps/depth-rows-test.json: ${JSON.parse(text).cells.length} cells, ${TRANSFERS.length} transfers`);
}
