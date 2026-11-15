// @ts-check
// Sky: a vertex-coloured backdrop plane behind the far city (depth 11), unlit and outside
// the fog so its gradient shows exactly the scene.sky stops. The view's own `background`
// (colour or hemisphere) cannot place gradient stops at given heights, so a mesh is used.

import { FlatMaterial, Mesh3D } from '@pixi/3d';
import { MeshBuilder, linear } from '../effects/builder.js';
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
    castShadow: false,
    receiveShadow: false,
  });
  mesh.label = 'sky';
  return { nodes: [mesh] };
}
