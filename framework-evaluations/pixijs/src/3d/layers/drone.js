// @ts-check
// Patrol drone (depth 0.5) with a real SpotLight and a visible additive light cone.
// The drone flies behind the foreground plane, so the searchlight is aimed in 3D at the
// point on the deck that the 2D cone reaches; the beam then lights the deck, crates and
// hunters, and its projection matches the 2D cone.

import { Container3D, FlatMaterial, Mesh3D, SpotLight } from '@pixi/3d';
import { droneState } from '@fw-eval/shared/scene.js';
import { MeshBuilder } from '../effects/batch.js';
import { createGlows } from '../effects/glow.js';
import { litVertexMaterial } from '../effects/materials.js';
import { DECK, S, X, Y, Z } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createDrone(scene, ctx) {
  const P = scene.palette;
  const dr = scene.drone;
  const d = dr.depth;

  // body in a local frame of world units at the drone's depth (scaled by the container)
  const b = new MeshBuilder();
  const w = dr.bodyW, h = dr.bodyH;
  b.box(-w / 2, -h / 2, -10, w / 2, h / 2, 10, P.gunmetal, { top: P.gunmetalLight, back: true });
  b.box(-w / 2 + 6, h / 2, -6, w / 2 - 6, h / 2 + 5, 6, P.gunmetalLight);
  b.box(-w / 2 - 14, h / 2 - 2, -2, w / 2 + 14, h / 2 + 1, 2, P.gunmetalDark); // rotor arms
  for (const sx of [-w / 2 - 12, w / 2 + 12]) {
    b.cylinder(sx, 0, 2, h / 2, h / 2 + 6, P.gunmetalDark, 6);
    b.ellipsoid([sx, h / 2 + 6, 0], [13, 1, 13], P.steelHighlight, { seg: 12 }); // rotor disc
  }
  b.box(-6, -h / 2 - 8, -4, 6, -h / 2, 4, P.gunmetalDark); // gimbal
  b.box(w / 2 - 2, -4, -5, w / 2 + 4, 4, 5, P.gunmetalDark); // lamp housing
  const body = new Container3D({ label: 'drone', scale: { x: 1 + d, y: 1 + d, z: 1 + d } });
  body.addChild(new Mesh3D({ geometry: b.build() ?? undefined, material: litVertexMaterial({ roughness: 0.4, metallic: 0.7 }), castShadow: false }));

  // visible cone: unit cone along +Z (apex at origin, length 1), alpha fades to the far end
  const c = new MeshBuilder();
  const segs = 24, rad = Math.tan(dr.coneHalfAngle);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    // one strip quad per segment, split along the length for a smoother fade
    for (let k = 0; k < 4; k++) {
      const f0 = k / 4, f1 = (k + 1) / 4;
      const base = c.vertexCount;
      for (const [f, a] of [[f0, a0], [f0, a1], [f1, a1], [f1, a0]]) {
        c.alpha = 0.22 * (1 - f) ** 1.5;
        c.vert([Math.cos(a) * rad * f, Math.sin(a) * rad * f, f], [0, 0, 1], [1, 0.85, 0.62]);
      }
      c.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const coneMat = new FlatMaterial({ baseColor: dr.color, vertexColors: true, alphaMode: 'blend', doubleSided: true });
  coneMat.state.blendMode = 'add';
  const cone = new Mesh3D({ geometry: c.build() ?? undefined, material: coneMat, castShadow: false, receiveShadow: false });
  cone.label = 'drone-cone';

  const spot = new SpotLight({
    color: dr.color,
    intensity: 2.6e6,
    range: 2200,
    coneAngle: (dr.coneHalfAngle * 180) / Math.PI * 1.6,
    penumbra: 0.5,
    castShadow: true,
  });
  const glows = createGlows(2);
  const target = { x: 0, y: 0, z: 0 };

  return {
    nodes: [spot, body, cone, glows.node],
    update(t) {
      const s = droneState(scene, t);
      const px = X(s.x, d), py = Y(s.y, d), pz = Z(d);
      body.position.set(px, py, pz);
      body.rotation.z = -s.tilt;
      // lamp position (front of the housing) and the 2D cone's end, landed on the deck
      const lx = s.x + (w / 2 + 4) * Math.cos(s.tilt), ly = s.y + (w / 2 + 4) * Math.sin(s.tilt);
      const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
      const len = dy > 0.05 ? Math.min(dr.coneLength * 1.4, (DECK.backY - ly) / dy) : dr.coneLength;
      const tx = lx + dx * len, ty = ly + dy * len;
      target.x = X(tx); target.y = Y(ty); target.z = DECK.backZ / 2;
      const ax = X(lx, d), ay = Y(ly, d);
      spot.position.set(ax, ay, pz);
      spot.lookAt(target);
      cone.position.set(ax, ay, pz);
      cone.lookAt(target);
      const dist = Math.hypot(target.x - ax, target.y - ay, target.z - pz);
      cone.scale.set(dist, dist, dist);
      ctx.cone.x = lx; ctx.cone.y = ly; ctx.cone.angle = s.angle; ctx.cone.half = dr.coneHalfAngle;
      glows.slots.length = 0;
      glows.add(ax, ay, pz + S(6, d), S(30, d), P.amberPale, 0.95);
      glows.add(px - S(w / 2 + 12, d), Y(s.y - h / 2 - 4, d), pz + S(4, d), S(8, d), P.warningRed, 0.5 + 0.5 * Math.sin(t * 5) ** 2);
      glows.upload();
    },
  };
}
