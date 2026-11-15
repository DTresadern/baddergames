// @ts-check
// Background megacity: four depth layers of tiered buildings.
// Each layer: one BatchedMesh3D (instancing) of unit cubes, one slot per tier and antenna,
// with a matrix for size and place; lit windows are merged into one unlit vertex-coloured
// mesh; domes into one lit mesh. Distance haze comes from the view's fog.

import { BatchedMesh3D, CubeGeometry, Material3D, Matrix4, Mesh3D, RenderPassBit } from '@pixi/3d';
import { MeshBuilder } from '../effects/batch.js';
import { glowVertexMaterial, litVertexMaterial } from '../effects/materials.js';
import { S, X, Y, Z } from '../stage.js';

const unitCube = new CubeGeometry({ width: 1, height: 1, depth: 1 });

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createCity(scene) {
  const P = scene.palette;
  /** @type {import('../stage.js').Node[]} */
  const nodes = [];
  let slotsTotal = 0;
  for (const layer of scene.city) {
    const d = layer.depth;
    const z = Z(d);
    // count slots first: the batch size is fixed at construction
    let count = 0;
    for (const b of layer.buildings) count += b.tiers.length + b.antennas.length;
    slotsTotal += count;
    const batch = new BatchedMesh3D({ size: Math.max(1, count) });
    batch.label = `city-${d}`;
    const mat = new Material3D({ baseColor: layer.color, roughness: 0.85, metallic: 0.3 });
    const m = new Matrix4();
    const windows = new MeshBuilder();
    const domes = new MeshBuilder();
    const winZ = z + S(0.6, d);
    let slot = 0;
    for (const b of layer.buildings) {
      const thick = S(Math.min(b.w, 90) * 0.8, d);
      for (const t of b.tiers) {
        const w = S(t.w, d), h = S(t.h, d);
        const cx = X(t.x + t.w / 2, d), cy = Y(t.y + t.h / 2, d);
        put(batch, slot++, mat, m.makeScale(w, h, thick).setPosition({ x: cx, y: cy, z: z - thick / 2 }));
        if (t.dome) {
          domes.ellipsoid([cx, Y(t.y, d), z - thick / 2], [w / 2, Math.min(S(t.w * 0.35, d), h), thick / 2], layer.color, { half: true, seg: 14 });
        }
        // lit windows: small quads in front of the front face
        const g = t.windows;
        for (let i = 0; i < g.lit.length; i++) {
          if (!g.lit[i]) continue;
          const c = i % g.cols, r = Math.floor(i / g.cols);
          const wx = g.x0 + c * g.dx, wy = g.y0 + r * g.dy;
          const color = (i * 7 + r) % 5 === 0 ? P.windowDim : P.windowLit;
          windows.quad(
            [X(wx, d), Y(wy + g.wh, d), winZ], [X(wx + g.ww, d), Y(wy + g.wh, d), winZ],
            [X(wx + g.ww, d), Y(wy, d), winZ], [X(wx, d), Y(wy, d), winZ], color, [0, 0, 1]);
        }
      }
      for (const a of b.antennas) {
        const top = b.tiers[b.tiers.length - 1].y;
        const h = S(top - a.top, d), w = S(1.5, d);
        put(batch, slot++, mat, m.makeScale(w, h, w).setPosition({ x: X(a.x, d), y: Y(top, d) + h / 2, z: z - thick / 4 }));
      }
    }
    nodes.push(batch);
    const wg = windows.build();
    if (wg) nodes.push(new Mesh3D({ geometry: wg, material: glowVertexMaterial(), castShadow: false, receiveShadow: false }));
    const dg = domes.build();
    if (dg) nodes.push(new Mesh3D({ geometry: dg, material: litVertexMaterial({ roughness: 0.6, metallic: 0.4 }), castShadow: false }));
  }
  return { nodes, info: { citySlots: slotsTotal } };
}

/**
 * @param {BatchedMesh3D} batch @param {number} i @param {Material3D} mat @param {Matrix4} m
 */
function put(batch, i, mat, m) {
  batch.setGeometryAt(i, unitCube);
  batch.setMaterialAt(i, mat);
  batch.setMatrixAt(i, m);
  batch.setPassesAt(i, RenderPassBit.OPAQUE);
}
