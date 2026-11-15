// @ts-check
// Sodium-amber lamps: fixtures, additive halos, light pools on the nearest surface
// below each lamp, and smeared vertical reflections on the wet deck.
// The number of lamps comes from stress.lights. Two instanced draws for all glows.

import { ShapeBatch } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { ORDER } from '../stage.js';
import { isFlickering } from '@fw-eval/shared/scene.js';

/**
 * Surfaces a lamp can light (y of the walking surface and its x range).
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 */
function surfaces(scene) {
  const deck = scene.bridge.deck;
  return [
    { x0: deck.x, x1: deck.x + deck.w, y: deck.y, h: deck.h },
    ...scene.structures.platforms.map((p) => ({ x0: p.x, x1: p.x + p.w, y: p.y, h: 4 })),
  ];
}

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createLights(scene, ctx) {
  const P = scene.palette;
  const fixtures = new ShapeBatch();
  const halos = new GlowBatch();
  const pools = new GlowBatch();
  const surf = surfaces(scene);

  scene.lamps.forEach((lamp, i) => {
    const blink = isFlickering(i) ? BLINK.flicker : BLINK.steady;
    // fixture shape by kind
    if (lamp.kind === 'post') {
      fixtures.rect(lamp.x - 1.5, lamp.y, 3, 18, P.gunmetalLight);
      fixtures.rect(lamp.x - 4, lamp.y - 6, 8, 7, 0x1a1a1c);
      fixtures.rect(lamp.x - 3, lamp.y - 4, 6, 4, P.amberPale);
    } else if (lamp.kind === 'wall') {
      fixtures.rect(lamp.x - 10, lamp.y - 3, 20, 5, 0x1a1a1c);
      fixtures.rect(lamp.x - 8, lamp.y, 16, 2.5, P.amberPale);
    } else {
      fixtures.rect(lamp.x - 9, lamp.y - 3, 18, 4, 0x1a1a1c);
      fixtures.rect(lamp.x - 7, lamp.y, 14, 2, P.amberPale);
    }
    halos.add(lamp.x, lamp.y, lamp.radius, lamp.radius * 0.8, lamp.color, lamp.intensity * 0.8, blink, i);

    // light pool on the first surface below the lamp, and a wet reflection streak
    const s = surf.find((q) => lamp.x >= q.x0 && lamp.x <= q.x1 && q.y >= lamp.y - 2 && q.y - lamp.y < 140);
    if (s) {
      const dist = Math.max(4, s.y - lamp.y);
      const w = lamp.radius * (0.7 + dist / 120);
      pools.add(lamp.x, s.y + s.h * 0.4, w, s.h * 0.9 + 2, lamp.color, lamp.intensity * 0.9, blink, i);
      // vertical smear: the lamp reflected in standing water, stretched downward
      pools.add(lamp.x, s.y + s.h + 6, 5, 16, P.amberPale, lamp.intensity * 0.35, blink, i);
    }
    // wall/underside lamps also wash the structure behind them downward
    if (lamp.kind !== 'post') pools.add(lamp.x, lamp.y + lamp.radius * 0.35, lamp.radius * 0.6, lamp.radius * 0.6, lamp.color, lamp.intensity * 0.35, blink, i);
  });

  return {
    parts: [
      { object: fixtures.build(ORDER.lightPools - 1), depth: 0 },
      { object: pools.build(ORDER.lightPools, { time: ctx.time }), depth: 0 },
      { object: halos.build(ORDER.glows, { time: ctx.time, core: 0.06 }), depth: 0 },
    ],
  };
}
