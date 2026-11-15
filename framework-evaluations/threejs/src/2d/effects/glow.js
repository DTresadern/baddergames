// @ts-check
// GlowBatch: many additive radial glows in ONE instanced draw call.
// Used for lamp halos, light pools on wet surfaces, red warning lights,
// growth pods, window bloom. Falloff and blinking are computed in the shader.
//
// Blink modes (same maths as lampFlicker / redBlink in shared/scene.js):
//   0 steady, 1 red warning blink, 2 lamp flicker, 3 slow pulse.

import * as THREE from 'three';

export const BLINK = Object.freeze({ steady: 0, red: 1, flicker: 2, pulse: 3 });

const VERT = /* glsl */ `
  attribute vec2 aCenter;     // world, y down
  attribute vec2 aRadius;     // x and y radius (ellipse)
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
    vec2 p = vec2(aCenter.x, -aCenter.y) + position.xy * aRadius;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uCore;   // size of the hot centre (0 = soft halo only)
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
  }
`;

export class GlowBatch {
  constructor() {
    /** @type {{ x: number, y: number, rx: number, ry: number, color: number, intensity: number, blink: number, phase: number }[]} */
    this.items = [];
  }

  /**
   * @param {number} x @param {number} y world centre (y down)
   * @param {number} rx @param {number} ry radii
   * @param {number} color 0xRRGGBB @param {number} intensity
   * @param {number} [blink] BLINK mode @param {number} [phase]
   */
  add(x, y, rx, ry, color, intensity, blink = 0, phase = 0) {
    this.items.push({ x, y, rx, ry, color, intensity, blink, phase });
    return this;
  }

  /**
   * @param {number} renderOrder
   * @param {{ core?: number, time: THREE.IUniform<number> }} opts core: radius (0..1)
   *   of a white-hot centre; time: the shared time uniform (stage.js)
   */
  build(renderOrder, opts) {
    const n = this.items.length;
    const base = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const center = new Float32Array(n * 2), radius = new Float32Array(n * 2), color = new Float32Array(n * 3);
    const intensity = new Float32Array(n), blink = new Float32Array(n), phase = new Float32Array(n);
    this.items.forEach((g, i) => {
      center[i * 2] = g.x; center[i * 2 + 1] = g.y;
      radius[i * 2] = g.rx; radius[i * 2 + 1] = g.ry;
      color[i * 3] = ((g.color >> 16) & 255) / 255;
      color[i * 3 + 1] = ((g.color >> 8) & 255) / 255;
      color[i * 3 + 2] = (g.color & 255) / 255;
      intensity[i] = g.intensity; blink[i] = g.blink; phase[i] = g.phase;
    });
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 2));
    geometry.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 2));
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
    geometry.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(intensity, 1));
    geometry.setAttribute('aBlink', new THREE.InstancedBufferAttribute(blink, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geometry.instanceCount = n;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: opts.time, uCore: { value: opts.core ?? 0 } },
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.visible = n > 0;
    return mesh;
  }
}
