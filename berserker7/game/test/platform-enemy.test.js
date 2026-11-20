import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENEMY, createEnemy, stepEnemy } from '../src/world/enemy.js';
import { platformAt, platformsStep, rideShift } from '../src/world/platform.js';
import { createPlayer, stepPlayer } from '../src/world/player.js';
import { createTileMap } from '../src/world/tilemap.js';
import { frame } from './frames.js';

const DT = 1 / 60;
const SIZE = { width: 0.55, height: 1.2, crouchHeight: 0.6 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);

// A floor with its top at y = 0 from x = -40 to 40, plus the given solid tiles.
function tileMap(extra = []) {
  const tiles = createTileMap({ types: [{ solid: false }, { solid: true, color: '#888888' }] });
  for (let x = -40; x <= 40; x++) tiles.setTile(x, -1, 1);
  for (const [x, y] of extra) tiles.setTile(x, y, 1);
  return tiles;
}

test('platformAt: pingpong walks there and back, by the tick only; loop wraps to the first point', () => {
  // 6 tiles/s: 0.1 tile per tick.
  const pingpong = { width: 3, height: 0.5, speed: 6, mode: 'pingpong', path: [[0, 2], [6, 2]] };
  const x = (tick) => platformAt(pingpong, tick).x;
  near(x(0), 0, 'start');
  near(x(30), 3, 'halfway out');
  near(x(60), 6, 'the far end (turn)');
  near(x(61), 5.9, 'just after the turn');
  near(x(90), 3, 'halfway back');
  near(x(120), 0, 'back at the start');
  near(x(150), 3, 'out again');
  assert.deepEqual(platformAt(pingpong, 30), platformAt(pingpong, 30));
  assert.deepEqual(Object.keys(platformAt(pingpong, 7)).sort(), ['height', 'width', 'x', 'y']);
  // A square loop, 8 tiles round.
  const loop = { width: 1, height: 0.5, speed: 6, mode: 'loop', path: [[0, 0], [2, 0], [2, 2], [0, 2]] };
  const at = (tick) => {
    const { x: px, y: py } = platformAt(loop, tick);
    return [Number(px.toFixed(9)), Number(py.toFixed(9))];
  };
  assert.deepEqual(at(20), [2, 0]);
  assert.deepEqual(at(50), [1, 2]);
  assert.deepEqual(at(70), [0, 1], 'last point back to the first');
  assert.deepEqual(at(80), [0, 0], 'wraps');
  assert.deepEqual(at(100), [2, 0]);
});

test('riding: a player on a moving platform moves with it; a jump leaves it', () => {
  const tiles = tileMap();
  const platforms = [{ width: 3, height: 0.5, speed: 3, mode: 'pingpong', path: [[0, 3], [10, 3]] }];
  const player = createPlayer(1.5, 3.5, SIZE);
  player.onGround = true;
  let tick = 0;
  const step = (f = null) => {
    stepPlayer(player, f, tiles, DT, { platforms: platformsStep(platforms, tick) });
    tick += 1;
  };
  for (let i = 0; i < 60; i++) step();
  // 3 tiles/s for 1 s: carried 3 tiles, still standing on the top.
  near(player.x, 4.5, 'carried');
  near(player.y, 3.5, 'on the top');
  assert.equal(player.onGround, true);
  step(frame(['jump']));
  assert.equal(player.onGround, false);
  assert.ok(player.vy > 0);
  const x = player.x;
  for (let i = 0; i < 10; i++) step();
  assert.ok(player.y > 3.5 + 1, `in the air at ${player.y}`);
  near(player.x, x, 'not carried in the air');
});

test('riding: one-way, a player passes up through a platform and lands on it falling', () => {
  const tiles = tileMap();
  const platforms = [{ width: 4, height: 0.5, speed: 0, mode: 'pingpong', path: [[-2, 1.5]] }];
  const player = createPlayer(0, 0, SIZE);
  player.onGround = true;
  const world = { platforms: platformsStep(platforms, 0) };
  stepPlayer(player, frame(['jump']), tiles, DT, world);
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) {
    stepPlayer(player, null, tiles, DT, world);
    landed = player.onGround;
  }
  assert.ok(landed);
  near(player.y, 2, 'stands on the top, not the floor');
});

