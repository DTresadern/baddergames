import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadGridMap } from '../src/world/grid-map.js';
import { PLAYER_SIZE } from '../src/world/player.js';

const small = (extra = {}) => ({
  format: 1,
  name: 'small',
  tileSize: 16,
  legend: { '#': { type: 'solid', color: '#111' }, o: { type: 'decor', color: '#222' } },
  grid: ['..o', '#..', '##.'],
  spawns: [{ type: 'player', x: 1, y: 1 }],
  ...extra,
});

test('grid map: the last row is y = 0 and the column is x', () => {
  const { tiles } = loadGridMap(small());
  assert.equal(tiles.tileAt(0, 0), 1);
  assert.equal(tiles.tileAt(1, 0), 1);
  assert.equal(tiles.tileAt(2, 0), 0);
  assert.equal(tiles.tileAt(0, 1), 1);
  assert.equal(tiles.tileAt(1, 1), 0);
  assert.equal(tiles.tileAt(2, 2), 2);
  assert.equal(tiles.tileAt(0, 2), 0);
});

test('grid map: legend ids start at 1 in legend order; unknown characters are empty', () => {
  const { tiles } = loadGridMap(small({ grid: ['#o?'] }));
  assert.deepEqual(tiles.types, [{ solid: false }, { solid: true, color: '#111' }, { solid: false, color: '#222' }]);
  assert.deepEqual([tiles.tileAt(0, 0), tiles.tileAt(1, 0), tiles.tileAt(2, 0)], [1, 2, 0]);
});

test('grid map: name, tile size and spawns are passed through; atlas and lighting are null', () => {
  const map = loadGridMap(small());
  assert.equal(map.name, 'small');
  assert.equal(map.tileSize, 16);
  assert.deepEqual(map.spawns, [{ type: 'player', x: 1, y: 1 }]);
  assert.equal(map.atlas, null, 'grid maps have no block atlas');
  assert.equal(loadGridMap(small({ atlas: 'blocks-placeholder' })).atlas, null, 'the field is not read');
  assert.equal(map.lighting, null, 'grid maps have no lighting');
  assert.equal(loadGridMap(small({ lighting: { ambient: [1, 1, 1] } })).lighting, null, 'the field is not read');
});

test('grid map: an unknown format throws', () => {
  assert.throws(() => loadGridMap(small({ format: 2 })), /unsupported format 2/);
  assert.throws(() => loadGridMap({ ...small(), format: undefined }), /unsupported format/);
  assert.throws(() => loadGridMap(null), /unsupported format/);
});

for (const file of ['walkway.json', 'mvp-upper-1.json']) {
  test(`${file}: the spawn and the space above it are empty and the floor below is solid`, () => {
    const json = JSON.parse(readFileSync(new URL(`../public/content/maps/${file}`, import.meta.url), 'utf8'));
    const { tiles, spawns, name } = loadGridMap(json);
    assert.equal(name + '.json', file);
    const spawn = spawns.find((s) => s.type === 'player');
    assert.ok(spawn);
    for (let dy = 0; dy < PLAYER_SIZE.height; dy++) assert.equal(tiles.isSolid(spawn.x, spawn.y + dy), false, `tile above spawn +${dy}`);
    assert.equal(tiles.isSolid(spawn.x, spawn.y - 1), true, 'floor below the spawn');
    assert.equal(tiles.isSolid(0, 0), true);
  });
}
