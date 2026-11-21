import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DAMAGE_SOURCES,
  ENEMY_ATTACK,
  ITEMS,
  ITEM_DEFS,
  MELEE,
  PISTOL,
  PLASMA_PISTOL,
  PLAYER_HEALTH,
  canTake,
  fired,
  inventoryFromMask,
  inventoryMask,
  resolveCombat,
  stepFire,
  stepMelee,
} from '../src/world/combat.js';
import { ENEMY, createEnemy } from '../src/world/enemy.js';
import { createPlayer } from '../src/world/player.js';
import { BOLT_ID_MAX, MAX_BOLTS, SUB_STEP, createBolt, stepBolts } from '../src/world/projectile.js';
import { MAX_PICKUPS, PICKUP, applyTakenMask, createPickups, stepPickups, takenMask } from '../src/world/pickup.js';
import { createTileMap } from '../src/world/tilemap.js';
import { initSandbox, tickSandbox } from '../src/scenes/sandbox.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { frame } from './frames.js';
import { STEP } from './fakes.js';

const SIZE = { width: 0.55, height: 1.2, crouchHeight: 0.6 };
const HEAD = SIZE.height; // the head's height above the feet
const armed = (x = 0, extra = {}) => Object.assign(createPlayer(x, 0, SIZE), { onGround: true, inventory: [PLASMA_PISTOL] }, extra);
// A frame holding the attack key (frame() presses it too).
const fire = () => frame(['primaryFire']);
const holdOnly = () => {
  const f = frame(['primaryFire']);
  f.actions.primaryFire.pressed = false;
  return f;
};

// A tile map with solid tiles at the given [x, y] cells.
function tiles(cells = []) {
  const map = createTileMap({ types: [{ solid: false }, { solid: true, color: '#888' }] });
  for (const [x, y] of cells) map.setTile(x, y, 1);
  return map;
}
// The angle from a player's head at (x, 0) to an enemy's box centre at (ex, 0).
const aimAt = (x, ex) => Math.atan2(ENEMY.height / 2 - HEAD, ex - x);
const enemyAt = (x, id = 0) => Object.assign(createEnemy(x, 0, id), { onGround: true });

// A world for stepBolts: players, enemies, rows (row -> tile map) and platforms.
function world({ players, enemies = [], rows = new Map([[0, tiles()]]), platforms = [] }) {
  const state = { players, enemies, bolts: [], nextBoltId: 0 };
  // One tick of firing (each player holds the attack key or not), bolts and combat.
  const tick = (held = [true]) => {
    players.forEach((p, i) => p && stepFire(p, held[i] ? holdOnly() : frame([])));
    stepBolts(state, rows, platforms, STEP);
    resolveCombat(state);
  };
  return { state, tick };
}

test('items: the plasma pistol is item 0 (bit 0); its definition sets onlyOne; inventory mask', () => {
  assert.deepEqual(ITEMS, ['plasmaPistol']);
  assert.equal(PLASMA_PISTOL, 'plasmaPistol');
  for (const id of ITEMS) assert.ok(ITEM_DEFS[id], id);
  assert.equal(ITEM_DEFS.plasmaPistol.onlyOne, true);
  assert.equal(inventoryMask(['plasmaPistol']), 1);
  assert.equal(inventoryMask([]), 0);
  assert.deepEqual(inventoryFromMask(1), ['plasmaPistol']);
  assert.deepEqual(inventoryFromMask(0), []);
  assert.ok(DAMAGE_SOURCES.includes('pistol'));
  assert.deepEqual(PISTOL, { damage: 20, chargeTicks: 30, speed: 30, length: 0.4, thickness: 0.12, radius: 0.1, lifeTicks: 40 });
  assert.equal(MAX_BOLTS, 8);
});

