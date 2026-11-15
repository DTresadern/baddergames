// @ts-check
// Two glowing billboards (abstract animated pattern, no text): a frame and legs (lit), an
// unlit screen whose pattern is a fragment shader bit, and an additive halo.
// Only the GLSL (`gl`) half of the bit is written: this build runs on WebGL2 only.

import { FlatMaterial, Mesh3D, PlaneGeometry } from '@pixi/3d';
import { Color } from 'pixi.js';
import { MeshBuilder } from '../effects/builder.js';
import { createGlows, litVertexMaterial } from '../effects/materials.js';
import { S, X, Y, Z } from '../stage.js';

/** @type {import('@pixi/3d').ShaderBit} */
const screenBit = {
  name: 'fwBillboardScreen',
  bindings: { material: { time: 'f32', seed: 'f32', colorA: 'vec4<f32>', colorB: 'vec4<f32>' } },
  gl: {
    header: /* glsl */ `
      float bbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float bbNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(bbHash(i), bbHash(i + vec2(1.0, 0.0)), u.x), mix(bbHash(i + vec2(0.0, 1.0)), bbHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float bbFbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { v += a * bbNoise(p); p *= 2.0; a *= 0.5; } return v; }
    `,
    fragment: {
      material: /* glsl */ `{
        vec2 uv = vUV;
        float t = material.time;
        float s = material.seed;
        float g = uv.y + 0.15 * sin(t * 0.4 + s + uv.x * 3.0);
        vec3 c = mix(decodeColor(material.colorB.rgb), decodeColor(material.colorA.rgb), clamp(g, 0.0, 1.0));
        float blobs = bbFbm(uv * vec2(3.0, 2.0) + vec2(t * 0.12, s));
        c *= 0.55 + 0.9 * smoothstep(0.35, 0.75, blobs);
        float sweep = smoothstep(0.08, 0.0, abs(fract(uv.x * 0.6 - uv.y * 0.3 - t * 0.15 + s) - 0.5));
        c += sweep * 0.25;
        c *= 0.82 + 0.18 * step(0.5, fract(uv.y * 30.0));
        c *= 0.85 + 0.15 * step(0.08, fract(sin(floor(t * 8.0) + s) * 43758.5));
        albedo = c;
      }`,
    },
  },
};

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createBillboards(scene, ctx) {
  /** @type {import('../stage.js').Node[]} */
  const nodes = [];
  const frame = new MeshBuilder();
  const glows = createGlows(scene.billboards.length * 2);
  for (const bb of scene.billboards) {
    const d = bb.depth, z = Z(d);
    const back = z - S(6, d);
    frame.box(X(bb.x + bb.w * 0.2, d), Y(bb.y + bb.h + 80, d), back - S(4, d), X(bb.x + bb.w * 0.2 + 4, d), Y(bb.y + bb.h, d), back, bb.frame);
    frame.box(X(bb.x + bb.w * 0.75, d), Y(bb.y + bb.h + 80, d), back - S(4, d), X(bb.x + bb.w * 0.75 + 4, d), Y(bb.y + bb.h, d), back, bb.frame);
    frame.box(X(bb.x - 4, d), Y(bb.y + bb.h + 4, d), back, X(bb.x + bb.w + 4, d), Y(bb.y - 4, d), z - S(0.5, d), bb.frame);

    const material = new FlatMaterial({ baseColor: 0xffffff, extraBits: [screenBit] });
    material.data.seed = bb.seed * 3.7;
    material.data.colorA = new Color(bb.colorA).toArray();
    material.data.colorB = new Color(bb.colorB).toArray();
    ctx.timed.push(material);
    nodes.push(new Mesh3D({
      geometry: new PlaneGeometry({ width: S(bb.w, d), height: S(bb.h, d) }),
      material,
      position: { x: X(bb.x + bb.w / 2, d), y: Y(bb.y + bb.h / 2, d), z: z + S(0.2, d) },
      castShadow: false,
      receiveShadow: false,
    }));
    const cx = X(bb.x + bb.w / 2, d), cy = Y(bb.y + bb.h / 2, d);
    glows.add(cx, cy, z + S(4, d), S(bb.w * 1.6, d), bb.colorA, 0.32);
    glows.add(cx, cy - S(bb.h * 0.4, d), z + S(4, d), S(bb.w * 1.1, d), bb.colorB, 0.22);
  }
  glows.upload();
  nodes.push(new Mesh3D({ geometry: frame.build() ?? undefined, material: litVertexMaterial({ roughness: 0.6, metallic: 0.5 }), castShadow: false }));
  nodes.push(glows.node);
  return { nodes };
}
