import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import { initSandbox, tickSandbox } from '../src/scenes/sandbox.js';
import { loadCellMap } from '../src/world/cell-map.js';
import { loadMap } from '../src/world/load-map.js';
import { PLAYER_SIZE } from '../src/world/player.js';

const small = {
  format: 1,
  kind: 'cells',
  name: 'small',
  tileSize: 64,
  tile: { type: 'solid', color: '#6b7a8f' },
  spawns: [{ type: 'player', x: 0, y: 0 }],
  cells: [[0, -1, 0], [1, -1, 0], [0, -1, 3], [-2, 5, -1]],
};

test('cell map: z = 0 cells collide, the others are visual only; loadMap picks the loader by kind', () => {
  const map = loadCellMap(small);
  assert.equal(map.tiles.isSolid(0, -1), true);
  assert.equal(map.tiles.isSolid(1, -1), true);
  assert.equal(map.tiles.isSolid(-2, 5), false);
  assert.deepEqual(map.cells.map(({ x, y, z }) => [x, y, z]), [[0, -1, 3], [-2, 5, -1]]);
  assert.equal(loadMap(small).cells.length, 2);
  assert.throws(() => loadCellMap({ ...small, format: 2 }), /unsupported/);
});

test('cell map: every cell goes into its row\'s tile map; transfers are checked and copied', () => {
  const map = loadCellMap({ ...small, transfers: [{ x0: 0, x1: 2, low: 1, high: 0 }] });
  assert.deepEqual([...map.rows.keys()].sort(), [-1, 0, 3]);
  assert.equal(map.rows.get(0), map.tiles);
  assert.equal(map.rows.get(3).isSolid(0, -1), true);
  assert.equal(map.rows.get(-1).isSolid(-2, 5), true);
  assert.equal(map.rows.get(-1).isSolid(0, -1), false);
  assert.deepEqual(map.transfers, [{ x0: 0, x1: 2, low: 1, high: 0 }]);
  assert.deepEqual(loadCellMap(small).transfers, []);
  assert.throws(() => loadCellMap({ ...small, transfers: [{ x0: 0, x1: 2, low: 2, high: 0 }] }), /not adjacent/);
  assert.throws(() => loadCellMap({ ...small, transfers: [{ x0: 3, x1: 2, low: 1, high: 0 }] }), /left of/);
  assert.throws(() => loadCellMap({ ...small, transfers: [{ x0: 0.5, x1: 2, low: 1, high: 0 }] }), /integers/);
});

test('cell map: atlas is the file\'s name, null when absent; a present non-string or empty value throws', () => {
  assert.equal(loadCellMap(small).atlas, null);
  assert.equal(loadCellMap({ ...small, atlas: 'blocks-placeholder' }).atlas, 'blocks-placeholder');
  for (const atlas of ['', 3, null, {}]) assert.throws(() => loadCellMap({ ...small, atlas }), /atlas must be a non-empty string/, JSON.stringify(atlas));
  const read = (file) => JSON.parse(readFileSync(new URL(`../public/content/maps/${file}`, import.meta.url), 'utf8'));
  assert.equal(loadMap(read('moge3-cyberpunk-blocks.json')).atlas, 'blocks-placeholder');
  assert.equal(loadMap(read('moge3-cyberpunk.json')).atlas, null);
  assert.equal(loadMap(read('depth-rows-test.json')).atlas, null);
});

test('moge3-cyberpunk.json: the spawn is on the walkway, and a fall goes back to the spawn', () => {
  const json = JSON.parse(readFileSync(new URL('../public/content/maps/moge3-cyberpunk.json', import.meta.url), 'utf8'));
  const map = loadMap(json);
  const spawn = map.spawns.find((s) => s.type === 'player');
  for (let dy = 0; dy < PLAYER_SIZE.height; dy++) assert.equal(map.tiles.isSolid(spawn.x, spawn.y + dy), false);
  assert.equal(map.tiles.isSolid(spawn.x, spawn.y - 1), true, 'walkway under the spawn');
  const state = initSandbox(map, 'map.moge3-cyberpunk');
  const actions = Object.fromEntries(ACTIONS.map((a) => [a, { held: false, pressed: false, released: false }]));
  for (let i = 0; i < 30; i++) tickSandbox(state, [{ player: 0, connected: true, actions }], 1 / 60, map.tiles);
  assert.equal(state.players[0].onGround, true);
  assert.equal(state.players[0].y, spawn.y);
  state.players[0].y = state.fallY - 1;
  tickSandbox(state, [], 1 / 60, map.tiles);
  assert.deepEqual([state.players[0].x, state.players[0].y], [state.spawn.x, state.spawn.y]);
});
