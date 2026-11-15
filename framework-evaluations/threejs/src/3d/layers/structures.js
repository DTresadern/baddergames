// @ts-check
// Foreground structures: left machinery tower, right fan tower, stairs, stepped
// platforms (wet tops, hazard-striped fronts), struts, ladders, railings, ground pipes,
// and the mid-distance dome building.
//
// The towers stand behind the walkways (their front face at Z = -DECK_DEPTH), so they get
// their own depthGroup(DECK_DEPTH / D) to keep the 2D composition. Everything else is
// in the depth-0 group with real Z extents.

import * as THREE from 'three';
import { InstanceBatch, MergeBatch, UNIT } from '../effects/batch.js';
import { wetMaterial, stripeMaterial, slab } from '../effects/materials.js';
import { depthGroup, lx, ly, D, DECK_DEPTH, DECK_FRONT_DROP } from '../stage.js';

export const RAIL = 0x9c7a26; // dull ochre railing paint
export const RAIL_DARK = 0x5a4718;

/**
 * Walking-surface y (2D, y down) at the front top edge of a structure whose 2D top is y.
 * The deck line (196) drops by DECK_FRONT_DROP so its wet top is visible from the raised
 * camera; platforms show a 4-unit wet strip like the 2D build.
 * @param {number} y
 */
