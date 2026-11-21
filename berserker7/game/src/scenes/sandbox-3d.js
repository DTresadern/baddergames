// The Sandbox's 2.5D view: view mode and FOV holder, perspective camera distance, per-face shaded
// cubes and the decorative depth cubes. The map, player and physics are the same as in 2D.

import { BoxGeometry, Float32BufferAttribute } from 'three';

export const VIEW_MODES = Object.freeze(['2d', '2.5d']);
export const DEFAULT_VIEW_MODE = '2.5d';
export const FOV_MIN = 1; // degrees, vertical
export const FOV_MAX = 130;
export const FOV_DEFAULT = 60;
export const OFFSET_LIMIT = 4; // camera offset range, ± tiles
export const OFFSET_STEP = 0.25; // camera offset step, tiles
export const OFFSET_DEFAULT = Object.freeze({ x: 0, y: 2 }); // camera offset at start, tiles
// Camera aim-follow settings: [key, label, min, max, step, default]. See cameraShift.
export const FOLLOW_SETTINGS = Object.freeze([
  ['follow', 'Follow', 0, 1, 0.05, 0.4], // fraction of head-to-aim the camera moves
  ['min', 'Min (tiles)', 0, 10, 0.25, 0], // minimum radius: a shorter shift is lengthened to this
  ['max', 'Max (tiles)', 0, 20, 0.25, 8], // a longer shift is scaled down to this length
  ['scaleX', 'X scale', 0, 2, 0.05, 1], // applied after the clamp
  ['scaleYUp', 'Y scale up', 0, 2, 0.05, 0.5], // y scale when the shift's y is above 0 (aiming up)
  ['scaleYDown', 'Y scale down', 0, 2, 0.05, 0.5], // y scale when the shift's y is below 0 (aiming down)
  ['smoothing', 'Smoothing half-life (s)', 0, 0.5, 0.01, 0.05], // camera source smoothing; 0 = snap
].map((row) => Object.freeze(row)));
// Depth range kept around the play plane by the near and far planes, tiles (cubes reach z ±1.5).
export const DEPTH_MARGIN = 4;
// A depth cube on every DEPTH_CUBE_SPACING-th column of the ground.
export const DEPTH_CUBE_SPACING = 3;
// Brightness per cube face (vertex colours, multiplied with the texture): the top is lit, the
// front a little darker, the sides darker, the bottom and back darkest. No lights needed.
export const FACE_SHADE = Object.freeze({ top: 1, front: 0.8, side: 0.62, bottom: 0.45, back: 0.45 });

