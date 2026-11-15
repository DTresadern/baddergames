// @ts-check
// Sky gradient (furthest back) and the rain mist overlay (in front of everything).

import { ShapeBatch, shaderRect, flatShader, RECT_VERT, NOISE_GLSL, col } from '../effects/batch.js';
import { ORDER } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createSky(scene) {
  const b = new ShapeBatch();
  const stops = scene.sky.stops;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], c = stops[i + 1];
    b.rect(-60, a.y, scene.world.width + 120, c.y - a.y, [a.color, c.color]);
  }
  // depth Infinity-like: the sky does not move with the camera
  return { parts: [{ object: b.build(ORDER.sky), depth: 1000 }] };
}

/**
 * Rain mist: a soft, slowly moving veil of lighter haze, strongest in the middle band
 * of the frame (where the reference shows the rain sheets lit by the city).
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createMist(scene, ctx) {
  const material = flatShader({
    vertexShader: RECT_VERT,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec2 vWorld;
      void main() {
        // diagonal rain sheets drifting down
        vec2 p = vec2(vWorld.x * 0.012 + vWorld.y * 0.002, vWorld.y * 0.004 - uTime * 0.35);
        float sheets = fbm(p * vec2(1.0, 3.0));
        float band = smoothstep(0.0, 0.45, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        float a = uOpacity * (0.35 + 0.9 * sheets) * (0.4 + 0.6 * band);
        gl_FragColor = vec4(uColor, a);
      }
    `,
    uniforms: {
      uTime: ctx.time,
      uColor: { value: col(scene.haze.far) },
      uOpacity: { value: scene.haze.mistOpacity },
    },
  });
  const mesh = shaderRect(0, 0, scene.world.width, scene.world.height, material, ORDER.mist);
  // vignette: darker top edge and a heavier dark floor, as in the reference
  const vig = new ShapeBatch();
  vig.rect(0, 0, scene.world.width, 50, 0x000000, 0.35, 0);
  vig.rect(0, 310, scene.world.width, 90, 0x000000, 0, 0.45);
  vig.rect(0, 0, 60, scene.world.height, 0x000000, 0.15, 0.15);
  return { parts: [{ object: mesh, depth: 1000 }, { object: vig.build(ORDER.mist + 1), depth: 1000 }] };
}
