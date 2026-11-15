// @ts-check
// Shared pieces of the PixiJS 2D build: draw order and the per-frame context.
//
// Layer contract (every module in layers/ follows it):
//   export function createX(scene, ctx?) -> { parts: Part[], update?(t) }   ctx only for layers that need it
//   Part = { object: Container, depth: number }
// main.js adds every part to the root container and, each frame, shifts it
// horizontally by parallaxOffset(depth, t).
//
// Draw order: every drawable leaf gets `zIndex = ORDER.x` and main.js attaches it to one
// sorted RenderLayer, so leaves draw in ORDER regardless of which part they belong to
// (the same global painter's order the three.js build gets from renderOrder).
// Shaders that animate read the SHARED UniformGroup below (one group referenced by
// many shaders, so one assignment updates them all).

import { UniformGroup } from 'pixi.js';

/** Painter's order, back to front (same values as the three.js 2D build). */
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
 * @typedef {{ object: import('pixi.js').Container, depth: number }} Part
 * @typedef {{ parts: Part[], update?: (t: number) => void }} Layer
 * @typedef {ReturnType<typeof createCtx>} Ctx
 */

/**
 * frame.uniforms: uTime seconds; uCameraX camera drift (world units);
 * uCone drone searchlight (apex x, apex y in world y-down, angle, half-angle) for the rain shader.
 */
export function createCtx() {
  const frame = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uCameraX: { value: 0, type: 'f32' },
    uCone: { value: new Float32Array(4), type: 'vec4<f32>' },
  });
  return { frame };
}
