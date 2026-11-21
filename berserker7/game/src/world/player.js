// The Sandbox player: a box moved by input and collided with solid tiles and moving platforms
// (solid like tiles). Enemies are bodies of the same kind (world/enemy.js). Pure logic, no three.js.
// One world unit is one tile; x is right, y is up. The position is the bottom-centre of the box:
// the box covers x - width / 2 .. x + width / 2 and y .. y + height.
// Player data is plain: { x, y, vx, vy, onGround, aim, crouching, size, row, hop, presses, health,
// inventory, meleeTicks, meleeDir, fireTicks, crushed } (aim in radians, y up, 0 = right). row, hop and presses
// belong to depth rows (world/rows.js); health, inventory, meleeTicks, meleeDir and fireTicks to combat
// (world/combat.js); stepPlayer leaves them alone. crushed: set by stepPlayer on every step (a
// moving platform crushed the body this step).

// Default box size, tiles. A map may override it (top-level `player` field); the player carries its
// own copy in `player.size`. crouchHeight: box height while crouched (feet stay put).
export const PLAYER_SIZE = Object.freeze({ width: 1, height: 2, crouchHeight: 1 });

// The map's size over the defaults: { width, height, crouchHeight } (plain data).
export function playerSize(overrides) {
  return { ...PLAYER_SIZE, ...overrides };
}

// Every movement number. Units: tiles, tiles/s, tiles/s^2.
export const MOVE = Object.freeze({
  maxSpeed: 8, // top horizontal speed, tiles/s
  groundAccel: 60, // horizontal acceleration towards the input direction on the ground, tiles/s^2
  groundFriction: 50, // horizontal slowing with no input on the ground, tiles/s^2
  airAccel: 30, // horizontal acceleration towards the input direction in the air, tiles/s^2
  airFriction: 5, // horizontal slowing with no input in the air, tiles/s^2
  gravity: 50, // downward acceleration, tiles/s^2
  jumpSpeed: 16, // upward speed at the start of a jump, tiles/s (peak about 2.5 tiles)
  maxFallSpeed: 30, // fastest fall, tiles/s
});

// Gap that stops a box resting exactly on a tile edge from counting as overlapping it, tiles.
const EPSILON = 1e-6;

// Press age meaning "no recent press" (world/rows.js re-exports it; defined here so rows.js can
// import this module without a cycle).
export const PRESS_NONE = 255;

// A player's full health (world/combat.js re-exports it; defined here so combat.js can import this
// module without a cycle).
export const PLAYER_HEALTH = 100;

export function createPlayer(x, y, size = PLAYER_SIZE) {
  return { x, y, vx: 0, vy: 0, onGround: false, aim: 0, crouching: false, size: { ...size }, row: 0, hop: null, presses: { down: PRESS_NONE, jump: PRESS_NONE }, health: PLAYER_HEALTH, inventory: [], meleeTicks: 0, meleeDir: 1, fireTicks: 0, crushed: false };
}

// Moves `value` towards `target` by at most `amount`, never past it.
function approach(value, target, amount) {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}

// The box's current height: the player's size.crouchHeight while crouched, else size.height.
export function playerHeight(player) {
  return player.crouching ? player.size.crouchHeight : player.size.height;
}

// Gap within which feet count as standing on a platform's top (riding), tiles.
const RIDE_TOLERANCE = 1e-3;
const NO_PLATFORMS = Object.freeze([]);

// A body's box { x0, x1, y0, y1 } at (x, y) with its current height.
function bodyBox(body, x = body.x, y = body.y) {
  const half = body.size.width / 2;
  return { x0: x - half, x1: x + half, y0: y, y1: y + playerHeight(body) };
}
// A platform box { x, y, width, height } as { x0, x1, y0, y1 }.
const edges = (p) => ({ x0: p.x, x1: p.x + p.width, y0: p.y, y1: p.y + p.height });
// True when two boxes overlap by more than EPSILON on both axes (touching does not count).
const overlaps = (a, b) => a.x0 < b.x1 - EPSILON && b.x0 < a.x1 - EPSILON && a.y0 < b.y1 - EPSILON && b.y0 < a.y1 - EPSILON;

