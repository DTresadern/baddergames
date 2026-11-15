// @ts-check
// Water dripping from the deck and platform edges: faint constant trickles plus
// falling drops animated in the vertex shader (same maths as dripState()).

import { Container, Geometry } from 'pixi.js';
import { ShapeBatch, makeShader, shaderMesh, unitQuad, vec3, f32 } from '../effects/batch.js';
import { ORDER } from '../stage.js';

const VERT = /* glsl */ `
  in vec4 aDrip;  // x, y0, y1, period
  in float aPhase;
  uniform float uTime;
  uniform float uGravity;
  out float vAlpha;
  out float vAlong;
  void main() {
    float local = mod(uTime + aPhase, aDrip.w);
    float y = aDrip.y + 0.5 * uGravity * local * local;
    float speed = uGravity * local;
    float len = 2.0 + speed * 0.012;              // motion streak grows with speed
    vAlpha = y <= aDrip.z ? 0.85 : 0.0;
    vAlong = aPosition.y;
    gl_Position = toClip(vec2(aDrip.x + aPosition.x * 1.4, y - aPosition.y * len));
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uWaterColor;
  in float vAlpha;
  in float vAlong;
  void main() {
    float a = vAlpha * (1.0 - 0.7 * vAlong);
    finalColor = vec4(uWaterColor * a, a);
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

  const a = new Float32Array(list.length * 4), ph = new Float32Array(list.length);
  list.forEach((d, i) => { a.set([d.x, d.y0, d.y1, d.period], i * 4); ph[i] = d.phase; });
  const geometry = new Geometry({
    attributes: {
      ...unitQuad(false),
      aDrip: { buffer: a, format: 'float32x4', instance: true },
      aPhase: { buffer: ph, format: 'float32', instance: true },
    },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
    instanceCount: list.length,
  });
  const shader = makeShader(VERT, FRAG, {
    frame: ctx.frame,
    drips: { uGravity: f32(scene.drips.gravity), uWaterColor: vec3(scene.drips.color) },
  });
  const drops = shaderMesh(geometry, shader, ORDER.drips);

  const group = new Container();
  group.addChild(trickle.build(ORDER.drips - 0.5), drops);
  return { parts: [{ object: group, depth: 0 }] };
}
