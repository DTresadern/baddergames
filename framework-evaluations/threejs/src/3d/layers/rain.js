// @ts-check
// Rain: GPU-animated instanced streaks in a real 3D volume. Per-drop data is uploaded once
// (rainAttributes() in shared/scene.js); the vertex shader moves every drop from the time
// uniform with the same formula as rainDropAt(), then places it at its depth with the
// stage mapping (scaled about the camera axis), so drops near and far keep the 2D framing
// while perspective and the depth buffer put them in front of or behind the geometry.
// One draw call for all drops. Drops inside the drone's searchlight cone (a real 3D cone
// test) are lit.

import * as THREE from 'three';
import { fragmentTail } from '../effects/materials.js';
import { D, CAM_H } from '../stage.js';
import { rainAttributes } from '@fw-eval/shared/scene.js';

/** Rain volume starts this far in front of the depth-0 plane (rain in front of the bridge). */
const Z_FRONT = 60;

const VERT = /* glsl */ `
  attribute vec4 aDrop;      // x0, y0, speed, depth
  attribute float aLength;
  uniform float uTime;
  uniform float uTanAngle;
  uniform float uWrap;       // world height + 40
  uniform float uD;
  uniform float uCamH;
  uniform float uZFront;
  uniform vec3 uConeApex;
  uniform vec3 uConeDir;
  uniform vec2 uConeParams;  // cos(half-angle), length
  varying float vAlong;
  varying float vAlpha;
  varying float vLit;
  vec3 place(vec2 p, float zDist) {
    float s = 1.0 + zDist / uD;
    return vec3((p.x - 600.0) * s, uCamH + (200.0 - p.y - uCamH) * s, -zDist);
  }
  void main() {
    float depth = aDrop.w;
    float zDist = depth * uD - uZFront;
    float travel = mod(aDrop.y + aDrop.z * uTime, uWrap) - 20.0;
    vec2 head = vec2(aDrop.x + uTanAngle * travel, travel);
    vec2 dir = normalize(vec2(uTanAngle, 1.0));
    vec2 perp = vec2(dir.y, -dir.x);
    float width = mix(1.1, 0.55, clamp(depth / 10.0, 0.0, 1.0));
    vec2 p = head - dir * aLength * position.y + perp * width * position.x;
    vAlong = position.y;
    vAlpha = mix(0.5, 0.16, clamp(depth / 10.0, 0.0, 1.0));
    // inside the searchlight cone?
    vec3 rel = place(head, zDist) - uConeApex;
    float dist = length(rel);
    float c = dot(rel / max(dist, 0.001), uConeDir);
    vLit = smoothstep(uConeParams.x, mix(uConeParams.x, 1.0, 0.4), c) * (1.0 - smoothstep(uConeParams.y * 0.3, uConeParams.y, dist));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(place(p, zDist), 1.0);
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
    gl_FragColor = vec4(mix(uColor, uLitColor, vLit), min(1.0, a));
    ${fragmentTail('')}
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createRain(scene, ctx) {
  const attrs = rainAttributes(scene);
  const n = attrs.depth.length;
  const base = new THREE.BufferGeometry();
  // unit streak: x across (-0.5..0.5), y along (0 = head, 1 = tail)
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const drop = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) drop.set([attrs.x0[i], attrs.y0[i], attrs.speed[i], attrs.depth[i]], i * 4);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drop, 4));
  geometry.setAttribute('aLength', new THREE.InstancedBufferAttribute(attrs.length, 1));
  geometry.instanceCount = n;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: ctx.time,
      uTanAngle: { value: Math.tan(scene.rain.angle) },
      uWrap: { value: scene.world.height + 40 },
      uD: { value: D },
      uCamH: { value: CAM_H },
      uZFront: { value: Z_FRONT },
      uConeApex: ctx.coneApex,
      uConeDir: ctx.coneDir,
      uConeParams: ctx.coneParams,
      uColor: { value: new THREE.Color(scene.rain.color) },
      uLitColor: { value: new THREE.Color(scene.palette.amberPale) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = n > 0;
  mesh.renderOrder = 20; // after the other transparent layers
  return { object: mesh };
}