test('canTake: an onlyOne item carried is left; an item without the flag is taken while carried', () => {
  const player = createPlayer(0, 0, SIZE);
  assert.equal(canTake(player, PLASMA_PISTOL), true, 'nothing carried');
  player.inventory.push(PLASMA_PISTOL);
  assert.equal(canTake(player, PLASMA_PISTOL), false, 'the pistol is onlyOne');
  const defs = { plasmaPistol: {} };
  assert.equal(canTake(player, PLASMA_PISTOL, defs), true, 'a definition without the flag');
});

test('firing: without the pistol the attack key swings (unchanged); with it, held fires on tick 1 and every 30 ticks, no swing', () => {
  const bare = createPlayer(0, 0, SIZE);
  stepMelee(bare, fire());
  stepFire(bare, fire());
  assert.deepEqual([bare.meleeTicks, bare.fireTicks, fired(bare)], [MELEE.cooldownTicks, 0, false]);
  const player = armed();
  const shots = [];
  for (let t = 1; t <= 61; t++) {
    stepMelee(player, t === 1 ? fire() : holdOnly());
    stepFire(player, t === 1 ? fire() : holdOnly());
    if (fired(player)) shots.push(t);
    assert.equal(player.meleeTicks, 0, `no swing at tick ${t}`);
  }
  assert.deepEqual(shots, [1, 31, 61]);
});

test('firing: a press while charging does nothing; the melee key still swings with the pistol', () => {
  const player = armed();
  stepFire(player, fire());
  assert.equal(fired(player), true);
  const shots = [];
  for (let t = 2; t <= 40; t++) {
    // Released, pressed again at tick 10 (charging), held from tick 25.
    const f = t === 10 ? fire() : t >= 25 ? holdOnly() : frame([]);
    stepFire(player, f);
    if (fired(player)) shots.push(t);
  }
  assert.deepEqual(shots, [31], 'the press at tick 10 did nothing; the hold fires once charged');
  stepMelee(player, frame(['melee']));
  assert.equal(player.meleeTicks, MELEE.cooldownTicks);
  // Not connected: nothing.
  const idle = armed();
  stepFire(idle, frame(['primaryFire'], null, false));
  assert.equal(fired(idle), false);
});

test('bolts: two hits (20 each) kill a walker on row 0; resolveCombat removes it', () => {
  const player = armed(0, { aim: aimAt(0, 6) });
  const enemy = enemyAt(6);
  const { state, tick } = world({ players: [player], enemies: [enemy] });
  tick();
  assert.equal(state.bolts.length, 1);
  const bolt = state.bolts[0];
  assert.deepEqual([bolt.id, bolt.owner, bolt.row, bolt.age], [0, 0, 0, 1]);
  assert.ok(Math.abs(bolt.x - PISTOL.speed * STEP * Math.cos(player.aim)) < 1e-9, 'moved once in the tick it was fired');
  for (let t = 0; t < 20 && enemy.health === 30; t++) tick();
  assert.equal(enemy.health, 30 - PISTOL.damage);
  assert.equal(state.bolts.length, 0, 'the bolt stopped at the hit');
  for (let t = 0; t < 40 && state.enemies.length > 0; t++) tick();
  assert.equal(enemy.health, 0);
  assert.equal(state.enemies.length, 0, 'removed by resolveCombat');
  assert.equal(state.nextBoltId, 2);
});

test('bolts: stop at a solid tile (no tunnelling through a 1-tile wall); the enemy behind it is untouched', () => {
  const player = armed(0, { aim: 0 });
  const enemy = enemyAt(6);
  enemy.size.height = 3; // tall enough to be in the bolt's line
  const { state, tick } = world({ players: [player], enemies: [enemy], rows: new Map([[0, tiles([[3, 0], [3, 1], [3, 2]])]]) });
  for (let t = 0; t < 12; t++) tick([t === 0]);
  assert.equal(state.bolts.length, 0);
  assert.equal(enemy.health, 30);
  assert.ok(SUB_STEP < 1);
  // Without the wall the same shot hits the tall enemy.
  const other = enemyAt(6);
  other.size.height = 3;
  const open = world({ players: [armed(0, { aim: 0 })], enemies: [other] });
  for (let t = 0; t < 14; t++) open.tick([t === 0]);
  assert.equal(other.health, 30 - PISTOL.damage);
});

