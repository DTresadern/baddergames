// @ts-check
// Water dripping from the deck and platform edges: faint trickles plus falling drops
// animated in the vertex shader (same maths as dripState()), just in front of the edges.

import * as THREE from 'three';
import { fragmentTail } from '../effects/materials.js';

const VERT = /* glsl */ `
  attribute vec4 aDrip;  // x, y0, y1, period (2D world, y down)
  attribute float aPhase;
  uniform float uTime;
  uniform float uGravity;
  uniform float uZ;
  uniform float uTrickle;
  varying float vAlpha;
  varying float vAlong;
  void main() {
    // trickle: a static streak whose bottom is aDrip.y and whose length is aDrip.w
    float local = uTrickle > 0.5 ? 0.0 : mod(uTime + aPhase, aDrip.w);
    float y = aDrip.y + 0.5 * uGravity * local * local;
    float len = uTrickle > 0.5 ? aDrip.w : 2.0 + uGravity * local * 0.012; // streak grows with speed
    vAlpha = y <= aDrip.z ? 0.85 : 0.0;
    vAlong = position.y;
    vec2 p = vec2(aDrip.x + position.x * (uTrickle > 0.5 ? 0.8 : 1.4), y - position.y * len);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x - 600.0, 200.0 - p.y, uZ, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTrickle;
  varying float vAlpha;
  varying float vAlong;
  void main() {
    gl_FragColor = vec4(uColor, uTrickle > 0.5 ? 0.12 * (1.0 - vAlong) : vAlpha * (1.0 - 0.7 * vAlong));
    ${fragmentTail('')}
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createDrips(scene, ctx) {
  const list = scene.drips.drips;
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const group = new THREE.Group();
  // two instanced meshes from the same data: falling drops, and the faint constant trickle
  for (const trickle of [false, true]) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const a = new Float32Array(list.length * 4), ph = new Float32Array(list.length);
    list.forEach((d, i) => {
      // trickle: a static streak from the edge down 60% of the fall
      const len = (d.y1 - d.y0) * 0.6;
      if (trickle) a.set([d.x, d.y0 + len, d.y1, len], i * 4);
      else a.set([d.x, d.y0, d.y1, d.period], i * 4);
      ph[i] = trickle ? 0 : d.phase;
    });
    geometry.setAttribute('aDrip', new THREE.InstancedBufferAttribute(a, 4));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    geometry.instanceCount = list.length;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uTime: trickle ? { value: 0 } : ctx.time,
        uGravity: { value: trickle ? 0 : scene.drips.gravity },
        uColor: { value: new THREE.Color(scene.drips.color) },
        uZ: { value: 4 },
        uTrickle: { value: trickle ? 1 : 0 },
      },
      transparent: true, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return { parts: [group] };
}
