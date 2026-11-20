import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ENEMY_ATTACK,
  ENEMY_HEALTH,
  MELEE,
  PLAYER_HEALTH,
  hasItem,
  inventoryFromMask,
  inventoryMask,
  meleeHits,
  resolveCombat,
  stepMelee,
  swinging,
} from '../src/world/combat.js';
import { ENEMY, createEnemy } from '../src/world/enemy.js';
import { createPlayer } from '../src/world/player.js';
import { createSandbox, initSandbox, tickSandbox } from '../src/scenes/sandbox.js';
import { createViewMode } from '../src/scenes/sandbox-3d.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { decode, encode, loadCodec, snapMessage, snapshotFromMessage } from '../src/net/codec.js';
import { healthText } from '../src/ui/health-hud.js';
import { frame } from './frames.js';
import { STEP } from './fakes.js';

await loadCodec();

const SIZE = { width: 0.55, height: 1.2, crouchHeight: 0.6 };
// The swing's tip, from the player's centre: half a width plus MELEE.reachWidths widths.
const REACH = SIZE.width / 2 + MELEE.reachWidths * SIZE.width;

// A player at x 0 on the floor (y 0), facing right, that has just started a swing.
function swingingPlayer(extra = {}) {
  const player = Object.assign(createPlayer(0, 0, SIZE), { onGround: true }, extra);
  stepMelee(player, frame(['primaryFire']));
  return player;
}

test('inventory: every player starts with an empty one; the mask over ITEMS is 0', () => {
  const player = createPlayer(0, 0, SIZE);
  assert.deepEqual(player.inventory, []);
  assert.equal(hasItem(player, 'anything'), false);
  assert.equal(inventoryMask(player.inventory), 0);
  assert.deepEqual(inventoryFromMask(0), []);
  assert.deepEqual([player.health, player.meleeTicks, player.meleeDir], [PLAYER_HEALTH, 0, 1]);
  assert.deepEqual([createEnemy(0, 0).health, createEnemy(0, 0).attackCooldown], [ENEMY_HEALTH, 0]);
});

test('melee: the attack or melee key starts a swing, drawn for swingTicks, next one after cooldownTicks; direction from the aim', () => {
  const player = createPlayer(0, 0, SIZE);
  stepMelee(player, frame([]));
  assert.equal(player.meleeTicks, 0, 'no press, no swing');
  stepMelee(player, frame(['primaryFire']));
  assert.equal(player.meleeTicks, MELEE.cooldownTicks);
  let drawn = 0;
  for (let t = 0; t < MELEE.cooldownTicks - 1; t++) {
    if (swinging(player)) drawn += 1;
    stepMelee(player, frame(['primaryFire'])); // presses during the cooldown do nothing
  }
  assert.equal(drawn, MELEE.swingTicks);
  assert.equal(player.meleeTicks, 1);
  player.aim = Math.PI; // aiming left
  stepMelee(player, frame(['melee']));
  assert.deepEqual([player.meleeTicks, player.meleeDir], [MELEE.cooldownTicks, -1], 'the melee key, 18 ticks after the last swing');
  // The attack key with something carried does not swing; the melee key always does.
  const armed = Object.assign(createPlayer(0, 0, SIZE), { inventory: ['thing'] });
  stepMelee(armed, frame(['primaryFire']));
  assert.equal(armed.meleeTicks, 0);
  stepMelee(armed, frame(['melee']));
  assert.equal(armed.meleeTicks, MELEE.cooldownTicks);
});

test('melee reach: in front within the box on the same row is hit; beyond the reach, behind or on another row is not', () => {
  const half = ENEMY.width / 2;
  const enemyAt = (x) => createEnemy(x, 0);
  const player = swingingPlayer();
  assert.equal(meleeHits(player, [enemyAt(REACH + half - 0.01)]).length, 1, 'just inside the reach');
  assert.equal(meleeHits(player, [enemyAt(REACH + half + 0.01)]).length, 0, 'just beyond the reach');
  assert.equal(meleeHits(player, [enemyAt(-1)]).length, 0, 'behind');
  assert.equal(meleeHits(swingingPlayer({ row: 1 }), [enemyAt(0.8)]).length, 0, 'the player on another row');
  assert.equal(meleeHits(swingingPlayer({ aim: Math.PI }), [enemyAt(-0.8)]).length, 1, 'aiming left hits on the left');
});

test('melee damage: three swings (respecting the cooldown) remove a 30-health enemy; one hit per swing', () => {
  const player = Object.assign(createPlayer(0, 0, SIZE), { onGround: true });
  const enemy = createEnemy(0.8, 0); // idle: it does not attack
  const state = { players: [player], enemies: [enemy] };
  const healths = [];
  for (let t = 0; t < 2 * MELEE.cooldownTicks + 1; t++) {
    stepMelee(player, frame(['primaryFire']));
    resolveCombat(state);
    if (t === 0 || t === MELEE.cooldownTicks) healths.push(enemy.health);
  }
  assert.deepEqual(healths, [ENEMY_HEALTH - MELEE.damage, ENEMY_HEALTH - 2 * MELEE.damage]);
  assert.equal(enemy.health, 0);
  assert.deepEqual(state.enemies, [], 'removed at 0');
});

