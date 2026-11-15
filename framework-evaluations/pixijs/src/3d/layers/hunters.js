// @ts-check
// Two crouching hunters on the deck: simple primitives (extruded body plates, tapered tube
// limbs, tail and scarf, a rifle beam), built in a local frame (x forward, y up from the
// feet, in 2D units x scale) and placed on the sloped deck. Muzzle glints are glow sprites.

import { Container3D, Mesh3D } from '@pixi/3d';
import { MeshBuilder } from '../effects/builder.js';
import { createGlows, litVertexMaterial } from '../effects/materials.js';
import { D, deckTopAt } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createHunters(scene) {
  const P = scene.palette;
  /** @type {import('../stage.js').Node[]} */
  const nodes = [];
  const glows = createGlows(scene.hunters.length);
  const material = litVertexMaterial({ roughness: 0.55, metallic: 0.35 });
  scene.hunters.forEach((h, idx) => {
    const b = new MeshBuilder();
    const hip = 26 - 10 * h.crouch;
    const sh = hip + 15 - 3 * h.crouch;
    const body = P.hunterBody, armour = P.hunterArmour, dark = 0x15170f;
    /** @param {number[][]} pts @param {number} r0 @param {number} r1 @param {number} color @param {number} z */
    const limb = (pts, r0, r1, color, z) => b.tube(pts.map(([x, y]) => /** @type {[number, number, number]} */ ([x, y, z])), r0, color, { radiusEnd: r1, sides: 7 });
    /** @param {number[][]} pts @param {number} color @param {number} z0 @param {number} z1 */
    const plate = (pts, color, z0, z1) => b.prism(pts, z0, z1, color);

    limb([[-6, hip - 2], [-18, hip - 8], [-28, 4], [-36, 1]], 3.5, 0.8, body, 0); // tail
    limb([[-4, hip], [-12, 6], [-20, 1]], 3.5, 2, dark, -4); // rear leg
    limb([[2, hip], [12, hip - 6], [10, 1]], 3.5, 2, body, 4); // front leg
    plate([[8, 0], [16, 0], [14, 3], [8, 3]], dark, 2, 7);
    if (h.backpack) plate([[-12, sh + 6], [-2, sh + 9], [-1, hip + 2], [-13, hip + 1]], 0x3a3d2c, -6, 6);
    plate([[-8, hip - 3], [6, hip - 4], [14, sh - 1], [4, sh + 5], [-6, sh + 2]], body, -5, 5);
    plate([[-5, sh + 1], [4, sh + 4.5], [12, sh - 1], [9, sh - 4], [-2, sh - 2]], armour, -5.5, 5.5);
    const hx = 12, hy = sh + 6;
    plate([[hx - 3, hy - 3], [hx + 4, hy + 3], [hx + 14, hy], [hx + 13, hy - 3], [hx + 2, hy - 5]], armour, -3, 3);
    plate([[hx, hy + 2], [hx - 9, hy + 10], [hx + 3, hy + 4]], 0x8f8a62, 1.5, 3);
    plate([[hx + 3, hy + 2], [hx - 4, hy + 13], [hx + 6, hy + 4]], 0x8f8a62, -3, -1.5);
    b.box(hx + 6, hy - 0.5, 2.9, hx + 8.5, hy + 1.5, 3.2, P.amber);
    if (h.scarf) limb([[hx - 2, hy - 3], [hx - 12, hy - 1], [hx - 22, hy - 6], [hx - 30, hy - 3]], 2.5, 0.8, P.hunterScarf, 0);
    const gx = 6, gy = sh - 2;
    const ca = Math.cos(-h.aim), sa = Math.sin(-h.aim);
    const tip = [gx + 34 * ca, gy + 34 * sa];
    b.beam(gx - 4, gy, tip[0], tip[1], 3.2, 4, 7, 0x1b1d1f);
    b.box(gx + 6, gy - 6, 4.5, gx + 9, gy - 1, 6.5, 0x1b1d1f);
    limb([[4, sh], [gx + 10, gy - 1]], 1.8, 1.5, body, 5.5);

    // place: the hunter's feet stand on the deck at depth z, kept at the 2D size on screen
    const z = -48 - idx * 8;
    const k = (D - z) / D;
    const s = h.scale * k;
    const node = new Container3D({
      label: `hunter-${idx}`,
      position: { x: (h.x - 600) * k, y: deckTopAt(z), z },
      scale: { x: s * h.facing, y: s, z: s },
    });
    node.addChild(new Mesh3D({ geometry: b.build() ?? undefined, material }));
    nodes.push(node);
    glows.add((h.x - 600) * k + (tip[0] + 2) * s * h.facing, deckTopAt(z) + tip[1] * s, z + 8, 14 * s, P.muzzle, 0.9);
  });
  glows.upload();
  nodes.push(glows.node);
  return { nodes };
}
