import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { MOVE, createPlayer, stepPlayer } from '../src/world/player.js';

const DT = 1 / 60;
const json = JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
const { tiles, spawns } = loadGridMap(json);
const spawn = spawns.find((s) => s.type === 'player');
const rows = json.grid.length;
// Floor top: the lowest empty y above the spawn column's floor; the right wall's left edge.
let floorTop = 0;
while (tiles.isSolid(spawn.x, floorTop)) floorTop += 1;
const lastColumn = json.grid[0].length - 1;
const wallLeft = lastColumn; // the tile at x = lastColumn is the right wall

// A frame with the named actions held (`pressed` for the ones in `pressed`).
function frame(held = [], pressed = []) {
  const actions = Object.fromEntries(ACTIONS.map((a) => [a, { held: false, pressed: false, released: false }]));
  for (const a of held) actions[a].held = true;
  for (const a of pressed) actions[a].held = actions[a].pressed = true;
  return { player: 0, connected: true, actions };
}

const run = (player, makeFrame, ticks) => {
  for (let i = 0; i < ticks; i++) stepPlayer(player, makeFrame(i), tiles, DT);
};

test('MOVE: one frozen object with the box size', () => {
  assert.ok(Object.isFrozen(MOVE));
  assert.equal(MOVE.width, 1);
  assert.equal(MOVE.height, 2);
});

test('player: dropped above the floor, it lands exactly on the floor top and is on the ground', () => {
  const player = createPlayer(spawn.x + 0.5, floorTop + 5);
  run(player, () => frame(), 120);
  assert.equal(player.onGround, true);
  assert.ok(Math.abs(player.y - floorTop) < 1e-6, `y ${player.y}`);
  assert.equal(player.vy, 0);
  run(player, () => frame(), 30);
  assert.equal(player.onGround, true, 'stays grounded');
  assert.ok(Math.abs(player.y - floorTop) < 1e-6);
});

test('player: a missing or unconnected frame is no input but gravity still applies', () => {
  const player = createPlayer(spawn.x + 0.5, floorTop + 5);
  stepPlayer(player, undefined, tiles, DT);
  assert.ok(player.vy < 0);
  const other = createPlayer(spawn.x + 0.5, floorTop + 5);
  stepPlayer(other, { ...frame(['moveRight']), connected: false }, tiles, DT);
  assert.equal(other.vx, 0);
  assert.ok(other.vy < 0);
});

test('player: holding moveRight stops at the right wall with vx 0', () => {
  const player = createPlayer(spawn.x + 0.5, floorTop);
  run(player, () => frame(['moveRight']), 600);
  assert.ok(player.x + MOVE.width / 2 <= wallLeft + 1e-9, `x ${player.x}`);
  assert.ok(player.x + MOVE.width / 2 > wallLeft - 1e-6, 'touches the wall');
  assert.equal(player.vx, 0);
  assert.equal(player.onGround, true);
});

test('player: holding moveLeft stops at the left wall', () => {
  const player = createPlayer(spawn.x + 0.5, floorTop);
  run(player, () => frame(['moveLeft']), 600);
  assert.ok(player.x - MOVE.width / 2 >= 1 - 1e-9, `x ${player.x}`);
  assert.equal(player.vx, 0);
});

test('player: with no input, friction stops it without overshooting', () => {
  const player = createPlayer(spawn.x + 0.5, floorTop);
  run(player, () => frame(['moveRight']), 20);
  assert.ok(player.vx > 0);
  let sign = 1;
  for (let i = 0; i < 60; i++) {
    stepPlayer(player, frame(), tiles, DT);
    if (player.vx < 0) sign = -1;
  }
  assert.equal(sign, 1, 'vx never went negative');
  assert.equal(player.vx, 0);
});

test('player: a jump press on the ground goes up, peaks near 2.5 tiles and lands again; in the air it does nothing', () => {
  const player = createPlayer(spawn.x + 0.5, floorTop);
  run(player, () => frame(), 5);
  assert.equal(player.onGround, true);
  stepPlayer(player, frame(['jump'], ['jump']), tiles, DT);
  assert.ok(player.vy > 0);
  assert.equal(player.onGround, false);
  let peak = player.y;
  let airTicks = 0;
  while (!player.onGround && airTicks < 300) {
    stepPlayer(player, frame(), tiles, DT);
    peak = Math.max(peak, player.y);
    airTicks += 1;
  }
  assert.ok(peak - floorTop > 2 && peak - floorTop < 3, `peak ${peak - floorTop}`);
  assert.equal(player.onGround, true);
  assert.ok(Math.abs(player.y - floorTop) < 1e-6);

  const air = createPlayer(spawn.x + 0.5, floorTop + 5);
  stepPlayer(air, frame(['jump'], ['jump']), tiles, DT);
  assert.ok(air.vy < 0, 'no mid-air jump');
});

test('player: a fall never exceeds maxFallSpeed', () => {
  const player = createPlayer(spawn.x + 0.5, rows + 100);
  run(player, () => frame(), 200);
  assert.ok(player.vy >= -MOVE.maxFallSpeed);
});

test('player: moveUp also jumps for now, and the aim follows the frame', () => {
  const tiles = loadGridMap(JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'))).tiles;
  const player = createPlayer(10.5, 2);
  for (let i = 0; i < 5; i++) stepPlayer(player, frame(), tiles, DT);
  assert.equal(player.onGround, true);
  const up = frame(['moveUp'], ['moveUp']);
  up.aim = 1.2;
  stepPlayer(player, up, tiles, DT);
  assert.ok(player.vy > 0);
  assert.equal(player.aim, 1.2);
});
