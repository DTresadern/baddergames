// Loader for cells maps ({ kind: "cells" }): a list of [x, y, z] tile cells in 3D, written by
// tools/moge_blockout.py. One world unit is one tile; x right, y up, z towards the camera.
// Every cell goes into the tile map of its row (its z; see world/rows.js): `rows` is a Map
// z -> tile map, and `tiles` is the play plane's (z = 0), always present. A player collides with
// the row it is on. `cells` lists the cells off the play plane, for drawing.
// Optional `platforms` (moving platforms, see world/platform.js) are passed through; default [].
// Optional `transfers: [{ x0, x1, low, high }]` (where a player can switch rows, see
// world/rows.js) are checked and copied; default [].
// Optional `atlas`: the name of the block atlas the level is drawn with (manifest keys
// `atlas.<name>` and `atlas.<name>.index`; see scenes/block-decor.js); null when absent.
// Optional `lighting`: the level's measured lighting (background, ambient, nearShade, fog, lights;
// see scenes/level-lights.js), a deep copy; null when absent. Only checked to be a plain object.

import { copyPlatforms } from './platform.js';
import { playerSize } from './player.js';
import { createTileMap } from './tilemap.js';

// Checked copies of a map's transfer zones: x0 <= x1 whole tiles (inclusive columns); low and high
// adjacent integer rows (low: the row whose floor is lower there).
function copyTransfers(list = []) {
  return list.map((t, i) => {
    const { x0, x1, low, high } = t ?? {};
    if (![x0, x1, low, high].every(Number.isInteger)) throw new Error(`cell map: transfer ${i}: x0, x1, low and high must be integers`);
    if (x1 < x0) throw new Error(`cell map: transfer ${i}: x1 ${x1} is left of x0 ${x0}`);
    if (Math.abs(low - high) !== 1) throw new Error(`cell map: transfer ${i}: rows ${low} and ${high} are not adjacent`);
    return { x0, x1, low, high };
  });
}

// The map's atlas name, or null when the field is absent.
function atlasName(atlas) {
  if (atlas === undefined) return null;
  if (typeof atlas !== 'string' || atlas === '') throw new Error(`cell map: atlas must be a non-empty string, not ${JSON.stringify(atlas)}`);
  return atlas;
}

// A deep copy of the map's lighting, or null when the field is absent.
function lightingCopy(lighting) {
  if (lighting === undefined) return null;
  if (lighting === null || typeof lighting !== 'object' || Array.isArray(lighting)) throw new Error(`cell map: lighting must be an object, not ${JSON.stringify(lighting)}`);
  return structuredClone(lighting);
}

export function loadCellMap(json) {
  if (json?.format !== 1 || json.kind !== 'cells') throw new Error(`cell map: unsupported format ${json?.format} / kind ${json?.kind}`);
  const { type, color } = json.tile;
  const types = [{ solid: false }, { solid: type === 'solid', color }];
  const rows = new Map([[0, createTileMap({ types })]]); // z -> tile map; one types table for all rows
  const cells = []; // [{ x, y, z, id }] off the play plane, for drawing
  for (const [x, y, z] of json.cells) {
    if (!rows.has(z)) rows.set(z, createTileMap({ types }));
    rows.get(z).setTile(x, y, 1);
    if (z !== 0) cells.push({ x, y, z, id: 1 });
  }
  const transfers = copyTransfers(json.transfers);
  return { name: json.name, tileSize: json.tileSize, atlas: atlasName(json.atlas), lighting: lightingCopy(json.lighting), tiles: rows.get(0), rows, spawns: json.spawns.map((s) => ({ ...s })), cells, player: playerSize(json.player), platforms: copyPlatforms(json.platforms), transfers };
}