// Every solid a box overlaps, tiles and platform boxes together: { left, right, bottom, top } with
// left the smallest left edge, right the largest right edge, bottom the smallest bottom edge and
// top the largest top edge among them, or null when it overlaps none. `solids` are platform edges.
function solidHit(tiles, solids, box) {
  let hit = null;
  const add = (s) => {
    if (hit === null) hit = { left: s.x0, right: s.x1, bottom: s.y0, top: s.y1 };
    else {
      hit.left = Math.min(hit.left, s.x0);
      hit.right = Math.max(hit.right, s.x1);
      hit.bottom = Math.min(hit.bottom, s.y0);
      hit.top = Math.max(hit.top, s.y1);
    }
  };
  for (let ty = Math.floor(box.y0 + EPSILON); ty <= Math.floor(box.y1 - EPSILON); ty++) {
    for (let tx = Math.floor(box.x0 + EPSILON); tx <= Math.floor(box.x1 - EPSILON); tx++) {
      if (tiles.isSolid(tx, ty)) add({ x0: tx, x1: tx + 1, y0: ty, y1: ty + 1 });
    }
  }
  for (const s of solids) if (overlaps(box, s)) add(s);
  return hit;
}

// True when `body` stands on the platform box `box` (on the ground, feet on its top, overlapping
// it horizontally): a rider.
function ridesOn(body, box) {
  const b = bodyBox(body);
  return body.onGround && Math.abs(b.y0 - (box.y + box.height)) < RIDE_TOLERANCE && b.x0 < box.x + box.width - EPSILON && box.x < b.x1 - EPSILON;
}

// Moving platforms are solid, like tiles, and move before the bodies (the kinematic solid model):
// each platform moves from `prev` to `now`, x first, then y. On each axis:
//   - a rider (feet on the top at the start of the step) is carried by the movement. Carried
//     sideways into a tile or another platform, it stops against it; carried up into one (a
//     ceiling), it is crushed;
//   - any other body the moved platform now overlaps is pushed out along the movement by exactly
//     the overlap (to the platform's leading edge). Pushed up, a falling vy stops; pushed down, a
//     rising vy stops. A push that would put it into a tile or another platform crushes it.
// A crushed body stays where it was before that push or carry; `body.crushed` is set. Returns true
// when crushed. `others` are the edges of every other platform (their `now` boxes).
function movePlatform(body, { prev, now }, others, tiles) {
  const riding = ridesOn(body, prev);
  const mid = { ...prev, x: now.x }; // after the x part of the move
  const blocked = (x, y) => solidHit(tiles, others, bodyBox(body, x, y)) !== null;
  // x part
  const dx = now.x - prev.x;
  if (dx !== 0) {
    if (riding) {
      const x = body.x + dx;
      const hit = solidHit(tiles, others, bodyBox(body, x, body.y));
      body.x = hit === null ? x : dx > 0 ? hit.left - body.size.width / 2 : hit.right + body.size.width / 2;
    } else if (overlaps(bodyBox(body), edges(mid))) {
      const m = edges(mid);
      const x = dx > 0 ? m.x1 + body.size.width / 2 : m.x0 - body.size.width / 2;
      if (blocked(x, body.y)) return (body.crushed = true);
      body.x = x;
    }
  }
  // y part
  const dy = now.y - prev.y;
  if (dy !== 0) {
    if (riding) {
      const y = body.y + dy;
      if (blocked(body.x, y)) {
        if (dy > 0) return (body.crushed = true); // carried up into a ceiling
      } else body.y = y;
    } else if (overlaps(bodyBox(body), edges(now))) {
      const n = edges(now);
      const y = dy > 0 ? n.y1 : n.y0 - playerHeight(body);
      if (blocked(body.x, y)) return (body.crushed = true);
      body.y = y;
      body.vy = dy > 0 ? Math.max(body.vy, 0) : Math.min(body.vy, 0);
    }
  }
  return false;
}

