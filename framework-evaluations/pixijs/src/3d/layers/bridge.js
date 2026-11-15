// @ts-check
// Elevated walkway: wet deck slab (low roughness), hazard-striped front band, girder,
// pillars with braces, sagging cables, red warning lights (blinking), railings.

import { Mesh3D } from '@pixi/3d';
import { redBlink } from '@fw-eval/shared/scene.js';
import { MeshBuilder } from '../effects/builder.js';
import { createGlows, litVertexMaterial } from '../effects/materials.js';
import { DECK, P3, X, Y } from '../stage.js';
import { Material3D } from '@pixi/3d';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createBridge(scene) {
  const P = scene.palette;
  const br = scene.bridge;
  const m = new MeshBuilder();
  const deck = new MeshBuilder();
  const stripes = new MeshBuilder();
  const reds = new MeshBuilder();
  const x0 = br.deck.x, x1 = br.deck.x + br.deck.w;

  // ---- deck slab: sloped wet top, plus a thin back lip
  {
    const fl = P3(x0, DECK.frontY, DECK.frontZ), fr = P3(x1, DECK.frontY, DECK.frontZ);
    const bl = P3(x0, DECK.backY, DECK.backZ), brr = P3(x1, DECK.backY, DECK.backZ);
    // panels: split the top into plates with slightly different tones (seams read as tiles)
    const plates = 20;
    for (let i = 0; i < plates; i++) {
      const a = i / plates, b = (i + 1) / plates;
      const lerp = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ f) => /** @type {[number, number, number]} */ ([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2]]);
      const tone = i % 3 === 0 ? 0x4a5058 : i % 3 === 1 ? 0x535963 : 0x454a52;
      const g = 0.6; // seam gap in world units
      deck.quad(lerp(fl, fr, a), lerp(fl, fr, b - g / 800), lerp(bl, brr, b - g / 800), lerp(bl, brr, a), tone);
    }
  }
  // the deck's front edge face down to the stripe band
  m.box(X(x0), Y(br.stripeBand.y), -6, X(x1), Y(DECK.frontY), 0, P.gunmetalLight);

  // ---- hazard stripe band: slanted parallelograms on the front face
  {
    const sb = br.stripeBand, z = 0.5;
    stripes.box(X(sb.x), Y(sb.y + sb.h), -8, X(sb.x + sb.w), Y(sb.y), z - 0.2, P.hazardBlack);
    for (let x = sb.x - br.stripeSlant; x < sb.x + sb.w; x += br.stripeSpacing) {
      const w = br.stripeSpacing / 2;
      const xa = Math.max(sb.x, x), xb = Math.min(sb.x + sb.w, x + w);
      if (xb <= xa) continue;
      // bottom edge at x, top edge shifted right by the slant
      const s = br.stripeSlant;
      stripes.quad([X(Math.max(sb.x, x)), Y(sb.y + sb.h), z], [X(Math.min(sb.x + sb.w, x + w)), Y(sb.y + sb.h), z],
        [X(Math.min(sb.x + sb.w, x + w + s)), Y(sb.y), z], [X(Math.max(sb.x, x + s)), Y(sb.y), z], P.hazardYellow, [0, 0, 1]);
    }
  }

  // ---- girder with vents and lamp housings
  const gd = br.girder;
  m.box(X(gd.x), Y(gd.y + gd.h), -70, X(gd.x + gd.w), Y(gd.y), -2, P.gunmetal, { top: P.gunmetalDark });
  for (let x = 40; x < 740; x += 120) m.box(X(x), Y(gd.y + 16), -2, X(x + 40), Y(gd.y + 6), 1, P.gunmetalDark);
  for (let x = gd.x; x < gd.x + gd.w; x += 50) m.box(X(x), Y(gd.y + gd.h), -3, X(x + 3), Y(gd.y), 0.5, P.gunmetalLight);

  // ---- pillars, braces
  for (const p of br.pillars) {
    m.box(X(p.x), Y(p.y + p.h + 20), -60, X(p.x + p.w), Y(p.y), -12, P.gunmetal, { front: 0x2e3238 });
    m.box(X(p.x + 4), Y(p.y + p.h + 20), -14, X(p.x + 8), Y(p.y), -10, P.gunmetalLight);
  }
  for (const [ax, ay, bx, by] of br.braces) m.beam(X(ax), Y(ay), X(bx), Y(by), 7, -40, -20, P.gunmetalDark);

  // ---- cables: sagging tubes through the three points
  for (const cable of br.cables) {
    /** @type {[number, number, number][]} */
    const pts = [];
    const [a, b, c] = cable;
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      // quadratic through a, b (at t = 0.5) and c
      const qx = 2 * b.x - 0.5 * (a.x + c.x), qy = 2 * b.y - 0.5 * (a.y + c.y);
      const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * qx + t * t * c.x;
      const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * qy + t * t * c.y;
      pts.push([X(x), Y(y), -6]);
    }
    m.tube(pts, 1.4, 0x0b0c0e, { sides: 5 });
  }

  // ---- red warning lights: housings + emissive lens + blinking glow
  const glows = createGlows(br.redLights.length);
  for (const r of br.redLights) {
    m.box(X(r.x - 4), Y(r.y + 5), -12, X(r.x + 4), Y(r.y - 5), -2, P.gunmetalDark);
    reds.box(X(r.x - 2.5), Y(r.y + 2.5), -2, X(r.x + 2.5), Y(r.y - 2.5), 1, P.warningRed);
    glows.add(X(r.x), Y(r.y), 4, r.radius * 2.4, P.warningRed, 0.9);
  }

  // ---- railings: posts + two rails, set back on the deck or platform
  const rail = new MeshBuilder();
  for (const r of scene.railings) {
    const z = r.y === DECK.backY ? DECK.backZ + 4 : -58;
    const post = 2;
    for (let x = r.x0; x <= r.x1 + 0.1; x += r.postSpacing) {
      const a = P3(x, r.y, z), b = P3(x + post, r.y - r.h, z);
      rail.box(a[0], a[1], z - 2, b[0], b[1], z, 0x8a6d1c);
    }
    for (const f of [1, 0.5]) {
      const a = P3(r.x0, r.y - r.h * f, z), b = P3(r.x1 + post, r.y - r.h * f + 2, z);
      rail.box(a[0], b[1], z - 2.4, b[0], a[1], z + 0.4, f === 1 ? P.hazardYellow : 0x8a6d1c);
    }
  }

  const nodes = [
    new Mesh3D({ geometry: m.build() ?? undefined, material: litVertexMaterial({ roughness: 0.6, metallic: 0.5 }) }),
    // the wet walking surface: smooth and metallic so the lamps and sky show in it
    new Mesh3D({ geometry: deck.build() ?? undefined, material: new Material3D({ baseColor: 0xffffff, vertexColors: true, roughness: 0.07, metallic: 0.85 }), castShadow: false }),
    new Mesh3D({ geometry: stripes.build() ?? undefined, material: litVertexMaterial({ roughness: 0.35, metallic: 0.2 }), castShadow: false }),
    new Mesh3D({ geometry: rail.build() ?? undefined, material: litVertexMaterial({ roughness: 0.4, metallic: 0.6 }) }),
    new Mesh3D({ geometry: reds.build() ?? undefined, material: new Material3D({ baseColor: 0x200000, emissive: { color: P.warningRed, strength: 2.5 } }), castShadow: false }),
    glows.node,
  ];
  return {
    nodes,
    update(t) { glows.upload((i) => redBlink(i, t)); },
  };
}
