// @ts-check
// Rock lower right and the low mound at the bottom centre: extruded outlines with
// instanced, jittered boulders on their faces. Red organic growth: every tendril is a
// tapered TubeGeometry along a CatmullRom curve over the rock, all merged into one mesh;
// glowing pods are emissive instanced spheres with pulsing halos.

import * as THREE from 'three';
import { InstanceBatch, MergeBatch, UNIT, taperedTube } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { lx, ly } from '../stage.js';
import { makeRng } from '@fw-eval/shared/rng.js';
import { pointInPolygon } from '@fw-eval/shared/scene.js';

const ROCK_FRONT = 14; // front face z of the rock (slightly in front of the platforms)

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createGrowth(scene, ctx) {
  const P = scene.palette;
  const g = scene.growth;
  const rng = makeRng(scene.seed * 31 + 7); // only for surface detail
  const group = new THREE.Group();

  // rock masses: extruded outlines (flat-shaded, wet)
  const rockMat = new THREE.MeshStandardMaterial({ color: P.rock, roughness: 0.85, metalness: 0.1, flatShading: true, envMap: ctx.env, envMapIntensity: 0.3 });
  for (const [outline, depth] of /** @type {[typeof g.rock, number][]} */ ([[g.rock, 70], [g.mound, 50]])) {
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(lx(p.x), ly(p.y >= 399 ? 460 : p.y))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 8, bevelSize: 6, bevelSegments: 2, curveSegments: 4 });
    const m = new THREE.Mesh(geo, rockMat);
    m.position.z = ROCK_FRONT - depth - 8;
    group.add(m);
  }

  // boulders on the rock faces: a jittered icosahedron, instanced
  const boulderGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const pos = boulderGeo.getAttribute('position');
    const r = makeRng(5);
    /** @type {Map<string, number>} */ const jitter = new Map(); // same jitter for shared vertices
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!jitter.has(key)) jitter.set(key, r.range(0.75, 1.15));
      const k = /** @type {number} */ (jitter.get(key));
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    boulderGeo.computeVertexNormals();
  }
  const boulders = new InstanceBatch(boulderGeo);
  const euler = new THREE.Euler();
  for (let i = 0; i < 70; i++) {
    const x = rng.range(850, 1240), y = rng.range(230, 400);
    if (!pointInPolygon(g.rock, x, y - 8)) continue;
    const s = rng.range(6, 16);
    boulders.add({ x: lx(x), y: ly(y), z: ROCK_FRONT + rng.range(-4, 3) }, euler.set(rng.range(0, 3), rng.range(0, 3), 0), { x: s * 1.3, y: s, z: s * 0.8 }, rng.chance(0.5) ? P.rockLight : 0x1d1916);
  }
  for (let i = 0; i < 18; i++) {
    const x = rng.range(580, 840), y = rng.range(368, 400);
    const s = rng.range(4, 10);
    boulders.add({ x: lx(x), y: ly(y), z: ROCK_FRONT + rng.range(-4, 2) }, euler.set(rng.range(0, 3), rng.range(0, 3), 0), { x: s * 1.4, y: s, z: s }, P.rockLight);
  }
  group.add(boulders.build(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1, flatShading: true, envMap: ctx.env, envMapIntensity: 0.6 })));

  // tendrils: tapered tubes crawling over the rock front
  const tendrils = new MergeBatch();
  g.tendrils.forEach((td, ti) => {
    const pts = td.points.map((p, k) => new THREE.Vector3(lx(p.x), ly(p.y), ROCK_FRONT + 4 + Math.sin(k * 1.3 + ti) * 3));
    const tube = taperedTube(pts, td.width * 0.9, td.width * 0.18);
    tendrils.add(tube, { x: 0, y: 0, z: 0 }, ti % 3 === 0 ? 0x6a141c : P.growthMid);
  });
  group.add(tendrils.build(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.3, metalness: 0.1, emissive: P.growth, emissiveIntensity: 0.4, envMap: ctx.env, envMapIntensity: 0.8,
  })));

  // fleshy masses and glowing pods
  const flesh = new InstanceBatch(UNIT.sphere);
  const pods = new InstanceBatch(UNIT.sphere);
  const glows = new GlowBatch();
  g.pods.forEach((p, i) => {
    flesh.add({ x: lx(p.x), y: ly(p.y + 2), z: ROCK_FRONT + 2 }, euler.set(0, 0, 0), { x: p.r * 4.4, y: p.r * 3.2, z: p.r * 2 }, P.growth);
    pods.add({ x: lx(p.x), y: ly(p.y), z: ROCK_FRONT + 3 + p.r * 0.6 }, euler.set(0, 0, 0), { x: p.r * 1.6, y: p.r * 1.6, z: p.r * 1.2 }, 0xc02a1a, 2.2);
    glows.add(p.x, p.y, ROCK_FRONT + 6 + p.r, p.r * 3, p.r * 2.6, g.glow, 0.35, BLINK.pulse, i);
  });
  group.add(flesh.build(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 })));
  group.add(pods.build(new THREE.MeshBasicMaterial({ color: 0xffffff })));
  group.add(glows.build({ time: ctx.time }));

  return { parts: [group] };
}
