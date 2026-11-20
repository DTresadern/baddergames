// Depth rows (issue #98). Pure logic, no three.js.
// A cells map's depth slices (z values) are rows; a player collides only with the blocks of the
// row it is on (`player.row`). The map's transfer zones (`transfers: [{ x0, x1, low, high }]`,
// world/cell-map.js) are where a player can switch between two adjacent rows: inside a zone
// "descend" moves to the row whose floor is lower there (`low`), "ascend" to the higher one
// (`high`). The switch is a short scripted hop, HOP_TICKS long, driven by the tick: across in
// depth and up or down to the landing found on the target row. A blocked landing: nothing happens.
// Outside a zone (or when blocked) crouch and jump behave exactly as before (world/player.js).
//
// Controls, two schemes (the input frame's `rowScheme`; anything but 'B' is 'A'):
//   A: descend = crouch, then jump; ascend = jump, then crouch while in the air.
//   B: descend = crouch twice; ascend = jump twice.
// The two presses must be at most ROW_WINDOW_TICKS apart.
//
// Player fields (plain data, set by createPlayer):
//   row      the z of the row the player is on
//   hop      null, or an active hop { to, t, y0, y1 }: target row, ticks done (1..HOP_TICKS), start
//            y, landing y
//   presses  { down, jump }: ticks since the last moveDown / jump (jump or moveUp) press, capped at
//            PRESS_NONE

import { PRESS_NONE, stepPlayer } from './player.js';
import { createTileMap } from './tilemap.js';

export const ROW_WINDOW_TICKS = 12; // 200 ms at 60 Hz: the two presses at most this many ticks apart
export const HOP_TICKS = 15; // 0.25 s
export const HOP_ARC = 0.5; // tiles: the hop's height above the straight line at its middle
export const ROW_RISE_MAX = 3; // tiles above the current floor a landing is searched
export const ROW_DROP_MAX = 6; // tiles below the current floor a landing is searched
export { PRESS_NONE }; // press age meaning "no recent press" (ages are capped there; 255)
export const ROW_SCHEMES = Object.freeze(['A', 'B']);
export const DEFAULT_ROW_SCHEME = 'A';
export const ROW_LIMIT = 64; // rows are -ROW_LIMIT..ROW_LIMIT (the codec's range)

// Same gap as world/player.js: a box resting exactly on a tile edge does not overlap it.
const EPSILON = 1e-6;
// A row the map has no cells on.
const EMPTY = Object.freeze(createTileMap({ types: [{ solid: false }] }));

// The row scheme chosen in the debug panel, carried on each input frame (`rowScheme`). Unknown
// values are ignored. Not saved.
export function createRowScheme(initial = DEFAULT_ROW_SCHEME) {
  let current = ROW_SCHEMES.includes(initial) ? initial : DEFAULT_ROW_SCHEME;
  return {
    get: () => current,
    set(v) {
      if (ROW_SCHEMES.includes(v)) current = v;
      return current;
    },
  };
}

// Tile columns the box overlaps, inclusive (the rule of world/player.js).
function columnsOf(player) {
  const half = player.size.width / 2;
  return { x0: Math.floor(player.x - half + EPSILON), x1: Math.floor(player.x + half - EPSILON) };
}

// The first transfer zone whose columns contain player.x and which connects the player's row, or null.
export function zoneAt(transfers, player) {
  return transfers.find((t) => t.x0 <= player.x && player.x < t.x1 + 1 && (t.low === player.row || t.high === player.row)) ?? null;
}

// The top of the first solid tile under the box (any column it overlaps), scanning down from the
// tile containing the feet for at most ROW_DROP_MAX + ROW_RISE_MAX tiles; null if none. In the air
// this is the floor below.
export function floorBelow(tiles, player) {
  const { x0, x1 } = columnsOf(player);
  const start = Math.floor(player.y - EPSILON);
  for (let ty = start; ty > start - (ROW_DROP_MAX + ROW_RISE_MAX); ty--) {
    for (let tx = x0; tx <= x1; tx++) if (tiles.isSolid(tx, ty)) return ty + 1;
  }
  return null;
}

// True when a standing box at (player.x, y) overlaps no solid tile of `tiles`.
function standsClear(tiles, player, y) {
  const { x0, x1 } = columnsOf(player);
  const y1 = Math.floor(y + player.size.height - EPSILON);
  for (let ty = Math.floor(y + EPSILON); ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (tiles.isSolid(tx, ty)) return false;
  }
  return true;
}

