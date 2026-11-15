// @ts-check
// Materials, procedural textures and the haze fog of the 3D build.
//   installHazeFog   - replaces three.js fog maths with the scene's haze curve
//   createEnvironment- a small procedural environment (sky + city glow) baked by PMREM,
//                      used as the wet surfaces' reflection
//   wetMaterial      - rain-slick metal plates: low roughness, puddle roughness map, env
//   stripeMaterial   - hazard stripes (procedural DataTexture)
//   slab             - a box with world-scaled UVs and one material per face
// Textures here are generated in code (DataTexture); no image files.

import * as THREE from 'three';
import { D } from '../stage.js';
import { makeRng } from '@fw-eval/shared/rng.js';

/**
 * three.js Fog is linear or exp2. The scene's haze is
 *   opacity(depth) = maxOpacity * (1 - exp(-falloff * depth)),  colour near -> far over depth 0..10
 * so the fog_fragment chunk is replaced (this page only) with that curve. vFogDepth is the
 * view-space distance along the camera axis = D * (1 + depth); fogNear = D, fogFar = D.
 * @param {THREE.Scene} scene3
 * @param {import('@fw-eval/shared/scene.js').Scene} world
 */
export function installHazeFog(scene3, world) {
  const far = new THREE.Color(world.haze.far);
  /** @param {number} v */
  const f = (v) => v.toFixed(5);
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float hazeDepth = max(0.0, vFogDepth - fogNear) / fogFar;
  float fogFactor = ${f(world.haze.maxOpacity)} * (1.0 - exp(-${f(world.haze.falloff)} * hazeDepth));
  vec3 hazeColor = mix(fogColor, vec3(${f(far.r)}, ${f(far.g)}, ${f(far.b)}), clamp(hazeDepth / 10.0, 0.0, 1.0));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, fogFactor);
