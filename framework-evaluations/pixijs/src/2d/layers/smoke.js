// @ts-check
// Smoke stacks: chimney rects plus soft particle quads (one instanced Mesh per stack).
// Particle positions come from smokeParticle() in shared/scene.js each frame and are
// written into a dynamic instance Buffer.

import { Buffer, BufferUsage, Container, Geometry } from 'pixi.js';
import { ShapeBatch, NOISE_GLSL, makeShader, shaderMesh, unitQuad, vec3 } from '../effects/batch.js';
import { ORDER } from '../stage.js';
import { hazed, smokeParticle } from '@fw-eval/shared/scene.js';

const VERT = /* glsl */ `
  in vec3 aParticle;  // x, y (world, y down), size
  in vec2 aAlphaRot;  // alpha, rotation
  out vec2 vLocal;
  out float vAlpha;
  out float vSeed;
  void main() {
    // rotate in a y-up local frame, then flip to world y-down (same result as three.js)
    float c = cos(aAlphaRot.y), s = sin(aAlphaRot.y);
    vec2 p = mat2(c, -s, s, c) * aPosition;
    vLocal = aPosition;
    vAlpha = aAlphaRot.x;
    vSeed = aAlphaRot.y;
    gl_Position = toClip(aParticle.xy + vec2(p.x, -p.y) * aParticle.z);
  }
`;

const FRAG = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uSmokeColor;
  in vec2 vLocal;
  in float vAlpha;
  in float vSeed;
  void main() {
    float d = length(vLocal);
    float n = fbm(vLocal * 1.6 + vSeed);
    float a = smoothstep(1.0, 0.1, d + (n - 0.5) * 0.7) * vAlpha;
    if (a < 0.003) discard;
    finalColor = vec4(uSmokeColor * (0.8 + 0.4 * n) * a, a);
  }
`;

/** @param {Float32Array} data */
const dynamicBuffer = (data) => new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createSmoke(scene) {
  const P = scene.palette;
  /** @type {import('../stage.js').Part[]} */
  const parts = [];
  /** @type {{ stack: typeof scene.smokeStacks[number], count: number, a: Buffer, b: Buffer }[]} */
  const emitters = [];
  for (const stack of scene.smokeStacks) {
    const d = stack.depth;
    const order = d >= 3 ? ORDER.smokeFar : ORDER.smokeNear;
    const group = new Container();

    const chimney = new ShapeBatch();
    chimney.rect(stack.x - stack.w / 2, stack.y, stack.w, stack.h, [hazed(scene, P.gunmetal, d), hazed(scene, P.gunmetal, d + 2)]);
    chimney.rect(stack.x - stack.w / 2 - 1.5, stack.y, stack.w + 3, 3, hazed(scene, P.gunmetalLight, d));
    chimney.rect(stack.x - 1, stack.y + 6, 2, 2, hazed(scene, P.warningRed, d * 0.4));
    group.addChild(chimney.build(order));

    const count = Math.ceil(stack.rate * stack.life);
    const a = dynamicBuffer(new Float32Array(count * 3));
    const b = dynamicBuffer(new Float32Array(count * 2));
    const geometry = new Geometry({
      attributes: {
        ...unitQuad(true),
        aParticle: { buffer: a, format: 'float32x3', instance: true },
        aAlphaRot: { buffer: b, format: 'float32x2', instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
      instanceCount: count,
    });
    const shader = makeShader(VERT, FRAG, { smoke: { uSmokeColor: vec3(hazed(scene, P.smoke, d * 0.7)) } });
    group.addChild(shaderMesh(geometry, shader, order + 0.5));
    parts.push({ object: group, depth: d });
    emitters.push({ stack, count, a, b });
  }
  return {
    parts,
    update(t) {
      for (const e of emitters) {
        const pa = /** @type {Float32Array} */ (e.a.data), pb = /** @type {Float32Array} */ (e.b.data);
        for (let i = 0; i < e.count; i++) {
          const p = smokeParticle(e.stack, i, t);
          pa[i * 3] = p.x; pa[i * 3 + 1] = p.y; pa[i * 3 + 2] = p.size;
          pb[i * 2] = p.alpha; pb[i * 2 + 1] = p.rotation;
        }
        e.a.update();
        e.b.update();
      }
    },
  };
}
