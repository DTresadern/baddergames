// Plasma pistol bolts (issue #133). Pure logic, no three.js; plain data, deterministic.
// Host and offline only: tickSandbox (scenes/sandbox.js) calls stepBolts after the enemies step and
// before resolveCombat, so an enemy a bolt brings to 0 health is removed by resolveCombat's filter.
// A guest never steps bolts: it draws the host's from the snapshots (net/session.js remoteBolts).
//
// Bolt data: { id, owner (player slot), x, y (tiles), angle (radians, y up), row, age (ticks moved) }.
// A bolt is a point for tiles and platforms; per tick it moves PISTOL.speed * dt along its angle in
// sub-steps of at most SUB_STEP tiles and stops at the first sample point that:
//   1. lies in an enemy's box grown by PISTOL.radius (only on ENEMY_ROW; enemies at 0 health are
//      skipped): damage(enemy, PISTOL.damage, 'pistol');
//   2. lies in a solid tile of the bolt's own row (a missing row is empty);
//   3. lies in a moving platform's `now` box (row 0 only: platforms exist only there).
// Players are never checked: bolts pass through every player (no friendly fire).

import { ENEMY_ROW, PISTOL, damage, fired } from './combat.js';
import { playerHeight } from './player.js';

// Bolts the world (and a snapshot) holds at once; adding one more drops the oldest.
export const MAX_BOLTS = 8;
// Largest bolt id; ids count up from 0 and wrap after this.
export const BOLT_ID_MAX = 65535;
// Longest sub-step of a bolt's move, tiles (under one tile, so a bolt never skips a 1-tile wall).
export const SUB_STEP = 0.25;

// A new bolt from the player's head (the aim line's start) along its aim, on its row.
export function createBolt(id, owner, player) {
  return { id, owner, x: player.x, y: player.y + playerHeight(player), angle: player.aim, row: player.row ?? 0, age: 0 };
}

// True when the point (x, y) lies in the enemy's box grown by PISTOL.radius.
function hitsEnemy(enemy, x, y) {
  const r = PISTOL.radius;
  return Math.abs(x - enemy.x) <= enemy.size.width / 2 + r && y >= enemy.y - r && y <= enemy.y + enemy.size.height + r;
}

const inBox = (b, x, y) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;

// Moves `bolt` one tick (dt seconds) and ages it. `world`: { enemies, rows (Map row -> tile map),
// platforms ([{ prev, now }] of this tick) }. Returns true when it hit something (it stops there).
export function moveBolt(bolt, { enemies, rows, platforms }, dt) {
  const distance = PISTOL.speed * dt;
  const steps = Math.max(1, Math.ceil(distance / SUB_STEP));
  const dx = (Math.cos(bolt.angle) * distance) / steps;
  const dy = (Math.sin(bolt.angle) * distance) / steps;
  const tiles = rows.get(bolt.row) ?? null;
  bolt.age += 1;
  for (let i = 0; i < steps; i++) {
    bolt.x += dx;
    bolt.y += dy;
    if (bolt.row === ENEMY_ROW) {
      const enemy = enemies.find((e) => e.health > 0 && hitsEnemy(e, bolt.x, bolt.y));
      if (enemy) {
        damage(enemy, PISTOL.damage, 'pistol');
        return true;
      }
    }
    if (tiles?.isSolid(Math.floor(bolt.x), Math.floor(bolt.y))) return true;
    if (bolt.row === 0 && platforms.some(({ now }) => inBox(now, bolt.x, bolt.y))) return true;
  }
  return false;
}

// One host (or offline) tick of the bolts in state.bolts: (a) every bolt moves; (b) each player
// that fired this tick (fired(), world/combat.js) adds a bolt, which moves once in the same tick;
// (c) a bolt that hit something or reached PISTOL.lifeTicks is removed. Over MAX_BOLTS, the oldest
// goes. `rows`: Map row -> tile map; `platforms`: this tick's [{ prev, now }].
export function stepBolts(state, rows, platforms, dt) {
  const world = { enemies: state.enemies, rows, platforms };
  const alive = (bolt) => !moveBolt(bolt, world, dt) && bolt.age < PISTOL.lifeTicks;
  state.bolts = state.bolts.filter(alive);
  state.players.forEach((player, slot) => {
    if (!player || !fired(player)) return;
    const bolt = createBolt(state.nextBoltId, slot, player);
    state.nextBoltId = (state.nextBoltId + 1) % (BOLT_ID_MAX + 1);
    if (!alive(bolt)) return;
    state.bolts.push(bolt);
    if (state.bolts.length > MAX_BOLTS) state.bolts.shift();
  });
  return state;
}