// The Sandbox view mode ('2d' or '2.5d'), the perspective FOV (whole degrees, clamped) and the
// camera offset from the point it follows (tiles, x right, y up, ±OFFSET_LIMIT in OFFSET_STEP
// steps), changed live by the debug panel and read by the scene in draw. Not saved.
export function createViewMode({ mode = DEFAULT_VIEW_MODE, fov = FOV_DEFAULT } = {}) {
  const clampFov = (v) => Math.min(FOV_MAX, Math.max(FOV_MIN, Math.round(v)));
  const clampOffset = (v) => Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, Math.round(v / OFFSET_STEP) * OFFSET_STEP)) + 0;
  let current = VIEW_MODES.includes(mode) ? mode : DEFAULT_VIEW_MODE;
  let degrees = clampFov(fov);
  const offset = { ...OFFSET_DEFAULT };
  const follow = Object.fromEntries(FOLLOW_SETTINGS.map(([key, , , , , value]) => [key, value]));
  let backdrop = true;
  let grid = false;
  let rowCamera = true;
  return {
    mode: () => current,
    // Ignores an unknown mode. Returns the mode now in use.
    setMode(m) {
      if (VIEW_MODES.includes(m)) current = m;
      return current;
    },
    fov: () => degrees,
    // Ignores a value that is not a finite number. Returns the FOV now in use.
    setFov(v) {
      if (Number.isFinite(v)) degrees = clampFov(v);
      return degrees;
    },
    offset: () => ({ ...offset }),
    // Sets one axis ('x' or 'y'); ignores a value that is not a finite number. Returns the offset.
    setOffset(axis, v) {
      if ((axis === 'x' || axis === 'y') && Number.isFinite(v)) offset[axis] = clampOffset(v);
      return { ...offset };
    },
    // The background city blocks (2.5D only), on by default.
    backdrop: () => backdrop,
    setBackdrop(on) {
      backdrop = Boolean(on);
      return backdrop;
    },
    // Level tiles and cubes drawn with the grid texture instead of the checkerboard (both views), off by default.
    grid: () => grid,
    setGrid(on) {
      grid = Boolean(on);
      return grid;
    },
    // 2.5D: the camera moves in depth with the local player's row (on by default); off keeps it on
    // the play plane.
    rowCamera: () => rowCamera,
    setRowCamera(on) {
      rowCamera = Boolean(on);
      return rowCamera;
    },
    follow: () => ({ ...follow }),
    // Sets one FOLLOW_SETTINGS key, clamped to its range and rounded to its step; ignores an
    // unknown key or a value that is not a finite number. Returns the settings.
    setFollow(key, v) {
      const row = FOLLOW_SETTINGS.find(([k]) => k === key);
      if (row && Number.isFinite(v)) {
        const [, , min, max, step] = row;
        follow[key] = Number(Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(4));
      }
      return { ...follow };
    },
  };
}

// Frame-rate independent exponential smoothing ("smerp"): moves `source` towards `target` so that
// half the remaining distance is covered every `halfLife` seconds, whatever the step `dt`.
// halfLife 0 (or less) snaps. Returns a new { x, y }.
export function smerp(source, target, dt, halfLife) {
  if (!(halfLife > 0)) return { x: target.x, y: target.y };
  const k = 1 - Math.exp((-Math.LN2 * dt) / halfLife);
  return { x: source.x + (target.x - source.x) * k, y: source.y + (target.y - source.y) * k };
}

// Camera aim-follow shift (tiles): (aim - head) * follow; if shorter than `min`, lengthened to
// `min` along the aim direction (head to aim), so with min > 0 the camera never sits at the head;
// if longer than `max`, scaled down to `max` (applied after min, so max wins when max < min); then
// x and y scaled. `aim` must be the mouse projected through the camera at its rest position, never
// through the shifted camera, or the camera chases itself. `lastDir` (a unit vector or null) is the
// direction used when the aim point is exactly at the head. Returns { x, y, dir }: `dir` is the
// unit aim direction used (keep it as the next `lastDir`), or null when there was none.
export function cameraShift(head, aim, { follow, min, max, scaleX, scaleYUp, scaleYDown }, lastDir = null) {
  const dx = aim.x - head.x;
  const dy = aim.y - head.y;
  const distance = Math.hypot(dx, dy);
  const dir = distance > 0 ? { x: dx / distance, y: dy / distance } : lastDir;
  if (!dir) return { x: 0, y: 0, dir: null };
  let length = distance * follow;
  if (length < min) length = min;
  if (length > max) length = max;
  const y = dir.y * length;
  return { x: dir.x * length * scaleX, y: y * (y > 0 ? scaleYUp : scaleYDown), dir };
}

// A point in canvas CSS px (top-left origin, y down) on the play plane (z = 0) seen by a camera
// centred on `camera` ({ x, y }) showing `tilesHigh` tiles in a `width` x `height` view. Exact for
// both views: the orthographic camera and the perspective camera (by its distance) both show
// `tilesHigh` tiles on the play plane, centred on the camera and looking straight along -z.
export function screenToPlane(camera, point, width, height, tilesHigh) {
  const tilesPerPx = tilesHigh / height;
  return { x: camera.x + (point.x - width / 2) * tilesPerPx, y: camera.y - (point.y - height / 2) * tilesPerPx };
}

