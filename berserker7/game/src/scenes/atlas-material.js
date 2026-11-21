// Block atlas drawing for the Sandbox: the level's instanced tiles and cubes show one atlas tile per
// face (chosen by scenes/block-decor.js) instead of the checkerboard, in the same draw calls.
// - per instance: `atlasTile` [side, top, front] atlas tile indices (an InstancedBufferAttribute on
//   a per-group geometry that shares the base geometry's buffers)
// - per vertex: `atlasFace`, which of the three a face shows (0 side, 1 top, 2 front)
// - the material is a MeshBasicMaterial whose vertex shader replaces the map UV with the tile's
//   square in the atlas, inset by half a texel so nearest sampling never reads the next tile.
// Nearest filtering and no mipmaps, like the checkerboard (mipmaps would also blend tiles).

import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, MeshBasicMaterial, NearestFilter, PlaneGeometry } from 'three';
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

// A MeshBasicMaterial that maps `map` (the atlas texture) by the atlas tile of each face. `layout`
// is atlasLayout's { columns, rows, tileSize }; `color` the material colour (depth shading), if any.
export function createAtlasMaterial({ map, layout, vertexColors = false, color }) {
  const material = new MeshBasicMaterial({ map, vertexColors, ...(color === undefined ? {} : { color }) });
  const chunk = atlasUvChunk(layout);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 atlasTile;\nattribute float atlasFace;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>${chunk}`);
  };
  // A fixed key with the grid size, so atlas programs are never shared with plain ones or with
  // another atlas's layout.
  const key = `block-atlas ${layout.columns}x${layout.rows} ${layout.tileSize}px`;
  material.customProgramCacheKey = () => key;
  return material;
}
