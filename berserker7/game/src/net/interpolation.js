// Interpolation of a remote player between host snapshots. Pure.
// The buffer holds { tick, player } (host ticks), ordered, at most `cap`; duplicate ticks and
// ticks older than the newest are ignored. sampleAt(tick) lerps x, y, vx and vy between the two
// entries around `tick`, turns the aim the short way round, and takes onGround, crouching and size
// from the earlier entry. Before the oldest: the oldest; after the newest: the newest (no
// extrapolation).

export const INTERP_CAP = 32;
// How far behind the newest host tick arriving now (the receive-side clock) the remote player is
// drawn: 6 ticks (100 ms), so three snapshot intervals of buffer at 30 per second at any delay.
export const INTERP_DELAY_TICKS = 6;

const lerp = (a, b, t) => a + (b - a) * t;

// From angle a to b by the shortest way, result in (-PI, PI].
export function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  let r = a + d * t;
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

export function createInterpolationBuffer(cap = INTERP_CAP) {
  const entries = [];
  return {
    push(tick, player) {
      if (entries.length > 0 && tick <= entries.at(-1).tick) return;
      entries.push({ tick, player });
      if (entries.length > cap) entries.shift();
    },
    clear() {
      entries.length = 0;
    },
    size: () => entries.length,
    // The player at `tick` (fractional allowed), or null when empty.
    sampleAt(tick) {
      if (entries.length === 0) return null;
      if (tick <= entries[0].tick) return structuredClone(entries[0].player);
      const last = entries.at(-1);
      if (tick >= last.tick) return structuredClone(last.player);
      let i = entries.length - 1;
      while (entries[i - 1].tick > tick) i -= 1;
      const from = entries[i - 1];
      const to = entries[i];
      const t = (tick - from.tick) / (to.tick - from.tick);
      const a = from.player;
      const b = to.player;
      return {
        ...structuredClone(a),
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        vx: lerp(a.vx, b.vx, t),
        vy: lerp(a.vy, b.vy, t),
        aim: lerpAngle(a.aim, b.aim, t),
      };
    },
  };
}
