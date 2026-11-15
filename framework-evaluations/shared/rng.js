// @ts-check
// Seeded pseudo-random numbers. Every build draws the scene from the same seed,
// so all four builds place the same buildings, crates, raindrops, etc.

/**
 * mulberry32: small, fast, good-enough 32-bit PRNG.
 * @param {number} seed
 * @returns {() => number} returns floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convenience wrapper with range helpers.
 * @param {number} seed
 */
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    /** @param {number} a @param {number} b */
    range: (a, b) => a + (b - a) * next(),
    /** integer in [a, b] inclusive @param {number} a @param {number} b */
    int: (a, b) => a + Math.floor((b - a + 1) * next()),
    /** @param {number} p probability of true */
    chance: (p) => next() < p,
    /** @template T @param {T[]} list @returns {T} */
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

/**
 * Derive an independent sub-seed so adding elements to one group does not
 * shift the random sequence of another group.
 * @param {number} seed
 * @param {string} label
 */
export function subSeed(seed, label) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
