// @ts-check
// Shaders for the foreground walking surfaces:
//   wetSurface   - rain-slick metal plates with sheen, puddles and ripple sparkles
//   hazardStripe - yellow/black slanted stripes with grime and a wet top edge
// Both are applied to shaderRect() quads (see batch.js), which supply vUv and vWorld.

import { makeShader, RECT_VERT, NOISE_GLSL, vec3, f32 } from './batch.js';

/**
 * @param {{ base: number, sheen: number, ctx: import('../stage.js').Ctx }} o
 */
export function wetSurface({ base, sheen, ctx }) {
  return makeShader(RECT_VERT, /* glsl */ `
    ${NOISE_GLSL}
    uniform float uTime;
    uniform vec3 uBase;
    uniform vec3 uSheen;
    in vec2 vUv;
    in vec2 vWorld;
    void main() {
      vec3 c = uBase;
      // plate seams
      float seam = step(fract(vWorld.x / 48.0), 0.025);
      c *= 1.0 - seam * 0.45;
      // puddles: large wet patches reflect the sky
      float puddle = smoothstep(0.45, 0.7, fbm(vec2(vWorld.x * 0.018, vWorld.y * 0.3)));
      c = mix(c, uSheen, puddle * 0.55);
      // long horizontal reflection streaks
      float streak = smoothstep(0.6, 0.95, vnoise(vec2(vWorld.x * 0.04, vWorld.y * 1.3)));
      c += uSheen * streak * 0.35;
      // ripple sparkles where rain hits (cells flash on and fade)
      vec2 cell = floor(vec2(vWorld.x / 5.0, vWorld.y / 3.0));
      float h = hash12(cell);
      float phase = fract(uTime * (0.8 + h) + h * 7.0);
      c += uSheen * step(0.93, h) * (1.0 - phase) * 0.8;
      // bright lip along the top edge (the edge catching the city light)
      c += uSheen * smoothstep(0.25, 0.0, vUv.y) * 0.45;
      finalColor = vec4(c, 1.0);
    }
  `, { frame: ctx.frame, surface: { uBase: vec3(base), uSheen: vec3(sheen) } });
}

/**
 * @param {{ yellow: number, black: number, spacing: number, slant: number, height: number }} o
 *   slant: how far (world units) a stripe leans right over the band height
 */
export function hazardStripe({ yellow, black, spacing, slant, height }) {
  return makeShader(RECT_VERT, /* glsl */ `
    ${NOISE_GLSL}
    uniform vec3 uYellow;
    uniform vec3 uBlack;
    uniform float uSpacing;
    uniform float uSlant;
    uniform float uHeight;
    in vec2 vUv;
    in vec2 vWorld;
    void main() {
      float s = fract((vWorld.x + (1.0 - vUv.y) * uSlant) / uSpacing);
      vec3 c = s < 0.5 ? uYellow : uBlack;
      // grime and wear
      float grime = fbm(vWorld * vec2(0.09, 0.35));
      c *= 0.55 + 0.6 * grime;
      // wet highlight at the top, shadowed bottom edge
      c += vec3(0.25, 0.22, 0.18) * smoothstep(0.2, 0.0, vUv.y);
      c *= 1.0 - 0.5 * smoothstep(0.75, 1.0, vUv.y);
      finalColor = vec4(c, 1.0);
    }
  `, {
    stripe: {
      uYellow: vec3(yellow), uBlack: vec3(black),
      uSpacing: f32(spacing), uSlant: f32(slant), uHeight: f32(height),
    },
  });
}
