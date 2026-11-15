// @ts-check
// ShapeBatch: collects flat 2D shapes (rects, quads, polygons, circles, thick lines)
// with per-vertex RGBA colour and turns them into ONE mesh = one draw call.
// Most static scenery in the 2D build is drawn through this.
//
// Input coordinates are scene world units (x right, y DOWN). The batch flips y
// (three.js y is up) so the orthographic camera can map x 0..1200, y 0..-400.

import * as THREE from 'three';

/** @typedef {number | [number, number]} Fill  0xRRGGBB, or [top colour, bottom colour] for a vertical gradient */

export class ShapeBatch {
  constructor() {
    /** @type {number[]} */ this.pos = [];
    /** @type {number[]} */ this.col = [];
  }

  /**
   * @param {number} x @param {number} y @param {number} color @param {number} alpha
   */
  vertex(x, y, color, alpha) {
    this.pos.push(x, -y, 0);
    this.col.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, alpha);
  }

  /**
   * Axis-aligned rectangle. fill may be a [top, bottom] gradient.
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {Fill} fill @param {number} [alpha] @param {number} [alphaBottom]
   */
  rect(x, y, w, h, fill, alpha = 1, alphaBottom = alpha) {
    const [top, bottom] = Array.isArray(fill) ? fill : [fill, fill];
    this.vertex(x, y, top, alpha); this.vertex(x + w, y, top, alpha); this.vertex(x, y + h, bottom, alphaBottom);
    this.vertex(x + w, y, top, alpha); this.vertex(x + w, y + h, bottom, alphaBottom); this.vertex(x, y + h, bottom, alphaBottom);
    return this;
  }

  /**
   * Any quad given as 4 corners in order (a b c d around the edge).
   * @param {number[]} p [ax, ay, bx, by, cx, cy, dx, dy]
   * @param {number} color @param {number} [alpha]
   */
  quad(p, color, alpha = 1) {
    const [ax, ay, bx, by, cx, cy, dx, dy] = p;
    this.vertex(ax, ay, color, alpha); this.vertex(bx, by, color, alpha); this.vertex(cx, cy, color, alpha);
    this.vertex(ax, ay, color, alpha); this.vertex(cx, cy, color, alpha); this.vertex(dx, dy, color, alpha);
    return this;
  }

  /**
   * Thick straight line from (x1,y1) to (x2,y2).
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
   * @param {number} width @param {number} color @param {number} [alpha]
   */
  line(x1, y1, x2, y2, width, color, alpha = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * width * 0.5, ny = (dx / len) * width * 0.5;
    return this.quad([x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny], color, alpha);
  }

  /**
   * Thick polyline through points, width tapering from w0 to w1.
   * @param {{x: number, y: number}[]} pts @param {number} w0 @param {number} w1
   * @param {number} color @param {number} [alpha]
   */
  polyline(pts, w0, w1, color, alpha = 1) {
    for (let i = 0; i < pts.length - 1; i++) {
      const f0 = i / (pts.length - 1), f1 = (i + 1) / (pts.length - 1);
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = -dy / len, uy = dx / len;
      const wa = (w0 + (w1 - w0) * f0) / 2, wb = (w0 + (w1 - w0) * f1) / 2;
      this.quad([a.x + ux * wa, a.y + uy * wa, b.x + ux * wb, b.y + uy * wb, b.x - ux * wb, b.y - uy * wb, a.x - ux * wa, a.y - uy * wa], color, alpha);
      // round joint so segments do not show gaps
      this.circle(b.x, b.y, wb, color, alpha, 6);
    }
    return this;
  }

  /**
   * Filled polygon (concave allowed, no holes).
   * @param {{x: number, y: number}[]} pts @param {number} color @param {number} [alpha]
   */
  polygon(pts, color, alpha = 1) {
    const contour = pts.map((p) => new THREE.Vector2(p.x, p.y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [a, b, c] of tris) {
      this.vertex(pts[a].x, pts[a].y, color, alpha);
      this.vertex(pts[b].x, pts[b].y, color, alpha);
      this.vertex(pts[c].x, pts[c].y, color, alpha);
    }
    return this;
  }

  /**
   * Filled circle or arc segment (a0..a1 radians, y down).
   * @param {number} cx @param {number} cy @param {number} r @param {number} color
   * @param {number} [alpha] @param {number} [segments] @param {number} [a0] @param {number} [a1]
   * @param {number} [ry] vertical radius for ellipses
   */
  circle(cx, cy, r, color, alpha = 1, segments = 16, a0 = 0, a1 = Math.PI * 2, ry = r) {
    for (let i = 0; i < segments; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segments, t1 = a0 + ((a1 - a0) * (i + 1)) / segments;
      this.vertex(cx, cy, color, alpha);
      this.vertex(cx + Math.cos(t0) * r, cy + Math.sin(t0) * ry, color, alpha);
      this.vertex(cx + Math.cos(t1) * r, cy + Math.sin(t1) * ry, color, alpha);
    }
    return this;
  }

  /** Number of triangles collected so far. */
  get triangles() { return this.pos.length / 9; }

  /**
   * Build the mesh. All 2D materials are transparent so three.js draws them in one
   * list sorted by renderOrder (painter's order), never opaque-first.
   * @param {number} renderOrder
   * @param {{ blending?: THREE.Blending }} [opts]
   */
  build(renderOrder, opts = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthTest: false, depthWrite: false,
      // shapes come in either winding (polygons, lines): draw both faces
      side: THREE.DoubleSide,
      blending: opts.blending ?? THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = true;
    return mesh;
  }
}

/**
 * A ShaderMaterial preset for 2D: transparent, no depth, painter's order.
 * @param {{ vertexShader: string, fragmentShader: string, uniforms?: Record<string, THREE.IUniform>, additive?: boolean }} o
 */
export function flatShader({ vertexShader, fragmentShader, uniforms = {}, additive = false }) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/**
 * Quad mesh covering a world rect (x, y top-left, y down), with a ShaderMaterial.
 * The shader receives `vUv` (0..1, v=0 at the TOP) and `vWorld` (world x, y down).
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {THREE.ShaderMaterial} material @param {number} renderOrder
 */
export function shaderRect(x, y, w, h, material, renderOrder) {
  const geometry = new THREE.BufferGeometry();
  const p = [x, -y, 0, x + w, -y, 0, x + w, -(y + h), 0, x, -(y + h), 0];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  return mesh;
}

/** Vertex shader for shaderRect: passes uv and world position (y down). */
export const RECT_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(position.x, -position.y);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** 2D value-noise helpers shared by several shaders. */
export const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

/**
 * 0xRRGGBB -> THREE.Color without colour management (we disable it globally; see main.js).
 * @param {number} hex
 */
export function col(hex) {
  return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
}
