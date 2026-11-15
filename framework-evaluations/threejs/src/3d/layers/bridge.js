// @ts-check
// The elevated walkway as real geometry: a deck slab (wet reflective top, hazard-striped
// front edge), the girder below it with vents, pillars with capitals, diagonal braces,
// sagging cables (tubes) and the blinking red warning lights on the pillars.

import * as THREE from 'three';
import { InstanceBatch, MergeBatch, UNIT } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { wetMaterial, stripeMaterial, slab } from '../effects/materials.js';
import { lx, ly, DECK_DEPTH, DECK_FRONT_DROP } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createBridge(scene, ctx) {
  const P = scene.palette;
  const br = scene.bridge;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.6, envMap: ctx.env, envMapIntensity: 0.5 });

  // deck slab: top = wet surface, front = stripe band (y 209..218)
  const top = br.deck.y + DECK_FRONT_DROP; // 209
  const sb = br.stripeBand;
  const h = sb.y + sb.h - top;
  const deck = slab(br.deck.w, h, DECK_DEPTH,
    [metal, metal, wetMaterial(P.gunmetal, ctx.env), metal, stripeMaterial(P.hazardYellow, P.hazardBlack), metal], br.stripeSpacing);
  deck.position.set(lx(br.deck.x + br.deck.w / 2), ly(top + h / 2), -DECK_DEPTH / 2);
  group.add(deck);

  const b = new InstanceBatch(UNIT.box);
  // girder: dark beam with vents
  const g = br.girder;
  b.box(g.x, g.y, g.w, g.h, -3, DECK_DEPTH - 6, P.gunmetal);
  b.box(g.x, g.y + g.h - 3, g.w, 3, -2, DECK_DEPTH - 8, 0x0a0b0d);
  for (let x = 30; x < g.w - 30; x += 96) {
    b.box(x, g.y + 6, 34, 10, -2, 2, 0x0c0d10);
    for (let k = 0; k < 5; k++) b.box(x + 2 + k * 7, g.y + 7, 4, 8, -1.5, 1, P.gunmetalLight);
  }
  // pillars, capitals, bands, braces
  const pz = -DECK_DEPTH * 0.3, pd = DECK_DEPTH * 0.4;
  for (const p of br.pillars) {
    b.box(p.x, p.y, p.w, p.h + 60, pz, pd, P.gunmetal);
    b.box(p.x + 6, p.y + 12, p.w - 12, p.h + 40, pz + 1, 2, P.gunmetalDark);
    for (let y = p.y + 20; y < 460; y += 34) b.box(p.x - 1, y, p.w + 2, 2, pz + 1, pd + 2, P.gunmetalDark);
    b.box(p.x - 8, p.y - 2, p.w + 16, 8, pz + 6, pd + 12, P.gunmetalLight);
  }
  for (const [x1, y1, x2, y2] of br.braces) b.beam(x1, y1, x2, y2, 7, pz - pd / 2, 8, P.gunmetal);
  // red light housings on the pillar fronts
  br.redLights.forEach((l) => b.box(l.x - 3, l.y - 4, 6, 8, pz + 3, 4, 0x0c0c0e));
  group.add(b.build(metal));

  const lens = new InstanceBatch(UNIT.box);
  const glows = new GlowBatch();
  br.redLights.forEach((l, i) => {
    lens.box(l.x - 2, l.y - 2, 4, 4, pz + 4, 2, P.warningRed, 3);
    glows.add(l.x, l.y, pz + 6, l.radius, l.radius, P.warningRed, 0.9, BLINK.red, i);
  });
  group.add(lens.build(new THREE.MeshBasicMaterial({ color: 0xffffff })));
  group.add(glows.build({ time: ctx.time, core: 0.15 }));

  // cables: sagging tubes under the girder
  const cables = new MergeBatch();
  for (const cable of br.cables) {
    const curve = new THREE.CatmullRomCurve3(cable.map((p) => new THREE.Vector3(lx(p.x), ly(p.y), 2)));
    cables.add(new THREE.TubeGeometry(curve, 24, 0.9, 5, false), { x: 0, y: 0, z: 0 }, 0x0b0c0e);
  }
  group.add(cables.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })));

  return { parts: [group] };
}
