// @ts-check
// Shared pieces of the PixiJS 3D build: the world -> 3D mapping and the per-frame context.
//
// Mapping (shared/scene.js header): X = x - 600, Y = 200 - y, Z = -depth * D, with X and Y
// scaled by (1 + depth) about the camera axis. The camera sits at (cameraX(t), 0, D) and looks
// straight down -Z, so an element at depth d moves with the 2D parallax factor 1 / (1 + d) and
// fills the same part of the frame as in the 2D builds.
//
// Layer contract (every module in layers/ follows it):
//   export function createX(scene, ctx) -> { nodes: Container3D[], update?(t) }
// main.js adds every node under one content container. Materials whose shader bits animate
// register in ctx.timed; main.js writes `data.time` on them each frame, because the
// built-in `uTime` of @pixi/3d is performance.now() and cannot be frozen for `?t=`.

/** Vertical field of view in degrees. */
export const FOV = 45;
/** Camera distance to the depth-0 plane: 400 world units fill the frame height there. */
export const D = 200 / Math.tan((FOV / 2) * (Math.PI / 180));

/** @param {number} x world x @param {number} [depth] */
export const X = (x, depth = 0) => (x - 600) * (1 + depth);
/** @param {number} y world y (down) @param {number} [depth] */
export const Y = (y, depth = 0) => (200 - y) * (1 + depth);
/** @param {number} depth */
export const Z = (depth) => -depth * D;
/** World length at a depth -> 3D length. @param {number} v @param {number} [depth] */
export const S = (v, depth = 0) => v * (1 + depth);

/**
 * @typedef {import('@pixi/3d').Container3D} Node
 * @typedef {{ nodes: Node[], update?: (t: number) => void, info?: Record<string, number> }} Layer
 * @typedef {{ data: Record<string, any> }} TimedMaterial
 * @typedef {{
 *   timed: TimedMaterial[],
 *   cone: { x: number, y: number, angle: number, half: number },
 * }} Ctx
 *   timed: materials with a `time` field in their shader-bit data;
 *   cone: drone searchlight in world units (apex x, apex y with y down, angle, half-angle)
 */

/** @returns {Ctx} */
export function createCtx() {
  return { timed: [], cone: { x: 0, y: 0, angle: 0, half: 0 } };
}

/**
 * Perspective-correct 3D point for a depth-0 world point placed at an arbitrary Z (objects
 * standing back on the deck): scaled by the camera distance so it projects exactly to (x, y).
 * @param {number} x @param {number} y @param {number} z
 * @returns {[number, number, number]}
 */
export function P3(x, y, z) {
  const k = (D - z) / D;
  return [(x - 600) * k, (200 - y) * k, z];
}

/**
 * The bridge deck's walking surface. The camera eye is level with world y = 200, just
 * below the deck top (y = 196), so a flat deck would be seen edge-on from underneath. The
 * deck is therefore built as a slab whose top rises gently from its front edge (projecting
 * to y = 209) to its back edge (projecting to y = 196): seen from the camera it covers the
 * same strip as the 2D deck and faces up, so lamps and the sky reflect in it.
 */
export const DECK = Object.freeze({ frontY: 209, backY: 196, frontZ: 0, backZ: -80 });

/**
 * Where something standing on the deck at depth z rests (3D Y of the walking surface).
 * @param {number} z between DECK.frontZ and DECK.backZ
 */
export function deckTopAt(z) {
  const f = (z - DECK.frontZ) / (DECK.backZ - DECK.frontZ);
  const yFront = P3(0, DECK.frontY, DECK.frontZ)[1], yBack = P3(0, DECK.backY, DECK.backZ)[1];
  return yFront + (yBack - yFront) * f;
}

/**
 * 3D Y of the surface an object standing at world y (feet) rests on, at depth z:
 * the sloped deck for y = DECK.backY, otherwise the flat platform top at Y(y).
 * @param {number} y @param {number} z
 */
export function standY(y, z) {
  return y === DECK.backY ? deckTopAt(z) : Y(y);
}
