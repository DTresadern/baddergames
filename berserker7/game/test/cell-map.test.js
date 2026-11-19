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
