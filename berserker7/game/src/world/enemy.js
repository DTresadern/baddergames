// Sandbox enemies: boxes that wait until a player comes near, then walk towards the nearest player
// for good. Pure logic, no three.js. No damage, no attacks, no pushing or blocking players.
// Enemy data is plain: { x, y, vx, vy, onGround, awake, aim, crouching, size }, with x, y the
// bottom-centre like a player, so stepPlayer moves it (aim and crouching are always 0 and false).

import { MOVE, playerHeight, stepPlayer } from './player.js';

// Box size (tiles), wake-up distance (tiles, centre to centre) and the distance in x under which
// an awake enemy stops walking (tiles).
export const ENEMY = Object.freeze({ width: 0.8, height: 0.9, triggerDistance: 7, stopDistance: 0.3 });

// Enemy movement: slower than a player, no jump; gravity and fall speed as MOVE.
export const ENEMY_MOVE = Object.freeze({ ...MOVE, maxSpeed: 3, groundAccel: 30, groundFriction: 30, jumpSpeed: 0 });

const ENEMY_SIZE = Object.freeze({ width: ENEMY.width, height: ENEMY.height, crouchHeight: ENEMY.height });

// A new idle enemy with its feet at (x, y).
export function createEnemy(x, y) {
  return { x, y, vx: 0, vy: 0, onGround: false, awake: false, aim: 0, crouching: false, size: { ...ENEMY_SIZE } };
}

const centre = (body) => ({ x: body.x, y: body.y + playerHeight(body) / 2 });

// The present player nearest to the enemy (centre to centre) with its distance, or null.
function nearestPlayer(enemy, players) {
  const e = centre(enemy);
  let best = null;
  for (const player of players) {
    if (!player) continue;
    const p = centre(player);
    const distance = Math.hypot(p.x - e.x, p.y - e.y);
    if (best === null || distance < best.distance) best = { player, distance };
  }
  return best;
}

// The synthetic input frame of an enemy walking towards `targetX` (nothing held within stopDistance).
function walkFrame(enemy, targetX) {
  const dx = targetX - enemy.x;
  const held = (on) => ({ held: on, pressed: false, released: false });
  const walking = Math.abs(dx) >= ENEMY.stopDistance;
  return { connected: true, actions: { moveLeft: held(walking && dx < 0), moveRight: held(walking && dx > 0) } };
}

// Advances `enemy` by `dt` seconds. Idle (awake false) until a present player's centre is within
// triggerDistance of the enemy's centre; once awake it stays awake and walks towards the nearest
// present player's x. Idle enemies still fall. `world` is stepPlayer's (platforms); the movement
// numbers are always ENEMY_MOVE.
export function stepEnemy(enemy, players, tiles, dt, world) {
  const nearest = nearestPlayer(enemy, players);
  if (!enemy.awake && nearest && nearest.distance <= ENEMY.triggerDistance) enemy.awake = true;
  const frame = enemy.awake && nearest ? walkFrame(enemy, nearest.player.x) : null;
  return stepPlayer(enemy, frame, tiles, dt, { ...world, move: ENEMY_MOVE });
}
