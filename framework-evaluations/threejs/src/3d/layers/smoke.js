// @ts-check
// Smoke stacks: chimney cylinders plus soft particle quads (one instanced mesh per stack).
// Particle positions come from smokeParticle() in shared/scene.js each frame.

import * as THREE from 'three';
import { InstanceBatch, UNIT } from '../effects/batch.js';
import { NOISE_GLSL, fragmentTail } from '../effects/materials.js';
import { depthGroup, lx, ly } from '../stage.js';
import { hazed, smokeParticle } from '@fw-eval/shared/scene.js';

const VERT = /* glsl */ `
  attribute vec3 aParticle;  // X, Y (local, y up), size
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
    vec3 w = vec3(aParticle.xy + p * aParticle.z, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
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
    ${fragmentTail('')}
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createSmoke(scene) {
  const P = scene.palette;
  const root = new THREE.Group();
  const chimneyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.4 });
  /** @type {{ stack: typeof scene.smokeStacks[number], count: number, a: THREE.InstancedBufferAttribute, b: THREE.InstancedBufferAttribute }[]} */
  const emitters = [];
  for (const stack of scene.smokeStacks) {
    const d = stack.depth;
    const g = depthGroup(d);
    const chimney = new InstanceBatch(UNIT.cylinder);
    chimney.add({ x: lx(stack.x), y: ly(stack.y + stack.h / 2), z: -stack.w / 2 }, new THREE.Euler(), { x: stack.w, y: stack.h, z: stack.w }, P.gunmetal);
    chimney.add({ x: lx(stack.x), y: ly(stack.y + 1.5), z: -stack.w / 2 }, new THREE.Euler(), { x: stack.w + 3, y: 3, z: stack.w + 3 }, P.gunmetalLight);
    g.add(chimney.build(chimneyMat));

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
      uniforms: { uColor: { value: new THREE.Color(hazed(scene, P.smoke, d * 0.7)) } },
      transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.position.z = -stack.w / 2;
    g.add(mesh);
    root.add(g);
    emitters.push({ stack, count, a, b });
  }
  return {
    parts: [root],
    update(t) {
      for (const e of emitters) {
        const pa = /** @type {Float32Array} */ (e.a.array), pb = /** @type {Float32Array} */ (e.b.array);
        for (let i = 0; i < e.count; i++) {
          const p = smokeParticle(e.stack, i, t);
          pa[i * 3] = lx(p.x); pa[i * 3 + 1] = ly(p.y); pa[i * 3 + 2] = p.size;
          pb[i * 2] = p.alpha; pb[i * 2 + 1] = p.rotation;
        }
        e.a.needsUpdate = true;
        e.b.needsUpdate = true;
      }
    },
  };
}
