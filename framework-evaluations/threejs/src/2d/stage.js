// @ts-check
// Shared pieces of the three.js 2D build: draw order and the per-frame context.
//
// Layer contract (every module in layers/ follows it):
//   export function createX(scene, ctx?) -> { parts: Part[], update?(t) }   ctx only for layers that need it
//   Part = { object: THREE.Object3D, depth: number }
// main.js adds every part to the scene and, each frame, shifts it horizontally by
// parallaxOffset(depth, t). Shaders that animate read the SHARED uniforms below
// (one object referenced by many materials, so one assignment updates them all).

import * as THREE from 'three';

/** Painter's order, back to front. Every material is transparent, so three.js sorts by this. */
export const ORDER = Object.freeze({
  sky: 0,
  cityFar: 10, hazeFar: 11, rainFar: 12,
  cityMid: 20, hazeMid: 21,
  train: 25,
  smokeFar: 28,
  billboards: 30,
  cityNear: 35, hazeNear: 36, rainMid: 37,
  dome: 38,
  cityLow: 40, hazeLow: 41,
  smokeNear: 42,
  structuresBack: 48,
  structures: 50,
  bridge: 52,
  railings: 54,
  clutter: 56,
  growth: 57,
  hunters: 58,
  lightPools: 60,
  glows: 62,
  drone: 64,
  drips: 70,
  rainNear: 72,
  mist: 80,
});

/**
 * @typedef {{ object: import('three').Object3D, depth: number }} Part
 * @typedef {{ parts: Part[], update?: (t: number) => void }} Layer
 * @typedef {{ time: import('three').IUniform<number>, cameraX: import('three').IUniform<number>,
 *   cone: import('three').IUniform<import('three').Vector4> }} Ctx
 *   time: seconds; cameraX: camera drift (world units);
 *   cone: drone searchlight (apex x, apex y in world y-down, angle, half-angle) for the rain shader
 */

/** @returns {Ctx} */
export function createCtx() {
  return { time: { value: 0 }, cameraX: { value: 0 }, cone: { value: new THREE.Vector4(0, 0, 0, 0) } };
}
