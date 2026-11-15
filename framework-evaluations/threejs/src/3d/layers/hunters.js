// @ts-check
// Two crouching hunter figures on the deck: primitive stand-ins (tapered tubes for tail,
// legs and arms, capsule torso, cone snout and horns, box rifle and backpack), merged into
// one vertex-coloured mesh. Muzzle and eye are emissive; the muzzle has a halo.

import * as THREE from 'three';
import { MergeBatch, taperedTube } from '../effects/batch.js';
import { GlowBatch } from '../effects/glow.js';
import { lx, ly, DECK_DEPTH } from '../stage.js';
import { surfaceY } from './structures.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createHunters(scene, ctx) {
  const P = scene.palette;
  const body = new MergeBatch();
  const glowParts = new MergeBatch();
  const glows = new GlowBatch();
  const e = new THREE.Euler();

  scene.hunters.forEach((h, hi) => {
    const s = h.scale, f = h.facing;
    const fx = lx(h.x), fy = ly(surfaceY(h.y)), fz = -DECK_DEPTH * (0.35 + 0.1 * hi);
    /** figure-local (x forward, y up, z sideways) -> group coordinates @param {number} x @param {number} y @param {number} [z] */
    const V = (x, y, z = 0) => new THREE.Vector3(fx + x * s * f, fy + y * s, fz + z * s);
    /** @param {number[][]} pts @param {number} r0 @param {number} r1 @param {number} color @param {number} [z] */
    const limb = (pts, r0, r1, color, z = 0) => body.add(taperedTube(pts.map(([x, y]) => V(x, y, z)), r0 * s, r1 * s, 6, 5), { x: 0, y: 0, z: 0 }, color);

    const hip = 26 - 10 * h.crouch;
    const sh = hip + 15 - 3 * h.crouch;
    const dark = 0x15170f;

    limb([[-6, hip - 2], [-18, hip - 8], [-28, 4], [-36, 1]], 3.5, 0.7, P.hunterBody); // tail
    limb([[-4, hip], [-12, 6], [-20, 1]], 3.5, 2, dark, -4); // rear leg, knee down
    limb([[2, hip], [12, hip - 6], [10, 1]], 3.5, 2, P.hunterBody, 4); // front leg, knee up
    body.add(new THREE.BoxGeometry(8 * s, 3 * s, 5 * s), V(12, 1.5, 4), dark); // front foot
    body.add(new THREE.BoxGeometry(7 * s, 3 * s, 5 * s), V(-21, 1.5, -4), dark); // rear foot
    // torso leaning forward, armour plate on top
    const lean = Math.atan2(sh - hip, 12) * f;
    const torso = V(3, (hip + sh) / 2 + 1);
    body.add(new THREE.CapsuleGeometry(7 * s, 8 * s, 4, 10), torso, P.hunterBody, e.set(0, 0, lean - Math.PI / 2 * f));
    body.add(new THREE.BoxGeometry(16 * s, 4 * s, 14 * s), V(3, sh + 1), P.hunterArmour, e.set(0, 0, lean * 0.4));
    if (h.backpack) body.add(new THREE.BoxGeometry(10 * s, 13 * s, 11 * s), V(-7, sh - 3), 0x3a3d2c, e.set(0, 0, lean * 0.3));
    // head: skull sphere, snout cone forward, two swept-back horns
    const hx = 13, hy = sh + 6;
    body.add(new THREE.SphereGeometry(4.5 * s, 10, 8), V(hx, hy), P.hunterArmour);
    body.add(new THREE.ConeGeometry(3.4 * s, 11 * s, 8), V(hx + 7, hy - 0.5), P.hunterArmour, e.set(0, 0, -Math.PI / 2 * f));
    for (const [z, len] of [[-2.5, 12], [2.5, 14]]) {
      body.add(new THREE.ConeGeometry(1.3 * s, len * s, 6), V(hx - 6, hy + 5, z), 0x8f8a62, e.set(0, 0, (Math.PI / 2 + 0.6) * f));
    }
    glowParts.add(new THREE.SphereGeometry(1.1 * s, 6, 5), V(hx + 6, hy + 1.5, 3), P.amber, undefined, undefined, 2.5); // eye
    if (h.scarf) limb([[hx - 2, hy - 3], [hx - 12, hy - 1], [hx - 22, hy - 6], [hx - 30, hy - 3]], 2.5, 0.8, P.hunterScarf, 1);
    // rifle along the aim angle, held at the shoulder; arm to the grip
    const gx = 6, gy = sh - 2;
    const ca = Math.cos(-h.aim), sa = Math.sin(-h.aim);
    const tip = [gx + 34 * ca, gy + 34 * sa];
    const mid = V((gx - 4 + tip[0]) / 2, (gy + tip[1]) / 2, 5);
    body.add(new THREE.BoxGeometry(38 * s, 3 * s, 2.5 * s), mid, 0x1b1d1f, e.set(0, 0, -h.aim * f));
    body.add(new THREE.BoxGeometry(3 * s, 5 * s, 2.5 * s), V(gx + 7, gy - 3.5, 5), 0x1b1d1f);
    limb([[4, sh], [gx + 10, gy - 1]], 2, 1.6, P.hunterBody, 5);
    const muzzle = V(tip[0] + 2, tip[1], 5);
    glowParts.add(new THREE.SphereGeometry(1.8 * s, 8, 6), muzzle, 0xffe6b0, undefined, undefined, 3);
    glows.addLocal(muzzle, 9 * s, 7 * s, P.muzzle, 0.9);
  });

  const group = new THREE.Group();
  group.add(body.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, envMap: ctx.env, envMapIntensity: 0.5 })));
  group.add(glowParts.build(new THREE.MeshBasicMaterial({ vertexColors: true })));
  group.add(glows.build({ time: ctx.time, core: 0.3 }));
  return { object: group };
}