export function surfaceY(y) {
  return y === 196 ? y + DECK_FRONT_DROP : y + 4;
}

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createStructures(scene, ctx) {
  const P = scene.palette;
  const st = scene.structures;
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.6, envMap: ctx.env, envMapIntensity: 0.5 });
  const emissive = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // ---- mid-distance dome building behind the platforms
  {
    const dm = st.dome;
    const g = depthGroup(dm.depth);
    const b = new InstanceBatch(UNIT.box);
    const domeB = new InstanceBatch(UNIT.sphere);
    const wins = new InstanceBatch(UNIT.box);
    const baseY = dm.y + 45;
    domeB.add({ x: lx(dm.x + dm.w / 2), y: ly(baseY), z: -dm.w / 2 }, new THREE.Euler(), { x: dm.w, y: 90, z: dm.w }, P.navy);
    b.box(dm.x, baseY, dm.w, dm.h + 60, 0, dm.w, P.navy);
    b.box(dm.x - 3, baseY - 2, dm.w + 6, 4, 2, dm.w + 4, P.gunmetalLight);
    for (let x = dm.x + 8; x < dm.x + dm.w - 8; x += 9) {
      wins.box(x, baseY + 8, 5, 3, 0.5, 1, P.windowLit, 1.4);
      if ((x | 0) % 3) wins.box(x, baseY + 22, 5, 3, 0.5, 1, P.windowLit, 0.9);
    }
    g.add(b.build(metal), domeB.build(metal), wins.build(emissive));
    root.add(g);
  }

  // ---- towers behind the walkways
  const back = depthGroup(DECK_DEPTH / D);
  const tb = new InstanceBatch(UNIT.box);
  const tp = new InstanceBatch(UNIT.cylinder);
  const tglow = new InstanceBatch(UNIT.box);
  const lt = st.leftTower;
  const L = lt.lattice;
  tb.box(lt.x, lt.y - 40, lt.w, lt.h + 40, -8, 160, 0x1d2025);
  tb.box(L.x + L.w + 4, lt.y - 40, lt.x + lt.w - (L.x + L.w + 4), lt.h + 40, 0, 10, P.gunmetal);
  for (const pnl of lt.panels) {
    tb.box(pnl.x, pnl.y, pnl.w, pnl.h, 3, 3, P.gunmetalLight);
    tb.box(pnl.x + 3, pnl.y + 3, pnl.w - 6, pnl.h - 6, 4, 1, P.gunmetal);
  }
  for (const y of [40, 100, 150]) tb.box(lt.x, y, lt.w, 5, 5, 8, P.gunmetalDark);
  const cellH = L.h / L.cells;
  tb.box(L.x, L.y - 40, 4, L.h + 40, 4, 6, P.gunmetalLight);
  tb.box(L.x + L.w - 4, L.y - 40, 4, L.h + 40, 4, 6, P.gunmetalLight);
  for (let i = 0; i < L.cells; i++) {
    const y = L.y + i * cellH;
    tb.box(L.x, y, L.w, 3, 4, 6, P.gunmetalLight);
    tb.beam(L.x + 2, y + 2, L.x + L.w - 2, y + cellH - 2, 2.5, 1, 3, P.gunmetalLight);
    tb.beam(L.x + L.w - 2, y + 2, L.x + 2, y + cellH - 2, 2.5, 2, 3, P.gunmetalLight);
  }
  const dr = lt.door;
  tb.box(dr.x - 6, dr.y - 8, dr.w + 12, dr.h + 8, 4, 6, P.gunmetalLight);
  tglow.box(dr.x, dr.y, dr.w, dr.h, 0, 2, 0x8a5220, 1.1); // doorway lit from inside
  tglow.box(dr.x + 6, dr.y + 6, dr.w - 12, dr.h - 6, 0.5, 2, 0xc07a30, 1.0);
  for (let y = dr.y; y < dr.y + dr.h; y += 8) tb.box(dr.x + dr.w + 8, y, 6, 4, 5, 1, P.hazardYellow);
  for (const p of lt.pipes) tp.beam(p.x0, p.y0, p.x1, p.y1, p.r * 2, 8, 0, P.gunmetalLight, true);

  const rt = st.rightTower;
  tb.box(rt.x, rt.y, rt.w, rt.h, 0, 120, P.gunmetal);
  tb.box(rt.x, rt.y, rt.w, 3, 2, 122, P.steelHighlight);
  tb.box(rt.x - 8, rt.y - 18, 40, 18, -10, 40, P.gunmetal);
  for (let x = rt.x + 4; x < rt.x + rt.w - 4; x += 6) tb.box(x, rt.y + 8, 3, 12, 1, 1, P.gunmetalDark);
  for (const f of rt.fans) {
    tb.box(f.cx - f.r - 4, f.cy - f.r - 4, f.r * 2 + 8, f.r * 2 + 8, 2, 2, P.gunmetalLight);
    tp.add({ x: lx(f.cx), y: ly(f.cy), z: 2 }, new THREE.Euler(Math.PI / 2, 0, 0), { x: f.r * 2, y: 1, z: f.r * 2 }, 0x0b0c0f);
  }
  for (const p of rt.pipes) tp.beam(p.x0, p.y0, p.x1, p.y1, p.r * 2, 6, 0, P.gunmetalLight, true);
  back.add(tb.build(metal), tp.build(metal), tglow.build(emissive));

  // rotating fan blades (one merged mesh per fan, rotated in update)
  /** @type {THREE.Mesh[]} */
  const fans = [];
  for (const f of rt.fans) {
    const mb = new MergeBatch();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      mb.add(new THREE.BoxGeometry(f.r * 0.9, 5, 1), { x: Math.cos(a) * f.r * 0.45, y: Math.sin(a) * f.r * 0.45, z: 0 }, P.gunmetalLight, new THREE.Euler(0.4, 0, a));
    }
    mb.add(new THREE.CylinderGeometry(3, 3, 3, 10), { x: 0, y: 0, z: 0 }, P.steelHighlight, new THREE.Euler(Math.PI / 2, 0, 0));
    const m = mb.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }));
    m.position.set(lx(f.cx), ly(f.cy), 3.5);
    back.add(m);
    fans.push(m);
  }
  root.add(back);

  // ---- depth-0 structures
  const front = new THREE.Group();
  const fb = new InstanceBatch(UNIT.box);
  const fp = new InstanceBatch(UNIT.cylinder);

  // struts under the platforms
  for (const s of st.struts) fb.box(s.x - 4, s.y0, 8, s.y1 - s.y0 + 8, -DECK_DEPTH * 0.3, 8, P.gunmetal);

  // platforms: slab = wet top + striped front face
  const wet = wetMaterial(P.gunmetal, ctx.env);
  const stripe = stripeMaterial(P.hazardYellow, P.hazardBlack);
  const side = metal;
  for (const pf of st.platforms) {
    const top = surfaceY(pf.y), h = pf.y + pf.h - top;
    const m = slab(pf.w, h, DECK_DEPTH, [side, side, wet, side, stripe, side], 18);
    m.position.set(lx(pf.x + pf.w / 2), ly(top + h / 2), -DECK_DEPTH / 2);
    front.add(m);
    fb.box(pf.x, pf.y + pf.h, pf.w, 4, -2, DECK_DEPTH - 4, P.gunmetalDark); // underside beam
  }

  // stairs: steps between two stringers, handrail in front
  const sr = st.stairs;
  const y0 = surfaceY(sr.y0), y1 = surfaceY(sr.y1);
  const dx = (sr.x1 - sr.x0) / sr.steps, dy = (y0 - y1) / sr.steps;
  const zf = -6, zb = -56;
  for (const z of [zf, zb]) fb.beam(sr.x0, y0 + 4, sr.x1, y1 + 4, 9, z, 4, P.gunmetal);
  for (let i = 0; i < sr.steps; i++) {
    const x = sr.x0 + i * dx, y = y0 - (i + 1) * dy;
    fb.box(x, y, dx + 1, 3, zf, zf - zb, P.gunmetalLight);
  }
  for (let i = 0; i <= sr.steps; i += 2) fb.box(sr.x0 + i * dx - 1, y0 - i * dy - 20, 2, 20, zf + 1, 2, RAIL);
  fb.beam(sr.x0, y0 - 20, sr.x1, y1 - 20, 2.5, zf, 2.5, RAIL);
  fb.beam(sr.x0, y0 - 11, sr.x1, y1 - 11, 1.5, zf, 1.5, RAIL_DARK);

  // ladders on the platform fronts
  for (const l of st.ladders) {
    const ya = surfaceY(l.y0), yb = l.y1 + 4;
    fb.box(l.x, ya - 12, 2, yb - ya + 12, 3, 2, RAIL);
    fb.box(l.x + l.w - 2, ya - 12, 2, yb - ya + 12, 3, 2, RAIL);
    for (let y = ya + 3; y < yb; y += l.rungSpacing) fb.box(l.x, y, l.w, 1.5, 2.5, 1.5, RAIL_DARK);
  }

  // railings along the back edges of the walking surfaces
  for (const r of scene.railings) {
    const yb = surfaceY(r.y), h = r.h * 1.15;
    const z = -DECK_DEPTH + 6;
    for (let x = r.x0; x <= r.x1; x += r.postSpacing) fb.box(x - 1.2, yb - h, 2.4, h, z, 2.4, RAIL_DARK);
    fb.box(r.x0, yb - h, r.x1 - r.x0, 2.5, z + 0.5, 3, RAIL);
    fb.box(r.x0, yb - h * 0.5, r.x1 - r.x0, 1.5, z, 2, RAIL_DARK);
  }

  // ground pipes lower left
  for (const p of st.groundPipes) fp.beam(p.x0, p.y0, p.x1, p.y1, p.r * 2, 20, 0, P.gunmetal, true);

  front.add(fb.build(metal), fp.build(metal));
  root.add(front);

  return {
    object: root,
    update(t) { fans.forEach((m, i) => { m.rotation.z = -t * (2.2 + i * 0.4); }); },
  };
}
