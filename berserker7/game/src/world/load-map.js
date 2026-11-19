// Picks the loader for a map file: cells maps (kind "cells") or the character grid.
// Both return { name, tileSize, tiles, spawns }; cells maps also return `cells` (off the play plane).

import { loadCellMap } from './cell-map.js';
import { loadGridMap } from './grid-map.js';

export function loadMap(json) {
  return json?.kind === 'cells' ? loadCellMap(json) : loadGridMap(json);
}
