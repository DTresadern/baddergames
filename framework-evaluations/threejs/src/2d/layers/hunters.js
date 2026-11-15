// @ts-check
// Two crouching hunter figures on the bridge: simple procedural stand-ins built from
// polygons and thick lines (tail, legs, torso, horned head, rifle, optional backpack/scarf).

import * as THREE from 'three';
import { ShapeBatch } from '../effects/batch.js';
import { GlowBatch } from '../effects/glow.js';
import { ORDER } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createHunters(scene, ctx) {
  const P = scene.palette;
  const b = new ShapeBatch();
  const glows = new GlowBatch();

  for (const h of scene.hunters) {
    const s = h.scale, f = h.facing;
    /** local (x right, y up from the feet) -> world @param {number} lx @param {number} ly */
    const W = (lx, ly) => ({ x: h.x + lx * s * f, y: h.y - ly * s });
    /** @param {number[][]} pts */
    const poly = (pts, /** @type {number} */ color, alpha = 1) => b.polygon(pts.map(([x, y]) => W(x, y)), color, alpha);
    /** @param {number[][]} pts @param {number} w0 @param {number} w1 @param {number} color */
    const limb = (pts, w0, w1, color) => b.polyline(pts.map(([x, y]) => W(x, y)), w0 * s, w1 * s, color);

    const hip = 26 - 10 * h.crouch; // hip height
    const sh = hip + 15 - 3 * h.crouch; // shoulder height
    const body = P.hunterBody, armour = P.hunterArmour, dark = 0x15170f;

    limb([[-6, hip - 2], [-18, hip - 8], [-28, 4], [-36, 1]], 7, 1.5, body); // tail
    limb([[-4, hip], [-12, 6], [-20, 1]], 7, 4, dark); // rear leg, knee down
    limb([[2, hip], [12, hip - 6], [10, 1]], 7, 4, body); // front leg, knee up
    poly([[8, 0], [16, 0], [14, 3], [8, 3]], dark); // front foot
    if (h.backpack) poly([[-12, sh + 6], [-2, sh + 9], [-1, hip + 2], [-13, hip + 1]], 0x3a3d2c);
    // torso leaning forward, armour plates on top
    poly([[-8, hip - 3], [6, hip - 4], [14, sh - 1], [4, sh + 5], [-6, sh + 2]], body);
    poly([[-5, sh + 1], [4, sh + 4.5], [12, sh - 1], [9, sh - 4], [-2, sh - 2]], armour);
    // head: snout forward, horns swept back
    const hx = 12, hy = sh + 6;
    poly([[hx - 3, hy - 3], [hx + 4, hy + 3], [hx + 14, hy], [hx + 13, hy - 3], [hx + 2, hy - 5]], armour);
    poly([[hx, hy + 2], [hx - 9, hy + 10], [hx + 3, hy + 4]], 0x8f8a62); // horn
    poly([[hx + 3, hy + 2], [hx - 4, hy + 13], [hx + 6, hy + 4]], 0x8f8a62); // horn
    b.circle(W(hx + 7, hy + 0.5).x, W(hx + 7, hy + 0.5).y, 1.1 * s, P.amber);
    if (h.scarf) {
      limb([[hx - 2, hy - 3], [hx - 12, hy - 1], [hx - 22, hy - 6], [hx - 30, hy - 3]], 5, 1.5, P.hunterScarf);
    }
    // rifle along the aim angle, held at the shoulder
    const gx = 6, gy = sh - 2;
    const ca = Math.cos(-h.aim), sa = Math.sin(-h.aim);
    const tip = [gx + 34 * ca, gy + 34 * sa];
    limb([[gx - 4, gy], tip], 3.2, 2.2, 0x1b1d1f);
    poly([[gx + 6, gy - 1], [gx + 9, gy - 1], [gx + 9, gy - 6], [gx + 6, gy - 6]], 0x1b1d1f); // grip
    limb([[4, sh], [gx + 10, gy - 1]], 3.5, 3, body); // arm
    // amber rim light from the deck lamps on top edges
    limb([[-6, sh + 2.5], [4, sh + 5.5], [13, sh]], 1, 0.6, 0xc89a5a);
    const muzzle = W(tip[0] + 2, tip[1]);
    glows.add(muzzle.x, muzzle.y, 9 * s, 7 * s, P.muzzle, 0.9);
    b.circle(muzzle.x, muzzle.y, 1.6 * s, 0xffe6b0);
    // contact shadow on the wet deck
    b.circle(h.x - 6 * f, h.y + 1, 26 * s, 0x000000, 0.35, 16, 0, Math.PI * 2, 2.5);
  }

  const group = new THREE.Group();
  group.add(b.build(ORDER.hunters), glows.build(ORDER.hunters + 0.5, { time: ctx.time, core: 0.3 }));
  return { parts: [{ object: group, depth: 0 }] };
}
