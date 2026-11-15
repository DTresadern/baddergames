// @ts-check
// Rain: GPU-animated streaks. Per-drop data is uploaded once (rainAttributes() in
// shared/scene.js) as instanced attributes of a Mesh; the vertex shader moves every drop
// from the time uniform with the same formula as rainDropAt(). Drops are split into
// three depth bands so far rain is drawn behind the near city and the bridge, near rain
// in front of everything. Drops inside the drone's searchlight cone are lit.
//
// Why a Mesh and not a ParticleContainer: a ParticleContainer moves particles on the CPU
// (dynamic `position` is rewritten and re-uploaded every frame). With 256 000 drops that
// is a large per-frame JS loop and upload; here the CPU does nothing per frame except
// set one uniform, the same work as the three.js build.

import { Geometry } from 'pixi.js';
import { makeShader, shaderMesh, unitQuad, vec3, f32 } from '../effects/batch.js';
import { ORDER } from '../stage.js';
import { rainAttributes } from '@fw-eval/shared/scene.js';

const VERT = /* glsl */ `
  in vec4 aDrop;      // x0, y0, speed, depth
  in float aLength;
  uniform float uTime;
  uniform float uCameraX;
  uniform float uTanAngle;
  uniform float uWrap;       // world height + 40
  uniform vec4 uCone;        // apex x, apex y (y down), angle, half-angle
  out float vAlong;
  out float vAlpha;
  out float vLit;
  void main() {
    float depth = aDrop.w;
    float travel = mod(aDrop.y + aDrop.z * uTime, uWrap) - 20.0;
    vec2 head = vec2(aDrop.x + uTanAngle * travel - uCameraX / (1.0 + depth), travel);
    vec2 dir = normalize(vec2(uTanAngle, 1.0));
    vec2 perp = vec2(dir.y, -dir.x);
    float width = mix(1.1, 0.55, clamp(depth / 10.0, 0.0, 1.0));
    vec2 p = head - dir * aLength * aPosition.y + perp * width * aPosition.x;
    vAlong = aPosition.y;
    vAlpha = mix(0.5, 0.16, clamp(depth / 10.0, 0.0, 1.0));
    // inside the searchlight cone?
    vec2 rel = head - uCone.xy;
    float ang = atan(rel.y, rel.x) - uCone.z;
    ang = abs(mod(ang + 3.14159265, 6.2831853) - 3.14159265);
    float dist = length(rel);
    vLit = (1.0 - smoothstep(uCone.w * 0.6, uCone.w, ang)) * (1.0 - smoothstep(60.0, 300.0, dist)) * step(1.0, uCone.w * 10.0);
    gl_Position = toClip(p);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uRainColor;
  uniform vec3 uLitColor;
  in float vAlong;
  in float vAlpha;
  in float vLit;
  void main() {
    float a = min(1.0, vAlpha * (1.0 - vAlong) * (1.0 + vLit * 2.0));
    finalColor = vec4(mix(uRainColor, uLitColor, vLit) * a, a);
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
  // one shader (and one local uniform group) shared by the three bands
  const shader = makeShader(VERT, FRAG, {
    frame: ctx.frame,
    rain: {
      uTanAngle: f32(Math.tan(scene.rain.angle)),
      uWrap: f32(scene.world.height + 40),
      uRainColor: vec3(scene.rain.color),
      uLitColor: vec3(scene.palette.amberPale),
    },
  });
  for (const band of bands) {
    /** @type {number[]} */
    const idx = [];
    for (let i = 0; i < attrs.depth.length; i++) if (attrs.depth[i] >= band.min && attrs.depth[i] < band.max) idx.push(i);
    const n = Math.max(1, idx.length); // empty buffers are not allowed; the mesh is hidden instead
    const drop = new Float32Array(n * 4), len = new Float32Array(n);
    idx.forEach((i, k) => {
      drop[k * 4] = attrs.x0[i]; drop[k * 4 + 1] = attrs.y0[i]; drop[k * 4 + 2] = attrs.speed[i]; drop[k * 4 + 3] = attrs.depth[i];
      len[k] = attrs.length[i];
    });
    const geometry = new Geometry({
      attributes: {
        ...unitQuad(false),
        aDrop: { buffer: drop, format: 'float32x4', instance: true },
        aLength: { buffer: len, format: 'float32', instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
      instanceCount: idx.length,
    });
    const mesh = shaderMesh(geometry, shader, band.order);
    mesh.visible = idx.length > 0;
    // parallax is done per drop in the shader, so the part itself never moves
    parts.push({ object: mesh, depth: Infinity });
  }
  return { parts };
}