// Camera distance from the play plane (z = 0) that shows exactly `tilesHigh` tiles there.
export function perspectiveDistance(tilesHigh, fovDegrees) {
  return tilesHigh / 2 / Math.tan((fovDegrees * Math.PI) / 360);
}

// A 1 x 1 x 1 cube with a colour attribute shading each face (FACE_SHADE). Each face keeps the
// box's 0..1 UVs, so the texture is mapped once per face.
export function shadedCubeGeometry() {
  const geometry = new BoxGeometry(1, 1, 1);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const faces = [FACE_SHADE.side, FACE_SHADE.side, FACE_SHADE.top, FACE_SHADE.bottom, FACE_SHADE.front, FACE_SHADE.back];
  const colors = faces.flatMap((v) => Array(4).fill([v, v, v]).flat());
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

// 32-bit integer hash, for deterministic decoration choices (not Math.random).
export function hashInt(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Decorative cubes off the play plane: on every `spacing`-th column strictly between the leftmost
// and rightmost solid columns, one cube in the same row as the column's top solid tile (flush with
// the floor surface, as if the floor extends sideways there), at z = -1 (far) or +1 (near) chosen
// by a hash of the column. They are not in the tile map, so they never collide.
// Returns [{ x, y, z, id }]: x, y the tile the cube fills, id the tile type it copies.
export function depthCubes(tiles, spacing = DEPTH_CUBE_SPACING) {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minY = Infinity;
  const size = tiles.chunkSize;
  for (const chunk of tiles.chunks()) {
    chunk.tiles.forEach((id, index) => {
      if (id === 0) return;
      const x = chunk.cx * size + (index % size);
      const y = chunk.cy * size + Math.floor(index / size);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
  }
  const cubes = [];
  for (let x = minX + 1; x < maxX; x++) {
    if (((x % spacing) + spacing) % spacing !== 0) continue;
    let y = maxY;
    while (y >= minY && !tiles.isSolid(x, y)) y--;
    if (y < minY) continue;
    cubes.push({ x, y, z: hashInt(x) & 1 ? 1 : -1, id: tiles.tileAt(x, y) });
  }
  return cubes;
}

// Depth shading for a cells map's cubes (2.5D), so the walkable layer reads apart from what is
// behind and in front of it. A colour multiplier [r, g, b] for the material (times the texture and
// the face shading): the play plane (z = 0) is unchanged; cells behind it get darker with each
// tile of depth and a cool tint (BEHIND: brightness at z = -1, -2, -3 and beyond); cells in front
// are dark, warm silhouettes (FRONT). Grid maps are not shaded.
export const DEPTH_SHADE = Object.freeze({
  behind: Object.freeze([0.62, 0.48, 0.38]),
  behindTint: Object.freeze([0.82, 0.9, 1]),
  front: 0.34,
  frontTint: Object.freeze([1, 0.88, 0.8]),
});

// The depth shading table of a lit map (map field `lighting`): nothing behind (brightness 1, no
// tint: the fog replaces the darkening there) and `nearShade` in front, no tint.
export function litDepthShade(nearShade) {
  return Object.freeze({ behind: Object.freeze([1]), behindTint: Object.freeze([1, 1, 1]), front: nearShade, frontTint: Object.freeze([1, 1, 1]) });
}

// A fractional z (relative depth during a hop) is interpolated linearly between the whole depths
// around it. `table` is DEPTH_SHADE or a table of the same shape (litDepthShade).
export function depthShade(z, table = DEPTH_SHADE) {
  if (!Number.isInteger(z)) {
    const lo = depthShade(Math.floor(z), table);
    const hi = depthShade(Math.ceil(z), table);
    const t = z - Math.floor(z);
    return lo.map((c, i) => c + (hi[i] - c) * t);
  }
  if (z === 0) return [1, 1, 1];
  if (z > 0) return table.frontTint.map((c) => c * table.front);
  const level = table.behind[Math.min(-z, table.behind.length) - 1];
  return table.behindTint.map((c) => c * level);
}
