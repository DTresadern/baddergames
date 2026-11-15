// @ts-check
// Background megacity: tiered building silhouettes with lit windows, one Graphics per
// depth layer, each followed by a ground-fog band so haze builds up with distance.

import { ShapeBatch } from '../effects/batch.js';
import { ORDER } from '../stage.js';
import { hazed, hazeAt, lerpColor } from '@fw-eval/shared/scene.js';

/** draw order of each scene.city layer (far to near) and its fog band */
const LAYER_ORDER = [
  [ORDER.cityFar, ORDER.hazeFar],
  [ORDER.cityMid, ORDER.hazeMid],
  [ORDER.cityNear, ORDER.hazeNear],
  [ORDER.cityLow, ORDER.hazeLow],
];

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createCity(scene) {
  const P = scene.palette;
  /** @type {import('../stage.js').Part[]} */
  const parts = [];
  scene.city.forEach((layer, li) => {
    const [order, fogOrder] = LAYER_ORDER[li] ?? LAYER_ORDER[LAYER_ORDER.length - 1];
    const d = layer.depth;
    const body = hazed(scene, layer.color, d);
    const bodyLow = hazed(scene, layer.color, d + 2.5);
    const rim = hazed(scene, P.gunmetalLight, d);
    const win = hazed(scene, P.windowLit, d * 0.45);
    const winDim = hazed(scene, P.windowDim, d * 0.6);
    const b = new ShapeBatch();
    for (const bld of layer.buildings) {
      for (const tier of bld.tiers) {
        b.rect(tier.x, tier.y, tier.w, tier.h, [body, bodyLow]);
        if (tier.dome) b.circle(tier.x + tier.w / 2, tier.y, tier.w / 2, body, 1, 18, Math.PI, Math.PI * 2);
        // thin lighter roof edge and a ledge between tiers
        b.rect(tier.x, tier.y, tier.w, 1.5, rim, 0.7);
        // vertical structural ribs
        const ribs = Math.floor(tier.w / 26);
        for (let r = 1; r <= ribs; r++) b.rect(tier.x + (tier.w * r) / (ribs + 1), tier.y, 1.5, tier.h, rim, 0.25);
        const w = tier.windows;
        for (let i = 0; i < w.lit.length; i++) {
          const c = i % w.cols, r = Math.floor(i / w.cols);
          const x = w.x0 + c * w.dx, y = w.y0 + r * w.dy;
          if (w.lit[i]) b.rect(x, y, w.ww, w.wh, win, 0.95);
          else if ((i * 7 + r) % 9 === 0) b.rect(x, y, w.ww, w.wh, winDim, 0.35);
        }
      }
      for (const a of bld.antennas) {
        const top = bld.tiers[bld.tiers.length - 1].y;
        b.rect(a.x - 0.75, a.top, 1.5, top - a.top, body);
        b.rect(a.x - 1.5, a.top - 1.5, 3, 3, hazed(scene, P.warningRed, d * 0.5));
      }
    }
    parts.push({ object: b.build(order), depth: d });

    // ground fog in front of this layer: transparent at the top, haze colour at the bottom
    const h = hazeAt(scene, d);
    const fog = new ShapeBatch();
    const fogTop = 150 + li * 25;
    fog.rect(-80, fogTop, scene.world.width + 160, scene.world.height - fogTop,
      [h.color, lerpColor(h.color, P.skyHorizon, 0.4)], 0, 0.1 + h.opacity * 0.2);
    parts.push({ object: fog.build(fogOrder), depth: d });
  });
  return { parts };
}