test('riding: a rider carried into a wall stops at the wall', () => {
  // A wall at x = 8 from y = 4 up (the rider's body height; the platform passes below it).
  const tiles = tileMap([[8, 4], [8, 5], [8, 6]]);
  const platforms = [{ width: 3, height: 0.5, speed: 3, mode: 'pingpong', path: [[0, 3], [12, 3]] }];
  const player = createPlayer(1.5, 4, SIZE);
  player.onGround = true;
  const wallLeft = 8 - SIZE.width / 2;
  for (let tick = 0; tick < 220; tick++) {
    stepPlayer(player, null, tiles, DT, { platforms: platformsStep(platforms, tick) });
    assert.ok(player.x <= wallLeft + 1e-9, `tick ${tick}: x ${player.x} past the wall`);
  }
  near(player.x, wallLeft, 'stopped at the wall');
  // The platform moved on under it; the rider dropped off to the floor.
  assert.equal(player.y, 0);
});

test('enemy: idle with the player out of range; wakes and walks to the nearest player; stays awake', () => {
  const tiles = tileMap();
  const enemy = createEnemy(0.5, 0);
  const run = (players, ticks) => {
    for (let i = 0; i < ticks; i++) stepEnemy(enemy, players, tiles, DT);
  };
  const far = createPlayer(0.5 + ENEMY.triggerDistance + 1, 0, SIZE);
  run([far], 60);
  assert.equal(enemy.awake, false);
  near(enemy.x, 0.5, 'idle');
  assert.equal(enemy.onGround, true);
  // Two players: one just in range on the left, one further away on the right.
  const left = createPlayer(-4.5, 0, SIZE);
  run([far, left], 30);
  assert.equal(enemy.awake, true);
  assert.ok(enemy.x < 0.5 - 0.5, `walked left to the nearest player: ${enemy.x}`);
  // The near player leaves range: still awake, now walking to the remaining player on the right.
  const x = enemy.x;
  run([far], 30);
  assert.equal(enemy.awake, true);
  assert.ok(enemy.x > x, 'walks right');
  // Stops within stopDistance of the player's x.
  run([far], 600);
  assert.ok(Math.abs(enemy.x - far.x) < ENEMY.stopDistance + 0.1, `${enemy.x} near ${far.x}`);
  assert.deepEqual(structuredClone(enemy), enemy, 'plain data');
});

test('rideShift: a remote body on a platform at an older tick is drawn moved with it to the draw tick', () => {
  const lift = { width: 3, height: 0.5, speed: 2, mode: 'pingpong', path: [[0, 0], [0, 8]] };
  const at30 = platformAt(lift, 30); // top at 1.5
  const body = { x: 1.5, y: at30.y + at30.height, size: { width: 0.55 } };
  const shift = rideShift([lift], body, 30, 42);
  assert.ok(Math.abs(shift.dx) < 1e-9);
  assert.ok(Math.abs(shift.dy - 0.4) < 1e-9); // 12 ticks at 2 tiles/s
  assert.deepEqual(rideShift([lift], { ...body, y: body.y + 1 }, 30, 42), { dx: 0, dy: 0 }); // not on it
});

test('tickSandbox: a fallen enemy with no spawn on this map is removed, not respawned', async () => {
  const { initSandbox, tickSandbox } = await import('../src/scenes/sandbox.js');
  const tiles = createTileMap({ types: [{ solid: false }, { solid: true, color: '#888' }] });
  for (let x = -5; x <= 5; x++) tiles.setTile(x, -1, 1);
  const map = { name: 't', tiles, player: { width: 0.55, height: 1.2, crouchHeight: 0.6 }, platforms: [], spawns: [{ type: 'player', x: 0, y: 0 }, { type: 'enemy', x: 3, y: 0 }] };
  const state = initSandbox(map);
  state.enemies.push({ ...createEnemy(0, state.fallY - 1, 900), y: state.fallY - 1 });
  state.enemies[0].y = state.fallY - 1; // the map's own enemy falls too
  tickSandbox(state, [], 1 / 60, tiles);
  assert.deepEqual(state.enemies.map((e) => [e.id, e.y]), [[0, 0]]);
});
