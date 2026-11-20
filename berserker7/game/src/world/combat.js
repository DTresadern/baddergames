// Sandbox combat (issue #105): health, the inventory, the player's melee hit and the enemies'
// attack. Pure logic, no three.js. Every number is here.
// One damage function for every source: damage(target, amount) (tracker T-025).
// Melee: the attack key (primaryFire) with an empty inventory, or the melee key (V, gamepad B),
// starts a swing in the aim's direction; it hits every enemy in a box in front of the player once,
// on the swing's first tick. Enemies attack a player close to them: damage and a push away. A
// player a moving platform crushes against a solid block dies.
// Only the host (or offline) decides hits (resolveCombat); a guest predicts its own swing
// (stepMelee) but never resolves it. A player at 0 health goes back to the spawn with full
// health (scenes/sandbox.js owns the spawn).
//
// Player fields (plain data, set by createPlayer): health, inventory (a list of item ids),
// meleeTicks (ticks until the next swing may start; MELEE.cooldownTicks on a swing's first tick),
// meleeDir (1 right, -1 left: the direction of the last swing).
// Enemy fields (createEnemy): health, attackCooldown (ticks until the next attack may happen).

import { PLAYER_HEALTH, playerHeight } from './player.js';
import { ENEMY_HEALTH } from './enemy.js';

// Full health of a player and an enemy (defined next to createPlayer and createEnemy, so those
// files need not import this one).
export { PLAYER_HEALTH, ENEMY_HEALTH };

// reachWidths: reach beyond the player's front edge, in player widths. swingTicks: ticks the swing
// is drawn (0.15 s). cooldownTicks: ticks from one swing's start to the earliest next one (0.3 s).
export const MELEE = Object.freeze({ damage: 10, reachWidths: 1, swingTicks: 9, cooldownTicks: 18 });
// range: the largest horizontal gap between the enemy's and the player's boxes, edge to edge
// (tiles; overlapping is in range); the boxes must also overlap vertically. cooldownTicks: ticks
// between two attacks of one enemy (1 s). pushSpeed, pushLift: the player's vx away from the
// enemy and its smallest vy after a hit (tiles/s).
export const ENEMY_ATTACK = Object.freeze({ damage: 10, range: 0.3, cooldownTicks: 60, pushSpeed: 6, pushLift: 5 });
// Enemies never change rows (world/enemy.js): they are always on row 0.
export const ENEMY_ROW = 0;
// The known item ids, in wire order (bit i of the inventory mask is ITEMS[i]). None yet.
export const ITEMS = Object.freeze([]);

export const hasItem = (body, item) => body.inventory.includes(item);

// Inventory <-> bit mask over ITEMS (for the wire). Unknown ids are not sent.
export function inventoryMask(inventory) {
  return ITEMS.reduce((mask, item, i) => (inventory.includes(item) ? mask | (1 << i) : mask), 0);
}
export function inventoryFromMask(mask) {
  return ITEMS.filter((_, i) => (mask & (1 << i)) !== 0);
}

// Damage sources (the third argument of damage): the player's melee, an enemy's attack, a moving
// platform crushing a player against a solid block.
export const DAMAGE_SOURCES = Object.freeze(['melee', 'enemy', 'crush']);
// A crush always kills: there is no room left, so any health left would leave the player stuck
// inside the platform; at 0 health it goes back to the spawn, which has room.
export const CRUSH_DAMAGE = Infinity;

// The one damage function, for every source (one of DAMAGE_SOURCES; nothing depends on it yet,
// it is there for later rules such as armour). Health never goes below 0. Returns true when it
// reached 0.
export function damage(target, amount, source) {
  if (!DAMAGE_SOURCES.includes(source)) throw new Error(`combat: unknown damage source ${String(source)}`);
  target.health = Math.max(0, target.health - amount);
  return target.health === 0;
}

// The melee direction from the aim: 1 (right, also straight up or down) or -1 (left).
export const facing = (player) => (Math.cos(player.aim) >= 0 ? 1 : -1);

// True when the frame asks for a swing: the melee key, or the attack key with nothing carried.
export function wantsMelee(player, frame) {
  if (!frame?.connected || !frame.actions) return false;
  const { melee, primaryFire } = frame.actions;
  return Boolean(melee?.pressed || (primaryFire?.pressed && player.inventory.length === 0));
}

