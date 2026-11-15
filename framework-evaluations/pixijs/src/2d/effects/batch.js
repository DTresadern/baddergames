// @ts-check
// ShapeBatch: collects flat 2D shapes (rects, quads, polygons, circles, thick lines)
// into ONE PixiJS Graphics. PixiJS batches the tessellated shapes of consecutive
// Graphics into as few draw calls as their textures and blend modes allow.
// Most static scenery in the 2D build is drawn through this.
//
// Vertical gradients use FillGradient (textureSpace 'local': 0..1 across each shape).
// PixiJS renders every FillGradient into a small texture at runtime, so gradients are
// cached by colour pair: the same pair always reuses one texture.
//
// Also here: helpers for custom-shader quads (Mesh + Shader) and shared GLSL.
// Coordinates are scene world units (x right, y DOWN), the same as PixiJS: no flip.

import { Graphics, FillGradient, Mesh, Geometry, Shader } from 'pixi.js';

/** @typedef {number | [number, number]} Fill  0xRRGGBB, or [top colour, bottom colour] for a vertical gradient */

/**
 * '#rrggbbaa' string (PixiJS Color accepts it; 0xRRGGBBAA numbers throw).
 * @param {number} hex @param {number} a
 */
function rgba(hex, a) {
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return `#${hex.toString(16).padStart(6, '0')}${alpha.toString(16).padStart(2, '0')}`;
}

/** @type {Map<string, FillGradient>} */
const gradients = new Map();

/**
 * Cached top-to-bottom gradient.
 * @param {number} top @param {number} bottom @param {number} aTop @param {number} aBottom
 */
export function verticalGradient(top, bottom, aTop, aBottom) {
  const key = `${top}|${bottom}|${aTop.toFixed(3)}|${aBottom.toFixed(3)}`;
  let g = gradients.get(key);
  if (!g) {
    g = new FillGradient({
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
      colorStops: [{ offset: 0, color: rgba(top, aTop) }, { offset: 1, color: rgba(bottom, aBottom) }],
    });
    gradients.set(key, g);
  }
  return g;
}

export class ShapeBatch {
  constructor() {
    this.g = new Graphics();
    this.shapes = 0;
  }

  /**
   * Axis-aligned rectangle. fill may be a [top, bottom] gradient.
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {Fill} fill @param {number} [alpha] @param {number} [alphaBottom]
   */
  rect(x, y, w, h, fill, alpha = 1, alphaBottom = alpha) {
    const [top, bottom] = Array.isArray(fill) ? fill : [fill, fill];
    this.g.rect(x, y, w, h);
    if (top === bottom && alpha === alphaBottom) this.g.fill({ color: top, alpha });
    else this.g.fill(verticalGradient(top, bottom, alpha, alphaBottom));
    this.shapes++;
    return this;
  }

  /**
   * Any quad given as 4 corners in order (a b c d around the edge).
   * @param {number[]} p [ax, ay, bx, by, cx, cy, dx, dy]
   * @param {number} color @param {number} [alpha]
   */
  quad(p, color, alpha = 1) {
    this.g.poly(p).fill({ color, alpha });
    this.shapes++;
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
   * Filled polygon (concave allowed, no holes; PixiJS triangulates it with earcut).
   * @param {{x: number, y: number}[]} pts @param {number} color @param {number} [alpha]
   */
  polygon(pts, color, alpha = 1) {
    this.g.poly(pts).fill({ color, alpha });
    this.shapes++;
    return this;
  }

  /**
   * Filled circle, ellipse or arc segment (a0..a1 radians, y down).
   * @param {number} cx @param {number} cy @param {number} r @param {number} color
   * @param {number} [alpha] @param {number} [segments] @param {number} [a0] @param {number} [a1]
   * @param {number} [ry] vertical radius for ellipses
   */
  circle(cx, cy, r, color, alpha = 1, segments = 16, a0 = 0, a1 = Math.PI * 2, ry = r) {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
      this.g.ellipse(cx, cy, r, ry).fill({ color, alpha });
    } else {
      const p = [cx, cy];
      for (let i = 0; i <= segments; i++) {
        const t = a0 + ((a1 - a0) * i) / segments;
        p.push(cx + Math.cos(t) * r, cy + Math.sin(t) * ry);
      }
      this.g.poly(p).fill({ color, alpha });
    }
    this.shapes++;
    return this;
  }

