// @ts-check
// Crates and barrels (count scales with stress.objects). Every crate is its own Mesh3D
// sharing one unit crate geometry (and every barrel one barrel geometry); @pixi/3d batches
// meshes that share a geometry into instanced draws on its own (instancing.md), so this
// stays a handful of draws at objects=16. The tint is the material's baseColor, multiplied
// with the grey vertex colours of the unit geometry.

import { Mesh3D } from '@pixi/3d';
import { MeshBuilder } from '../effects/batch.js';
import { litVertexMaterial } from '../effects/materials.js';
import { DECK, standY } from '../stage.js';
import { D } from '../stage.js';

/** Unit crate: x and z -0.5..0.5, y 0..1, reinforced frame on the front. */
function crateGeometry() {
  const b = new MeshBuilder();
  b.box(-0.5, 0, -0.5, 0.5, 1, 0.5, 0xd0d0d0, { top: 0xe8e8e8, back: false });
  const f = 0.1, z = 0.5, e = 0.03;
  b.box(-0.5, 1 - f, z - e, 0.5, 1, z + e, 0x707070);
  b.box(-0.5, 0, z - e, 0.5, f, z + e, 0x707070);
  b.box(-0.5, 0, z - e, -0.5 + f, 1, z + e, 0x707070);
  b.box(0.5 - f, 0, z - e, 0.5, 1, z + e, 0x707070);
  b.beam(-0.5 + f, f, 0.5 - f, 1 - f, 0.07, z - e, z + e * 0.5, 0x808080);
  return b.build();
}

/** Unit barrel: radius 0.5, y 0..1, two ribs and a pale label band. */
function barrelGeometry() {
  const b = new MeshBuilder();
  b.cylinder(0, 0, 0.5, 0, 1, 0xd8d8d8, 14);
  for (const y of [0.3, 0.7]) b.tube([[0, y, 0], [0, y + 0.05, 0]], 0.52, 0x707070, { sides: 14 });
  b.tube([[0, 0.42, 0], [0, 0.58, 0]], 0.505, 0xffffff, { sides: 14 });
  return b.build();
}

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createClutter(scene) {
  const crate = crateGeometry() ?? undefined;
  const barrel = barrelGeometry() ?? undefined;
  /** @type {Map<number, import('@pixi/3d').Material3D>} */
  const materials = new Map();
  const matFor = (/** @type {number} */ tint, /** @type {boolean} */ isBarrel) => {
    const key = tint * 2 + (isBarrel ? 1 : 0);
    let m = materials.get(key);
    if (!m) {
      m = litVertexMaterial({ roughness: isBarrel ? 0.35 : 0.6, metallic: isBarrel ? 0.5 : 0.25 });
      m.baseColor = tint;
      materials.set(key, m);
    }
    return m;
  };
  /** @type {import('../stage.js').Part[]} */
  const parts = [];
  scene.clutter.forEach((it, i) => {
    const feet = it.y + it.h;
    const onDeck = feet === DECK.backY;
    // stagger in depth so stacks overlap naturally
    const z = onDeck ? -50 - (i % 3) * 6 : -30 - (i % 2) * 8;
    const k = (D - z) / D;
    const barrelItem = it.kind === 'barrel';
    const depth = barrelItem ? it.w : it.w * 0.8;
    parts.push(new Mesh3D({
      geometry: barrelItem ? barrel : crate,
      material: matFor(it.tint, barrelItem),
      position: { x: (it.x + it.w / 2 - 600) * k, y: standY(feet, z), z },
      scale: { x: it.w * k, y: it.h * k, z: depth * k },
    }));
  });
  return { parts, info: { clutterMeshes: parts.length } };
}
