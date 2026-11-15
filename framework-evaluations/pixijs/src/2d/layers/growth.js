// @ts-check
// Rock lower right (and a low mound at the bottom centre) overgrown with red organic
// tendrils and glowing pods.

import { Container } from 'pixi.js';
import { ShapeBatch } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { ORDER } from '../stage.js';
import { makeRng } from '@fw-eval/shared/rng.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createGrowth(scene, ctx) {
  const P = scene.palette;
  const g = scene.growth;
  const b = new ShapeBatch();
  const rng = makeRng(scene.seed * 31 + 7); // only for surface texture detail

  for (const outline of [g.rock, g.mound]) {
    b.polygon(outline, P.rock);
    // lit, wet ridge line along the top edge (skip the closing points at the bottom)
    const ridge = outline.filter((p) => p.y < 399);
    b.polyline(ridge, 3, 3, P.rockLight, 0.9);
    b.polyline(ridge.map((p) => ({ x: p.x, y: p.y - 1 })), 1, 1, 0x9aa6b8, 0.35);
  }
  // boulders and strata inside the rock mass
  for (let i = 0; i < 40; i++) {
    const x = rng.range(860, 1200), y = rng.range(300, 400);
    if (!inside(g.rock, x, y - 8)) continue;
    b.circle(x, y, rng.range(5, 14), rng.chance(0.5) ? P.rockLight : 0x1d1916, 0.7, 7, 0, Math.PI * 2, rng.range(3, 8));
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.range(580, 840), y = rng.range(370, 400);
    b.circle(x, y, rng.range(4, 10), P.rockLight, 0.6, 7, 0, Math.PI * 2, rng.range(2, 5));
  }

  // tendrils: dark outline pass, then the flesh colour, then a thin wet highlight
  for (const td of g.tendrils) b.polyline(td.points, td.width * 1.8 + 1.5, 1.2, 0x1a0306);
  for (const td of g.tendrils) b.polyline(td.points, td.width * 1.8, 0.8, P.growthMid);
  for (const td of g.tendrils) b.polyline(td.points, td.width * 0.45, 0.3, 0xa02a2a, 0.45);

  // fleshy masses where the growth is thickest (around the pods)
  for (const p of g.pods) b.circle(p.x, p.y + 2, p.r * 2.4, P.growth, 0.95, 14, 0, Math.PI * 2, p.r * 1.6);

  const glows = new GlowBatch();
  g.pods.forEach((p, i) => {
    b.circle(p.x, p.y, p.r, P.growth, 1, 14);
    b.circle(p.x, p.y, p.r * 0.65, 0xc02a1a, 1, 12);
    b.circle(p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.25, 0xffb090, 0.6, 8);
    glows.add(p.x, p.y, p.r * 3, p.r * 2.6, g.glow, 0.3, BLINK.pulse, i);
  });

  const group = new Container();
  group.addChild(b.build(ORDER.growth), glows.build(ORDER.growth + 0.5, { ctx }));
  return { parts: [{ object: group, depth: g.depth }] };
}

/**
 * Point-in-polygon (even-odd rule).
 * @param {{x: number, y: number}[]} poly @param {number} x @param {number} y
 */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
