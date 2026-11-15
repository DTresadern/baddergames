// @ts-check
// Stress axes for the benchmark. Vary ONE axis at a time; the others stay at base.
//   rain    - number of rain particles
//   lights  - number of lamps (light sources that glow and cast light pools)
//   objects - multiplier for crates, barrels and background buildings

/** @typedef {{ rain: number, lights: number, objects: number }} Stress */

/** @type {Stress} realistic scene */
export const BASE = Object.freeze({ rain: 4000, lights: 8, objects: 1 });

/** Values tried per axis (the first value of each is the base value). */
export const AXES = Object.freeze({
  rain: [4000, 16000, 64000, 256000],
  lights: [8, 32, 128],
  objects: [1, 4, 16],
});

/**
 * Every level the benchmark runs: base first, then each non-base value per axis.
 * @returns {{ id: string, stress: Stress }[]}
 */
export function stressLevels() {
  /** @type {{ id: string, stress: Stress }[]} */
  const levels = [{ id: 'base', stress: { ...BASE } }];
  for (const axis of /** @type {(keyof Stress)[]} */ (Object.keys(AXES))) {
    for (const value of AXES[axis]) {
      if (value === BASE[axis]) continue;
      levels.push({ id: `${axis}-${value}`, stress: { ...BASE, [axis]: value } });
    }
  }
  return levels;
}

/**
 * Turn a stress level into URL query parameters for a build page.
 * @param {Stress} stress
 */
export function stressQuery(stress) {
  return `rain=${stress.rain}&lights=${stress.lights}&objects=${stress.objects}`;
}

/**
 * Read page options from the URL, e.g. `2d.html?rain=64000&lights=8&objects=1&seed=1&t=12.5`.
 * Missing or invalid values fall back to base. `t` (seconds) freezes animation at that
 * time for deterministic screenshots; null means "animate in real time".
 * @param {URLSearchParams} params
 * @returns {{ stress: Stress, seed: number, t: number | null }}
 */
export function parseStress(params) {
  /** @param {string} key @param {number} fallback @param {number} min @param {number} max */
  const num = (key, fallback, min, max) => {
    const raw = params.get(key);
    if (raw === null || raw === '') return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  const tRaw = params.get('t');
  const t = tRaw === null || tRaw === '' || !Number.isFinite(Number(tRaw)) ? null : Number(tRaw);
  return {
    stress: {
      rain: Math.round(num('rain', BASE.rain, 0, 1_000_000)),
      lights: Math.round(num('lights', BASE.lights, 0, 1024)),
      objects: Math.round(num('objects', BASE.objects, 1, 64)),
    },
    seed: Math.round(num('seed', 1, 0, 2 ** 31)),
    t,
  };
}
