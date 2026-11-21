// Block atlas drawing for the Sandbox: the level's instanced tiles and cubes show one atlas tile per
// face (chosen by scenes/block-decor.js) instead of the checkerboard, in the same draw calls.
// - per instance: `atlasTile` [side, top, front] atlas tile indices (an InstancedBufferAttribute on
//   a per-group geometry that shares the base geometry's buffers)
// - per vertex: `atlasFace`, which of the three a face shows (0 side, 1 top, 2 front)
// - the material is a MeshBasicMaterial whose vertex shader replaces the map UV with the tile's
//   square in the atlas, inset by half a texel so nearest sampling never reads the next tile.
// Nearest filtering and no mipmaps, like the checkerboard (mipmaps would also blend tiles).
// A lit map (map field `lighting`, the test level) adds per-pixel lighting and fog to the same
// material (`lit`, see createAtlasMaterial); `addFog` gives any MeshBasicMaterial the fog only.
// Without `lit` the material is unchanged.

import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, MeshBasicMaterial, NearestFilter, PlaneGeometry } from 'three';
import { MAX_LIGHTS } from './level-lights.js';
import { shadedCubeGeometry } from './sandbox-3d.js';

// Which of [side, top, front] each face shows. BoxGeometry face order: +x, -x, +y, -y, +z, -z.
// The camera never sees the bottom and back: they reuse the side and front tiles.
export const ATLAS_FACE = Object.freeze({ side: 0, top: 1, front: 2 });
const CUBE_FACES = Object.freeze([ATLAS_FACE.side, ATLAS_FACE.side, ATLAS_FACE.top, ATLAS_FACE.side, ATLAS_FACE.front, ATLAS_FACE.front]);

// The atlas texture (a cache-owned texture: set up here, never tracked by the scene).
export function configureAtlasTexture(texture) {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// The shaded cube (2.5D) plus `atlasFace` per vertex (4 vertices per face).
export function atlasCubeGeometry() {
  const geometry = shadedCubeGeometry();
  geometry.setAttribute('atlasFace', new Float32BufferAttribute(CUBE_FACES.flatMap((face) => [face, face, face, face]), 1));
  return geometry;
}

// The 2D tile plane plus `atlasFace`: every vertex shows the front tile.
export function atlasPlaneGeometry() {
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute('atlasFace', new Float32BufferAttribute(Array(geometry.attributes.position.count).fill(ATLAS_FACE.front), 1));
  return geometry;
}

// One level group's geometry: the base geometry's index and attributes (shared, not copied) plus its
// own `atlasTile` attribute (3 floats per instance, [side, top, front]). An attribute set on the
// shared base geometry would be shared by every mesh, so each group gets its own geometry.
export function atlasGroupGeometry(base, tiles) {
  const geometry = new BufferGeometry();
  geometry.setIndex(base.index);
  for (const [name, attribute] of Object.entries(base.attributes)) geometry.setAttribute(name, attribute);
  geometry.setAttribute('atlasTile', new InstancedBufferAttribute(tiles, 3));
  return geometry;
}

// GLSL float literal.
const glslFloat = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// Vertex shader lines that replace vMapUv with the atlas tile's square. Row 0 is the image's top
// row; the texture is flipped on upload (flipY), so v = 1 is the image top and the tile's v runs
// from (rows - 1 - row) / rows to (rows - row) / rows. The tile index is a whole float; floor
// on (t + 0.5) / columns keeps float error from moving it to the previous row.
function atlasUvChunk({ columns, rows, tileSize }) {
  const [c, r, inset] = [glslFloat(columns), glslFloat(rows), glslFloat(0.5 / tileSize)];
  return `
#ifdef USE_MAP
{
  float atlasT = atlasFace < 0.5 ? atlasTile.x : (atlasFace < 1.5 ? atlasTile.y : atlasTile.z);
  float atlasRow = floor((atlasT + 0.5) / ${c});
  float atlasCol = atlasT - atlasRow * ${c};
  vec2 atlasLocal = ${inset} + uv * (1.0 - 2.0 * ${inset});
  vMapUv = vec2((atlasCol + atlasLocal.x) / ${c}, (${r} - 1.0 - atlasRow + atlasLocal.y) / ${r});
}
#endif`;
}

// Fragment line for the palette LUT's Bayer dithering (scenes/palette-lut.js): the atlas texture
// pixel this fragment samples, vMapUv x the atlas size in pixels (columns x tileSize by rows x
// tileSize; the image's size, atlasLayout checks the grid). It is the same coordinate the nearest
// sampler reads, so the pattern sits on the texture's own pixels on every face and moves with the
// block. Tiles start at multiples of 64 px, so each tile's pattern starts at its own corner.
function ditherTexelPars({ columns, rows, tileSize }) {
  return `
#ifdef USE_MAP
#define PALETTE_DITHER_TEXEL (vMapUv * vec2(${glslFloat(columns * tileSize)}, ${glslFloat(rows * tileSize)}))
#endif`;
}

// A MeshBasicMaterial that maps `map` (the atlas texture) by the atlas tile of each face. `layout`
// is atlasLayout's { columns, rows, tileSize }; `color` the material colour (depth shading), if any.
// `lit` (optional, a lit map): { uniforms, emissive }, `uniforms` the one shared object of level
// uniforms (LIT_UNIFORMS; every lit material holds the same uniform objects, so one write per frame
// updates them all) and `emissive` the atlas tile indices that glow (the light tiles). See litChunks.
export function createAtlasMaterial({ map, layout, vertexColors = false, color, lit }) {
  const material = new MeshBasicMaterial({ map, vertexColors, ...(color === undefined ? {} : { color }) });
  const chunk = atlasUvChunk(layout);
  const texelPars = ditherTexelPars(layout);
  // A fixed key with the grid size, so atlas programs are never shared with plain ones or with
  // another atlas's layout.
  const key = `block-atlas ${layout.columns}x${layout.rows} ${layout.tileSize}px`;
  if (lit) {
    const emissive = [...lit.emissive];
    const chunks = litChunks(emissive);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec3 atlasTile;\nattribute float atlasFace;${chunks.vertexPars}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>${chunk}`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${chunks.vertex}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${chunks.fragmentPars}${texelPars}`)
        .replace('#include <opaque_fragment>', `${chunks.fragment}\n#include <opaque_fragment>`);
      for (const name of LIT_UNIFORMS) shader.uniforms[name] = lit.uniforms[name];
    };
    // Lit and unlit programs never mix; the emissive list is in the shader.
    const litKey = `${key} lit ${emissive.join(',')}`;
    material.customProgramCacheKey = () => litKey;
    return material;
  }
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 atlasTile;\nattribute float atlasFace;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>${chunk}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${texelPars}`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// The shared level uniforms of a lit map (three.js uniform objects { value }): the light pool's
// slots (createLightPool: litLightPos, litLightColor, litLightRadius; MAX_LIGHTS each), the ambient
// multiplier litAmbient (Vector3, linear), and the fog: litFogColor (Color, linear),
// litFogDensity (k) and litFogOrigin (the virtual eye's z: fog distance = litFogOrigin - z).
export const LIT_UNIFORMS = Object.freeze(['litLightPos', 'litLightColor', 'litLightRadius', 'litAmbient', 'litFogColor', 'litFogDensity', 'litFogOrigin']);
const FOG_UNIFORMS = Object.freeze(['litFogColor', 'litFogDensity', 'litFogOrigin']);

// World position varying (vertex, after worldpos_vertex), with or without instancing.
const WORLD_POS_VERTEX = `
#ifdef USE_INSTANCING
  litWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  litWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`;

// Exponential fog from the virtual eye at z = litFogOrigin (fragment, before opaque_fragment):
// f = 1 - e^(-k d), d = max(litFogOrigin - z, 0). Exported for scenes/palette-lut.js, which inserts
// its step just before this text.
export const FOG_FRAGMENT = `
{
  float litFog = 1.0 - exp(-litFogDensity * max(litFogOrigin - litWorldPos.z, 0.0));
  outgoingLight = mix(outgoingLight, litFogColor, litFog);
}`;
const FOG_PARS = `
uniform vec3 litFogColor;
uniform float litFogDensity;
uniform float litFogOrigin;`;

// The lit atlas shader parts. Per pixel: light = litAmbient + the sum over the MAX_LIGHTS slots of
// colour x w x facing, with L = light position - world position, x = clamp(|L| / radius, 0, 1),
// w = (1 - x^2)^2 (windowed falloff, 0 at the radius) and facing = 1 when the face looks towards
// the light (normal . L >= 0); an emissive tile (litEmissive 1) shows at full brightness; the
// surface colour is multiplied by it, then fogged (FOG_FRAGMENT). MeshBasicMaterial computes no
// normal without an envmap, so the world normal comes from the `normal` attribute here.
function litChunks(emissive) {
  const isEmissive = emissive.length === 0 ? 'false' : emissive.map((t) => `abs(litT - ${glslFloat(t)}) < 0.5`).join(' || ');
  return {
    vertexPars: `