test('enemy attack: a touching awake enemy hurts the player by 10 and pushes it away, at most once per 60 ticks', () => {
  const player = Object.assign(createPlayer(0, 0, SIZE), { onGround: true });
  // Its box 0.1 tile right of the player's box.
  const enemy = Object.assign(createEnemy(SIZE.width / 2 + ENEMY.width / 2 + 0.1, 0), { awake: true });
  const state = { players: [player], enemies: [enemy] };
  assert.deepEqual(resolveCombat(state), []);
  assert.equal(player.health, PLAYER_HEALTH - ENEMY_ATTACK.damage);
  assert.deepEqual([player.vx, player.vy, player.onGround], [-ENEMY_ATTACK.pushSpeed, ENEMY_ATTACK.pushLift, false], 'pushed left, away from the enemy');
  for (let t = 1; t < ENEMY_ATTACK.cooldownTicks; t++) resolveCombat(state);
  assert.equal(player.health, PLAYER_HEALTH - ENEMY_ATTACK.damage, 'no second attack before 60 ticks');
  resolveCombat(state);
  assert.equal(player.health, PLAYER_HEALTH - 2 * ENEMY_ATTACK.damage, 'the second one 60 ticks after the first');
  // Not when idle, out of range or on another row.
  const calm = { players: [Object.assign(createPlayer(0, 0, SIZE), { onGround: true })], enemies: [createEnemy(0.6, 0)] };
  const far = { players: [Object.assign(createPlayer(0, 0, SIZE), { onGround: true })], enemies: [Object.assign(createEnemy(SIZE.width / 2 + ENEMY.width / 2 + 0.31, 0), { awake: true })] };
  const deep = { players: [Object.assign(createPlayer(0, 0, SIZE), { onGround: true, row: -1 })], enemies: [Object.assign(createEnemy(0.6, 0), { awake: true })] };
  for (const s of [calm, far, deep]) {
    resolveCombat(s);
    assert.equal(s.players[0].health, PLAYER_HEALTH);
  }
});

test('zero health: a player at 10 health hit by an enemy goes back to the spawn with full health (tickSandbox)', () => {
  const json = JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
  const map = loadGridMap(json);
  const state = initSandbox(map);
  const player = state.players[0];
  Object.assign(player, { x: state.spawn.x + 4, health: 10, onGround: true });
  state.enemies = [Object.assign(createEnemy(player.x + player.size.width / 2 + ENEMY.width / 2 + 0.05, state.spawn.y, 0), { awake: true, onGround: true })];
  state.enemySpawns = [{ x: player.x, y: state.spawn.y }];
  tickSandbox(state, [frame([])], STEP, map.tiles);
  assert.deepEqual([player.x, player.y, player.health, player.row, player.vx], [state.spawn.x, state.spawn.y, PLAYER_HEALTH, 0, 0]);
  assert.deepEqual(state.camera, { x: state.spawn.x, y: state.spawn.y + player.size.height }, 'the camera snaps to the local respawn');
});

test('sandbox draw: a primaryFire press with an empty inventory shows the swing mesh for MELEE.swingTicks ticks', async () => {
  let rendered;
  const renderer = { render: (scene) => (rendered = scene) };
  const json = JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
  const scene = createSandbox({ viewMode: createViewMode({ mode: '2d' }), fetchJson: async () => json });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin: () => {} };
  const swingMeshes = () => rendered.children.filter((o) => o.isMesh && o.material.transparent && o.material.opacity === 0.45);
  scene.draw(state, view);
  assert.deepEqual(swingMeshes().map((m) => m.visible), [false, false]);
  let shown = 0;
  for (let t = 0; t < MELEE.cooldownTicks; t++) {
    scene.tick(state, [frame(t === 0 ? ['primaryFire'] : [])], STEP);
    scene.draw(state, view);
    if (swingMeshes()[0].visible) shown += 1;
  }
  assert.equal(shown, MELEE.swingTicks);
});

test('snapshot: health, inventory, melee ticks and direction, and enemy health survive the wire', () => {
  const players = [
    Object.assign(createPlayer(1, 2, SIZE), { health: 40, meleeTicks: 12, meleeDir: -1 }),
    Object.assign(createPlayer(3, 2, SIZE), { health: 0, meleeTicks: MELEE.cooldownTicks, meleeDir: 1 }),
  ];
  const enemies = [Object.assign(createEnemy(5, 0, 2), { health: 20 })];
  const back = snapshotFromMessage(decode(encode(snapMessage({ tick: 1, ack: -1, wt: 1, players, enemies }))));
  assert.deepEqual(back.players.map((p) => [p.health, p.inventory, p.meleeTicks, p.meleeDir]), [[40, [], 12, -1], [0, [], MELEE.cooldownTicks, 1]]);
  assert.equal(back.enemies[0].health, 20);
});

test('health HUD text: one line per present slot, health over PLAYER_HEALTH', () => {
  assert.equal(healthText([{ health: 100 }]), 'P1 100/100');
  assert.equal(healthText([{ health: 100 }, { health: 70 }]), 'P1 100/100\nP2 70/100');
});
