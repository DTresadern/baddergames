// @ts-check
// Distant elevated track (depth 5) and the train that loops along it (position from trainX()).
// Track and cars are instanced boxes; window strips are emissive boxes that bloom.

import * as THREE from 'three';
import { InstanceBatch, UNIT } from '../effects/batch.js';
import { GlowBatch } from '../effects/glow.js';
import { depthGroup } from '../stage.js';
import { trainX } from '@fw-eval/shared/scene.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createTrain(scene, ctx) {
  const tr = scene.train;
  const P = scene.palette;
  const g = depthGroup(tr.depth);
  const lit = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.5 });
  const emissive = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const y = tr.trackY;
  const track = new InstanceBatch(UNIT.box);
  const lamps = new InstanceBatch(UNIT.box);
  track.box(-300, y, scene.world.width + 600, tr.trackThickness, 0, 40, P.gunmetal);
  track.box(-300, y + tr.trackThickness, scene.world.width + 600, 5, -4, 32, P.gunmetalDark);
  for (const x of tr.trackSupports) {
    track.box(x - 6, y + 12, 12, tr.supportBottom - y, -10, 20, P.gunmetalDark);
    track.beam(x - 30, y + 12, x - 4, y + 32, 4, -20, 16, P.gunmetalDark);
    track.beam(x + 30, y + 12, x + 4, y + 32, 4, -20, 16, P.gunmetalDark);
  }
  for (let x = -40; x < scene.world.width + 80; x += 45) lamps.box(x, y + 8, 2, 2, 0.5, 1, P.amber, 1.6);
  g.add(track.build(lit), lamps.build(emissive));

  // train cars: body, roof highlight, window strip; front car gets a sloped nose
  const cars = new InstanceBatch(UNIT.box);
  const wins = new InstanceBatch(UNIT.box);
  for (let c = 0; c < tr.carCount; c++) {
    const x = c * (tr.carLength + tr.carGap);
    const top = y - tr.carHeight;
    const front = c === tr.carCount - 1;
    cars.box(x, top, front ? tr.carLength - 8 : tr.carLength, tr.carHeight - 2, -6, 24, tr.color);
    if (front) cars.beam(x + tr.carLength - 9, top + 1, x + tr.carLength, y - 3, 6, -18, 24, tr.color);
    cars.box(x + 2, top - 1, tr.carLength - 10, 1.5, -8, 20, P.steelHighlight);
    for (let k = 0; k < 6; k++) wins.box(x + 3 + k * 6.5, top + 4, 4.5, 3.5, -5.5, 1, tr.windowColor, 1.6);
  }
  const glows = new GlowBatch();
  const length = tr.carCount * (tr.carLength + tr.carGap);
  glows.add(length - 2, y - 5, -4, 26, 10, P.amberPale, 0.6);
  for (let c = 0; c < tr.carCount; c++) glows.add(c * (tr.carLength + tr.carGap) + 21, y - 8, -4, 26, 9, P.amber, 0.25);
  const train = new THREE.Group();
  train.add(cars.build(lit), wins.build(emissive), glows.build({ time: ctx.time }));
  // cars are placed from x = 0; the group's x offset is the train position
  g.add(train);

  return {
    parts: [g],
    update(t) { train.position.x = trainX(scene, t); },
  };
}