  /**
   * Finish: the Graphics, placed in the global draw order.
   * @param {number} order ORDER value (zIndex in the sorted RenderLayer)
   * @param {{ blendMode?: import('pixi.js').BLEND_MODES }} [opts]
   */
  build(order, opts = {}) {
    this.g.zIndex = order;
    if (opts.blendMode) this.g.blendMode = opts.blendMode;
    return this.g;
  }
}

// ---------------------------------------------------------------------------
// Custom shaders
// ---------------------------------------------------------------------------
// GLSL ES 3.0. A Mesh supplies uProjectionMatrix and uWorldTransformMatrix (global)
// and uTransformMatrix (per mesh). Those names, plus uColor, uRound and
// uWorldColorAlpha, are PixiJS's own: our uniforms must use other names.
// Output colour is PREMULTIPLIED (PixiJS blends normal as ONE, ONE_MINUS_SRC_ALPHA;
// 'add' as ONE, ONE).

const VERT_HEAD = /* glsl */ `#version 300 es
in vec2 aPosition;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
vec4 toClip(vec2 p) {
  return vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(p, 1.0)).xy, 0.0, 1.0);
}
`;

const FRAG_HEAD = /* glsl */ `#version 300 es
out vec4 finalColor;
`;

/**
 * Shader from GLSL bodies (headers above are prepended). highp in the fragment stage:
 * the surface shaders hash world coordinates up to ~1200, too coarse in mediump.
 * @param {string} vertex @param {string} fragment
 * @param {Record<string, any>} resources UniformGroups or plain { name: { value, type } } maps
 */
export function makeShader(vertex, fragment, resources) {
  return Shader.from({
    gl: { vertex: VERT_HEAD + vertex, fragment: FRAG_HEAD + fragment, preferredFragmentPrecision: 'highp' },
    resources,
  });
}

/**
 * Mesh with a custom shader, placed in the global draw order.
 * @param {Geometry} geometry @param {Shader} shader @param {number} order
 * @param {{ additive?: boolean }} [opts]
 */
export function shaderMesh(geometry, shader, order, opts = {}) {
  const mesh = new Mesh({ geometry, shader });
  mesh.zIndex = order;
  if (opts.additive) mesh.blendMode = 'add';
  return mesh;
}

/**
 * Quad mesh covering a world rect (x, y top-left, y down) with a custom shader.
 * The shader receives `vUv` (0..1, v=0 at the TOP) and `vWorld` (world x, y down).
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {Shader} shader @param {number} order @param {{ additive?: boolean }} [opts]
 */
export function shaderRect(x, y, w, h, shader, order, opts) {
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]), format: 'float32x2' },
      aUV: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' },
    },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
  return shaderMesh(geometry, shader, order, opts);
}

/** Vertex shader body for shaderRect: passes uv and world position (y down). */
export const RECT_VERT = /* glsl */ `
  in vec2 aUV;
  out vec2 vUv;
  out vec2 vWorld;
  void main() {
    vUv = aUV;
    vWorld = aPosition;
    gl_Position = toClip(aPosition);
  }
`;

/**
 * Unit quad for instanced meshes: x across -0.5..0.5, y along 0..1 (or -1..1 when `centered`).
 * @param {boolean} centered
 */
export function unitQuad(centered) {
  const p = centered ? [-1, -1, 1, -1, 1, 1, -1, 1] : [-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1];
  return { aPosition: { buffer: new Float32Array(p), format: /** @type {const} */ ('float32x2') } };
}

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
 * 0xRRGGBB -> vec3 uniform value (0..1 per channel, colours used as-is: no colour management).
 * @param {number} hex
 */
export function col(hex) {
  return new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);
}

/** @param {number} hex */
export const vec3 = (hex) => ({ value: col(hex), type: /** @type {const} */ ('vec3<f32>') });
/** @param {number} v */
export const f32 = (v) => ({ value: v, type: /** @type {const} */ ('f32') });