// One tick of the player's melee timer; starts a swing when one is asked for and allowed. On the
// tick a swing starts, meleeTicks === MELEE.cooldownTicks.
export function stepMelee(player, frame) {
  if (player.meleeTicks > 0) player.meleeTicks -= 1;
  if (player.meleeTicks === 0 && wantsMelee(player, frame)) {
    player.meleeTicks = MELEE.cooldownTicks;
    player.meleeDir = facing(player);
  }
  return player;
}

// True while the swing is drawn (its first swingTicks ticks).
export const swinging = (player) => player.meleeTicks > MELEE.cooldownTicks - MELEE.swingTicks;
// True on the swing's first tick, the only tick it hits.
export const swingStarted = (player) => player.meleeTicks === MELEE.cooldownTicks;

const rowOf = (body) => body.row ?? 0;

// The swing's box { x0, x1, y0, y1 } (tiles): from the player's centre to reachWidths player
// widths beyond its front edge, in meleeDir, over the player's current height.
export function meleeBox(player) {
  const width = player.size.width;
  const tip = player.x + player.meleeDir * (width / 2 + MELEE.reachWidths * width);
  return { x0: Math.min(player.x, tip), x1: Math.max(player.x, tip), y0: player.y, y1: player.y + playerHeight(player) };
}

const bodyBox = (body) => ({ x0: body.x - body.size.width / 2, x1: body.x + body.size.width / 2, y0: body.y, y1: body.y + playerHeight(body) });
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The enemies the player's swing box overlaps; none unless the player is on the enemies' row.
export function meleeHits(player, enemies) {
  if (rowOf(player) !== ENEMY_ROW) return [];
  const box = meleeBox(player);
  return enemies.filter((enemy) => overlaps(box, bodyBox(enemy)));
}

// The present player on ENEMY_ROW nearest to the enemy (centre to centre) that is within
// ENEMY_ATTACK.range (horizontal gap edge to edge, vertical overlap), or null.
export function enemyAttackTarget(enemy, players) {
  const e = bodyBox(enemy);
  let best = null;
  let bestDistance = Infinity;
  for (const player of players) {
    if (!player || rowOf(player) !== ENEMY_ROW) continue;
    const p = bodyBox(player);
    const gap = Math.max(0, p.x0 - e.x1, e.x0 - p.x1);
    if (gap > ENEMY_ATTACK.range || !(p.y0 < e.y1 && e.y0 < p.y1)) continue;
    const distance = Math.hypot(player.x - enemy.x, (p.y0 + p.y1) / 2 - (e.y0 + e.y1) / 2);
    if (distance < bestDistance) {
      best = player;
      bestDistance = distance;
    }
  }
  return best;
}

// Pushes `player` away from `enemy`: by the sign of player.x - enemy.x, or with equal x the way
// the enemy faces (its vx; right when it stands still).
function push(player, enemy) {
  const dx = player.x - enemy.x;
  const away = dx !== 0 ? Math.sign(dx) : enemy.vx < 0 ? -1 : 1;
  player.vx = away * ENEMY_ATTACK.pushSpeed;
  player.vy = Math.max(player.vy, ENEMY_ATTACK.pushLift);
  player.onGround = false;
}

// Host and offline only, after players and enemies have stepped this tick: (0) a crushed player
// dies (CRUSH_DAMAGE); (a) every swing that
// started this tick damages each enemy in its box once; (b) enemies at 0 health are removed from
// state.enemies; (c) each remaining enemy counts its cooldown down and, at 0 and awake, attacks
// the nearest player in range (damage, push, cooldown). Returns the slots of the players at 0
// health (scenes/sandbox.js sends them back to the spawn).
export function resolveCombat(state) {
  const players = state.players;
  // (0) a player a moving platform crushed this tick (pushByPlatforms in world/player.js) dies.
  for (const player of players) if (player?.crushed) damage(player, CRUSH_DAMAGE, 'crush');
  for (const player of players) {
    if (!player || !swingStarted(player)) continue;
    for (const enemy of meleeHits(player, state.enemies)) damage(enemy, MELEE.damage, 'melee');
  }
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  for (const enemy of state.enemies) {
    if (enemy.attackCooldown > 0) enemy.attackCooldown -= 1;
    if (enemy.attackCooldown > 0 || !enemy.awake) continue;
    const target = enemyAttackTarget(enemy, players);
    if (!target) continue;
    damage(target, ENEMY_ATTACK.damage, 'enemy');
    push(target, enemy);
    enemy.attackCooldown = ENEMY_ATTACK.cooldownTicks;
  }
  const dead = [];
  players.forEach((player, slot) => {
    if (player && player.health === 0) dead.push(slot);
  });
  return dead;
}
