// Loader for cells maps ({ kind: "cells" }): a list of [x, y, z] tile cells in 3D, written by
// tools/moge_blockout.py. One world unit is one tile; x right, y up, z towards the camera.
// Cells at z = 0 (the play plane) go into the tile map and collide; the others are visual only.
// Optional `platforms` (moving platforms, see world/platform.js) are passed through; default [].

import { copyPlatforms } from './platform.js';
import { playerSize } from './player.js';
import { createTileMap } from './tilemap.js';

export function loadCellMap(json) {
  if (json?.format !== 1 || json.kind !== 'cells') throw new Error(`cell map: unsupported format ${json?.format} / kind ${json?.kind}`);
  const { type, color } = json.tile;
  const tiles = createTileMap({ types: [{ solid: false }, { solid: type === 'solid', color }] });
  const cells = []; // [{ x, y, z, id }] off the play plane, for drawing
  for (const [x, y, z] of json.cells) {
    if (z === 0) tiles.setTile(x, y, 1);
    else cells.push({ x, y, z, id: 1 });
  }
  return { name: json.name, tileSize: json.tileSize, tiles, spawns: json.spawns.map((s) => ({ ...s })), cells, player: playerSize(json.player), platforms: copyPlatforms(json.platforms) };
}
