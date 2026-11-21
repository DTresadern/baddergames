// Level lights for the Sandbox (a map's `lighting.lights`): point lights that belong to the light
// tiles the block decoration places (lamps, signs, screens, windows; scenes/block-decor.js). Pure
// apart from three's Color and Vector3; tested in Node. The lights are fixed at load; a pool of
// MAX_LIGHTS shader slots holds the ones nearest the camera (scenes/atlas-material.js lights by
// them).

import { Color, Vector3 } from 'three';
import { DECOR, blockTiles } from './block-decor.js';

// A light sits this far in front of its block's front face (tiles), so the face itself is lit.
export const LIGHT_FACE_OFFSET = 0.05;

// Shader light slots. The test level has 83 lights; at most 21 reach a 21 x 12 tile view (the
// default zoom at 16:9) and 23 at zoom 18, anywhere in the level. `select` ranks lights by how far
// their reach stays outside the view, so every light that reaches the view gets a slot as long as
// no more than MAX_LIGHTS do (at the furthest zoom, 28, up to 29 can: the furthest outside the
// view's centre then miss out).
export const MAX_LIGHTS = 24;

// The level's lights: `cells` is every solid cell [x, y, z] of the map (all rows), `solid(x, y, z)`
// as in the Sandbox, `layout` and `pools` from atlasLayout and atlasPools, `lights` the map's
// `lighting.lights` (per atlas tile name { color, intensity, radius }). A cell whose front tile is
// named in `lights` and whose front face is not covered (no solid cell at z + 1) gives a light just
// in front of the face's centre: (x + 0.5, y + 0.5, z + 0.5 + LIGHT_FACE_OFFSET) (cubes are centred
// at (x + 0.5, y + 0.5, z)). Window tiles (kind `window`) give one light per wall patch (the patch
// the decoration uses), at the mean position of its uncovered window cells.
// Returns a frozen list of frozen { x, y, z, color: [r, g, b] (linear, times intensity), radius },
// sorted by z, then y, then x.
export function levelLights(cells, solid, layout, pools, lights) {
  const tileAt = new Map(layout.tiles.map((t) => [t.index, t]));
  const out = [];
  const patches = new Map(); // "px,py,z" -> { name, sx, sy, z, n }
  for (const [x, y, z] of cells) {
    const tile = tileAt.get(blockTiles(solid, x, y, z, pools)[2]);
    if (!tile || !Object.hasOwn(lights, tile.name) || solid(x, y, z + 1)) continue;
    if (tile.kind === 'window') {
      const key = `${Math.floor(x / DECOR.patchWidth)},${Math.floor(y / DECOR.patchHeight)},${z}`;
      if (!patches.has(key)) patches.set(key, { name: tile.name, sx: 0, sy: 0, z, n: 0 });
      const patch = patches.get(key);
      patch.sx += x + 0.5;
      patch.sy += y + 0.5;
      patch.n += 1;
    } else {
      out.push(makeLight(x + 0.5, y + 0.5, z, lights[tile.name]));
    }
  }
  for (const { name, sx, sy, z, n } of patches.values()) out.push(makeLight(sx / n, sy / n, z, lights[name]));
  out.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  return Object.freeze(out);
}

function makeLight(x, y, z, { color, intensity, radius }) {
  const c = new Color(color); // linear (three's default colour management converts the sRGB hex)
  return Object.freeze({ x, y, z: z + 0.5 + LIGHT_FACE_OFFSET, color: Object.freeze([c.r * intensity, c.g * intensity, c.b * intensity]), radius });
}

// The shader's light slots for a fixed list of lights. `uniforms` holds three.js uniform objects
// ({ value }): litLightPos and litLightColor (MAX_LIGHTS Vector3 each) and litLightRadius
// (MAX_LIGHTS numbers). `select` puts the MAX_LIGHTS lights that reach furthest into the view into
// the slots, in that order (see select); unused slots get colour 0 and radius 1 (intensity 0,
// never removed). Nothing is allocated in select. Returns true when the chosen set changed (a new
// order of the same lights is not a change).
export function createLightPool(lights) {
  const uniforms = {
    litLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
    litLightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
    litLightRadius: { value: Array(MAX_LIGHTS).fill(1) },
  };
  const n = lights.length;
  const used = Math.min(n, MAX_LIGHTS);
  const distance = new Float64Array(n); // per light: its distance to the view rectangle minus its radius
  const taken = new Uint8Array(n); // 1: chosen in this select
  const before = new Uint8Array(n); // 1: chosen in the previous select
  // (x, y, z): the view's centre on the player's row; halfWidth, halfHeight: the view's half size
  // there (tiles; 0 gives the lights nearest the point, by distance minus radius); cameraZ: the
  // perspective camera's z (Infinity: orthographic). A light ranks by its distance to the view
  // rectangle, minus its radius: negative when its light reaches into the view. With a perspective
  // camera the rectangle is the view's size at the light's own depth ((cameraZ - l.z) /
  // (cameraZ - z) times the size on the row), so the distance is in x and y only; orthographic
  // (only z = 0 drawn) it is the 3D distance to the rectangle at depth z.
  function select(x, y, z, halfWidth = 0, halfHeight = 0, cameraZ = Infinity) {
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      const scale = Number.isFinite(cameraZ) ? Math.max(0, (cameraZ - l.z) / (cameraZ - z)) : 1;
      const dx = Math.max(0, Math.abs(l.x - x) - halfWidth * scale);
      const dy = Math.max(0, Math.abs(l.y - y) - halfHeight * scale);
      const dz = Number.isFinite(cameraZ) ? 0 : l.z - z;
      distance[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) - l.radius;
      taken[i] = 0;
    }
    // Partial selection sort: the lowest-ranked remaining light per slot (ties: the lower index).
    let changed = false;
    for (let s = 0; s < used; s++) {
      let best = -1;
      for (let i = 0; i < n; i++) if (!taken[i] && (best < 0 || distance[i] < distance[best])) best = i;
      taken[best] = 1;
      if (!before[best]) changed = true;
      const l = lights[best];
      uniforms.litLightPos.value[s].set(l.x, l.y, l.z);
      uniforms.litLightColor.value[s].set(l.color[0], l.color[1], l.color[2]);
      uniforms.litLightRadius.value[s] = l.radius;
    }
    before.set(taken);
    return changed;
  }
  return { uniforms, select };
}
