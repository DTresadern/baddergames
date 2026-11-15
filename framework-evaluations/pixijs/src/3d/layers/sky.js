// @ts-check
// Sky: a vertex-coloured backdrop plane behind the far city (depth 11), unlit and outside
// the fog so its gradient shows exactly the scene.sky stops. The view's own `background`
// (colour or hemisphere) cannot place gradient stops at given heights, so a mesh is used.
// Mist: a soft rain veil and vignette over the whole frame, drawn after the 3D scene.

import { FlatMaterial, Mesh3D } from '@pixi/3d';
import { Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import { MeshBuilder, linear } from '../effects/batch.js';
import { NOISE_GLSL } from '../effects/materials.js';
import { X, Y, Z } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createSky(scene) {
  const depth = 11;
  const b = new MeshBuilder();
  const stops = scene.sky.stops;
  // margin past the frame for the camera drift
  const x0 = X(-120, depth), x1 = X(1320, depth), z = Z(depth);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], c = stops[i + 1];
    const ya = Y(a.y - (i === 0 ? 40 : 0), depth);
    const yc = Y(c.y + (i === stops.length - 2 ? 40 : 0), depth);
    const base = b.vertexCount;
    b.quad([x0, yc, z], [x1, yc, z], [x1, ya, z], [x0, ya, z], c.color, [0, 0, 1]);
    // the top edge takes the upper stop's colour
    const top = linear(a.color);
    for (const v of [base + 2, base + 3]) b.col.splice(v * 4, 3, ...top);
  }
  const mesh = new Mesh3D({
    geometry: b.build() ?? undefined,
    material: new FlatMaterial({ baseColor: 0xffffff, vertexColors: true, fog: false }),
  });
  mesh.label = 'sky';
  return { parts: [mesh] };
}

/** sRGB -> linear with the exact sRGB curve three.js uses (@pixi/3d's srgbToLinear is a 2.2 power). @param {number} c */
const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

/**
 * The same shader maths as the three.js 3D mist (threejs/src/3d/layers/sky.js), as a 2D Mesh
 * on the stage above the View3D: one full-screen quad and one draw, like three.js's quad on
 * the camera. A post effect in `view.passes` would instead render the scene to a texture
 * first, which is more GPU work than the three.js build does.
 * The colour maths match three.js 3D too: its uniform colour is converted to linear and the
 * premultiplied result is sRGB-encoded at output, so this shader does the same. Blending is
 * PixiJS 'normal' (ONE, ONE_MINUS_SRC_ALPHA), the factors three.js's mist uses.
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Overlay}
 */
export function createMist(scene) {
  const c = scene.haze.far;
  const mist = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uMistColor: { value: new Float32Array([(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => toLinear(v / 255))), type: 'vec3<f32>' },
    uOpacity: { value: scene.haze.mistOpacity, type: 'f32' },
  });
  const shader = Shader.from({
    gl: {
      vertex: /* glsl */ `#version 300 es
        in vec2 aPosition;
        out vec2 vUv;
        void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
      `,
      fragment: /* glsl */ `#version 300 es
        ${NOISE_GLSL}
        uniform float uTime;
        uniform vec3 uMistColor;
        uniform float uOpacity;
        in vec2 vUv;
        out vec4 finalColor;
        vec3 srgbEncode(vec3 v) {
          return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308))));
        }
        void main() {
          vec2 w = vec2(vUv.x * 1200.0, (1.0 - vUv.y) * 400.0); // world-like coords, y down
          vec2 p = vec2(w.x * 0.012 + w.y * 0.002, w.y * 0.004 - uTime * 0.35);
          float sheets = fbm(p * vec2(1.0, 3.0));
          float yd = 1.0 - vUv.y;
          float band = smoothstep(0.0, 0.45, yd) * (1.0 - smoothstep(0.75, 1.0, yd));
          float a = uOpacity * (0.35 + 0.9 * sheets) * (0.4 + 0.6 * band);
          // vignette: darker top edge and floor
          float dark = 0.35 * smoothstep(0.125, 0.0, yd) + 0.45 * smoothstep(0.775, 1.0, yd);
          finalColor = vec4(srgbEncode(uMistColor * a), a + dark);
        }
      `,
      // world-like coordinates up to 1200 feed the hash: too coarse in mediump
      preferredFragmentPrecision: 'highp',
    },
    resources: { mist },
  });
  // clip-space quad: the vertex shader ignores the stage transform
  const geometry = new Geometry({
    attributes: { aPosition: { buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), format: 'float32x2' } },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
  const mesh = new Mesh({ geometry, shader, label: 'mist' });
  return {
    parts: [mesh],
    update(t) { mist.uniforms.uTime = t; },
  };
}
