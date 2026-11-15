// @ts-check
// MeshBuilder: merges many procedural shapes into one Geometry3D with per-vertex colours,
// so a whole layer (every crate face, every window, every rail) is one mesh and one draw.
// @pixi/3d has no merge helper and no computeVertexNormals, so faces carry their own flat
// normals here. All coordinates are already in 3D units (see stage.js X/Y/Z/S).
//
// Colours: pass 0xRRGGBB (sRGB). Vertex colours are linear light in @pixi/3d (skill
// reference geometry.md), so they are converted with srgbToLinear on the way in.

import { Geometry3D, srgbToLinear } from '@pixi/3d';
import { earcut } from 'pixi.js';

/** @param {number} hex @param {number} [scale] brightness multiplier (linear) @returns {[number, number, number]} */
export function linear(hex, scale = 1) {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255) * scale,
    srgbToLinear(((hex >> 8) & 255) / 255) * scale,
    srgbToLinear((hex & 255) / 255) * scale,
  ];
}

/** @typedef {[number, number, number]} V3 */

export class MeshBuilder {
  constructor() {
    /** @type {number[]} */ this.pos = [];
    /** @type {number[]} */ this.nrm = [];
    /** @type {number[]} */ this.col = [];
    /** @type {number[]} */ this.idx = [];
    /** colour scale applied to every colour added (linear), e.g. to brighten emissive art */
    this.gain = 1;
    /** alpha written to the colours (for blended materials) */
    this.alpha = 1;
  }

  get vertexCount() { return this.pos.length / 3; }