// The landing top on the target row's tiles, or null (blocked). `from` is the reference floor y;
// `dir` 'ascend' searches whole tops from < top <= from + ROW_RISE_MAX, 'descend'
// from - ROW_DROP_MAX <= top < from, highest first. A top is valid when a column under the box
// has a solid tile just below it and the standing box there overlaps no solid tile.
export function findLanding(targetTiles, player, from, dir) {
  const hi = dir === 'ascend' ? Math.floor(from + ROW_RISE_MAX) : Math.ceil(from) - 1;
  const lo = dir === 'ascend' ? Math.floor(from) + 1 : Math.ceil(from - ROW_DROP_MAX);
  const { x0, x1 } = columnsOf(player);
  for (let top = hi; top >= lo; top--) {
    let floor = false;
    for (let tx = x0; tx <= x1 && !floor; tx++) floor = targetTiles.isSolid(tx, top - 1);
    if (floor && standsClear(targetTiles, player, top)) return top;
  }
  return null;
}

const ease = (s) => s * s * (3 - 2 * s); // smoothstep

// The drawn depth (z): the row, or during a hop eased from the row to the target.
export function playerDepth(player) {
  const { row, hop } = player;
  return hop ? row + (hop.to - row) * ease(hop.t / HOP_TICKS) : row;
}

// One hop tick: input is ignored except aim. The last tick puts the player on the target row,
// standing on the landing.
function advanceHop(player, frame) {
  if (frame?.connected && Number.isFinite(frame.aim)) player.aim = frame.aim;
  const hop = player.hop;
  hop.t += 1;
  const s = hop.t / HOP_TICKS;
  player.y = hop.y0 + (hop.y1 - hop.y0) * s + HOP_ARC * 4 * s * (1 - s);
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  if (hop.t >= HOP_TICKS) {
    Object.assign(player, { row: hop.to, y: hop.y1, hop: null, onGround: true, crouching: false });
  }
}

// One tick for a Sandbox player. `rows` is the map's Map z -> tile map (a missing row is empty),
// `transfers` its transfer zones; `world` as for stepPlayer (moving platforms are on row 0 only).
export function stepRowPlayer(player, frame, rows, transfers, dt, world) {
  const presses = player.presses;
  presses.down = Math.min(PRESS_NONE, presses.down + 1);
  presses.jump = Math.min(PRESS_NONE, presses.jump + 1);
  if (player.hop) {
    advanceHop(player, frame);
    return player;
  }
  const actions = frame?.connected ? frame.actions : undefined;
  const downPressed = Boolean(actions?.moveDown?.pressed);
  const jumpPressed = Boolean(actions?.jump?.pressed || actions?.moveUp?.pressed);
  // The intent, from the press ages before this tick's presses are recorded.
  let intent = null;
  if (frame?.rowScheme === 'B') {
    if (downPressed && presses.down <= ROW_WINDOW_TICKS) intent = 'descend';
    else if (jumpPressed && presses.jump <= ROW_WINDOW_TICKS) intent = 'ascend';
  } else {
    // A down and a jump in the same frame also count: the host's guest-input queue can merge two
    // consecutive frames into one (net/session.js), and the host must still see the descend. A
    // merged scheme A ascend (jump, then down) or scheme B double press is lost there; the next
    // snapshot corrects the guest's prediction.
    if (jumpPressed && (downPressed || presses.down <= ROW_WINDOW_TICKS)) intent = 'descend';
    else if (downPressed && !player.onGround && presses.jump <= ROW_WINDOW_TICKS) intent = 'ascend';
  }
  if (downPressed) presses.down = 0;
  if (jumpPressed) presses.jump = 0;
  const zone = intent ? zoneAt(transfers, player) : null;
  if (zone && player.row === (intent === 'descend' ? zone.high : zone.low)) {
    const target = intent === 'descend' ? zone.low : zone.high;
    const from = floorBelow(rows.get(player.row) ?? EMPTY, player) ?? player.y;
    const top = findLanding(rows.get(target) ?? EMPTY, player, from, intent);
    if (top !== null) {
      // The press is used by the hop: no normal jump this tick. Both ages reset, so a third
      // press does not start another.
      Object.assign(player, { hop: { to: target, t: 0, y0: player.y, y1: top }, crouching: false, vx: 0, vy: 0 });
      presses.down = PRESS_NONE;
      presses.jump = PRESS_NONE;
      advanceHop(player, frame);
      return player;
    }
  }
  return stepPlayer(player, frame, rows.get(player.row) ?? EMPTY, dt, player.row === 0 ? world : undefined);
}
