// @ts-check
// Crates and barrels as InstancedMeshes (count scales with stress.objects): one draw for
// all crate boxes and their frame bars, one for all barrels and their rings.

import * as THREE from 'three';
import { InstanceBatch, UNIT } from '../effects/batch.js';
import { lx, ly, DECK_DEPTH } from '../stage.js';
import { surfaceY } from './structures.js';
import { makeRng } from '@fw-eval/shared/rng.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createClutter(scene) {
  const P = scene.palette;
  const rng = makeRng(scene.seed * 17 + 3); // only for z placement inside the walkways
  const crates = new InstanceBatch(UNIT.box);
  const barrels = new InstanceBatch(UNIT.cylinder);
  scene.clutter.forEach((it, i) => {
    const bottom = surfaceY(it.y + it.h);
    const y = bottom - it.h;
    // first items are hand-placed: keep them near the front; stress copies spread in z
    const zFront = i < 11 ? -8 - (i % 3) * 6 : -rng.range(6, DECK_DEPTH * 0.7);
    if (it.kind === 'crate') {
      const zd = Math.min(it.w * 0.9, DECK_DEPTH * 0.5);
      crates.box(it.x, y, it.w, it.h, zFront, zd, it.tint);
      // frame: top and bottom bands, corner posts (slightly proud of the faces)
      const frame = 0x55595f;
      crates.box(it.x - 0.6, y, it.w + 1.2, 2.2, zFront + 0.6, zd + 1.2, frame);
      crates.box(it.x - 0.6, y + it.h - 2.2, it.w + 1.2, 2.2, zFront + 0.6, zd + 1.2, frame);
      crates.box(it.x - 0.6, y, 2.4, it.h, zFront + 0.6, zd + 1.2, frame);
      crates.box(it.x + it.w - 1.8, y, 2.4, it.h, zFront + 0.6, zd + 1.2, frame);
      if (it.w > 40) crates.beam(it.x + 3, y + it.h - 3, it.x + it.w - 3, y + 3, 2, zFront + 0.5, 1, frame);
    } else {
      const z = zFront - it.w / 2;
      const pos = { x: lx(it.x + it.w / 2), y: ly(y + it.h / 2), z };
      barrels.add(pos, new THREE.Euler(), { x: it.w, y: it.h, z: it.w }, it.tint);
      for (const f of [0.22, 0.78]) {
        barrels.add({ x: pos.x, y: ly(y + it.h * f), z }, new THREE.Euler(), { x: it.w + 1, y: 1.6, z: it.w + 1 }, 0x3a0a08);
      }
      barrels.add({ x: pos.x, y: ly(y + it.h * 0.5), z }, new THREE.Euler(), { x: it.w + 0.6, y: 2.5, z: it.w + 0.6 }, P.hazardYellow);
    }
  });
  const group = new THREE.Group();
  group.add(
    crates.build(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.45 })),
    barrels.build(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.5 })),
  );
  return { object: group };
}
