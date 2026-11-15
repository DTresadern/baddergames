// @ts-check
// Foreground structures: left machinery tower, right fan tower, dome building, stairs,
// stepped platforms, struts, ladders, ground pipes. One merged lit mesh for the metal,
// one unlit mesh for glowing details, fan blades as their own meshes (rotated each frame).

import { Mesh3D } from '@pixi/3d';
import { MeshBuilder } from '../effects/builder.js';
import { glowVertexMaterial, litVertexMaterial } from '../effects/materials.js';
import { S, X, Y, Z } from '../stage.js';

/** Foreground objects run from the depth-0 plane back to this Z. */
const BACK = -70;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createStructures(scene) {
  const P = scene.palette;
  const st = scene.structures;
  const m = new MeshBuilder();
  const wet = new MeshBuilder(); // low-roughness tops (platform walking surfaces)
  const glow = new MeshBuilder();
  /** @type {import('../stage.js').Node[]} */
  const nodes = [];

  /** box from world rect at depth 0, Z range z0..z1 */
  const rect = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ z0, /** @type {number} */ z1, /** @type {number} */ color, /** @type {MeshBuilder} */ b = m, top = color) =>
    b.box(X(x), Y(y + h), z0, X(x + w), Y(y), z1, color, { top });
  /** pipe from world points, at Z */
  const pipe = (/** @type {{ x0: number, y0: number, x1: number, y1: number, r: number }} */ p, /** @type {number} */ z, /** @type {number} */ color) =>
    m.tube([[X(p.x0), Y(p.y0), z], [X(p.x1), Y(p.y1), z]], p.r, color, { sides: 8 });

  // ---- dome building (depth 2.5)
  {
    const dm = st.dome, d = dm.depth, z = Z(d);
    const baseY = dm.y + 45;
    m.box(X(dm.x, d), Y(400, d), z - S(120, d), X(dm.x + dm.w, d), Y(baseY, d), z, P.navy, { top: P.bruisedNavy });
    m.ellipsoid([X(dm.x + dm.w / 2, d), Y(baseY, d), z - S(60, d)], [S(dm.w / 2, d), S(45, d), S(60, d)], P.bruisedNavy, { half: true, seg: 20 });
    for (let k = 0; k < 6; k++) {
      const wx = dm.x + 12 + k * 21;
      glow.box(X(wx, d), Y(baseY + 22, d), z, X(wx + 12, d), Y(baseY + 14, d), z + S(0.5, d), P.windowLit);
    }
  }

  // ---- left tower
  const lt = st.leftTower;
  rect(lt.x, lt.y, lt.w, lt.h, -110, -24, P.gunmetal);
  for (const y of [40, 100, 150]) rect(lt.x, y, lt.w, 5, -30, -20, P.gunmetalDark);
  for (const pnl of lt.panels) rect(pnl.x, pnl.y, pnl.w, pnl.h, -30, -18, P.gunmetalLight);
  const L = lt.lattice;
  rect(L.x, L.y, 4, L.h, -30, -14, P.gunmetalLight);
  rect(L.x + L.w - 4, L.y, 4, L.h, -30, -14, P.gunmetalLight);
  const cellH = L.h / L.cells;
  for (let c = 0; c < L.cells; c++) {
    const y = L.y + c * cellH;
    rect(L.x, y, L.w, 3, -28, -16, P.gunmetalLight);
    m.beam(X(L.x + 2), Y(y + 2), X(L.x + L.w - 2), Y(y + cellH - 2), 2.5, -26, -18, P.gunmetalLight);
    m.beam(X(L.x + L.w - 2), Y(y + 2), X(L.x + 2), Y(y + cellH - 2), 2.5, -26, -18, P.gunmetalLight);
  }
  const dr = lt.door;
  rect(dr.x - 6, dr.y - 8, dr.w + 12, dr.h + 8, -30, -16, P.gunmetalLight);
  rect(dr.x, dr.y, dr.w, dr.h, -60, -40, P.gunmetalDark); // recess: the frame stands in front
  glow.box(X(dr.x + 4), Y(dr.y + dr.h - 2), -58, X(dr.x + dr.w - 4), Y(dr.y + 4), -57, P.amberDeep);
  for (let y = dr.y; y < dr.y + dr.h; y += 8) rect(dr.x + dr.w + 8, y, 6, 4, -24, -18, P.hazardYellow);
  for (const p of lt.pipes) pipe(p, -14, P.gunmetalLight);

  // ---- right tower and fans
  const rt = st.rightTower;
  rect(rt.x, rt.y, rt.w, rt.h, -110, -20, P.gunmetal, m, P.gunmetalLight);
  rect(rt.x - 8, rt.y - 18, 40, 18, -90, -30, P.gunmetal, m, P.gunmetalLight);
  for (let x = rt.x + 4; x < rt.x + rt.w - 4; x += 6) rect(x, rt.y + 8, 3, 12, -22, -18, P.gunmetalDark);
  /** @type {Mesh3D[]} */
  const fans = [];
  const bladeMat = litVertexMaterial({ roughness: 0.5, metallic: 0.6 });
  for (const f of rt.fans) {
    rect(f.cx - f.r - 4, f.cy - f.r - 4, f.r * 2 + 8, f.r * 2 + 8, -22, -14, P.gunmetalLight);
    // housing: a short tube along Z, dark inside
    m.tube([[X(f.cx), Y(f.cy), -40], [X(f.cx), Y(f.cy), -12]], f.r, P.gunmetalDark, { sides: 20 });
    const blades = new MeshBuilder();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      blades.beam(0, 0, Math.cos(a) * f.r * 0.92, Math.sin(a) * f.r * 0.92, 7, -2, 2, P.gunmetalLight);
    }
    blades.cylinder(0, 0, 3, -3, 3, P.steelHighlight, 8);
    const fan = new Mesh3D({ geometry: blades.build() ?? undefined, material: bladeMat, position: { x: X(f.cx), y: Y(f.cy), z: -24 } });
    fans.push(fan);
    nodes.push(fan);
  }
  for (const p of rt.pipes) pipe(p, -14, P.gunmetalLight);

  // ---- struts
  for (const s of st.struts) rect(s.x - 4, s.y0, 8, s.y1 - s.y0, -50, -20, P.gunmetal);

  // ---- platforms: steel slab, wet top, yellow edge
  for (const pf of st.platforms) {
    rect(pf.x, pf.y + 2, pf.w, pf.h - 2, BACK, 0, P.gunmetal);
    wet.box(X(pf.x), Y(pf.y + 2), BACK, X(pf.x + pf.w), Y(pf.y), 0, P.gunmetalLight);
    rect(pf.x, pf.y + 2, pf.w, 2, -1, 0.6, P.hazardYellow);
    // under-lip shadow strip
    rect(pf.x + 4, pf.y + pf.h, pf.w - 8, 4, BACK + 10, -6, P.gunmetalDark);
  }

  // ---- stairs: treads, stringer, handrail
  const sr = st.stairs;
  const dx = (sr.x1 - sr.x0) / sr.steps, dy = (sr.y1 - sr.y0) / sr.steps;
  for (let i = 0; i < sr.steps; i++) {
    const x = sr.x0 + i * dx, y = sr.y0 + (i + 1) * dy;
    rect(x, y, dx + 1, 3, -46, -6, P.gunmetalLight);
  }
  m.beam(X(sr.x0), Y(sr.y0 + 6), X(sr.x1), Y(sr.y1 + 6), 9, -8, -2, P.gunmetal);
  m.beam(X(sr.x0), Y(sr.y0 + 6), X(sr.x1), Y(sr.y1 + 6), 9, -50, -44, P.gunmetal);
  m.beam(X(sr.x0), Y(sr.y0 - 20), X(sr.x1), Y(sr.y1 - 20), 2.5, -4, -1, P.hazardYellow);
  for (let i = 0; i <= sr.steps; i += 3) {
    const x = sr.x0 + i * dx, y = sr.y0 + i * dy;
    rect(x, y - 20, 2, 20, -4, -1, P.hazardYellow);
  }

  // ---- ladders
  for (const l of st.ladders) {
    rect(l.x, l.y0 - 10, 2, l.y1 - l.y0 + 10, -6, -2, P.hazardYellow);
    rect(l.x + l.w - 2, l.y0 - 10, 2, l.y1 - l.y0 + 10, -6, -2, P.hazardYellow);
    for (let y = l.y0 + 4; y < l.y1; y += l.rungSpacing) rect(l.x + 2, y, l.w - 4, 1.5, -5, -3, P.amberDeep);
  }

  // ---- ground pipes (foreground)
  for (const p of st.groundPipes) pipe(p, 20, P.gunmetal);

  const geo = m.build();
  if (geo) nodes.push(new Mesh3D({ geometry: geo, material: litVertexMaterial({ roughness: 0.65, metallic: 0.45 }) }));
  const wg = wet.build();
  if (wg) nodes.push(new Mesh3D({ geometry: wg, material: litVertexMaterial({ roughness: 0.12, metallic: 0.7 }) }));
  const gg = glow.build();
  if (gg) nodes.push(new Mesh3D({ geometry: gg, material: glowVertexMaterial(), castShadow: false, receiveShadow: false }));
  return {
    nodes,
    update(t) { fans.forEach((f, i) => { f.rotation.z = -t * (2.2 + i * 0.4); }); },
  };
}
