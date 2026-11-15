// @ts-check
// Crates and barrels on the deck and platforms (count scales with stress.objects).
// All in one batched mesh.

import { ShapeBatch } from '../effects/batch.js';
import { ORDER } from '../stage.js';
import { lerpColor } from '@fw-eval/shared/scene.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createClutter(scene) {
  const P = scene.palette;
  const b = new ShapeBatch();
  scene.clutter.forEach((it, i) => {
    const light = lerpColor(it.tint, 0xffffff, 0.18);
    const dark = lerpColor(it.tint, 0x000000, 0.45);
    if (it.kind === 'crate') {
      b.rect(it.x, it.y, it.w, it.h, [light, it.tint]);
      // reinforced frame
      const f = Math.max(2, Math.min(it.w, it.h) * 0.12);
      b.rect(it.x, it.y, it.w, f, dark); b.rect(it.x, it.y + it.h - f, it.w, f, dark);
      b.rect(it.x, it.y, f, it.h, dark); b.rect(it.x + it.w - f, it.y, f, it.h, dark);
      if (i % 3 === 0) {
        // hazard strip on every third crate
        for (let x = it.x + f; x < it.x + it.w - f - 3; x += 6) b.quad([x, it.y + it.h * 0.42, x + 3, it.y + it.h * 0.42, x + 5, it.y + it.h * 0.58, x + 2, it.y + it.h * 0.58], P.hazardYellow, 0.85);
      } else {
        b.line(it.x + f, it.y + f, it.x + it.w - f, it.y + it.h - f, f * 0.7, dark);
      }
      b.rect(it.x, it.y, it.w, 1.2, 0xc8d0dc, 0.35); // wet top edge
    } else {
      // barrel: body, rounded top, ribs, vertical highlight
      b.rect(it.x, it.y + 2, it.w, it.h - 2, [light, it.tint]);
      b.circle(it.x + it.w / 2, it.y + 2, it.w / 2, light, 1, 12, Math.PI, Math.PI * 2, 2);
      b.rect(it.x, it.y + it.h * 0.3, it.w, 1.5, dark);
      b.rect(it.x, it.y + it.h * 0.7, it.w, 1.5, dark);
      b.rect(it.x + it.w * 0.25, it.y + 2, 1.5, it.h - 3, 0xffd0c0, 0.35);
      b.rect(it.x + it.w * 0.15, it.y + it.h * 0.42, it.w * 0.7, it.h * 0.16, 0xd8d8d8, 0.55); // label band
    }
    // contact shadow
    b.rect(it.x - 1, it.y + it.h - 1, it.w + 2, 2, 0x000000, 0.4);
  });
  return { parts: [{ object: b.build(ORDER.clutter), depth: 0 }] };
}
