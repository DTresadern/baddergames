// @ts-check
// Rain: GPU-animated streaks, one mesh and one draw for every drop at every depth.
// Per-drop data (rainAttributes() in shared/scene.js) is uploaded once; a vertex shader bit
// moves each drop from material.data.time with the same formula as rainDropAt() and places
// it at its depth in 3D, so the depth buffer hides far rain behind buildings and the bridge.
//
// Geometry3D takes only fixed attribute names (aPosition, aUV, aNormal, aColor, ...; see
// Geometry3DOptions.attributes), so the drop data is packed into them:
//   position = (x0, y0, depth + 20 * corner)    corner 0..3 of the streak quad
//   uv       = (speed, length)
// Drops inside the drone's searchlight cone are lit (material.data.cone).
// Only the GLSL (`gl`) half of the bit is written: this build runs on WebGL2 only.

import { Box, FlatMaterial, Geometry3D, Mesh3D, Vector3 } from '@pixi/3d';
import { Color } from 'pixi.js';
import { rainAttributes } from '@fw-eval/shared/scene.js';
import { D } from '../stage.js';

/** @type {import('@pixi/3d').ShaderBit} */
const rainBit = {
  name: 'fwRain',
  interStage: { vAlong: 'f32', vRainAlpha: 'f32', vLit: 'f32' },
  bindings: {
    material: { time: 'f32', tanAngle: 'f32', wrap: 'f32', camD: 'f32', cone: 'vec4<f32>', rainColor: 'vec4<f32>', litColor: 'vec4<f32>' },
  },
  gl: {
    vertex: {
      beforeTransform: /* glsl */ `{
        float corner = floor(position.z / 20.0);
        float depth = position.z - corner * 20.0;
        float side = (corner == 1.0 || corner == 2.0) ? 0.5 : -0.5;
        float along = corner >= 2.0 ? 1.0 : 0.0;
        float travel = mod(position.y + uv.x * material.time, material.wrap) - 20.0;
        vec2 head = vec2(position.x + material.tanAngle * travel, travel);
        vec2 dir = normalize(vec2(material.tanAngle, 1.0));
        vec2 perp = vec2(dir.y, -dir.x);
        float fd = clamp(depth / 10.0, 0.0, 1.0);
        float width = mix(1.1, 0.7, fd);
        vec2 p = head - dir * uv.y * along + perp * width * side;
        float k = 1.0 + depth;
        position = vec4((p.x - 600.0) * k, (200.0 - p.y) * k, -depth * material.camD, 1.0);
        vAlong = along;
        vRainAlpha = mix(0.55, 0.22, fd);
        vec2 rel = head - material.cone.xy;
        float ang = atan(rel.y, rel.x) - material.cone.z;
        ang = abs(mod(ang + 3.14159265, 6.2831853) - 3.14159265);
        vLit = (1.0 - smoothstep(material.cone.w * 0.6, material.cone.w, ang)) * (1.0 - smoothstep(60.0, 320.0, length(rel)));
      }`,
    },
    fragment: {
      material: /* glsl */ `{
        albedo = mix(decodeColor(material.rainColor.rgb), decodeColor(material.litColor.rgb), vLit);
        alpha = vRainAlpha * (1.0 - vAlong) * (1.0 + vLit * 2.0);
      }`,
    },
  },
};

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createRain(scene, ctx) {
  const a = rainAttributes(scene);
  const n = a.x0.length;
  const positions = new Float32Array(n * 4 * 3);
  const uvs = new Float32Array(n * 4 * 2);
  const indices = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      positions[v * 3] = a.x0[i];
      positions[v * 3 + 1] = a.y0[i];
      positions[v * 3 + 2] = a.depth[i] + 20 * c;
      uvs[v * 2] = a.speed[i];
      uvs[v * 2 + 1] = a.length[i];
    }
    const v = i * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }
  // the shader moves every vertex, so the bounds the view culls with are set by hand
  const big = 1e5;
  const geometry = n
    ? new Geometry3D({ positions, uvs, indices, bounds3D: new Box(new Vector3(-big, -big, -big), new Vector3(big, big, big)) })
    : undefined;
  const material = new FlatMaterial({ baseColor: 0xffffff, alphaMode: 'blend', doubleSided: true, extraBits: [rainBit] });
  material.data.tanAngle = Math.tan(scene.rain.angle);
  material.data.wrap = scene.world.height + 40;
  material.data.camD = D;
  material.data.rainColor = new Color(scene.rain.color).toArray();
  material.data.litColor = new Color(scene.palette.amberPale).toArray();
  material.data.cone = [0, 0, 0, 0];
  ctx.timed.push(material);
  const mesh = new Mesh3D({ geometry, material });
  mesh.label = 'rain';
  mesh.visible = n > 0;
  return {
    parts: [mesh],
    info: { rainDrops: n },
    update() {
      const c = ctx.cone;
      material.data.cone = [c.x, c.y, c.angle, c.half];
    },
  };
}
