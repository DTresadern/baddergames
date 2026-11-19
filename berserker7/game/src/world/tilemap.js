// The tile map in memory: sparse chunks of tiles, plus a table of tile types.
// One world unit is one tile; x is right, y is up. This module knows nothing about map files
// (see grid-map.js for the loader of the character-grid format).

export const CHUNK_SIZE = 32;

// Non-negative remainder, so negative tile coordinates map into 0..CHUNK_SIZE-1.
const mod = (n) => ((n % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
const chunkKey = (cx, cy) => `${cx},${cy}`;

// `types` is indexed by tile id; id 0 is empty. Each entry is { solid, color } (color is for drawing).
export function createTileMap({ types }) {
  if (!Array.isArray(types) || types[0]?.solid !== false) throw new Error('tilemap: types[0] must be the empty tile { solid: false }');
  const chunkMap = new Map(); // "cx,cy" -> { cx, cy, tiles: Uint16Array(CHUNK_SIZE * CHUNK_SIZE) }

  const chunkAt = (x, y) => chunkMap.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)));
  const indexOf = (x, y) => mod(y) * CHUNK_SIZE + mod(x);

  return {
    types,
    chunkSize: CHUNK_SIZE,
    // Creates the chunk when needed, except for id 0 into a missing chunk (it is already empty).
    setTile(x, y, id) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`tilemap: tile coordinates must be integers, got ${x}, ${y}`);
      if (!Number.isInteger(id) || id < 0 || id >= types.length) throw new Error(`tilemap: unknown tile id ${id}`);
      let chunk = chunkAt(x, y);
      if (!chunk) {
        if (id === 0) return;
        const cx = Math.floor(x / CHUNK_SIZE);
        const cy = Math.floor(y / CHUNK_SIZE);
        chunk = { cx, cy, tiles: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE) };
        chunkMap.set(chunkKey(cx, cy), chunk);
      }
      chunk.tiles[indexOf(x, y)] = id;
    },
    // Never creates a chunk: a missing one reads as empty.
    tileAt(x, y) {
      const chunk = chunkAt(x, y);
      return chunk ? chunk.tiles[indexOf(x, y)] : 0;
    },
    isSolid(x, y) {
      return types[this.tileAt(x, y)]?.solid === true;
    },
    // The chunks that exist: { cx, cy, tiles }. Tile (lx, ly) in a chunk is at world (cx * chunkSize + lx, cy * chunkSize + ly), index ly * chunkSize + lx.
    chunks() {
      return chunkMap.values();
    },
  };
}
