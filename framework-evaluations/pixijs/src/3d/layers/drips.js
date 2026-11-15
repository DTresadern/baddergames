// @ts-check
// Water dripping from the deck and platform edges: one glow-free ParticleContainer3D,
// written each frame from dripState(). Each drip is a short trail of three dots stretched
// along its fall, since particle quads are square.

import { ParticleContainer3D, packParticleColor } from '@pixi/3d';
import { dripState } from '@fw-eval/shared/scene.js';
import { softDot } from '../effects/glow.js';
import { X, Y } from '../stage.js';

const TRAIL = 3;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createDrips(scene) {
  const drips = scene.drips.drips;
  const dots = new ParticleContainer3D({ texture: softDot(), capacity: drips.length * TRAIL, blendMode: 'add' });
  dots.label = 'drips';
  const water = scene.drips.color;
  return {
    nodes: [dots],
    update(t) {
      let slot = 0;
      for (const drip of drips) {
        const s = dripState(scene, drip, t);
        for (let k = 0; k < TRAIL; k++) {
          // trail points back up along the fall, spaced by the current speed
          const y = s.y - k * Math.min(6, s.speed * 0.008);
          const alpha = s.visible ? 0.75 * (1 - k / TRAIL) : 0;
          dots.writePacked(slot++, X(s.x), Y(y), 4, alpha > 0 ? 4.5 - k : 0, 0, packParticleColor(water, alpha));
        }
      }
      dots.upload();
    },
  };
}
