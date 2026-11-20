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

test('scheme A: down and jump pressed in the same frame descend (a merged guest frame on the host)', () => {
  const player = standing(6.5);
  step(player, f(['moveDown', 'jump']));
  assert.equal(player.hop?.to, 1);
});

// Reach map: row 0 floor top 0 (x 0..39); row -1 floor top 3 at x 0..9 (zone G, x 5..8) and top 5 at
// x 20..29 (zone H, x 25..28). A jump's y after n ticks: 1.125 (5), 1.903 (10), 2.428 at the peak (19).
const reachMap = loadCellMap({
  ...json(),
  transfers: [
    { x0: 5, x1: 8, low: 0, high: -1 },
    { x0: 25, x1: 28, low: 0, high: -1 },
  ],
  cells: [
    ...Array.from({ length: 40 }, (_, x) => [x, -1, 0]),
    ...Array.from({ length: 10 }, (_, x) => [x, 2, -1]),
    ...Array.from({ length: 10 }, (_, x) => [x + 20, 4, -1]),
  ],
});
const rstep = (player, frame) => step(player, frame, reachMap);
const rstanding = (x, row = 0, y = 0) => {
  const player = createPlayer(x, y, reachMap.player);
  player.row = row;
  for (let i = 0; i < 5; i++) rstep(player, f());
  assert.equal(player.onGround, true);
  return player;
};
// Presses jump at tick 1, then idles until the tick before `n`, and returns the player.
const jumped = (x, n, scheme = 'A') => {
  const player = rstanding(x);
  rstep(player, f(['jump'], [], scheme));
  for (let i = 2; i < n; i++) rstep(player, f([], [], scheme));
  return player;
};

test('reach, top 3: standing or an early double jump cannot reach; a crouch press on the ground does nothing', () => {
  const early = rstanding(6.5);
  rstep(early, f(['jump'], [], 'B'));
  run(early, 2, f([], [], 'B'));
  rstep(early, f(['jump'], [], 'B'));
  assert.equal(early.hop, null);
  const crouch = rstanding(6.5);
  rstep(crouch, f(['moveDown']));
  assert.equal(crouch.hop, null);
  // Held from the ground into the air: not a press event.
  const held = rstanding(6.5);
  rstep(held, f(['jump'], ['moveDown']));
  run(held, 15, f([], ['moveDown']));
  assert.equal(held.hop, null);
});

test('reach, top 3: jump, then a crouch press near the top of the jump hops to y 3', () => {
  for (const scheme of ['A', 'B']) {
    const player = jumped(6.5, 15, scheme);
    rstep(player, f(['moveDown'], [], scheme));
    assert.equal(player.hop?.to, -1, scheme);
    assert.equal(player.hop.y1, 3, scheme);
  }
  const low = jumped(6.5, 5);
  rstep(low, f(['moveDown']));
  assert.equal(low.hop, null, 'y 1.1: out of reach');
});

test('reach, top 3: scheme B two jump presses near the top of the jump hop', () => {
  const player = jumped(6.5, 12, 'B');
  rstep(player, f(['jump'], [], 'B'));
  assert.equal(player.hop?.to, -1);
});

test('reach, top 5: out of reach even at the peak; descending from it works', () => {
  for (const scheme of ['A', 'B']) {
    const player = jumped(26.5, 19, scheme);
    rstep(player, f(['moveDown'], [], scheme));
    assert.equal(player.hop, null, scheme);
  }
  const second = jumped(26.5, 10, 'B');
  rstep(second, f(['jump'], [], 'B'));
  assert.equal(second.hop, null);
  const down = rstanding(26.5, -1, 5);
  rstep(down, f(['moveDown']));
  rstep(down, f(['jump'], ['moveDown']));
  assert.deepEqual([down.hop?.to, down.hop?.y1], [0, 0]);
});

test('air grab: a player falling past the ledge grabs the higher row with a crouch press', () => {
  for (const scheme of ['A', 'B']) {
    const player = createPlayer(6.5, 2.5, reachMap.player);
    player.row = 0;
    rstep(player, f([], [], scheme));
    assert.equal(player.onGround, false);
    assert.equal(player.presses.down, PRESS_NONE);
    rstep(player, f(['moveDown'], [], scheme));
    assert.deepEqual([player.hop?.to, player.hop?.y1], [-1, 3], scheme);
  }
});