test('bolts: stop at a moving platform on row 0', () => {
  const box = { x: 3, y: 0.5, width: 2, height: 1 };
  const { state, tick } = world({ players: [armed(0, { aim: 0 })], platforms: [{ prev: box, now: box }] });
  tick();
  let last = state.bolts[0];
  for (let t = 0; t < 10 && state.bolts.length > 0; t++) {
    last = state.bolts[0];
    tick([false]);
  }
  assert.equal(state.bolts.length, 0);
  assert.ok(last.x >= box.x && last.x < box.x + SUB_STEP, `stopped at the platform's edge: ${last.x}`);
});

test('bolts: pass through the other player (no damage) and keep going', () => {
  const shooter = armed(0, { aim: 0 });
  const other = Object.assign(createPlayer(2, 0.5, SIZE), { onGround: true });
  const { state, tick } = world({ players: [shooter, other] });
  tick([true, false]);
  for (let t = 0; t < 10; t++) tick([false, false]);
  assert.equal(other.health, PLAYER_HEALTH);
  assert.equal(state.bolts.length, 1);
  assert.ok(state.bolts[0].x > 5, `kept going: ${state.bolts[0].x}`);
});

test('bolts: a bolt on row 1 ignores enemies (row 0) but stops at its own row\'s tiles', () => {
  const player = armed(0, { aim: 0, row: 1 });
  const enemy = enemyAt(3);
  enemy.size.height = 3;
  const rows = new Map([[0, tiles()], [1, tiles([[6, 1]])]]);
  const { state, tick } = world({ players: [player], enemies: [enemy], rows });
  tick();
  assert.equal(state.bolts[0].row, 1);
  for (let t = 0; t < 20 && state.bolts.length > 0; t++) tick([false]);
  assert.equal(enemy.health, 30, 'not hit');
  assert.equal(state.bolts.length, 0, 'stopped at the row 1 wall');
  // A row with no tile map is empty: the bolt flies on.
  const lone = world({ players: [armed(0, { aim: 0, row: 2 })] });
  lone.tick();
  for (let t = 0; t < 5; t++) lone.tick([false]);
  assert.equal(lone.state.bolts.length, 1);
});

test('bolts: expire after lifeTicks (20 tiles); the cap of 8 drops the oldest; ids wrap', () => {
  const { state, tick } = world({ players: [armed(0, { aim: 0 })] });
  tick();
  for (let t = 1; t < PISTOL.lifeTicks - 1; t++) tick([false]);
  assert.equal(state.bolts.length, 1);
  assert.equal(state.bolts[0].age, PISTOL.lifeTicks - 1);
  tick([false]);
  assert.equal(state.bolts.length, 0, 'gone at lifeTicks');
  // Eight in flight; one more drops the oldest (id 0).
  const capped = world({ players: [armed(0, { aim: Math.PI / 2 })] });
  capped.state.bolts = Array.from({ length: MAX_BOLTS }, (_, i) => createBolt(i, 0, createPlayer(-100 - i * 10, 0, SIZE)));
  capped.state.nextBoltId = BOLT_ID_MAX;
  capped.tick();
  assert.equal(capped.state.bolts.length, MAX_BOLTS);
  assert.deepEqual(capped.state.bolts.map((b) => b.id), [1, 2, 3, 4, 5, 6, 7, BOLT_ID_MAX]);
  assert.equal(capped.state.nextBoltId, 0, 'wraps at 65536');
});

