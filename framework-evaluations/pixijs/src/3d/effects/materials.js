// @ts-check
// Materials shared by the layers (lit and unlit, coloured by MeshBuilder vertex colours)
// and GLSL noise for the mist shader.

import { FlatMaterial, Material3D } from '@pixi/3d';

/**
 * Lit PBR material that takes its colour from the vertex colours of a MeshBuilder mesh.
 * @param {{ roughness?: number, metallic?: number }} [opt]
 */
export function litVertexMaterial(opt = {}) {
  return new Material3D({ baseColor: 0xffffff, vertexColors: true, roughness: opt.roughness ?? 0.8, metallic: opt.metallic ?? 0.2 });
}

/** Unlit material for lit windows, screens and lamp bulbs: shows the vertex colours as authored (then fog). */
export function glowVertexMaterial() {
  return new FlatMaterial({ baseColor: 0xffffff, vertexColors: true });
}

/** Hash, value noise and fbm (the same functions as the three.js builds' NOISE_GLSL). */
export const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;
