// Moving platforms. Pure logic, no three.js.
// A platform is level data from the map: { width, height, speed, mode, path }. `path` is a list of
// [x, y] waypoints for the box's bottom-left corner (tiles); the box covers x..x+width and
// y..y+height. `speed` is tiles/s along the path; `mode` is 'pingpong' (there and back) or 'loop'
// (last point back to the first).
// Position is a function of the world tick only (D-129): the same tick gives the same box on host
// and guest, so platforms are never sent over the network.
// Collision is one-way, from above only (see stepPlayer in player.js).

import { STEP_SECONDS } from '../engine/clock.js';

// Plain copies of a map file's platforms ([] when absent).
export function copyPlatforms(platforms = []) {
  return platforms.map(({ width, height, speed, mode, path }) => ({ width, height, speed, mode, path: path.map(([x, y]) => [x, y]) }));
}

// The platform's box at world tick `tick`: { x, y, width, height } (x, y the bottom-left corner).
export function platformAt(platform, tick) {
  const { width, height, speed, mode, path } = platform;
  const points = mode === 'loop' ? [...path, path[0]] : path;
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(d);
    total += d;
  }
  if (total === 0 || !(speed > 0)) return { x: path[0][0], y: path[0][1], width, height };
  let distance = speed * tick * STEP_SECONDS;
  if (mode === 'loop') {
    distance = ((distance % total) + total) % total;
  } else {
    // Pingpong: one period is there and back; the second half walks the path in reverse.
    const period = 2 * total;
    distance = ((distance % period) + period) % period;
    if (distance > total) distance = period - distance;
  }
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(1, distance / lengths[i]);
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, width, height };
    }
    distance -= lengths[i];
  }
  return { x: path[0][0], y: path[0][1], width, height };
}

// The step's platform boxes from world tick `tick` to `tick + 1`: [{ prev, now }], for stepPlayer.
export function platformsStep(platforms, tick) {
  return platforms.map((p) => ({ prev: platformAt(p, tick), now: platformAt(p, tick + 1) }));
}

// Feet within this of a platform's top count as riding it when drawing a remote body, tiles.
const DRAW_RIDE_TOLERANCE = 0.05;

// Drawing only (a guest): a remote body (the host's player or an enemy, { x, y, size }) is sampled
// at the host's world tick `fromTick`, while the platforms are drawn at the guest's own tick
// `toTick`. A body standing on a platform at `fromTick` is moved by that platform's movement from
// `fromTick` to `toTick`, so it is drawn on the platform. Returns { dx, dy } (0, 0 when not riding).
export function rideShift(platforms, body, fromTick, toTick) {
  const half = body.size.width / 2;
  for (const p of platforms) {
    const a = platformAt(p, fromTick);
    if (Math.abs(body.y - (a.y + a.height)) < DRAW_RIDE_TOLERANCE && body.x + half > a.x && body.x - half < a.x + a.width) {
      const b = platformAt(p, toTick);
      return { dx: b.x - a.x, dy: b.y - a.y };
    }
  }
  return { dx: 0, dy: 0 };
}
