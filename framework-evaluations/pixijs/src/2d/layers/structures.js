// @ts-check
// Foreground structures: left machinery tower, right fan tower, stairs, stepped
// platforms, struts, ladders, railings, ground pipes, plus the mid-distance dome.

import { Container } from 'pixi.js';
import { ShapeBatch, shaderRect } from '../effects/batch.js';
import { wetSurface, hazardStripe } from '../effects/surfaces.js';
import { ORDER } from '../stage.js';
import { hazed } from '@fw-eval/shared/scene.js';

const RAIL = 0x9c7a26; // dull ochre railing paint
const RAIL_DARK = 0x5a4718;

/**
 * Pipe with a highlight stripe.
 * @param {ShapeBatch} b
 * @param {{ x0: number, y0: number, x1: number, y1: number, r: number }} p
 * @param {number} color @param {number} light
 */
function pipe(b, p, color, light) {
  b.line(p.x0, p.y0, p.x1, p.y1, p.r * 2, color);
  const vertical = Math.abs(p.x1 - p.x0) < Math.abs(p.y1 - p.y0);
  const ox = vertical ? -p.r * 0.4 : 0, oy = vertical ? 0 : -p.r * 0.4;
  b.line(p.x0 + ox, p.y0 + oy, p.x1 + ox, p.y1 + oy, Math.max(1, p.r * 0.4), light, 0.5);
}

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createStructures(scene, ctx) {
  const P = scene.palette;
  const st = scene.structures;
  const group = new Container();
  /** @type {import('../stage.js').Part[]} */
  const parts = [{ object: group, depth: st.depth }];

  // ---- mid-distance dome building behind the platforms
  {
    const d = st.dome.depth;
    const b = new ShapeBatch();
    const body = hazed(scene, P.navy, d), rib = hazed(scene, P.gunmetalLight, d);
    const cx = st.dome.x + st.dome.w / 2, baseY = st.dome.y + 45;
    b.circle(cx, baseY, st.dome.w / 2, body, 1, 28, Math.PI, Math.PI * 2, 45);
    b.rect(st.dome.x, baseY, st.dome.w, st.dome.h - 45 + 60, [body, hazed(scene, P.navy, d + 2)]);
    for (let k = 1; k < 6; k++) {
      const a = Math.PI + (Math.PI * k) / 6;
      b.line(cx, baseY - 45, cx + Math.cos(a) * st.dome.w / 2, baseY + Math.sin(a) * 45, 1.2, rib, 0.5);
    }
    const win = hazed(scene, P.windowLit, d * 0.4);
    for (let x = st.dome.x + 8; x < st.dome.x + st.dome.w - 8; x += 9) {
      b.rect(x, baseY + 8, 5, 3, win, 0.9);
      if ((x | 0) % 3) b.rect(x, baseY + 22, 5, 3, win, 0.6);
    }
    parts.push({ object: b.build(ORDER.dome), depth: d });
  }

  const back = new ShapeBatch(); // things behind the walkways
  const front = new ShapeBatch(); // things in front of / on the walkways

  // ---- left tower
  const lt = st.leftTower;
  const L = lt.lattice;
  back.rect(lt.x, lt.y, lt.w, lt.h, [0x1d2025, 0x24272d]);
  back.rect(L.x + L.w + 4, lt.y, lt.x + lt.w - (L.x + L.w + 4), lt.h, [P.gunmetal, P.gunmetalDark]); // right of the lattice
  for (const pnl of lt.panels) {
    back.rect(pnl.x, pnl.y, pnl.w, pnl.h, P.gunmetalLight, 0.55);
    back.rect(pnl.x + 3, pnl.y + 3, pnl.w - 6, pnl.h - 6, P.gunmetal, 0.8);
  }
  // horizontal floor beams
  for (const y of [40, 100, 150]) back.rect(lt.x, y, lt.w, 5, P.gunmetalDark);
  // lattice of cross-braced girders
  const cellH = L.h / L.cells;
  back.rect(L.x, L.y, 4, L.h, P.gunmetalLight); back.rect(L.x + L.w - 4, L.y, 4, L.h, P.gunmetalLight);
  for (let i = 0; i < L.cells; i++) {
    const y = L.y + i * cellH;
    back.rect(L.x, y, L.w, 3, P.gunmetalLight);
    back.line(L.x + 2, y + 2, L.x + L.w - 2, y + cellH - 2, 2.5, P.gunmetalLight);
    back.line(L.x + L.w - 2, y + 2, L.x + 2, y + cellH - 2, 2.5, P.gunmetalLight);
  }
  // doorway lit from inside
  const dr = lt.door;
  back.rect(dr.x - 6, dr.y - 8, dr.w + 12, dr.h + 8, P.gunmetalLight);
  back.rect(dr.x, dr.y, dr.w, dr.h, [0x8a5220, 0x2a1a0e]);
  back.rect(dr.x + 6, dr.y + 6, dr.w - 12, dr.h - 6, [0xc07a30, 0x3a2412], 0.8);
  for (let y = dr.y; y < dr.y + dr.h; y += 8) back.rect(dr.x + dr.w + 8, y, 6, 4, P.hazardYellow, 0.8);
  for (const p of lt.pipes) pipe(back, p, P.gunmetalLight, P.steelHighlight);

  // ---- right tower with fans
  const rt = st.rightTower;
  back.rect(rt.x, rt.y, rt.w, rt.h, [P.gunmetal, P.gunmetalDark]);
  back.rect(rt.x, rt.y, rt.w, 3, P.steelHighlight, 0.5);
  back.rect(rt.x - 8, rt.y - 18, 40, 18, P.gunmetal); // roof unit
  for (let x = rt.x + 4; x < rt.x + rt.w - 4; x += 6) back.rect(x, rt.y + 8, 3, 12, P.gunmetalDark);
  for (const f of rt.fans) {
    back.rect(f.cx - f.r - 4, f.cy - f.r - 4, f.r * 2 + 8, f.r * 2 + 8, P.gunmetalLight);
    back.circle(f.cx, f.cy, f.r, 0x0b0c0f, 1, 24);
  }
  for (const p of rt.pipes) pipe(back, p, P.gunmetalLight, P.steelHighlight);

  // ---- struts under the platforms
  for (const s of st.struts) {
    back.rect(s.x - 4, s.y0, 8, s.y1 - s.y0, [P.gunmetal, P.gunmetalDark]);
    back.rect(s.x - 4, s.y0, 1.5, s.y1 - s.y0, P.steelHighlight, 0.3);
  }

  // ---- platforms: dark body; the wet top and stripe are shader quads added below
  for (const pf of st.platforms) {
    back.rect(pf.x, pf.y, pf.w, pf.h, P.gunmetal);
    back.rect(pf.x, pf.y + pf.h, pf.w, 4, 0x000000, 0.45);
  }

  // ---- stairs
  const sr = st.stairs;
  const dx = (sr.x1 - sr.x0) / sr.steps, dy = (sr.y0 - sr.y1) / sr.steps;
  front.line(sr.x0, sr.y0 + 6, sr.x1, sr.y1 + 6, 9, P.gunmetal); // stringer
  for (let i = 0; i < sr.steps; i++) {
    const x = sr.x0 + i * dx, y = sr.y0 - (i + 1) * dy;
    front.rect(x, y, dx + 1, 3, P.gunmetalLight);
    front.rect(x, y, dx + 1, 1, P.steelHighlight, 0.5);
  }
  // handrail with posts
  for (let i = 0; i <= sr.steps; i += 2) {
    const x = sr.x0 + i * dx, y = sr.y0 - i * dy;
    front.rect(x - 1, y - 20, 2, 20, RAIL);
  }
  front.line(sr.x0, sr.y0 - 20, sr.x1, sr.y1 - 20, 2.5, RAIL);
  front.line(sr.x0, sr.y0 - 11, sr.x1, sr.y1 - 11, 1.5, RAIL_DARK);

  // ---- ladders
  for (const l of st.ladders) {
    front.rect(l.x, l.y0 - 10, 2, l.y1 - l.y0 + 10, RAIL);
    front.rect(l.x + l.w - 2, l.y0 - 10, 2, l.y1 - l.y0 + 10, RAIL);
    for (let y = l.y0 + 3; y < l.y1; y += l.rungSpacing) front.rect(l.x, y, l.w, 1.5, RAIL_DARK);
  }

  // ---- railings
  for (const r of scene.railings) {
    for (let x = r.x0; x <= r.x1; x += r.postSpacing) front.rect(x - 1, r.y - r.h, 2.2, r.h, RAIL_DARK);
    front.rect(r.x0, r.y - r.h, r.x1 - r.x0, 2.5, RAIL);
    front.rect(r.x0, r.y - r.h + 0.5, r.x1 - r.x0, 0.8, 0xe0c060, 0.5); // wet highlight
    front.rect(r.x0, r.y - r.h * 0.5, r.x1 - r.x0, 1.5, RAIL_DARK);
  }

  // ---- ground pipes lower left
  for (const p of st.groundPipes) pipe(front, p, P.gunmetal, P.steelHighlight);

  group.addChild(back.build(ORDER.structuresBack));
  group.addChild(front.build(ORDER.railings));

  // wet tops and stripe edges of the platforms (two shaders shared by all platforms)
  const wet = wetSurface({ base: P.gunmetal, sheen: 0x8794a8, ctx });
  const stripe = hazardStripe({ yellow: P.hazardYellow, black: P.hazardBlack, spacing: 18, slant: 6, height: 6 });
  for (const pf of st.platforms) {
    group.addChild(shaderRect(pf.x, pf.y, pf.w, 4, wet, ORDER.structures));
    group.addChild(shaderRect(pf.x, pf.y + 4, pf.w, Math.min(6, pf.h - 4), stripe, ORDER.structures));
  }

  // ---- rotating fan blades (one Graphics per fan, rotated in update)
  /** @type {import('pixi.js').Graphics[]} */
  const fans = [];
  for (const f of rt.fans) {
    const b = new ShapeBatch();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      b.quad([0, 0, Math.cos(a - 0.25) * f.r * 0.95, Math.sin(a - 0.25) * f.r * 0.95,
        Math.cos(a + 0.25) * f.r * 0.95, Math.sin(a + 0.25) * f.r * 0.95, 0, 0], P.gunmetalLight);
    }
    b.circle(0, 0, 3, P.steelHighlight);
    const m = b.build(ORDER.structuresBack + 1);
    m.position.set(f.cx, f.cy);
    group.addChild(m);
    fans.push(m);
  }

  return {
    parts,
    // y is down in PixiJS, so a positive rotation turns clockwise on screen (as three.js's -z)
    update(t) { fans.forEach((m, i) => { m.rotation = t * (2.2 + i * 0.4); }); },
  };
}
