import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import { loadCellMap } from '../src/world/cell-map.js';
import { createPlayer } from '../src/world/player.js';
import { HOP_TICKS, PRESS_NONE, createRowScheme, findLanding, playerDepth, stepRowPlayer, zoneAt } from '../src/world/rows.js';

const STEP = 1 / 60;

// Row 0: floor top 0; row +1 (towards the camera): floor top -2; both x 0..19. One zone at x 5..8:
// descend 0 -> +1, ascend +1 -> 0.
const json = (extraCells = []) => ({
  format: 1,
  kind: 'cells',
  name: 'rows',
  tileSize: 64,
  tile: { type: 'solid', color: '#6f7f99' },
  player: { width: 0.55, height: 1.2, crouchHeight: 0.6 },
  spawns: [{ type: 'player', x: 6, y: 0 }],
  transfers: [{ x0: 5, x1: 8, low: 1, high: 0 }],
  cells: [...Array.from({ length: 20 }, (_, x) => [x, -1, 0]), ...Array.from({ length: 20 }, (_, x) => [x, -3, 1]), ...extraCells],
});
const map = loadCellMap(json());

// A frame with `pressed` actions (held and pressed) and `held` ones (held only), in `scheme`.
function f(pressed = [], held = [], scheme = 'A') {
  const actions = Object.fromEntries(ACTIONS.map((a) => [a, { held: false, pressed: false, released: false }]));
  for (const a of held) actions[a] = { held: true, pressed: false, released: false };
  for (const a of pressed) actions[a] = { held: true, pressed: true, released: false };
  return { player: 0, connected: true, actions, aim: 0, wheel: 0, pointer: null, activated: false, rowScheme: scheme };
}

const step = (player, frame, m = map) => stepRowPlayer(player, frame, m.rows, m.transfers, STEP);

// A player standing at x on `row` (floor top 0 on row 0, -2 on row 1).
function standing(x, row = 0, m = map) {
  const player = createPlayer(x, row === 0 ? 0 : -2, m.player);
  player.row = row;
  for (let i = 0; i < 5; i++) step(player, f(), m);
  assert.equal(player.onGround, true);
  return player;
}

// Runs `frame` for `n` ticks.
const run = (player, n, frame = f()) => {
  for (let i = 0; i < n; i++) step(player, frame);
};

test('zoneAt: x inside the columns and the row in the zone; else null', () => {
  const zone = map.transfers[0];
  assert.equal(zoneAt(map.transfers, { x: 5, row: 0 }), zone);
  assert.equal(zoneAt(map.transfers, { x: 8.99, row: 1 }), zone);
  assert.equal(zoneAt(map.transfers, { x: 9, row: 0 }), null, 'right of x1 + 1');
  assert.equal(zoneAt(map.transfers, { x: 4.9, row: 0 }), null);
  assert.equal(zoneAt(map.transfers, { x: 6.5, row: -1 }), null, 'row not in the zone');
});

test('scheme A descend: crouch, then jump within the window hops to the lower row', () => {
  const player = standing(6.5);
  step(player, f(['moveDown']));
  run(player, 4, f([], ['moveDown']));
  step(player, f(['jump'], ['moveDown']));
  assert.deepEqual(player.hop, { to: 1, t: 1, y0: 0, y1: -2 });
  assert.equal(player.row, 0);
  assert.deepEqual(player.presses, { down: PRESS_NONE, jump: PRESS_NONE });
  run(player, HOP_TICKS - 2, f(['jump']));
  assert.equal(player.row, 0, 'still hopping; input ignored');
  assert.ok(playerDepth(player) > 0.9 && playerDepth(player) < 1);
  step(player, f());
  assert.deepEqual([player.row, player.y, player.hop, player.onGround], [1, -2, null, true]);
  assert.equal(playerDepth(player), 1);
  // The next ticks collide with row 1's floor.
  run(player, 10);
  assert.deepEqual([player.y, player.onGround, player.row], [-2, true, 1]);
});

test('scheme A descend: presses too far apart, or outside a zone, give a normal jump', () => {
  const late = standing(6.5);
  step(late, f(['moveDown']));
  run(late, 19, f([], ['moveDown']));
  step(late, f(['jump'], ['moveDown']));
  assert.equal(late.hop, null);
  assert.ok(late.vy > 0, 'a normal jump');
  const outside = standing(12.5);
  step(outside, f(['moveDown']));
  run(outside, 4, f([], ['moveDown']));
  step(outside, f(['jump'], ['moveDown']));
  assert.deepEqual([outside.hop, outside.row], [null, 0]);
  assert.ok(outside.vy > 0, 'a normal jump');
});

test('scheme A ascend: jump, then down in the air within the window hops to the higher row', () => {
  const player = standing(6.5, 1);
  step(player, f(['jump']));
  run(player, 3, f([], ['jump']));
  assert.equal(player.onGround, false);
  step(player, f(['moveDown']));
  assert.equal(player.hop?.to, 0);
  assert.equal(player.hop.y1, 0);
  run(player, HOP_TICKS - 1);
  assert.deepEqual([player.row, player.y, player.hop], [0, 0, null]);
});

test('scheme B: two downs descend, two jumps ascend, within the window; 20 ticks apart nothing', () => {
  const down = standing(6.5);
  step(down, f(['moveDown'], [], 'B'));
  run(down, 4, f([], [], 'B'));
  step(down, f(['moveDown'], [], 'B'));
  assert.equal(down.hop?.to, 1);
  const up = standing(6.5, 1);
  step(up, f(['jump'], [], 'B'));
  run(up, 4, f([], [], 'B'));
  step(up, f(['jump'], [], 'B'));
  assert.equal(up.hop?.to, 0);
  const slow = standing(6.5);
  step(slow, f(['moveDown'], [], 'B'));
  run(slow, 19, f([], [], 'B'));
  step(slow, f(['moveDown'], [], 'B'));
  assert.deepEqual([slow.hop, slow.row], [null, 0]);
  // Scheme A's sequence does nothing in B (crouch then jump is a plain jump).
  const other = standing(6.5);
  step(other, f(['moveDown'], [], 'B'));
  step(other, f(['jump'], [], 'B'));
  assert.equal(other.hop, null);
});

test('blocked landing: a block where the box would stand means no hop (a normal jump)', () => {
  const blocked = loadCellMap(json([[6, -1, 1]]));
  const player = standing(6.5, 0, blocked);
  assert.equal(findLanding(blocked.rows.get(1), player, 0, 'descend'), null);
  step(player, f(['moveDown']), blocked);
  step(player, f(['jump'], ['moveDown']), blocked);
  assert.equal(player.hop, null);
  assert.ok(player.vy > 0);
});

test('createRowScheme: A by default; unknown values ignored', () => {
  const scheme = createRowScheme();
  assert.equal(scheme.get(), 'A');
  assert.equal(scheme.set('B'), 'B');
  assert.equal(scheme.set('C'), 'B');
  assert.equal(createRowScheme('x').get(), 'A');
});
