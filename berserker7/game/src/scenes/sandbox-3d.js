// The Sandbox's 2.5D view: view mode and FOV holder, perspective camera distance, per-face shaded
// cubes and the decorative depth cubes. The map, player and physics are the same as in 2D.

import { BoxGeometry, Float32BufferAttribute } from 'three';

export const VIEW_MODES = Object.freeze(['2d', '2.5d']);
export const DEFAULT_VIEW_MODE = '2.5d';
export const FOV_MIN = 1; // degrees, vertical
export const FOV_MAX = 130;
export const FOV_DEFAULT = 15;
export const OFFSET_LIMIT = 4; // camera offset range, ± tiles
export const OFFSET_STEP = 0.25; // camera offset step, tiles
// Camera aim-follow settings: [key, label, min, max, step, default]. See cameraShift.
export const FOLLOW_SETTINGS = Object.freeze([
  ['follow', 'Follow', 0, 1, 0.05, 0.5], // fraction of head-to-aim the camera moves
  ['min', 'Min (tiles)', 0, 10, 0.25, 0], // dead zone: a shift shorter than this is 0
  ['max', 'Max (tiles)', 0, 20, 0.25, 8], // a longer shift is scaled down to this length
  ['scaleX', 'X scale', 0, 2, 0.05, 1], // applied after the clamp
  ['scaleY', 'Y scale', 0, 2, 0.05, 1],
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
  const offset = { x: 0, y: 0 };
  const follow = Object.fromEntries(FOLLOW_SETTINGS.map(([key, , , , , value]) => [key, value]));
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

// Camera aim-follow shift (tiles): (aim - head) * follow, its length clamped (below `min`: 0, above
// `max`: scaled down to `max`), then x and y scaled. `aim` must be the mouse projected through the
// camera at its rest position, never through the shifted camera, or the camera chases itself.
export function cameraShift(head, aim, { follow, min, max, scaleX, scaleY }) {
  let x = (aim.x - head.x) * follow;
  let y = (aim.y - head.y) * follow;
  const length = Math.hypot(x, y);
  if (length < min || length === 0) return { x: 0, y: 0 };
  if (length > max) {
    x *= max / length;
    y *= max / length;
  }
  return { x: x * scaleX, y: y * scaleY };
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