test('bolts: an enemy already at 0 health is not hit again', () => {
  const dead = Object.assign(enemyAt(3), { health: 0 });
  dead.size.height = 3;
  const state = { players: [armed(0, { aim: 0 })], enemies: [dead], bolts: [], nextBoltId: 0 };
  const rows = new Map([[0, tiles()]]);
  for (let t = 0; t < 10; t++) {
    stepFire(state.players[0], t === 0 ? fire() : frame([]));
    stepBolts(state, rows, [], STEP);
  }
  assert.equal(state.bolts.length, 1, 'flew through');
  assert.ok(state.bolts[0].x > 4);
});

test('pickups: from the map spawns, at most MAX_PICKUPS, known items only; the taken mask', () => {
  const spawns = [{ type: 'player', x: 0, y: 0 }, { type: 'pickup', item: 'plasmaPistol', x: 2, y: 0 }, { type: 'enemy', x: 9, y: 0 }, { type: 'pickup', item: 'plasmaPistol', x: 6, y: 1 }];
  const pickups = createPickups(spawns);
  assert.deepEqual(pickups, [
    { id: 0, item: 'plasmaPistol', x: 2.5, y: 0, taken: false },
    { id: 1, item: 'plasmaPistol', x: 6.5, y: 1, taken: false },
  ]);
  assert.throws(() => createPickups(Array.from({ length: MAX_PICKUPS + 1 }, () => ({ type: 'pickup', item: 'plasmaPistol', x: 0, y: 0 }))), /at most 8/);
  assert.throws(() => createPickups([{ type: 'pickup', item: 'rocket', x: 0, y: 0 }]), /unknown item/);
  pickups[1].taken = true;
  assert.equal(takenMask(pickups), 2);
  applyTakenMask(pickups, 1);
  assert.deepEqual(pickups.map((p) => p.taken), [true, false]);
  assert.deepEqual(PICKUP, { width: 0.6, height: 0.6 });
});

test('pickups: two players each take one; a player with a pistol leaves the second for the other; taken stays taken', () => {
  const pickups = createPickups([{ type: 'pickup', item: 'plasmaPistol', x: 2, y: 0 }, { type: 'pickup', item: 'plasmaPistol', x: 6, y: 0 }]);
  const p1 = Object.assign(createPlayer(2.5, 0, SIZE), { onGround: true });
  const p2 = Object.assign(createPlayer(20, 0, SIZE), { onGround: true });
  stepPickups(pickups, [p1, p2]);
  assert.deepEqual(p1.inventory, ['plasmaPistol']);
  assert.deepEqual(pickups.map((p) => p.taken), [true, false]);
  // P1 walks over the second one: it already carries a pistol (onlyOne), so the pickup stays.
  p1.x = 6.5;
  stepPickups(pickups, [p1, p2]);
  assert.deepEqual(p1.inventory, ['plasmaPistol']);
  assert.equal(pickups[1].taken, false);
  // P2 comes along later and takes it.
  p2.x = 6.6;
  stepPickups(pickups, [p1, p2]);
  assert.deepEqual(p2.inventory, ['plasmaPistol']);
  assert.equal(pickups[1].taken, true);
  // Used up: a fresh player on the first spot gets nothing.
  const p3 = Object.assign(createPlayer(2.5, 0, SIZE), { onGround: true });
  stepPickups(pickups, [p3]);
  assert.deepEqual(p3.inventory, []);
  // Not on row 0, or not touching: nothing.
  const fresh = createPickups([{ type: 'pickup', item: 'plasmaPistol', x: 2, y: 0 }]);
  stepPickups(fresh, [Object.assign(createPlayer(2.5, 0, SIZE), { row: 1 }), Object.assign(createPlayer(2.5 + 0.3 + 0.275 + 0.01, 0, SIZE), {})]);
  assert.equal(fresh[0].taken, false);
  // A tie goes to the first slot.
  const both = [Object.assign(createPlayer(2.5, 0, SIZE), {}), Object.assign(createPlayer(2.5, 0, SIZE), {})];
  stepPickups(fresh, both);
  assert.deepEqual(both.map((p) => p.inventory.length), [1, 0]);
});