  /** @param {V3} p @param {V3} n @param {[number, number, number]} c */
  vert(p, n, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2], this.alpha);
    return this.vertexCount - 1;
  }

  /**
   * Quad a-b-c-d, counter-clockwise seen from the side the normal points to.
   * @param {V3} a @param {V3} b @param {V3} c @param {V3} d @param {number} color
   * @param {V3} [n] normal; computed from the corners when omitted
   */
  quad(a, b, c, d, color, n) {
    const nn = n ?? faceNormal(a, b, c);
    const lc = linear(color, this.gain);
    const i = this.vert(a, nn, lc);
    this.vert(b, nn, lc);
    this.vert(c, nn, lc);
    this.vert(d, nn, lc);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /**
   * Axis-aligned box from min to max corner (3D units).
   * @param {number} x0 @param {number} y0 @param {number} z0 @param {number} x1 @param {number} y1 @param {number} z1
   * @param {number} color @param {{ top?: number, front?: number, back?: boolean }} [opt]
   */
  box(x0, y0, z0, x1, y1, z1, color, opt = {}) {
    const top = opt.top ?? color, front = opt.front ?? color;
    // front (+Z)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front, [0, 0, 1]);
    // top (+Y)
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, [0, 1, 0]);
    // bottom (-Y)
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, [0, -1, 0]);
    // left (-X)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, [-1, 0, 0]);
    // right (+X)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, [1, 0, 0]);
    if (opt.back) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, [0, 0, -1]);
  }

  /**
   * A straight beam between two XY points with a square-ish cross section, extruded z0..z1.
   * @param {number} ax @param {number} ay @param {number} bx @param {number} by
   * @param {number} thick @param {number} z0 @param {number} z1 @param {number} color
   */
  beam(ax, ay, bx, by, thick, z0, z1, color) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * thick / 2, py = (dx / len) * thick / 2;
    /** @type {V3[]} */
    const f = [[ax - px, ay - py, z1], [bx - px, by - py, z1], [bx + px, by + py, z1], [ax + px, ay + py, z1]];
    /** @type {V3[]} */
    const b = f.map((p) => /** @type {V3} */ ([p[0], p[1], z0]));
    this.quad(f[0], f[1], f[2], f[3], color, [0, 0, 1]);
    const sides = [[0, 1], [1, 2], [2, 3], [3, 0]];
    for (const [i, j] of sides) {
      const nx = (f[i][1] - f[j][1]), ny = -(f[i][0] - f[j][0]);
      const nl = Math.hypot(nx, ny) || 1;
      // outward normal of edge i->j (counter-clockwise polygon): (dy, -dx)
      this.quad(b[i], b[j], f[j], f[i], color, [-nx / nl, -ny / nl, 0]);
    }
  }

  /**
   * Tube along a 3D polyline (pipes, cables, tendrils). Radius may taper to `radiusEnd`.
   * @param {V3[]} pts @param {number} radius @param {number} color
   * @param {{ sides?: number, radiusEnd?: number }} [opt]
   */
  tube(pts, radius, color, opt = {}) {
    const sides = opt.sides ?? 6;
    const rEnd = opt.radiusEnd ?? radius;
    const lc = linear(color, this.gain);
    const n = pts.length;
    if (n < 2) return;
    // reference "up" for the ring frame: Z unless the segment is nearly along Z
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // u = normalize(t x Z) or t x Y
      let ux = ty, uy = -tx, uz = 0;
      if (Math.hypot(ux, uy) < 1e-3) { ux = 0; uy = tz; uz = -ty; }
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      // v = t x u
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      const r = radius + (rEnd - radius) * (i / (n - 1));
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const c = Math.cos(ang), sn = Math.sin(ang);
        const nx = ux * c + vx * sn, ny = uy * c + vy * sn, nz = uz * c + vz * sn;
        this.vert([p[0] + nx * r, p[1] + ny * r, p[2] + nz * r], [nx, ny, nz], lc);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides);
        const c = a + sides, d = b + sides;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  /**
   * Flat polygon (XY, 3D units) extruded from z0 to z1: front cap plus side walls.
   * @param {number[][]} poly [[x, y], ...] in either winding @param {number} z0 @param {number} z1
   * @param {number} color @param {number} [sideColor]
   */
  prism(poly, z0, z1, color, sideColor = color) {
    const flat = poly.flat();
    const tri = earcut(flat);
    const lc = linear(color, this.gain);
    const base = this.vertexCount;
    for (const p of poly) this.vert([p[0], p[1], z1], [0, 0, 1], lc);
    // make every triangle face +Z
    for (let i = 0; i < tri.length; i += 3) {
      const a = poly[tri[i]], b = poly[tri[i + 1]], c = poly[tri[i + 2]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross >= 0) this.idx.push(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
      else this.idx.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]);
    }
    // side walls, both windings are emitted outward by checking polygon orientation
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ccw = area > 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      /** @type {V3} */ const fa = [a[0], a[1], z1];
      /** @type {V3} */ const fb = [b[0], b[1], z1];
      /** @type {V3} */ const ba = [a[0], a[1], z0];
      /** @type {V3} */ const bb = [b[0], b[1], z0];
      if (ccw) this.quad(ba, bb, fb, fa, sideColor);
      else this.quad(bb, ba, fa, fb, sideColor);
    }
  }

  /**
   * Ellipsoid or half-ellipsoid (dome) centred at c with radii r.
   * @param {V3} c @param {V3} r @param {number} color @param {{ half?: boolean, seg?: number }} [opt]
   */
  ellipsoid(c, r, color, opt = {}) {
    const seg = opt.seg ?? 12;
    const rings = opt.half ? seg / 2 : seg;
    const lc = linear(color, this.gain);
    const base = this.vertexCount;
    for (let i = 0; i <= rings; i++) {
      const phi = (i / seg) * Math.PI; // 0 = top
      for (let j = 0; j <= seg; j++) {
        const th = (j / seg) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        const n = /** @type {V3} */ ([nx / r[0], ny / r[1], nz / r[2]]);
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        this.vert([c[0] + nx * r[0], c[1] + ny * r[1], c[2] + nz * r[2]], [n[0] / nl, n[1] / nl, n[2] / nl], lc);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j, b = a + 1, cc = a + seg + 1, d = cc + 1;
        this.idx.push(a, b, cc, b, d, cc);
      }
    }
  }

  /**
   * Upright cylinder (barrels, posts, chimneys) from y0 to y1.
   * @param {number} x @param {number} z @param {number} r @param {number} y0 @param {number} y1 @param {number} color
   * @param {number} [sides]
   */
  cylinder(x, z, r, y0, y1, color, sides = 10) {
    this.tube([[x, y0, z], [x, y1, z]], r, color, { sides });
    // top cap
    const lc = linear(color, this.gain);
    const base = this.vertexCount;
    this.vert([x, y1, z], [0, 1, 0], lc);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      this.vert([x + Math.cos(a) * r, y1, z + Math.sin(a) * r], [0, 1, 0], lc);
    }
    for (let s = 0; s < sides; s++) this.idx.push(base, base + 1 + ((s + 1) % sides), base + 1 + s);
  }

  /**
   * Build the Geometry3D (null when empty).
   * @param {{ dynamic?: boolean }} [opt]
   */
  build(opt = {}) {
    if (!this.idx.length) return null;
    const big = this.vertexCount > 65535;
    return new Geometry3D({
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
      indices: big ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      dynamic: opt.dynamic,
    });
  }
}

/** @param {V3} a @param {V3} b @param {V3} c @returns {V3} */
function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
