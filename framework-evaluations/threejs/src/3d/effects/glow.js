// @ts-check
// GlowBatch: many additive halos (lamp glow in the rain, warning lights, pods) in ONE
// instanced draw call. Quads lie in the XY plane, which always faces this build's camera
// (it only moves sideways). Depth-tested, so structures in front hide a halo.
//
// Blink modes (same maths as lampFlicker / redBlink in shared/scene.js):
//   0 steady, 1 red warning blink, 2 lamp flicker, 3 slow pulse.

import * as THREE from 'three';
import { fragmentTail } from './materials.js';
import { lx, ly } from '../stage.js';

export const BLINK = Object.freeze({ steady: 0, red: 1, flicker: 2, pulse: 3 });

const VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec2 aRadius;
  attribute vec3 aColor;
  attribute float aIntensity;
  attribute float aBlink;
  attribute float aPhase;
  uniform float uTime;
  varying vec2 vLocal;
  varying vec3 vColor;
  varying float vIntensity;
  void main() {
    float b = 1.0;
    if (aBlink > 0.5 && aBlink < 1.5) {
      b = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 3.0 + aPhase * 0.9), 4.0);
    } else if (aBlink > 1.5 && aBlink < 2.5) {
      float v = sin(uTime * 17.0 + aPhase * 3.1) + sin(uTime * 7.3 + aPhase);
      b = v > 1.4 ? 0.35 : 1.0;
    } else if (aBlink > 2.5) {
      b = 0.65 + 0.35 * sin(uTime * 1.6 + aPhase);
    }
    vLocal = position.xy;
    vColor = aColor;
    vIntensity = aIntensity * b;
    vec3 p = aCenter + vec3(position.xy * aRadius, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uCore;
  varying vec2 vLocal;
  varying vec3 vColor;
  varying float vIntensity;
  void main() {
    float d = length(vLocal);
    if (d > 1.0) discard;
    float halo = exp(-d * d * 4.0) * (1.0 - d);
    float core = uCore > 0.0 ? smoothstep(uCore, 0.0, d) : 0.0;
    vec3 c = vColor * halo * vIntensity + mix(vColor, vec3(1.0), 0.6) * core * vIntensity;
    gl_FragColor = vec4(c, 1.0);
    ${fragmentTail('')}
  }
`;

export class GlowBatch {
  constructor() {
    /** @type {number[]} */ this.data = [];
  }

  /**
   * @param {number} x @param {number} y world (y down) @param {number} z local z
   * @param {number} rx @param {number} ry radii
   * @param {number} color 0xRRGGBB @param {number} intensity
   * @param {number} [blink] BLINK mode @param {number} [phase]
   */
  add(x, y, z, rx, ry, color, intensity, blink = 0, phase = 0) {
    return this.addLocal(new THREE.Vector3(lx(x), ly(y), z), rx, ry, color, intensity, blink, phase);
  }

  /**
   * Same as add() with a position already in local 3D units (X, Y up, Z).
   * @param {THREE.Vector3} p @param {number} rx @param {number} ry
   * @param {number} color @param {number} intensity @param {number} [blink] @param {number} [phase]
   */
  addLocal(p, rx, ry, color, intensity, blink = 0, phase = 0) {
    const c = new THREE.Color(color);
    this.data.push(p.x, p.y, p.z, rx, ry, c.r, c.g, c.b, intensity, blink, phase);
    return this;
  }

  /**
   * @param {{ core?: number, time: THREE.IUniform<number> }} opts core: radius (0..1) of a white-hot centre
   */
  build(opts) {
    const n = this.data.length / 11;
    const base = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(this.data), 11);
    geometry.setAttribute('aCenter', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    geometry.setAttribute('aRadius', new THREE.InterleavedBufferAttribute(buf, 2, 3));
    geometry.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buf, 3, 5));
    geometry.setAttribute('aIntensity', new THREE.InterleavedBufferAttribute(buf, 1, 8));
    geometry.setAttribute('aBlink', new THREE.InterleavedBufferAttribute(buf, 1, 9));
    geometry.setAttribute('aPhase', new THREE.InterleavedBufferAttribute(buf, 1, 10));
    geometry.instanceCount = n;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: opts.time, uCore: { value: opts.core ?? 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = n > 0;
    mesh.renderOrder = 10;
    return mesh;
  }
}
