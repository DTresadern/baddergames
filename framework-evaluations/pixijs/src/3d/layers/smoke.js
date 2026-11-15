// @ts-check
// Smoke stacks: lit chimney cylinders plus rising smoke puffs.
// Puffs are a ParticleContainer3D (camera-facing quads, one draw) written every frame from
// smokeParticle(), so the smoke is identical in every build and freezes with `?t=`.
// ParticleSystem3D (extras) simulates on its own clock and was not used for that reason.

import { Mesh3D, ParticleContainer3D, packParticleColor } from '@pixi/3d';
import { smokeParticle } from '@fw-eval/shared/scene.js';
import { MeshBuilder } from '../effects/batch.js';
import { softDot } from '../effects/glow.js';
import { litVertexMaterial } from '../effects/materials.js';
import { S, X, Y, Z } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createSmoke(scene) {
  const P = scene.palette;
  const stacks = scene.smokeStacks;
  const chimneys = new MeshBuilder();
  let capacity = 0;
  for (const s of stacks) {
    const d = s.depth;
    chimneys.cylinder(X(s.x, d), Z(d) - S(s.w, d), S(s.w / 2, d), Y(s.y + s.h, d), Y(s.y, d), P.gunmetal, 10);
    // red aircraft light on top
    chimneys.box(X(s.x - 1.5, d), Y(s.y + 1, d), Z(d) - S(s.w, d), X(s.x + 1.5, d), Y(s.y - 2, d), Z(d) - S(s.w / 2 - 2, d), P.warningRedDeep);
    capacity += Math.ceil(s.rate * s.life);
  }
  const puffs = new ParticleContainer3D({ texture: softDot(), capacity, blendMode: 'normal' });
  puffs.label = 'smoke';
  return {
    parts: [new Mesh3D({ geometry: chimneys.build() ?? undefined, material: litVertexMaterial({ roughness: 0.7, metallic: 0.3 }) }), puffs],
    info: { smokeParticles: capacity },
    update(t) {
      let slot = 0;
      for (const s of stacks) {
        const d = s.depth;
        const n = Math.ceil(s.rate * s.life);
        for (let i = 0; i < n; i++) {
          const p = smokeParticle(s, i, t);
          // the soft dot fades early, so the quad is drawn about twice the 2D puff size
          puffs.writePacked(slot++, X(p.x, d), Y(p.y, d), Z(d) - S(s.w, d), S(p.size * 2.2, d), p.rotation, packParticleColor(P.smoke, Math.min(1, p.alpha * 0.9)));
        }
      }
      puffs.upload();
    },
  };
}
