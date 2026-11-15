// @ts-check
// Two glowing billboards (abstract animated pattern, no text), with frames, legs and a halo.

import * as THREE from 'three';
import { ShapeBatch, shaderRect, flatShader, RECT_VERT, NOISE_GLSL, col } from '../effects/batch.js';
import { GlowBatch } from '../effects/glow.js';
import { ORDER } from '../stage.js';
import { hazed, hazeAt } from '@fw-eval/shared/scene.js';

const FRAG = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uHaze;
  uniform float uHazeAmount;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // two-colour gradient that slowly rolls
    float g = uv.y + 0.15 * sin(uTime * 0.4 + uSeed + uv.x * 3.0);
    vec3 c = mix(uA, uB, clamp(g, 0.0, 1.0));
    // drifting abstract blobs (an "advert" without text)
    float blobs = fbm(uv * vec2(3.0, 2.0) + vec2(uTime * 0.12, uSeed));
    c *= 0.55 + 0.9 * smoothstep(0.35, 0.75, blobs);
    // bright diagonal sweep
    float sweep = smoothstep(0.08, 0.0, abs(fract(uv.x * 0.6 - uv.y * 0.3 - uTime * 0.15 + uSeed) - 0.5));
    c += sweep * 0.25;
    // scanlines and a rare flicker
    c *= 0.82 + 0.18 * step(0.5, fract(uv.y * 30.0));
    c *= 0.85 + 0.15 * step(0.08, fract(sin(floor(uTime * 8.0) + uSeed) * 43758.5));
    // haze: emissive surfaces cut through haze better than unlit ones
    c = mix(c, uHaze, uHazeAmount * 0.45);
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createBillboards(scene, ctx) {
  /** @type {import('../stage.js').Part[]} */
  const parts = [];
  for (const bb of scene.billboards) {
    const group = new THREE.Group();
    const d = bb.depth;
    const frame = new ShapeBatch();
    const steel = hazed(scene, bb.frame, d);
    // legs down into the haze and a frame around the screen
    frame.rect(bb.x + bb.w * 0.2, bb.y + bb.h, 4, 80, steel);
    frame.rect(bb.x + bb.w * 0.75, bb.y + bb.h, 4, 80, steel);
    frame.rect(bb.x - 4, bb.y - 4, bb.w + 8, bb.h + 8, steel);
    group.add(frame.build(ORDER.billboards));

    const h = hazeAt(scene, d);
    const material = flatShader({
      vertexShader: RECT_VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: ctx.time,
        uSeed: { value: bb.seed * 3.7 },
        uA: { value: col(bb.colorA) },
        uB: { value: col(bb.colorB) },
        uHaze: { value: col(h.color) },
        uHazeAmount: { value: h.opacity },
      },
    });
    group.add(shaderRect(bb.x, bb.y, bb.w, bb.h, material, ORDER.billboards + 1));

    // halo in the rain around the screen
    const glow = new GlowBatch();
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    glow.add(cx, cy, bb.w * 1.1, bb.h * 1.2, bb.colorA, 0.35);
    glow.add(cx, cy + bb.h * 0.4, bb.w * 0.8, bb.h * 0.9, bb.colorB, 0.25);
    group.add(glow.build(ORDER.billboards + 2, { time: ctx.time }));
    parts.push({ object: group, depth: d });
  }
  return { parts };
}
