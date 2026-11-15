// @ts-check
// Batching helpers for the 3D build: many meshes, few draw calls.
//   InstanceBatch - one InstancedMesh: one geometry repeated with a per-instance matrix
//                   and colour (boxes, beams, cylinders, spheres, rocks)
//   MergeBatch    - different primitives merged into ONE geometry with vertex colours
//                   (hunters, drone body, lamp fixtures)
// Input coordinates are scene world units (x right, y DOWN); z is local depth
// (0 = front plane of the group, negative = further away). See stage.js lx / ly.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lx, ly } from '../stage.js';

/**
 * Hex sRGB colour -> THREE.Color (converted to linear: colour management is on in 3D).
 * @param {number} hex
 */
export function col(hex) {
  return new THREE.Color(hex);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class InstanceBatch {
  /** @param {THREE.BufferGeometry} geometry unit-sized geometry */
  constructor(geometry) {
    this.geometry = geometry;
    /** @type {number[]} */ this.mats = [];
    /** @type {number[]} */ this.cols = [];
  }

  /**
   * @param {THREE.Vector3Like} pos @param {THREE.Euler} rot @param {THREE.Vector3Like} scale
   * @param {number} color 0xRRGGBB @param {number} [mul] colour multiplier (emissive > 1 blooms)
   */
  add(pos, rot, scale, color, mul = 1) {
    _m.compose(_p.set(pos.x, pos.y, pos.z), _q.setFromEuler(rot), _s.set(scale.x, scale.y, scale.z));
    this.mats.push(..._m.elements);
    _c.setHex(color).multiplyScalar(mul);
    this.cols.push(_c.r, _c.g, _c.b);
    return this;
  }

  /**
   * Axis-aligned box: x..x+w, y..y+h (y down), z from z0 back to z0 - zd.
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {number} z0 @param {number} zd @param {number} color @param {number} [mul]
   */
  box(x, y, w, h, z0, zd, color, mul) {
    return this.add({ x: lx(x + w / 2), y: ly(y + h / 2), z: z0 - zd / 2 }, _e.set(0, 0, 0), { x: w, y: h, z: zd }, color, mul);
  }

  /**
   * Straight beam from (x1,y1) to (x2,y2) with a square-ish cross-section (unit box geometry),
   * or a pipe (unit cylinder geometry along Y).
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
   * @param {number} thick @param {number} z centre z @param {number} zd depth
   * @param {number} color @param {boolean} [cylinder] geometry is a Y-axis cylinder
   */
  beam(x1, y1, x2, y2, thick, z, zd, color, cylinder = false) {
    const X1 = lx(x1), Y1 = ly(y1), X2 = lx(x2), Y2 = ly(y2);
    const len = Math.hypot(X2 - X1, Y2 - Y1);
    const a = Math.atan2(Y2 - Y1, X2 - X1);
    const pos = { x: (X1 + X2) / 2, y: (Y1 + Y2) / 2, z };
    if (cylinder) return this.add(pos, _e.set(0, 0, a - Math.PI / 2), { x: thick, y: len, z: thick }, color);
    return this.add(pos, _e.set(0, 0, a), { x: len, y: thick, z: zd }, color);
  }

  /**
   * @param {THREE.Material} material
   * @returns {THREE.InstancedMesh}
   */
  build(material) {
    const n = this.cols.length / 3;
    const mesh = new THREE.InstancedMesh(this.geometry, material, Math.max(1, n));
    mesh.count = n;
    if (n) {
      mesh.instanceMatrix.array.set(this.mats);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cols), 3);
      mesh.computeBoundingSphere();
    }
    mesh.visible = n > 0;
    return mesh;
  }
}

export class MergeBatch {
  constructor() {
    /** @type {THREE.BufferGeometry[]} */ this.parts = [];
  }

  /**
   * Add a primitive (it is consumed: transformed in place and coloured).
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Vector3Like} pos local position (already in X/Y/Z, y up)
   * @param {number} color @param {THREE.Euler} [rot] @param {THREE.Vector3Like} [scale]
   * @param {number} [mul] colour multiplier
   */
  add(geo, pos, color, rot, scale, mul = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _m.compose(_p.set(pos.x, pos.y, pos.z), _q.setFromEuler(rot ?? _e.set(0, 0, 0)), _s.set(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1));
    g.applyMatrix4(_m);
    _c.setHex(color).multiplyScalar(mul);
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    this.parts.push(g);
    return this;
  }

  /** @param {THREE.Material} material */
  build(material) {
    const geo = this.parts.length ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry();
    if (!geo) throw new Error('MergeBatch: mergeGeometries failed (attribute mismatch)');
    return new THREE.Mesh(geo, material);
  }
}

/** Shared unit geometries. */
export const UNIT = Object.freeze({
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  plane: new THREE.PlaneGeometry(1, 1),
});

/**
 * TubeGeometry along a CatmullRom curve through the points, tapered linearly from radius
 * r0 at the first point to r1 at the last.
 * @param {THREE.Vector3[]} points @param {number} r0 @param {number} r1
 * @param {number} [radial] @param {number} [segPerPoint]
 */
export function taperedTube(points, r0, r1, radial = 6, segPerPoint = 4) {
  const curve = new THREE.CatmullRomCurve3(points);
  const seg = Math.max(2, (points.length - 1) * segPerPoint);
  const tube = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = tube.getAttribute('position');
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c); // TubeGeometry samples the curve with getPointAt too
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  tube.computeVertexNormals();
  return tube;
}
