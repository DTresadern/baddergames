// @ts-check
// Rain: GPU-animated streaks. Per-drop data is uploaded once (rainAttributes() in
// shared/scene.js); the vertex shader moves every drop from the time uniform with the
// same formula as rainDropAt(). Drops are split into three depth bands so far rain is
// drawn behind the near city and the bridge, near rain in front of everything.
// Drops inside the drone's searchlight cone are lit.

import * as THREE from 'three';
import { col } from '../effects/batch.js';
import { ORDER } from '../stage.js';
import { rainAttributes } from '@fw-eval/shared/scene.js';

const VERT = /* glsl */ `
  attribute vec4 aDrop;      // x0, y0, speed, depth
  attribute float aLength;
  uniform float uTime;
  uniform float uCameraX;
  uniform float uTanAngle;
  uniform float uWrap;       // world height + 40
  uniform vec4 uCone;        // apex x, apex y (y down), angle, half-angle
  varying float vAlong;
  varying float vAlpha;
  varying float vLit;
  void main() {
    float depth = aDrop.w;
    float travel = mod(aDrop.y + aDrop.z * uTime, uWrap) - 20.0;
    vec2 head = vec2(aDrop.x + uTanAngle * travel - uCameraX / (1.0 + depth), travel);
    vec2 dir = normalize(vec2(uTanAngle, 1.0));
    vec2 perp = vec2(dir.y, -dir.x);
    float width = mix(1.1, 0.55, clamp(depth / 10.0, 0.0, 1.0));
    vec2 p = head - dir * aLength * position.y + perp * width * position.x;
    vAlong = position.y;
    vAlpha = mix(0.5, 0.16, clamp(depth / 10.0, 0.0, 1.0));
    // inside the searchlight cone?
    vec2 rel = head - uCone.xy;
    float ang = atan(rel.y, rel.x) - uCone.z;
    ang = abs(mod(ang + 3.14159265, 6.2831853) - 3.14159265);
    float dist = length(rel);
    vLit = (1.0 - smoothstep(uCone.w * 0.6, uCone.w, ang)) * (1.0 - smoothstep(60.0, 300.0, dist)) * step(1.0, uCone.w * 10.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLitColor;
  varying float vAlong;
  varying float vAlpha;
  varying float vLit;
  void main() {
    float a = vAlpha * (1.0 - vAlong) * (1.0 + vLit * 2.0);
    gl_FragColor = vec4(mix(uColor, uLitColor, vLit), a);
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createRain(scene, ctx) {
  const attrs = rainAttributes(scene);
  const bands = [
    { min: 4, max: Infinity, order: ORDER.rainFar },
    { min: 1.5, max: 4, order: ORDER.rainMid },
    { min: -Infinity, max: 1.5, order: ORDER.rainNear },
  ];
  /** @type {import('../stage.js').Part[]} */
  const parts = [];
  const base = new THREE.BufferGeometry();
  // unit streak: x across (-0.5..0.5), y along (0 = head, 1 = tail)
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const uniforms = {
    uTime: ctx.time,
    uCameraX: ctx.cameraX,
    uCone: ctx.cone,
    uTanAngle: { value: Math.tan(scene.rain.angle) },
    uWrap: { value: scene.world.height + 40 },
    uColor: { value: col(scene.rain.color) },
    uLitColor: { value: col(scene.palette.amberPale) },
  };
  for (const band of bands) {
    /** @type {number[]} */
    const idx = [];
    for (let i = 0; i < attrs.depth.length; i++) if (attrs.depth[i] >= band.min && attrs.depth[i] < band.max) idx.push(i);
    const drop = new Float32Array(idx.length * 4), len = new Float32Array(idx.length);
    idx.forEach((i, k) => {
      drop[k * 4] = attrs.x0[i]; drop[k * 4 + 1] = attrs.y0[i]; drop[k * 4 + 2] = attrs.speed[i]; drop[k * 4 + 3] = attrs.depth[i];
      len[k] = attrs.length[i];
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drop, 4));
    geometry.setAttribute('aLength', new THREE.InstancedBufferAttribute(len, 1));
    geometry.instanceCount = idx.length;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = band.order;
    mesh.frustumCulled = false;
    mesh.visible = idx.length > 0;
    // parallax is done per drop in the shader, so the part itself never moves
    parts.push({ object: mesh, depth: Infinity });
  }
  return { parts };
}
