// @ts-check
// Two glowing billboards (abstract animated pattern, no text): emissive shader planes in a
// box frame on legs, with a halo in the rain. The screens are brighter than 1.0 so the
// bloom pass picks them up.

import * as THREE from 'three';
import { InstanceBatch, UNIT } from '../effects/batch.js';
import { GlowBatch } from '../effects/glow.js';
import { NOISE_GLSL, fragmentTail } from '../effects/materials.js';
import { depthGroup, lx, ly } from '../stage.js';
import { hazeAt } from '@fw-eval/shared/scene.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

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
    float g = uv.y + 0.15 * sin(uTime * 0.4 + uSeed + uv.x * 3.0);
    vec3 c = mix(uA, uB, clamp(g, 0.0, 1.0));
    float blobs = fbm(uv * vec2(3.0, 2.0) + vec2(uTime * 0.12, uSeed));
    c *= 0.55 + 0.9 * smoothstep(0.35, 0.75, blobs);
    float sweep = smoothstep(0.08, 0.0, abs(fract(uv.x * 0.6 - uv.y * 0.3 - uTime * 0.15 + uSeed) - 0.5));
    c += sweep * 0.25;
    c *= 0.82 + 0.18 * step(0.5, fract(uv.y * 30.0));
    c *= 0.85 + 0.15 * step(0.08, fract(sin(floor(uTime * 8.0) + uSeed) * 43758.5));
    c = mix(c, uHaze, uHazeAmount * 0.45);
    gl_FragColor = vec4(c * 1.3, 1.0);
    ${fragmentTail('')}
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createBillboards(scene, ctx) {
  const root = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.6 });
  for (const bb of scene.billboards) {
    const g = depthGroup(bb.depth);
    const frame = new InstanceBatch(UNIT.box);
    frame.box(bb.x + bb.w * 0.2, bb.y + bb.h, 4, 120, -4, 4, bb.frame);
    frame.box(bb.x + bb.w * 0.75, bb.y + bb.h, 4, 120, -4, 4, bb.frame);
    frame.box(bb.x - 4, bb.y - 4, bb.w + 8, bb.h + 8, -1, 6, bb.frame);
    g.add(frame.build(frameMat));

    const h = hazeAt(scene, bb.depth);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: ctx.time,
        uSeed: { value: bb.seed * 3.7 },
        uA: { value: new THREE.Color(bb.colorA) },
        uB: { value: new THREE.Color(bb.colorB) },
        uHaze: { value: new THREE.Color(h.color) },
        uHazeAmount: { value: h.opacity },
      },
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(bb.w, bb.h), material);
    screen.position.set(lx(bb.x + bb.w / 2), ly(bb.y + bb.h / 2), 0.2);
    g.add(screen);

    const glow = new GlowBatch();
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    glow.add(cx, cy, 2, bb.w * 1.1, bb.h * 1.2, bb.colorA, 0.3);
    glow.add(cx, cy + bb.h * 0.4, 2, bb.w * 0.8, bb.h * 0.9, bb.colorB, 0.2);
    g.add(glow.build({ time: ctx.time }));
    root.add(g);
  }
  return { parts: [root] };
}
