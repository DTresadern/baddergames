// Loader for map files of format 1 (a character grid). This is the only code that knows the grid:
// everything else gets { name, tileSize, tiles, spawns, player }. A later file format needs only another
// loader that returns the same thing.
//
// File: { format: 1, name, tileSize, legend: { <char>: { type, color } }, grid: [string, ...], spawns: [...] }
//  - grid rows are written top to bottom; the last string is y = 0. The column index is x.
//  - a character not in the legend is an empty tile.
//  - optional `player: { width, height, crouchHeight }` (tiles) over the defaults in player.js (PLAYER_SIZE).
//  - spawns are { type, x, y } in tile coordinates with y up (as produced here), passed through.

import { playerSize } from './player.js';
import { createTileMap } from './tilemap.js';

export const GRID_FORMAT = 1;

export function loadGridMap(json) {
  if (json?.format !== GRID_FORMAT) throw new Error(`grid map: unsupported format ${JSON.stringify(json?.format)} (want ${GRID_FORMAT})`);
  const { name, tileSize, legend, grid, spawns } = json;
  if (!Array.isArray(grid) || grid.some((row) => typeof row !== 'string')) throw new Error('grid map: grid must be a list of strings');
  const types = [{ solid: false }];
  const idOf = new Map(); // legend character -> tile id, in legend order from 1
  for (const [char, entry] of Object.entries(legend ?? {})) {
    if (char.length !== 1) throw new Error(`grid map: legend key '${char}' is not one character`);
    idOf.set(char, types.length);
    types.push({ solid: entry.type === 'solid', color: entry.color });
  }
  const tiles = createTileMap({ types });
  const rows = grid.length;
  grid.forEach((row, index) => {
    const y = rows - 1 - index;
    for (let x = 0; x < row.length; x++) {
      const id = idOf.get(row[x]);
      if (id !== undefined) tiles.setTile(x, y, id);
    }
  });
  return { name, tileSize, tiles, spawns: (spawns ?? []).map((spawn) => ({ ...spawn })), player: playerSize(json.player) };
}
