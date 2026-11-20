// The Sandbox player: a box moved by input and collided with solid tiles. Pure logic, no three.js.
// One world unit is one tile; x is right, y is up. The position is the bottom-centre of the box:
// the box covers x - width / 2 .. x + width / 2 and y .. y + height.
// Player data is plain: { x, y, vx, vy, onGround, aim, crouching, size, row, hop, presses, health,
// inventory, meleeTicks, meleeDir } (aim in radians, y up, 0 = right). row, hop and presses belong
// to depth rows (world/rows.js); health, inventory, meleeTicks and meleeDir to combat
// (world/combat.js). stepPlayer leaves them alone.

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
  return { x, y, vx: 0, vy: 0, onGround: false, aim: 0, crouching: false, size: { ...size }, row: 0, hop: null, presses: { down: PRESS_NONE, jump: PRESS_NONE }, health: PLAYER_HEALTH, inventory: [], meleeTicks: 0, meleeDir: 1, crushed: false };
}

// Moves `value` towards `target` by at most `amount`, never past it.
function approach(value, target, amount) {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}

// The box's current height: the player's size.crouchHeight while crouched, else size.height.
export function playerHeight(player) {
  return player.crouching ? player.size.crouchHeight : player.size.height;
}

// Tile ranges a box of `height` overlaps at (x, y), inclusive.
function overlap(x, y, width, height) {
  return {
    x0: Math.floor(x - width / 2 + EPSILON),
    x1: Math.floor(x + width / 2 - EPSILON),
    y0: Math.floor(y + EPSILON),
    y1: Math.floor(y + height - EPSILON),
  };
}

// Solid tiles in the box's range: { min, max } of the along-axis tile coordinate, or null.
function solidSpan(tiles, range, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      if (!tiles.isSolid(tx, ty)) continue;
      const along = axis === 'x' ? tx : ty;
      if (along < min) min = along;
      if (along > max) max = along;
    }
  }
  return max < min ? null : { min, max };
}

// Gap within which feet count as standing on a platform's top (riding), tiles.
const RIDE_TOLERANCE = 1e-3;
const NO_PLATFORMS = Object.freeze([]);

// True when the box at `player` overlaps `box` ({ x, width }, bottom-left x) horizontally.
function overlapsX(player, box) {
  const half = player.size.width / 2;
  return player.x + half > box.x + EPSILON && player.x - half < box.x + box.width - EPSILON;
}

// Carries a rider by the platform's movement this step: x first, pushed out of solid tiles like
// the side collision (a wall stops the rider; no crush, no teleport), then y (a ceiling clamps the
// head and the rider drops off; a floor below stops it). The rider's own velocity is unchanged.
function carry(player, dx, dy, tiles) {
  const height = playerHeight(player);
  const width = player.size.width;
  if (dx !== 0) {
    player.x += dx;
    const span = solidSpan(tiles, overlap(player.x, player.y, width, height), 'x');
    if (span) player.x = dx > 0 ? span.min - width / 2 : span.max + 1 + width / 2;
  }
  if (dy !== 0) {
    player.y += dy;
    const span = solidSpan(tiles, overlap(player.x, player.y, width, height), 'y');
    if (span) player.y = dy > 0 ? span.min - height : span.max + 1;
  }
}

// True when the box at `player` overlaps the platform box `box` ({ x, y, width, height }).
function overlapsBox(player, box) {
  const height = playerHeight(player);
  return overlapsX(player, box) && player.y + height > box.y + EPSILON && player.y < box.y + box.height - EPSILON;
}

// Platforms push players (players only; enemies are not pushed). Called before the player's own
// step with the step's platform boxes. A platform whose box after this step (`now`) overlaps the
// player pushes it out of `now` along each direction the platform moved in (x and y apart), but
// only when the player is on that leading side (its centre past the platform's centre that way),
// so a player is never pulled through a platform. The shortest such exit wins. A platform that
// moves away from the player, or does not move, does not push (platforms stay one-way). A rider
// stands on the top, does not overlap, and is carried as before (stepPlayer). Pushed up, a falling
// vy stops; pushed down, a rising vy stops; vx is unchanged.
// Crushed: the exit would overlap a solid tile of `tiles` (a wall, floor or ceiling: no room
// left). The player then stays where it was and `player.crushed` is true; the host kills it
// (world/combat.js). Sets `player.crushed` on every call and returns it.
export function pushByPlatforms(player, platforms, tiles) {
  player.crushed = false;
  for (const { prev, now } of platforms) {
    if (!overlapsBox(player, now)) continue;
    const dx = now.x - prev.x;
    const dy = now.y - prev.y;
    const half = player.size.width / 2;
    const height = playerHeight(player);
    const cx = now.x + now.width / 2;
    const cy = now.y + now.height / 2;
    const py = player.y + height / 2;
    const exits = [];
    if (dx > 0 && player.x >= cx) exits.push({ x: now.x + now.width + half, y: player.y });
    if (dx < 0 && player.x <= cx) exits.push({ x: now.x - half, y: player.y });
    if (dy > 0 && py >= cy) exits.push({ x: player.x, y: now.y + now.height });
    if (dy < 0 && py <= cy) exits.push({ x: player.x, y: now.y - height });
    if (exits.length === 0) continue;
    const cost = (e) => Math.abs(e.x - player.x) + Math.abs(e.y - player.y);
    const exit = exits.reduce((best, e) => (cost(e) < cost(best) ? e : best));
    if (solidSpan(tiles, overlap(exit.x, exit.y, player.size.width, height), 'x')) {
      player.crushed = true;
      continue;
    }
    if (exit.y > player.y) player.vy = Math.max(player.vy, 0);
    if (exit.y < player.y) player.vy = Math.min(player.vy, 0);
    player.x = exit.x;
    player.y = exit.y;
  }
  return player.crushed;
}

