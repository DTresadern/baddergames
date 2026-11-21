// Picks the loader for a map file: cells maps (kind "cells") or the character grid.
// Both return { name, tileSize, atlas, tiles, rows, spawns, player, platforms, transfers }: `atlas`
// the name of the block atlas the level is drawn with (a cells map's optional field; null when
// absent, always null for a grid map), `tiles` the play plane's (z = 0) tile map, `rows` a Map
// z -> tile map (a grid map has row 0 only) and `transfers` the places a player can switch rows
// (world/rows.js; [] for a grid map). Cells maps also return `cells` (off the play plane, for
// drawing).

import { loadCellMap } from './cell-map.js';
import { loadGridMap } from './grid-map.js';

export function loadMap(json) {
  return json?.kind === 'cells' ? loadCellMap(json) : loadGridMap(json);
}
