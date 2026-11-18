// Helpers shared by the scenes.

import { DataTexture, NearestFilter, RepeatWrapping } from 'three';

// Key of the checker texture shared by scene A and scene B through the asset cache.
export const CHECKER = 'checker';

export function createCheckerTexture() {
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = ((x >> 1) + (y >> 1)) % 2 === 0 ? 255 : 140;
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.magFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Makes `group` hold exactly one mesh per entity. `meshOf` is a WeakMap from
// state entity to mesh: it does not keep entities alive, so when a state is
// replaced (for example restored from a snapshot) the old entries go with it.
// Meshes share the scene's tracked geometry and materials, so they hold no GPU
// memory of their own and need no dispose().
export function syncMeshes(group, entities, meshOf, make) {
  const used = new Set();
  for (const entity of entities) {
    let mesh = meshOf.get(entity);
    if (!mesh) {
      mesh = make(entity);
      meshOf.set(entity, mesh);
    }
    if (mesh.parent !== group) group.add(mesh);
    used.add(mesh);
  }
  for (const mesh of [...group.children]) if (!used.has(mesh)) group.remove(mesh);
}

// Orthographic camera showing `halfHeight` world units above and below centre.
export function fitOrtho(camera, view, halfHeight) {
  const halfWidth = (halfHeight * view.width) / view.height;
  if (camera.right === halfWidth && camera.top === halfHeight) return;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

// Perspective camera; on narrow (portrait) views it moves back so the width still fits.
export function fitPerspective(camera, view, distance) {
  const aspect = view.width / view.height;
  if (camera.aspect === aspect) return;
  camera.aspect = aspect;
  camera.position.setLength(distance * Math.max(1, 1 / aspect));
  camera.updateProjectionMatrix();
}

// True when (x, y) is in the rectangle: left and top edges inside, right and bottom outside.
export const inside = (r, x, y) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

// Puts a unit plane on a layout rectangle (CSS px, top-left origin, y down): centred, in y-up camera space.
export function place(mesh, rect, viewWidth, viewHeight) {
  mesh.position.x = rect.x + rect.width / 2 - viewWidth / 2;
  mesh.position.y = viewHeight / 2 - (rect.y + rect.height / 2);
  mesh.scale.set(rect.width, rect.height, 1);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
