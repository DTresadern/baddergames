// @ts-check
// Background megacity: every building tier is an extruded box (one InstancedMesh per
// depth layer), lit windows are emissive quads on the front faces (one InstancedMesh per
// layer), plus a ground-fog band in front of each layer. Distance haze comes from the
// scene fog (effects/materials.js installHazeFog); windows skip fog and are pre-hazed less
// strongly, as emissive light cuts through haze (same rule as the 2D build).

import * as THREE from 'three';
import { InstanceBatch, UNIT } from '../effects/batch.js';
import { depthGroup, lx, ly } from '../stage.js';
import { hazed, hazeAt, lerpColor } from '@fw-eval/shared/scene.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createCity(scene) {
  const P = scene.palette;
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });

  scene.city.forEach((layer, li) => {
    const d = layer.depth;
    const g = depthGroup(d);
    const boxes = new InstanceBatch(UNIT.box);
    const domes = new InstanceBatch(UNIT.sphere);
    const wins = new InstanceBatch(UNIT.plane);
    const win = hazed(scene, P.windowLit, d * 0.45);
    const winDim = hazed(scene, P.windowDim, d * 0.6);
    const tip = hazed(scene, P.warningRed, d * 0.5);
    for (const bld of layer.buildings) {
      const thick = bld.w * 0.9;
      for (const tier of bld.tiers) {
        boxes.box(tier.x, tier.y, tier.w, tier.h, 0, thick, layer.color);
        if (tier.dome) domes.add({ x: lx(tier.x + tier.w / 2), y: ly(tier.y), z: -thick / 2 }, new THREE.Euler(), { x: tier.w, y: tier.w * 0.9, z: thick }, layer.color);
        // structural ribs standing out of the facade
        const ribs = Math.floor(tier.w / 26);
        for (let r = 1; r <= ribs; r++) boxes.box(tier.x + (tier.w * r) / (ribs + 1) - 0.75, tier.y, 1.5, tier.h, 1, 1, P.gunmetalLight);
        boxes.box(tier.x - 1, tier.y, tier.w + 2, 2, 1, thick + 2, P.gunmetalLight); // roof ledge
        const w = tier.windows;
        for (let i = 0; i < w.lit.length; i++) {
          const c = i % w.cols, r = Math.floor(i / w.cols);
          const lit = w.lit[i] === 1;
          if (!lit && (i * 7 + r) % 9 !== 0) continue;
          const x = w.x0 + c * w.dx + w.ww / 2, y = w.y0 + r * w.dy + w.wh / 2;
          wins.add({ x: lx(x), y: ly(y), z: 0.3 }, new THREE.Euler(), { x: w.ww, y: w.wh, z: 1 }, lit ? win : winDim, lit ? 1.5 : 0.4);
        }
      }
      for (const a of bld.antennas) {
        const top = bld.tiers[bld.tiers.length - 1].y;
        boxes.box(a.x - 0.75, a.top, 1.5, top - a.top, -thick / 2, 1.5, layer.color);
        wins.add({ x: lx(a.x), y: ly(a.top), z: -thick / 2 + 1 }, new THREE.Euler(), { x: 3, y: 3, z: 1 }, tip, 2);
      }
    }
    g.add(boxes.build(bodyMat), domes.build(bodyMat), wins.build(winMat));

    // ground fog band in front of the layer: transparent at the top, haze at the bottom
    const h = hazeAt(scene, d);
    const fogTop = 150 + li * 25;
    const top = new THREE.Color(h.color), bottom = new THREE.Color(lerpColor(h.color, P.skyHorizon, 0.4));
    const fogGeo = new THREE.BufferGeometry();
    const x0 = lx(-200), x1 = lx(1400), y0 = ly(fogTop), y1 = ly(460);
    fogGeo.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x0, y1, 0, x1, y1, 0], 3));
    const a = 0.1 + h.opacity * 0.2;
    fogGeo.setAttribute('color', new THREE.Float32BufferAttribute([
      top.r, top.g, top.b, 0, top.r, top.g, top.b, 0,
      bottom.r, bottom.g, bottom.b, a, bottom.r, bottom.g, bottom.b, a,
    ], 4));
    fogGeo.setIndex([0, 2, 1, 1, 2, 3]);
    const fog = new THREE.Mesh(fogGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    fog.position.z = 8;
    g.add(fog);
    root.add(g);
  });
  return { parts: [root] };
}
