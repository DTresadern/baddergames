// Block decor for the Sandbox: which atlas tile each block face shows. Pure, no three.js: a fixed
// rule from the block's neighbours (in its own row) and a fixed hash of its cell position, so the
// result is the same on every load and machine, nothing is stored per cell in the map and nothing
// is sent over the network. scenes/atlas-material.js draws the chosen tiles.
//
// Tiles come from a block atlas index (for example blocks-placeholder.json): a grid of `tileSize`
// squares, each tile with a `kind` and `tiles` (the axes it repeats along: x, y, xy or none).

import { hashInt } from './sandbox-3d.js';

export const DECOR = Object.freeze({
  bandLength: 6, // a band (pipe, rail, truss) runs over the cells of one row in a band of this many columns
  bandOdds: 7, // 1 in this many bands shows one
  patchWidth: 4, // wall patch columns: one panel (or window) over a patch, so seams read as one wall
  patchHeight: 3, // wall patch rows
  windowOddsBehind: 4, // 1 in this many patches is windows, behind the play plane (z < 0)
  windowOdds: 12, // 1 in this many patches is windows, on and in front of the play plane
  featurePercent: 8, // percent of the remaining wall cells that show a feature (vent, fan, sign, ...)
});

// Hash salts, one per decision, so the decisions do not line up.
const SALT = Object.freeze({ crate: 1, band: 2, bandTile: 3, window: 4, feature: 5, featureTile: 6, panel: 7 });

// The atlas grid from its index: { columns, rows, tileSize, tiles: [{ name, index, kind, tiles }] }
// in the index's order. `index` = row * columns + column, row 0 the top row of the image. Throws on
// a tile that is not one grid square.
export function atlasLayout(index) {
  const { columns, rows, tileSize } = index;
  const tiles = Object.entries(index.tiles).map(([name, t]) => {
    const col = t.x / tileSize;
    const row = t.y / tileSize;
    const onGrid = Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < columns && row >= 0 && row < rows && t.w === tileSize && t.h === tileSize;
    if (!onGrid) throw new Error(`block atlas: tile '${name}' (${t.x}, ${t.y}, ${t.w} x ${t.h}) is not on the ${columns} x ${rows} grid of ${tileSize} px`);
    return { name, index: row * columns + col, kind: t.kind, tiles: t.tiles };
  });
  return { columns, rows, tileSize, tiles };
}

// The tile pools the rule picks from, by kind and repeat axes. pipe-elbow and pipe-v (pipe tiles
// that do not run along x) are in no pool for now.
const POOLS = Object.freeze({
  panel: (t) => t.kind === 'panel' && t.tiles === 'xy', // plain wall
  floorTop: (t) => t.kind === 'floor' && t.tiles === 'xy', // the top face of a walkable surface
  walkway: (t) => t.kind === 'floor' && t.tiles === 'x', // the front of a walkable surface
  edge: (t) => t.kind === 'stripe' && t.tiles === 'x', // the front of a surface at a drop
  stripe: (t) => t.kind === 'stripe' && t.tiles === 'xy', // the top of a surface at a drop
  band: (t) => (t.kind === 'pipe' || t.kind === 'girder') && t.tiles === 'x', // horizontal runs in a wall
  span: (t) => t.kind === 'girder' && t.tiles === 'x', // a block open below between two blocks
  window: (t) => t.kind === 'window',
  crate: (t) => t.kind === 'crate', // a lone block standing on a surface
  // One-off wall pieces: anything that does not tile (except crates and pipes), slot vents, braces.
  feature: (t) => (t.tiles === 'none' && t.kind !== 'crate' && t.kind !== 'pipe') || (t.kind === 'vent' && t.tiles === 'x') || (t.kind === 'girder' && t.tiles === 'xy'),
});

// { panel, floorTop, ... }: atlas tile indices per pool, sorted by index (so the picks are
// deterministic). Throws naming a pool that has no tile in this atlas.
export function atlasPools(layout) {
  const pools = {};
  for (const [name, test] of Object.entries(POOLS)) {
    pools[name] = Object.freeze(layout.tiles.filter(test).map((t) => t.index).sort((a, b) => a - b));
    if (pools[name].length === 0) throw new Error(`block atlas: no tile for pool '${name}'`);
  }
  return Object.freeze(pools);
}

// Deterministic unsigned 32-bit hash of three integers and a salt.
export function hash3(a, b, c, salt) {
  return hashInt(a ^ hashInt(b ^ hashInt(c ^ hashInt(salt)))) >>> 0;
}

export const pick = (pool, h) => pool[h % pool.length];

// [side, top, front]: the atlas tile indices for the solid cell (x, y, z). `solid(x, y, z)` is true
// for a solid cell in any row; neighbours are looked up in the cell's own row (z). The faces the
// camera never sees reuse them in the shader: bottom shows the side tile, back the front tile.
// Front face (+z), first match wins:
//   1. crate: open above, open left and right, solid below
//   2. surface (open above): `edge` at a drop (open left or right), else `walkway`
//   3. span: open below, solid left and right
//   4. band: one in DECOR.bandOdds runs of DECOR.bandLength columns in a row shows a band tile
//   5. window: one in windowOddsBehind (z < 0) or windowOdds wall patches
//   6. feature: featurePercent of the rest
//   7. panel: one panel per wall patch
// Top face (+y): open above: `stripe` at a drop, else `floorTop`; covered (hidden): the front tile.
// Side faces (±x): a surface cell keeps its front tile (the walkway or edge runs round the corner);
// any other cell shows its patch panel.
export function blockTiles(solid, x, y, z, pools) {
  const openAbove = !solid(x, y + 1, z);
  const openBelow = !solid(x, y - 1, z);
  const left = solid(x - 1, y, z);
  const right = solid(x + 1, y, z);
  const drop = !left || !right;
  const px = Math.floor(x / DECOR.patchWidth);
  const py = Math.floor(y / DECOR.patchHeight);
  const panel = pick(pools.panel, hash3(px, py, z, SALT.panel));
  let front;
  if (openAbove && !left && !right && !openBelow) front = pick(pools.crate, hash3(x, y, z, SALT.crate));
  else if (openAbove) front = drop ? pools.edge[0] : pools.walkway[0];
  else if (openBelow && left && right) front = pools.span[0];
  else {
    const band = Math.floor(x / DECOR.bandLength);
    const windowOdds = z < 0 ? DECOR.windowOddsBehind : DECOR.windowOdds;
    if (hash3(band, y, z, SALT.band) % DECOR.bandOdds === 0) front = pick(pools.band, hash3(band, y, z, SALT.bandTile));
    else if (hash3(px, py, z, SALT.window) % windowOdds === 0) front = pick(pools.window, hash3(px, py, z, SALT.window));
    else if (hash3(x, y, z, SALT.feature) % 100 < DECOR.featurePercent) front = pick(pools.feature, hash3(x, y, z, SALT.featureTile));
    else front = panel;
  }
  const top = openAbove ? (drop ? pools.stripe[0] : pools.floorTop[0]) : front;
  const side = openAbove ? front : panel;
  return [side, top, front];
}

// Per-instance atlas tiles for a list of cells ([x, y, z] each), in order: 3 floats per cell,
// [side, top, front], as the scene's `atlasTile` attribute wants them.
export function decorTiles(positions, solid, pools) {
  const out = new Float32Array(positions.length * 3);
  positions.forEach(([x, y, z = 0], i) => out.set(blockTiles(solid, x, y, z, pools), i * 3));
  return out;
}
