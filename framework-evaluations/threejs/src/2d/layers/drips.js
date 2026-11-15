// @ts-check
// Water dripping from the deck and platform edges: faint constant trickles plus
// falling drops animated in the vertex shader (same maths as dripState()).

import * as THREE from 'three';
import { ShapeBatch, col } from '../effects/batch.js';
import { ORDER } from '../stage.js';

const VERT = /* glsl */ `
  attribute vec4 aDrip;  // x, y0, y1, period
  attribute float aPhase;
  uniform float uTime;
  uniform float uGravity;
  varying float vAlpha;
  varying float vAlong;
  void main() {
    float local = mod(uTime + aPhase, aDrip.w);
    float y = aDrip.y + 0.5 * uGravity * local * local;
    float speed = uGravity * local;
    float len = 2.0 + speed * 0.012;              // motion streak grows with speed
    vAlpha = y <= aDrip.z ? 0.85 : 0.0;
    vAlong = position.y;
    vec2 p = vec2(aDrip.x + position.x * 1.4, y - position.y * len);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vAlong;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * (1.0 - 0.7 * vAlong));
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createDrips(scene, ctx) {
  const list = scene.drips.drips;
  // faint permanent trickle under each source
  const trickle = new ShapeBatch();
  for (const d of list) trickle.rect(d.x - 0.4, d.y0, 0.8, (d.y1 - d.y0) * 0.6, scene.drips.color, 0.12, 0);

  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  const a = new Float32Array(list.length * 4), ph = new Float32Array(list.length);
  list.forEach((d, i) => { a.set([d.x, d.y0, d.y1, d.period], i * 4); ph[i] = d.phase; });
  geometry.setAttribute('aDrip', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  geometry.instanceCount = list.length;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uTime: ctx.time, uGravity: { value: scene.drips.gravity }, uColor: { value: col(scene.drips.color) } },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const drops = new THREE.Mesh(geometry, material);
  drops.renderOrder = ORDER.drips;
  drops.frustumCulled = false;

  const group = new THREE.Group();
  group.add(trickle.build(ORDER.drips - 0.5), drops);
  return { parts: [{ object: group, depth: 0 }] };
}
