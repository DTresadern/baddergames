import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHUNK_SIZE, createTileMap } from '../src/world/tilemap.js';

const TYPES = [{ solid: false }, { solid: true, color: '#fff' }, { solid: false, color: '#0f0' }];
const keys = (map) => [...map.chunks()].map((c) => `${c.cx},${c.cy}`).sort();

test('tilemap: chunk size is 32 and exposed', () => {
  assert.equal(CHUNK_SIZE, 32);
  assert.equal(createTileMap({ types: TYPES }).chunkSize, 32);
});

test('tilemap: setTile and tileAt across a chunk edge', () => {
  const map = createTileMap({ types: TYPES });
  map.setTile(31, 31, 1);
  map.setTile(32, 31, 2);
  map.setTile(31, 32, 1);
  map.setTile(32, 32, 2);
  assert.deepEqual([map.tileAt(31, 31), map.tileAt(32, 31), map.tileAt(31, 32), map.tileAt(32, 32)], [1, 2, 1, 2]);
  assert.deepEqual(keys(map), ['0,0', '0,1', '1,0', '1,1']);
  assert.equal(map.tileAt(30, 31), 0);
  assert.equal(map.tileAt(33, 33), 0);
});

test('tilemap: negative coordinates', () => {
  const map = createTileMap({ types: TYPES });
  map.setTile(-1, -1, 1);
  map.setTile(-33, 0, 2);
  assert.equal(map.tileAt(-1, -1), 1);
  assert.equal(map.tileAt(-33, 0), 2);
  assert.equal(map.tileAt(0, 0), 0);
  assert.equal(map.tileAt(-2, -1), 0);
  assert.deepEqual(keys(map), ['-1,-1', '-2,0']);
});

test('tilemap: a missing chunk reads as empty and is not created; chunks() lists only created ones', () => {
  const map = createTileMap({ types: TYPES });
  assert.equal(map.tileAt(1000, -1000), 0);
  assert.equal(map.isSolid(1000, -1000), false);
  map.setTile(0, 0, 0); // clearing an empty chunk creates nothing
  assert.deepEqual(keys(map), []);
  map.setTile(5, 5, 1);
  assert.deepEqual(keys(map), ['0,0']);
  assert.equal(map.tileAt(-5, 70), 0);
  assert.deepEqual(keys(map), ['0,0']);
});

test('tilemap: isSolid follows the type table; setTile can clear a tile', () => {
  const map = createTileMap({ types: TYPES });
  map.setTile(3, 4, 1);
  map.setTile(4, 4, 2);
  assert.equal(map.isSolid(3, 4), true);
  assert.equal(map.isSolid(4, 4), false);
  map.setTile(3, 4, 0);
  assert.equal(map.isSolid(3, 4), false);
});

test('tilemap: bad input throws', () => {
  const map = createTileMap({ types: TYPES });
  assert.throws(() => map.setTile(0.5, 0, 1), /integers/);
  assert.throws(() => map.setTile(0, 0, 3), /unknown tile id/);
  assert.throws(() => createTileMap({ types: [{ solid: true }] }), /types\[0\]/);
});
