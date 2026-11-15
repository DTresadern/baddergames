// @ts-check
// Smoke stacks: chimney rects plus soft particle quads (one instanced mesh per stack).
// Particle positions come from smokeParticle() in shared/scene.js each frame.

import * as THREE from 'three';
import { ShapeBatch, NOISE_GLSL, col } from '../effects/batch.js';
import { ORDER } from '../stage.js';
import { hazed, smokeParticle } from '@fw-eval/shared/scene.js';

const VERT = /* glsl */ `
  attribute vec3 aParticle;  // x, y (world, y down), size
  attribute vec2 aAlphaRot;  // alpha, rotation
  varying vec2 vLocal;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    float c = cos(aAlphaRot.y), s = sin(aAlphaRot.y);
    vec2 p = mat2(c, -s, s, c) * position.xy;
    vLocal = position.xy;
    vAlpha = aAlphaRot.x;
    vSeed = aAlphaRot.y;
    vec2 w = vec2(aParticle.x, -aParticle.y) + p * aParticle.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uColor;
  varying vec2 vLocal;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    float d = length(vLocal);
    float n = fbm(vLocal * 1.6 + vSeed);
    float a = smoothstep(1.0, 0.1, d + (n - 0.5) * 0.7) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (0.8 + 0.4 * n), a);
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createSmoke(scene) {
  const P = scene.palette;
  /** @type {import('../stage.js').Part[]} */
  const parts = [];
  /** @type {{ stack: typeof scene.smokeStacks[number], count: number, a: THREE.InstancedBufferAttribute, b: THREE.InstancedBufferAttribute }[]} */
  const emitters = [];
  for (const stack of scene.smokeStacks) {
    const d = stack.depth;
    const order = d >= 3 ? ORDER.smokeFar : ORDER.smokeNear;
    const group = new THREE.Group();

    const chimney = new ShapeBatch();
    chimney.rect(stack.x - stack.w / 2, stack.y, stack.w, stack.h, [hazed(scene, P.gunmetal, d), hazed(scene, P.gunmetal, d + 2)]);
    chimney.rect(stack.x - stack.w / 2 - 1.5, stack.y, stack.w + 3, 3, hazed(scene, P.gunmetalLight, d));
    chimney.rect(stack.x - 1, stack.y + 6, 2, 2, hazed(scene, P.warningRed, d * 0.4));
    group.add(chimney.build(order));

    const count = Math.ceil(stack.rate * stack.life);
    const base = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    a.setUsage(THREE.DynamicDrawUsage);
    b.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aParticle', a);
    geometry.setAttribute('aAlphaRot', b);
    geometry.instanceCount = count;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: col(hazed(scene, P.smoke, d * 0.7)) } },
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = order + 0.5;
    mesh.frustumCulled = false;
    group.add(mesh);
    parts.push({ object: group, depth: d });
    emitters.push({ stack, count, a, b });
  }
  return {
    parts,
    update(t) {
      for (const e of emitters) {
        const pa = /** @type {Float32Array} */ (e.a.array), pb = /** @type {Float32Array} */ (e.b.array);
        for (let i = 0; i < e.count; i++) {
          const p = smokeParticle(e.stack, i, t);
          pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.size;
          pb[i * 2] = p.alpha; pb[i * 2 + 1] = p.rotation;
        }
        e.a.needsUpdate = true;
        e.b.needsUpdate = true;
      }
    },
  };
}
