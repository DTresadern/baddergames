// @ts-check
// Shared pieces of the three.js 3D build: world-to-3D mapping, camera frustum and the
// per-frame context.
//
// Mapping (see the header of shared/scene.js):
//   X = x - 600,  Y = 200 - y,  Z = -depth * D
// The camera sits at height CAM_H (not at Y = 0) so it looks slightly down onto the
// walkways and their wet top surfaces are visible. To keep the 2D composition, every
// element is scaled about the camera's axis (X = 0, Y = CAM_H) by (1 + depth), and the
// projection is an off-axis frustum, so the depth-0 plane still shows exactly the world
// rectangle x 0..1200, y 0..400. A sideways camera move by cameraX(t) then gives the 2D
// parallax factor 1 / (1 + depth) from real perspective.
//
// Layer contract (every module in layers/ follows it; the PixiJS 3D build uses the same):
//   export function createX(scene, ctx?) -> { parts: Part[], update?(t), info? }
//   Part = THREE.Object3D; ctx only for layers that need it
// main.js adds every part to the scene graph once (the mist's to the camera: it is a screen
// overlay); nothing is shifted per frame for parallax. `info` goes to the bench hook.

import * as THREE from 'three';

/** Camera distance to the depth-0 plane, in world units. */
export const D = 800;
/** Camera height above Y = 0 (world y = 200 - CAM_H). */
export const CAM_H = 130;
/** How far the bridge deck and platforms reach back into the scene (Z). */
export const DECK_DEPTH = 100;
/** World y of the front top edge of walking surfaces sits this far below the 2D deck line. */
export const DECK_FRONT_DROP = 13;

/**
 * A group placed at a scene depth: local coordinates are (x - 600, 200 - y, z) and the
 * group is scaled about the camera axis so it keeps its 2D screen position.
 * @param {number} depth
 * @returns {THREE.Group}
 */
export function depthGroup(depth) {
  const g = new THREE.Group();
  const s = 1 + depth;
  g.scale.setScalar(s);
  g.position.set(0, CAM_H * (1 - s), -depth * D);
  return g;
}

/**
 * World point (x, y down, local z inside a depthGroup(depth)) -> 3D world position.
 * @param {number} x @param {number} y @param {number} z @param {number} [depth]
 */
export function toWorld(x, y, z, depth = 0) {
  const s = 1 + depth;
  return new THREE.Vector3((x - 600) * s, CAM_H + (200 - y - CAM_H) * s, -depth * D + z * s);
}

/** World (y down) -> local X. @param {number} x */
export const lx = (x) => x - 600;
/** World (y down) -> local Y. @param {number} y */
export const ly = (y) => 200 - y;

/**
 * Rectangle of the view at a distance in front of the camera (camera-local units),
 * for screen-filling quads. The frustum is off-axis: see main.js.
 * @param {number} dist
 */
export function frustumRect(dist) {
  const k = dist / D;
  return { left: -600 * k, right: 600 * k, top: (200 - CAM_H) * k, bottom: (-200 - CAM_H) * k };
}

/**
 * @typedef {import('three').Object3D} Part
 * @typedef {{ parts: Part[], update?: (t: number) => void, info?: Record<string, number> }} Layer
 * @typedef {{
 *   root: import('three').Scene,
 *   time: import('three').IUniform<number>,
 *   coneApex: import('three').IUniform<import('three').Vector3>,
 *   coneDir: import('three').IUniform<import('three').Vector3>,
 *   coneParams: import('three').IUniform<import('three').Vector2>,
 *   env: import('three').Texture | null,
 * }} Ctx
 *   root: the scene graph (the sky layer sets its background). time: seconds. cone*: the drone searchlight in world space (apex, unit direction,
 *   (cos of the half-angle, length)); the rain shader lights drops inside it.
 *   env: procedural environment map for wet reflections (set by main.js).
 */

/** @param {THREE.Scene} root @returns {Ctx} */
export function createCtx(root) {
  return {
    root,
    time: { value: 0 },
    coneApex: { value: new THREE.Vector3() },
    coneDir: { value: new THREE.Vector3(1, 0, 0) },
    coneParams: { value: new THREE.Vector2(1, 0) },
    env: null,
  };
}
