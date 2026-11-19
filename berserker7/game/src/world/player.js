// The Sandbox player: a box moved by input and collided with solid tiles. Pure logic, no three.js.
// One world unit is one tile; x is right, y is up. The position is the bottom-centre of the box:
// the box covers x - width / 2 .. x + width / 2 and y .. y + height.
// Player data is plain: { x, y, vx, vy, onGround, aim, crouching, size } (aim in radians, y up, 0 = right).

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

export function createPlayer(x, y, size = PLAYER_SIZE) {
  return { x, y, vx: 0, vy: 0, onGround: false, aim: 0, crouching: false, size: { ...size } };
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

// Advances `player` by `dt` seconds. `frame` is the player's input frame (missing or not connected:
// no input, gravity still applies). `tiles` is a tile map.
// No swept collision: at maxFallSpeed (30 tiles/s) and 1/60 s a step is 0.5 tile, less than the
// box's width and height, so a box cannot skip over a tile. Keep dt small to keep that true.
export function stepPlayer(player, frame, tiles, dt) {
  const actions = frame?.connected ? frame.actions : undefined;
  const dir = (actions?.moveRight?.held ? 1 : 0) - (actions?.moveLeft?.held ? 1 : 0);

  if (dir !== 0) {
    player.vx = approach(player.vx, dir * MOVE.maxSpeed, (player.onGround ? MOVE.groundAccel : MOVE.airAccel) * dt);
  } else {
    player.vx = approach(player.vx, 0, (player.onGround ? MOVE.groundFriction : MOVE.airFriction) * dt);
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
  if (jumping) player.vy = MOVE.jumpSpeed;
  if (frame?.connected && Number.isFinite(frame.aim)) player.aim = frame.aim;
  player.vy = Math.max(player.vy - MOVE.gravity * dt, -MOVE.maxFallSpeed);

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
  player.y += player.vy * dt;
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
  return player;
}
