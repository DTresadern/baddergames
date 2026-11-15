// @ts-check
// Rock (extruded outline) and the red organic growth over it: tapered tubes for the
// tendrils, glossy so the lamps catch them, and pods that glow from inside.

import { Material3D, Mesh3D } from '@pixi/3d';
import { MeshBuilder } from '../effects/batch.js';
import { createGlows } from '../effects/glow.js';
import { glowVertexMaterial, litVertexMaterial } from '../effects/materials.js';
import { X, Y } from '../stage.js';

/** Front face of the rock, in front of the structures. */
const ROCK_Z = 30;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createGrowth(scene) {
  const P = scene.palette;
  const g = scene.growth;
  const rock = new MeshBuilder();
  rock.prism(g.rock.map((p) => [X(p.x), Y(p.y)]), -140, ROCK_Z, P.rock, P.rockLight);
  rock.prism(g.mound.map((p) => [X(p.x), Y(p.y)]), -60, ROCK_Z - 6, P.rock, P.rockLight);
  // boulders on the ridge break up the flat face
  const ridge = g.rock.filter((_, i) => i % 3 === 1);
  for (const p of ridge) {
    if (p.y > 380) continue;
    rock.ellipsoid([X(p.x), Y(p.y + 14), ROCK_Z - 4], [18, 12, 10], P.rockLight, { seg: 8 });
  }

  const tendrils = new MeshBuilder();
  g.tendrils.forEach((td, i) => {
    const pts = td.points.map((p, k) => /** @type {[number, number, number]} */ ([X(p.x), Y(p.y), ROCK_Z + 2 + Math.sin(k * 1.3 + i) * 2]));
    tendrils.tube(pts, td.width * 0.6, i % 2 ? P.growth : P.growthMid, { radiusEnd: td.width * 0.18, sides: 6 });
  });

  const pods = new MeshBuilder();
  const glows = createGlows(g.pods.length);
  for (const p of g.pods) {
    pods.ellipsoid([X(p.x), Y(p.y), ROCK_Z + 3], [p.r, p.r * 0.8, p.r * 0.6], P.growthGlow, { seg: 10 });
    glows.add(X(p.x), Y(p.y), ROCK_Z + 10, p.r * 4, P.growthGlow, 0.35);
  }
  glows.upload();

  return {
    nodes: [
      new Mesh3D({ geometry: rock.build() ?? undefined, material: litVertexMaterial({ roughness: 0.75, metallic: 0.05 }) }),
      new Mesh3D({
        geometry: tendrils.build() ?? undefined,
        material: new Material3D({ baseColor: 0xffffff, vertexColors: true, roughness: 0.25, metallic: 0.1, emissive: { color: P.growth, strength: 0.25 } }),
      }),
      new Mesh3D({ geometry: pods.build() ?? undefined, material: glowVertexMaterial(), castShadow: false }),
      glows.node,
    ],
  };
}