// Advances `player` by `dt` seconds. `frame` is the player's input frame (missing or not connected:
// no input, gravity still applies). `tiles` is a tile map.
// `world` (optional): { platforms: [{ prev, now }], move }. `prev` and `now` are a moving
// platform's boxes (platformAt) at the world tick before and after this step; `move` replaces MOVE
// (enemies). Without it the step is exactly the tiles-only one.
// Platforms are one-way, from above only: a player passes up through them and lands on them when
// falling. A player standing on one (onGround, feet on its `prev` top) is first carried by its
// movement this step, then moves on its own.
// No swept collision: at maxFallSpeed (30 tiles/s) and 1/60 s a step is 0.5 tile, less than the
// box's width and height, so a box cannot skip over a tile. Keep dt small to keep that true.
export function stepPlayer(player, frame, tiles, dt, world) {
  const move = world?.move ?? MOVE;
  const platforms = world?.platforms ?? NO_PLATFORMS;
  if (player.onGround) {
    const ride = platforms.find(({ prev }) => Math.abs(player.y - (prev.y + prev.height)) < RIDE_TOLERANCE && overlapsX(player, prev));
    if (ride) carry(player, ride.now.x - ride.prev.x, ride.now.y - ride.prev.y, tiles);
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
  const roomToStand = () => !solidSpan(tiles, overlap(player.x, player.y, player.size.width, player.size.height), 'y');
  const downHeld = Boolean(actions?.moveDown?.held);
  if (downHeld && player.onGround) player.crouching = true;
  // For now moveUp (W, up arrow, stick up) also jumps; DEFAULT_BINDINGS stay unchanged so W does not select menu items.
  const jumpPressed = actions?.jump?.pressed || actions?.moveUp?.pressed;
  const jumping = jumpPressed && player.onGround;
  if (player.crouching && (!downHeld || jumping) && roomToStand()) player.crouching = false;
  if (jumping) player.vy = move.jumpSpeed;
  if (frame?.connected && Number.isFinite(frame.aim)) player.aim = frame.aim;
  player.vy = Math.max(player.vy - move.gravity * dt, -move.maxFallSpeed);

  // One axis at a time: move, then push out of any solid tile it now overlaps.
  player.x += player.vx * dt;
  const height = playerHeight(player);
  const sideSpan = solidSpan(tiles, overlap(player.x, player.y, player.size.width, height), 'x');
  if (sideSpan) {
    if (player.vx > 0) player.x = sideSpan.min - player.size.width / 2;
    else if (player.vx < 0) player.x = sideSpan.max + 1 + player.size.width / 2;
    player.vx = 0;
  }

  player.onGround = false;
  const before = player.y;
  const falling = player.vy <= 0;
  player.y += player.vy * dt;
  // Platform landing (falling only): the highest platform top the feet crossed this step. The feet
  // must have been at or above the top before the move, give or take the platform's own rise.
  let platformTop = -Infinity;
  if (falling) {
    for (const { prev, now } of platforms) {
      const top = now.y + now.height;
      const rise = Math.max(0, now.y - prev.y);
      if (top > platformTop && before >= top - rise - EPSILON && player.y < top && overlapsX(player, now)) platformTop = top;
    }
  }
  const vertSpan = solidSpan(tiles, overlap(player.x, player.y, player.size.width, height), 'y');
  if (vertSpan) {
    if (player.vy < 0) {
      player.y = vertSpan.max + 1;
      player.onGround = true;
    } else if (player.vy > 0) {
      player.y = vertSpan.min - height;
    }
    player.vy = 0;
  }
  // The higher of a tile landing and a platform landing wins.
  if (platformTop > -Infinity && (!player.onGround || platformTop > player.y)) {
    player.y = platformTop;
    player.onGround = true;
    player.vy = 0;
  }
  return player;
}
