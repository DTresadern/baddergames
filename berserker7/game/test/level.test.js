import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildLevel, mapText } from '../tools/build-level.mjs';
import { depthRowsTransfers } from '../tools/levels/depth-rows-test.mjs';
import { LIGHTING } from '../tools/levels/moge3-cyberpunk-blocks.sections.mjs';
import { loadMap } from '../src/world/load-map.js';
import { createPlayer } from '../src/world/player.js';
import { fallPathClear, findLanding, floorBelow } from '../src/world/rows.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('level: the committed moge3-cyberpunk-blocks map is exactly the build output (npm run build:level)', () => {
  assert.equal(read('../public/content/maps/moge3-cyberpunk-blocks.json'), mapText(buildLevel()));
  const base = JSON.parse(read('../tools/moge3-cyberpunk-blocks.base.json'));
  const cells = new Set(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')).cells.map((c) => c.join(',')));
  assert.ok(base.cells.every((c) => cells.has(c.join(','))), 'every base cell is kept');
  // The sections' ATLAS is written as `atlas`, directly after `tile`.
  const keys = Object.keys(buildLevel());
  assert.equal(keys.indexOf('atlas'), keys.indexOf('tile') + 1);
  assert.equal(buildLevel().atlas, 'blocks-placeholder');
  // The sections' LIGHTING is written as `lighting`, directly after `atlas` (a copy).
  assert.equal(keys.indexOf('lighting'), keys.indexOf('atlas') + 1);
  assert.deepEqual(buildLevel().lighting, LIGHTING);
  assert.notEqual(buildLevel().lighting, LIGHTING);
  const map = JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json'));
  assert.deepEqual(map.lighting, LIGHTING);
  assert.deepEqual(Object.keys(map).slice(4, 7), ['tile', 'atlas', 'lighting']);
});

test('level: the depth rows part (x 151-297) is joined at the open end of G; its nine zones find their landings', () => {
  const map = loadMap(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')));
  // The old end wall at x 150 is gone; the roof at top 9 runs through it.
  for (let y = 9; y <= 15; y++) assert.equal(map.tiles.isSolid(150, y), false, `x 150 y ${y} is open`);
  assert.equal(map.tiles.isSolid(150, 8), true, 'x 150: roof, top 9');
  for (const row of [-1, 0, 1]) assert.ok(map.rows.has(row), `row ${row}`);
  assert.deepEqual(map.transfers, depthRowsTransfers(151));
  // Per zone: [floor top on the high row, floor top on the low row] (depth-rows-test tops + 9).
  const tops = [[9, 7], [9, 7], [11, 9], [11, 9], [9, 6], [9, 6], [12, 9], [14, 9], [12, 9]];
  const JUMP_TOP_REACH = 3.628; // jump top 2.428 + height 1.2
  map.transfers.forEach((zone, i) => {
    const [highTop, lowTop] = tops[i];
    for (let x = zone.x0; x <= zone.x1; x++) {
      const at = (row, y) => Object.assign(createPlayer(x + 0.5, y, map.player), { row });
      const high = at(zone.high, highTop);
      assert.equal(floorBelow(map.rows.get(zone.high), high), highTop, `zone ${i} x ${x}: high floor`);
      assert.equal(findLanding(map.rows.get(zone.low), high, highTop, 'descend'), lowTop, `zone ${i} x ${x}: descend`);
      assert.equal(fallPathClear(map.rows.get(zone.low), high, lowTop), true, `zone ${i} x ${x}: fall path`);
      const low = at(zone.low, lowTop);
      assert.equal(floorBelow(map.rows.get(zone.low), low), lowTop, `zone ${i} x ${x}: low floor`);
      // H (i 7) is out of reach even at the top of a jump.
      assert.equal(findLanding(map.rows.get(zone.high), low, lowTop, 'ascend', lowTop + JUMP_TOP_REACH), i === 7 ? null : highTop, `zone ${i} x ${x}: ascend`);
    }
  });
});

test('level: two plasma pistol pickups on the walkway (row 0, top 0) between the player spawn and the first enemy', () => {
  const map = loadMap(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')));
  const pickups = map.spawns.filter((s) => s.type === 'pickup');
  assert.deepEqual(pickups, [{ type: 'pickup', item: 'plasmaPistol', x: 2, y: 0 }, { type: 'pickup', item: 'plasmaPistol', x: 6, y: 0 }]);
  const spawn = map.spawns.find((s) => s.type === 'player');
  const firstEnemy = Math.min(...map.spawns.filter((s) => s.type === 'enemy').map((s) => s.x));
  assert.equal(firstEnemy, 22);
  for (const p of pickups) {
    assert.ok(p.x > spawn.x && p.x < firstEnemy, `x ${p.x}`);
    assert.ok(map.tiles.isSolid(p.x, p.y - 1) && !map.tiles.isSolid(p.x, p.y), `on the walkway at x ${p.x}`);
  }
  assert.equal(map.spawns.length, 13);
});

test('level: from the spawn the player walks right, picks up a pistol, climbs the crate step and shoots the first enemy dead', async () => {
  const { OFFLINE_NET, initSandbox, tickSandbox } = await import('../src/scenes/sandbox.js');
  const { frame } = await import('./frames.js');
  const map = loadMap(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')));
  const state = initSandbox(map, 'map.moge3-cyberpunk-blocks');
  const player = state.players[0];
  let pickedAt = null;
  let shots = 0;
  let killedAt = null;
  for (let t = 0; t < 600 && killedAt === null; t++) {
    const enemy = state.enemies.find((e) => e.id === 0);
    const keys = [];
    // Walk to the crate step (x 18-19, top 1), jump onto it and stop on it.
    if (player.onGround && player.y < 0.5) keys.push(player.x < 17 ? 'moveRight' : 'jump');
    else if (!player.onGround) keys.push(player.x < 18.8 ? 'moveRight' : 'moveLeft');
    const f = frame(keys);
    // On the crate: hold the attack key, aimed from the head at the enemy's centre.
    if (player.onGround && player.y >= 1) {
      f.actions.primaryFire = { held: true, pressed: false, released: false };
      f.aim = Math.atan2(enemy.y + enemy.size.height / 2 - (player.y + player.size.height), enemy.x - player.x);
    }
    const bolts = state.bolts.length;
    tickSandbox(state, [f], 1 / 60, map.tiles, 0, OFFLINE_NET, map);
    if (pickedAt === null && player.inventory.length > 0) pickedAt = player.x;
    if (state.bolts.length > bolts) shots += 1;
    if (!state.enemies.some((e) => e.id === 0)) killedAt = t;
  }
  assert.deepEqual(player.inventory, ['plasmaPistol']);
  assert.ok(pickedAt > 1.5 && pickedAt < 3.5, `picked up at x ${pickedAt}`);
  assert.deepEqual(state.pickups.map((p) => p.taken), [true, false], 'the second is left for player 2');
  assert.ok(killedAt !== null, 'the first enemy is dead');
  assert.equal(shots, 2, 'two bolts');
  assert.equal(player.health, 100);
  assert.equal(player.meleeTicks, 0, 'no swing');
});