varying vec3 litWorldPos;
varying vec3 litWorldNormal;
varying float litEmissive;`,
    vertex: `${WORLD_POS_VERTEX}
#ifdef USE_INSTANCING
  litWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
  litWorldNormal = normalize(mat3(modelMatrix) * normal);
#endif
{
  float litT = atlasFace < 0.5 ? atlasTile.x : (atlasFace < 1.5 ? atlasTile.y : atlasTile.z);
  litEmissive = (${isEmissive}) ? 1.0 : 0.0;
}`,
    fragmentPars: `
varying vec3 litWorldPos;
varying vec3 litWorldNormal;
varying float litEmissive;
uniform vec3 litLightPos[${MAX_LIGHTS}];
uniform vec3 litLightColor[${MAX_LIGHTS}];
uniform float litLightRadius[${MAX_LIGHTS}];
uniform vec3 litAmbient;${FOG_PARS}`,
    fragment: `
{
  vec3 litLight = litAmbient;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 litL = litLightPos[i] - litWorldPos;
    float litX = clamp(length(litL) / litLightRadius[i], 0.0, 1.0);
    float litQ = 1.0 - litX * litX;
    litLight += litLightColor[i] * (litQ * litQ) * step(0.0, dot(litWorldNormal, litL));
  }
  litLight = mix(litLight, vec3(1.0), litEmissive);
  outgoingLight *= litLight;
}${FOG_FRAGMENT}`,
  };
}

// Patches a MeshBasicMaterial with the level fog only (the city backdrop of a lit map): a world
// position varying and the fog mix, with the shared fog uniforms of `uniforms` (see LIT_UNIFORMS).
// Returns the material.
export function addFog(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 litWorldPos;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${WORLD_POS_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 litWorldPos;${FOG_PARS}`)
      .replace('#include <opaque_fragment>', `${FOG_FRAGMENT}\n#include <opaque_fragment>`);
    for (const name of FOG_UNIFORMS) shader.uniforms[name] = uniforms[name];
  };
  material.customProgramCacheKey = () => 'level-fog';
  return material;
}
