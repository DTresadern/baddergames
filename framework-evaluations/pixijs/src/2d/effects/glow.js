// @ts-check
// GlowBatch: many additive radial glows in ONE instanced draw call (Mesh + custom
// Shader + instanced Geometry attributes).
// Used for lamp halos, light pools on wet surfaces, red warning lights,
// growth pods, window bloom. Falloff and blinking are computed in the shader.
//
// Blink modes (same maths as lampFlicker / redBlink in shared/scene.js):
//   0 steady, 1 red warning blink, 2 lamp flicker, 3 slow pulse.

import { Geometry } from 'pixi.js';
import { makeShader, shaderMesh, unitQuad, f32 } from './batch.js';

export const BLINK = Object.freeze({ steady: 0, red: 1, flicker: 2, pulse: 3 });

const VERT = /* glsl */ `
  in vec2 aCenter;     // world, y down
  in vec2 aRadius;     // x and y radius (ellipse)
  in vec3 aTint;
  in float aIntensity;
  in float aBlink;
  in float aPhase;
  uniform float uTime;
  out vec2 vLocal;
  out vec3 vTint;
  out float vIntensity;
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
    vLocal = aPosition;
    vTint = aTint;
    vIntensity = aIntensity * b;
    gl_Position = toClip(aCenter + aPosition * aRadius);
  }
`;

const FRAG = /* glsl */ `
  uniform float uCore;   // size of the hot centre (0 = soft halo only)
  in vec2 vLocal;
  in vec3 vTint;
  in float vIntensity;
  void main() {
    float d = length(vLocal);
    if (d > 1.0) discard;
    float halo = exp(-d * d * 4.0) * (1.0 - d);
    float core = uCore > 0.0 ? smoothstep(uCore, 0.0, d) : 0.0;
    vec3 c = vTint * halo * vIntensity + mix(vTint, vec3(1.0), 0.6) * core * vIntensity;
    finalColor = vec4(c, 0.0);   // additive: adds c, leaves alpha alone
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
   * @param {number} order ORDER value
   * @param {{ core?: number, ctx: import('../stage.js').Ctx }} opts core: radius (0..1)
   *   of a white-hot centre; ctx: the shared frame uniforms (stage.js)
   */
  build(order, opts) {
    const n = this.items.length;
    const m = Math.max(1, n); // empty buffers are not allowed; the mesh is hidden instead
    const center = new Float32Array(m * 2), radius = new Float32Array(m * 2), color = new Float32Array(m * 3);
    const intensity = new Float32Array(m), blink = new Float32Array(m), phase = new Float32Array(m);
    this.items.forEach((g, i) => {
      center[i * 2] = g.x; center[i * 2 + 1] = g.y;
      radius[i * 2] = g.rx; radius[i * 2 + 1] = g.ry;
      color[i * 3] = ((g.color >> 16) & 255) / 255;
      color[i * 3 + 1] = ((g.color >> 8) & 255) / 255;
      color[i * 3 + 2] = (g.color & 255) / 255;
      intensity[i] = g.intensity; blink[i] = g.blink; phase[i] = g.phase;
    });
    const geometry = new Geometry({
      attributes: {
        ...unitQuad(true),
        aCenter: { buffer: center, format: 'float32x2', instance: true },
        aRadius: { buffer: radius, format: 'float32x2', instance: true },
        aTint: { buffer: color, format: 'float32x3', instance: true },
        aIntensity: { buffer: intensity, format: 'float32', instance: true },
        aBlink: { buffer: blink, format: 'float32', instance: true },
        aPhase: { buffer: phase, format: 'float32', instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
      instanceCount: n,
    });
    const shader = makeShader(VERT, FRAG, { frame: opts.ctx.frame, glow: { uCore: f32(opts.core ?? 0) } });
    const mesh = shaderMesh(geometry, shader, order, { additive: true });
    mesh.visible = n > 0;
    return mesh;
  }
}