#endif
`;
  scene3.fog = new THREE.Fog(world.haze.near, D, D);
}

/**
 * Procedural environment for reflections: a gradient sky dome with amber and billboard
 * glows near the horizon, baked once with PMREMGenerator.
 * @param {THREE.WebGLRenderer} renderer
 * @param {import('@fw-eval/shared/scene.js').Scene} world
 */
export function createEnvironment(renderer, world) {
  const P = world.palette;
  const env = new THREE.Scene();
  const sky = new THREE.SphereGeometry(100, 32, 16);
  const pos = sky.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(P.skyTop), mid = new THREE.Color(P.skyHorizon), bottom = new THREE.Color(0x0a0c10);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 100;
    if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.6));
    else c.copy(mid).lerp(bottom, Math.min(1, -y * 3));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  sky.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  env.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // horizon glows: city windows, lamps, billboards
  const rng = makeRng(99);
  const glow = (/** @type {number} */ hex, /** @type {number} */ k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  for (let i = 0; i < 24; i++) {
    const a = rng.range(0, Math.PI * 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(rng.range(4, 12), rng.range(2, 6)), glow(P.amber, rng.range(1, 3)));
    m.position.set(Math.cos(a) * 80, rng.range(2, 20), Math.sin(a) * 80);
    m.lookAt(0, m.position.y, 0);
    env.add(m);
  }
  for (const [hex, a] of [[0xffb04a, 1.9], [0x39a8ff, 2.6]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), glow(hex, 2.5));
    m.position.set(Math.cos(a) * 80, 22, Math.sin(a) * 80);
    m.lookAt(0, 22, 0);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  return rt.texture;
}

/**
 * DataTexture from a per-pixel function returning [r, g, b] in 0..255.
 * @param {number} w @param {number} h @param {(x: number, y: number) => number[]} fn
 * @param {boolean} srgb colour data (true) or linear data such as roughness (false)
 */
function dataTexture(w, h, fn, srgb) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise (period p cells) in 0..1. */
function tileNoise(/** @type {number} */ seed, /** @type {number} */ p) {
  const rng = makeRng(seed);
  const grid = Array.from({ length: p * p }, () => rng.next());
  /** @param {number} u @param {number} v  0..1 */
  return (u, v) => {
    const x = u * p, y = v * p;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (/** @type {number} */ i, /** @type {number} */ j) => grid[(((j % p) + p) % p) * p + (((i % p) + p) % p)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** UV scale of wet surfaces: one texture tile per this many world units. */
export const WET_TILE = 96;

/**
 * Wet metal walkway: plate seams in the colour map; puddles as low-roughness patches
 * (roughness map) so the environment and the lamps reflect in them.
 * @param {number} base 0xRRGGBB @param {THREE.Texture | null} env
 */
export function wetMaterial(base, env) {
  const n1 = tileNoise(11, 6), n2 = tileNoise(12, 16);
  const S = 128;
  // the map is a grey multiplier; the hue comes from material.color
  const map = dataTexture(S, S, (x, y) => {
    const seam = x % 64 < 2 || y % 64 < 2 ? 0.55 : 1; // plate seams every half tile (48 units)
    const grime = 0.8 + 0.35 * n2(x / S, y / S);
    const v = Math.round(255 * Math.min(1, seam * grime));
    return [v, v, v];
  }, true);
  const rough = dataTexture(S, S, (x, y) => {
    const puddle = n1(x / S, y / S) * 0.7 + n2(x / S, y / S) * 0.3;
    const r = puddle > 0.5 ? 0.08 : 0.08 + (0.5 - puddle) * 1.2; // puddles near mirror, the rest satin
    const v = Math.round(255 * Math.min(1, r));
    return [v, v, v];
  }, false);
  return new THREE.MeshStandardMaterial({
    color: base, map, roughnessMap: rough, roughness: 1, metalness: 0.7,
    envMap: env, envMapIntensity: 0.9,
  });
}

/**
 * Hazard stripes: one yellow + one black slanted stripe per texture tile; UVs are scaled so
 * u = world x / spacing (see slab()).
 * @param {number} yellow @param {number} black
 */
export function stripeMaterial(yellow, black) {
  const n = tileNoise(21, 8);
  const W = 64, H = 16;
  const y = new THREE.Color(yellow), k = new THREE.Color(black);
  const ys = [y.r, y.g, y.b].map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)));
  const ks = [k.r, k.g, k.b].map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)));
  const map = dataTexture(W, H, (x, yy) => {
    const u = x / W + (yy / H) * 0.35; // slant
    const c = (u % 1) < 0.5 ? ys : ks;
    const g = 0.6 + 0.5 * n(x / W, yy / H);
    return c.map((v) => Math.min(255, Math.round(v * g)));
  }, true);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.2 });
}

/**
 * A box with world-scaled UVs (top face: u = x / WET_TILE, v = z / WET_TILE;
 * front face: u = x / uSpacing, v 0..1) and per-face materials
 * [right, left, top, bottom, front, back] like BoxGeometry's groups.
 * @param {number} w @param {number} h @param {number} zd
 * @param {THREE.Material[]} materials
 * @param {number} uSpacing world units per front-face texture tile
 */
export function slab(w, h, zd, materials, uSpacing) {
  const geo = new THREE.BoxGeometry(w, h, zd);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4); // 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
    if (face === 2 || face === 3) uv.setXY(i, uv.getX(i) * w / WET_TILE, uv.getY(i) * zd / WET_TILE);
    else if (face === 4 || face === 5) uv.setXY(i, uv.getX(i) * w / uSpacing, uv.getY(i));
    else uv.setXY(i, uv.getX(i) * zd / uSpacing, uv.getY(i));
  }
  return new THREE.Mesh(geo, materials);
}

/**
 * Patch a ShaderMaterial source so it uses three.js fog and output conversion.
 * Adds the fog chunks (vertex: needs mvPosition) and tonemapping/colorspace at the end.
 * @param {string} body fragment main() body that sets gl_FragColor
 */
export function fragmentTail(body) {
  return `${body}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;
}

/** Hash, value noise and fbm for procedural shaders (same functions as the 2D build). */
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