// Advances `player` (a player or an enemy: a body) by `dt` seconds. `frame` is its input frame
// (missing or not connected: no input, gravity still applies). `tiles` is a tile map.
// `world` (optional): { platforms: [{ prev, now }], move }. `prev` and `now` are a moving
// platform's boxes (platformAt) at the world tick before and after this step; `move` replaces MOVE
// (enemies). Without it the step is exactly the tiles-only one.
// Platforms are solid, exactly like tiles: first they move (movePlatform: carry riders, push
// bodies, crush), then the body moves on its own, colliding on x and then on y with tiles and the
// platforms' `now` boxes in one query. `player.crushed` is set on every step (true: the host
// kills it, world/combat.js); a crushed body does not move on its own that step.
// No swept collision: a step must stay shorter than the body plus the thinnest solid along the
// axis (at maxFallSpeed 30 tiles/s and 1/60 s a fall step is 0.5 tile; the thinnest platform is
// 0.5 tall and a player 0.6 crouched), and a platform's step shorter than a body's width or height,
// so nothing skips through. Keep dt small to keep that true.
export function stepPlayer(player, frame, tiles, dt, world) {
  const move = world?.move ?? MOVE;
  const platforms = world?.platforms ?? NO_PLATFORMS;
  player.crushed = false;
  const solids = platforms.map(({ now }) => edges(now));
  for (let i = 0; i < platforms.length; i++) {
    if (movePlatform(player, platforms[i], solids.filter((_, j) => j !== i), tiles)) return player;
  }

  const actions = frame?.connected ? frame.actions : undefined;
  const dir = (actions?.moveRight?.held ? 1 : 0) - (actions?.moveLeft?.held ? 1 : 0);

  if (dir !== 0) {
    player.vx = approach(player.vx, dir * move.maxSpeed, (player.onGround ? move.groundAccel : move.airAccel) * dt);
  } else {
    player.vx = approach(player.vx, 0, (player.onGround ? move.groundFriction : move.airFriction) * dt);
  }
  // Crouch: holding moveDown on the ground makes the box size.crouchHeight tall, feet in place
  // (down in mid-air does nothing). Releasing it, or jumping, stands back up only when the full
  // height fits; under a low ceiling the box stays crouched until there is room.
  const roomToStand = () => !solidHit(tiles, solids, { ...bodyBox(player), y1: player.y + player.size.height });
  const downHeld = Boolean(actions?.moveDown?.held);
  if (downHeld && player.onGround) player.crouching = true;
  // For now moveUp (W, up arrow, stick up) also jumps; DEFAULT_BINDINGS stay unchanged so W does not select menu items.
  const jumpPressed = actions?.jump?.pressed || actions?.moveUp?.pressed;
  const jumping = jumpPressed && player.onGround;
  if (player.crouching && (!downHeld || jumping) && roomToStand()) player.crouching = false;
  if (jumping) player.vy = move.jumpSpeed;
  if (frame?.connected && Number.isFinite(frame.aim)) player.aim = frame.aim;
  player.vy = Math.max(player.vy - move.gravity * dt, -move.maxFallSpeed);

  // One axis at a time: move, then push out of any solid (tile or platform) it now overlaps.
  player.x += player.vx * dt;
  const sideHit = solidHit(tiles, solids, bodyBox(player));
  if (sideHit) {
    if (player.vx > 0) player.x = sideHit.left - player.size.width / 2;
    else if (player.vx < 0) player.x = sideHit.right + player.size.width / 2;
    player.vx = 0;
  }

  player.onGround = false;
  player.y += player.vy * dt;
  const vertHit = solidHit(tiles, solids, bodyBox(player));
  if (vertHit) {
    if (player.vy < 0) {
      player.y = vertHit.top;
      player.onGround = true;
    } else if (player.vy > 0) {
      player.y = vertHit.bottom - playerHeight(player);
    }
    player.vy = 0;
  }
  return player;
}