const walkway = () => loadGridMap(JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8')));

test('pickups: a death respawn keeps the pistol and resets fireTicks; another map has none and the fire button punches', () => {
  const map = walkway();
  const state = initSandbox(map);
  assert.deepEqual(state.pickups, []);
  assert.deepEqual(state.bolts, []);
  tickSandbox(state, [fire()], STEP, map.tiles);
  assert.equal(state.players[0].meleeTicks, MELEE.cooldownTicks, 'the fire button punches');
  assert.deepEqual(state.bolts, []);
  const player = state.players[0];
  Object.assign(player, { x: state.spawn.x + 4, health: ENEMY_ATTACK.damage, onGround: true, inventory: [PLASMA_PISTOL], fireTicks: 12 });
  state.enemies = [Object.assign(createEnemy(player.x + player.size.width / 2 + ENEMY.width / 2 + 0.05, state.spawn.y, 0), { awake: true, onGround: true })];
  state.enemySpawns = [{ x: player.x, y: state.spawn.y }];
  tickSandbox(state, [frame([])], STEP, map.tiles);
  assert.deepEqual([player.x, player.health, player.fireTicks], [state.spawn.x, PLAYER_HEALTH, 0]);
  assert.deepEqual(player.inventory, [PLASMA_PISTOL], 'kept');
});

test('sandbox draw: pools of 8 bolts (core and halo) and 8 pickups per view, hidden while unused; nothing made per frame', async () => {
  const { createSandbox, BOLT_COLOR, PICKUP_COLOR } = await import('../src/scenes/sandbox.js');
  const { createViewMode } = await import('../src/scenes/sandbox-3d.js');
  const { fakeLoadLut } = await import('./fakes.js');
  const json = JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
  for (const mode of ['2d', '2.5d']) {
    let rendered;
    const renderer = { render: (scene) => (rendered = scene) };
    const scene = createSandbox({ loadLut: fakeLoadLut, viewMode: createViewMode({ mode }), fetchJson: async () => json });
    await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
    const state = scene.enter();
    const view = { renderer, width: 800, height: 600, setAimOrigin: () => {} };
    const of = (colour) => rendered.children.filter((o) => o.isMesh && o.material.color?.getHex() === colour);
    scene.draw(state, view);
    const count = rendered.children.length;
    assert.equal(of(BOLT_COLOR).length, 2 * MAX_BOLTS, mode);
    assert.equal(of(PICKUP_COLOR).length, MAX_PICKUPS, mode);
    assert.ok([...of(BOLT_COLOR), ...of(PICKUP_COLOR)].every((m) => !m.visible), `${mode}: all hidden`);
    state.bolts = [{ id: 4, owner: 0, x: 5, y: 3, angle: 0.5, row: 1, age: 2 }];
    state.pickups = [{ id: 0, item: 'plasmaPistol', x: 7.5, y: 2, taken: false }, { id: 1, item: 'plasmaPistol', x: 9.5, y: 2, taken: true }];
    scene.draw(state, view);
    assert.equal(rendered.children.length, count, 'nothing added');
    const bolts = of(BOLT_COLOR).filter((m) => m.visible);
    assert.equal(bolts.length, 2);
    for (const m of bolts) {
      assert.deepEqual([m.position.x, m.position.y, m.rotation.z], [5, 3, 0.5]);
      if (mode === '2.5d') assert.ok(m.position.z > 1 && m.position.z < 1.1, `at row 1's depth: ${m.position.z}`);
    }
    const pickups = of(PICKUP_COLOR).filter((m) => m.visible);
    assert.equal(pickups.length, 1, 'the taken one is hidden');
    assert.equal(pickups[0].position.x, 7.5);
  }
});
