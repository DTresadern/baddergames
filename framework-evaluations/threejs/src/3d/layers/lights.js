// @ts-check
// Sodium-amber lamps as REAL lights: one PointLight per lamp (count = stress.lights), so
// light pools on the wet deck and highlights on crates, rails and figures come from the
// renderer's lighting. Each lamp also has a fixture (merged geometry, one draw), an
// emissive lens that blooms, and an additive halo in the rain (one instanced draw).
// Flicker uses lampFlicker() on the light intensity; the halo flickers in its shader.

import * as THREE from 'three';
import { MergeBatch, InstanceBatch, UNIT } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { toWorld, DECK_DEPTH, D } from '../stage.js';
import { isFlickering, lampFlicker } from '@fw-eval/shared/scene.js';

/**
 * Where a lamp sits in 3D: wall lamps on the tower fronts (behind the deck), post and
 * under-deck lamps at the front, stress extras spread in z.
 * @param {import('@fw-eval/shared/scene.js').Lamp} lamp @param {number} i
 */
function lampPosition(lamp, i) {
  if (lamp.kind === 'wall') return toWorld(lamp.x, lamp.y, 6, DECK_DEPTH / D);
  if (lamp.kind === 'post') return toWorld(lamp.x, lamp.y + 13, -14, 0);
  if (lamp.kind === 'under') return toWorld(lamp.x, lamp.y, 6, 0);
  const z = -((i * 0.6180339) % 1) * DECK_DEPTH * 0.9 + 8;
  return toWorld(lamp.x, lamp.y, z, 0);
}

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createLights(scene, ctx) {
  const P = scene.palette;
  const group = new THREE.Group();
  const fixtures = new MergeBatch();
  const lenses = new InstanceBatch(UNIT.box);
  const halos = new GlowBatch();
  /** @type {{ light: THREE.PointLight, base: number, i: number }[]} */
  const lights = [];

  scene.lamps.forEach((lamp, i) => {
    const p = lampPosition(lamp, i);
    const blink = isFlickering(i) ? BLINK.flicker : BLINK.steady;
    const housing = 0x1a1a1c;
    if (lamp.kind === 'post') {
      // p is the lamp head; the post runs down to the walking surface
      fixtures.add(new THREE.CylinderGeometry(1.5, 1.5, 22, 8), { x: p.x, y: p.y - 15, z: p.z }, P.gunmetalLight);
      fixtures.add(new THREE.BoxGeometry(8, 7, 8), { x: p.x, y: p.y + 1, z: p.z }, housing);
      lenses.add({ x: p.x, y: p.y - 2, z: p.z }, new THREE.Euler(), { x: 6.5, y: 4, z: 6.5 }, P.amberPale, 3);
    } else {
      const w = lamp.kind === 'wall' ? 20 : 18;
      fixtures.add(new THREE.BoxGeometry(w, 4, 8), { x: p.x, y: p.y + 2.5, z: p.z - 2 }, housing);
      lenses.add({ x: p.x, y: p.y, z: p.z - 1 }, new THREE.Euler(), { x: w - 4, y: 2, z: 6 }, P.amberPale, 3);
    }
    halos.addLocal(new THREE.Vector3(p.x, p.y, p.z + 4), lamp.radius, lamp.radius * 0.8, lamp.color, lamp.intensity * 0.55, blink, i);

    const light = new THREE.PointLight(lamp.color, 0, lamp.radius * 3.2, 1.2);
    // under-deck and wall lamps hang below their housing; post lamps glow from the lens
    light.position.set(p.x, p.y - (lamp.kind === 'post' ? 1 : 6), p.z + 4);
    group.add(light);
    lights.push({ light, base: lamp.intensity * 420, i });
  });

  group.add(fixtures.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })));
  group.add(lenses.build(new THREE.MeshBasicMaterial({ color: 0xffffff })));
  group.add(halos.build({ time: ctx.time, core: 0.05 }));

  return {
    parts: [group],
    update(t) {
      for (const l of lights) l.light.intensity = l.base * lampFlicker(l.i, t);
    },
  };
}
