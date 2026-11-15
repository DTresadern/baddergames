// @ts-check
// Sodium lamps (count = stress `lights`): a fixture, an emissive bulb, a halo sprite and a
// real PointLight each. @pixi/3d shades at most 32 direct lights per view (MAX_LIGHTS in
// core/lightLimits): past that the lights last in the view's list are skipped, so at
// lights=128 only the first lamps (plus the drone's spot) actually light surfaces; the
// bulbs and halos of every lamp still draw.

import { Mesh3D, PointLight } from '@pixi/3d';
import { lampFlicker } from '@fw-eval/shared/scene.js';
import { MeshBuilder } from '../effects/builder.js';
import { createGlows, glowVertexMaterial, litVertexMaterial } from '../effects/materials.js';
import { DECK, X, Y, deckTopAt } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createLights(scene) {
  const P = scene.palette;
  const fixtures = new MeshBuilder();
  const bulbs = new MeshBuilder();
  const glows = createGlows(scene.lamps.length);
  /** @type {PointLight[]} */
  const lights = [];
  scene.lamps.forEach((l) => {
    const x = X(l.x), y = Y(l.y);
    let z = 6; // in front of the structure it hangs on
    if (l.kind === 'post') {
      z = l.x < 800 ? DECK.backZ + 12 : -20;
      const foot = l.x < 800 ? deckTopAt(z) : Y(l.y + 30);
      fixtures.box(x - 2, foot, z - 2, x + 2, y, z + 2, P.gunmetalDark);
      fixtures.box(x - 5, y - 2, z - 5, x + 5, y + 2, z + 5, P.gunmetal);
      bulbs.box(x - 4, y + 2, z - 4, x + 4, y + 8, z + 4, P.amberPale);
      fixtures.box(x - 5, y + 8, z - 5, x + 5, y + 11, z + 5, P.gunmetal);
    } else if (l.kind === 'under') {
      fixtures.box(x - 12, y + 2, z - 8, x + 12, y + 6, z + 2, P.gunmetalDark);
      bulbs.box(x - 10, y - 1, z - 6, x + 10, y + 2, z, P.amberPale);
    } else if (l.kind === 'wall') {
      z = -12;
      fixtures.box(x - 14, y + 2, z - 6, x + 14, y + 6, z + 4, P.gunmetalDark);
      bulbs.box(x - 12, y - 1, z - 4, x + 12, y + 2, z + 2, P.amberPale);
    } else {
      bulbs.box(x - 2.5, y - 2.5, z - 2.5, x + 2.5, y + 2.5, z + 2.5, l.color);
    }
    glows.add(x, y, z + 6, l.radius * 1.5, l.color, 0.55 * l.intensity);
    const light = new PointLight({
      color: l.color,
      // inverse-square falloff in world units: about full strength at radius/2
      intensity: l.intensity * l.radius * l.radius * 2.2,
      range: l.radius * 2.6,
      position: { x, y: y - 4, z: z + 18 },
    });
    lights.push(light);
  });
  const nodes = [
    new Mesh3D({ geometry: fixtures.build() ?? undefined, material: litVertexMaterial({ roughness: 0.5, metallic: 0.6 }), castShadow: false }),
    new Mesh3D({ geometry: bulbs.build() ?? undefined, material: glowVertexMaterial(), castShadow: false, receiveShadow: false }),
    glows.node,
    ...lights,
  ];
  return {
    nodes,
    info: { lamps: scene.lamps.length },
    update(t) {
      const base = scene.lamps;
      for (let i = 0; i < lights.length; i++) lights[i].intensity = base[i].intensity * base[i].radius * base[i].radius * 2.2 * lampFlicker(i, t);
      glows.upload((i) => lampFlicker(i, t));
    },
  };
}
