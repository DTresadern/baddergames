// @ts-check
// Patrol drone (depth 0.5) with a REAL SpotLight searchlight and a visible cone mesh:
// an open cone drawn additively, fading along its length and towards its silhouette
// (view-angle fade), which reads as a volumetric beam. Position and sweep from droneState().
// The cone's world-space apex/direction go to ctx so the rain shader lights drops inside it.

import * as THREE from 'three';
import { MergeBatch } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { fragmentTail } from '../effects/materials.js';
import { depthGroup, lx, ly } from '../stage.js';
import { droneState } from '@fw-eval/shared/scene.js';

const CONE_VERT = /* glsl */ `
  uniform float uLength;
  varying float vAlong;
  varying float vFacing;
  void main() {
    vAlong = -position.y / uLength;           // 0 at the lens, 1 at the far end
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));  // 1 facing the camera, 0 at the silhouette
    gl_Position = projectionMatrix * mv;
  }
`;
const CONE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlong;
  varying float vFacing;
  void main() {
    float along = clamp(vAlong, 0.0, 1.0);
    float facing = clamp(vFacing, 0.0, 1.0);
    float a = pow(1.0 - along, 1.6) * facing * facing;
    a += 0.5 * (1.0 - smoothstep(0.0, 0.1, along));
    gl_FragColor = vec4(uColor * a * 0.32, 1.0);
    ${fragmentTail('')}
  }
`;

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createDrone(scene, ctx) {
  const P = scene.palette;
  const dr = scene.drone;
  const w = dr.bodyW, h = dr.bodyH;
  const g = depthGroup(dr.depth);

  // body around (0,0), y up
  const b = new MergeBatch();
  b.add(new THREE.BoxGeometry(w, h, 26), { x: 0, y: 0, z: 0 }, P.gunmetalLight);
  b.add(new THREE.BoxGeometry(w * 0.55, h * 0.45, 18), { x: -w * 0.03, y: h * 0.65, z: 0 }, P.gunmetal);
  b.add(new THREE.BoxGeometry(w * 1.3, 3, 3), { x: 0, y: h * 0.55, z: 0 }, P.gunmetalDark); // rotor arm
  b.add(new THREE.BoxGeometry(3, 3, 40), { x: 0, y: h * 0.55, z: 0 }, P.gunmetalDark);
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(3, 3, 6, 8), { x: sx * w * 0.62, y: h * 0.7, z: 0 }, P.gunmetal);
    b.add(new THREE.CylinderGeometry(3, 3, 6, 8), { x: 0, y: h * 0.7, z: sx * 18 }, P.gunmetal);
  }
  b.add(new THREE.BoxGeometry(6, 6, 4), { x: -w * 0.12, y: -h * 0.65, z: 6 }, P.gunmetalDark); // landing struts
  b.add(new THREE.BoxGeometry(6, 6, 4), { x: w * 0.08, y: -h * 0.65, z: -6 }, P.gunmetalDark);
  b.add(new THREE.CylinderGeometry(6, 7, 13, 12), { x: w * 0.32 + 6, y: -h * 0.15, z: 0 }, P.gunmetalDark, new THREE.Euler(0, 0, Math.PI / 2)); // searchlight housing
  const body = b.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7, envMap: ctx.env, envMapIntensity: 0.8 }));

  // blurred rotor discs
  const rotorMat = new THREE.MeshBasicMaterial({ color: P.steelHighlight, transparent: true, opacity: 0.18, depthWrite: false });
  const rotorGeo = new THREE.CylinderGeometry(13, 13, 0.5, 20);
  const craft = new THREE.Group();
  craft.add(body);
  for (const [x, z] of [[-w * 0.62, 0], [w * 0.62, 0], [0, -18], [0, 18]]) {
    const r = new THREE.Mesh(rotorGeo, rotorMat);
    r.position.set(x, h * 0.85, z);
    craft.add(r);
  }
  const lensPos = new THREE.Vector3(w * 0.32 + 13, -h * 0.15, 0);
  const lensMesh = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(dr.color).multiplyScalar(4) }));
  lensMesh.position.copy(lensPos);
  craft.add(lensMesh);
  const glows = new GlowBatch();
  glows.addLocal(lensPos, 18, 18, dr.color, 1.0);
  glows.addLocal(new THREE.Vector3(-w * 0.5, 0, 14), 6, 6, P.warningRed, 0.9, BLINK.red, 2);
  craft.add(glows.build({ time: ctx.time, core: 0.3 }));
  g.add(craft);

  // beam: open cone with its apex at the origin, pointing down -Y, in a pivot at the lens
  const L = dr.coneLength, radius = L * Math.tan(dr.coneHalfAngle);
  const coneGeo = new THREE.ConeGeometry(radius, L, 40, 1, true);
  coneGeo.translate(0, -L / 2, 0); // ConeGeometry's apex is at +L/2: move it to the origin, base at y = -L
  const cone = new THREE.Mesh(coneGeo, new THREE.ShaderMaterial({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
    uniforms: { uColor: { value: new THREE.Color(dr.color) }, uLength: { value: L } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  cone.frustumCulled = false;
  const pivot = new THREE.Group();
  pivot.add(cone);
  g.add(pivot);

  const spot = new THREE.SpotLight(dr.color, 2600, L * 2.2, dr.coneHalfAngle * 1.15, 0.45, 1);
  const target = new THREE.Object3D();
  g.add(spot, target);
  spot.target = target;

  const apex = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    object: g,
    update(t) {
      const s = droneState(scene, t);
      craft.position.set(lx(s.x), ly(s.y), 0);
      craft.rotation.z = -s.tilt;
      craft.updateMatrix();
      apex.copy(lensPos).applyMatrix4(craft.matrix); // lens in group coordinates
      // world angle (y down, 0 = right, +PI/2 = down) -> local direction (y up)
      dir.set(Math.cos(s.angle), -Math.sin(s.angle), 0);
      pivot.position.copy(apex);
      pivot.rotation.z = Math.PI / 2 - s.angle; // rotates -Y onto dir
      spot.position.copy(apex);
      target.position.copy(apex).addScaledVector(dir, 100);
      // world-space cone for the rain shader (group scale is uniform)
      g.updateMatrixWorld();
      ctx.coneApex.value.copy(apex).applyMatrix4(g.matrixWorld);
      ctx.coneDir.value.copy(dir);
      ctx.coneParams.value.set(Math.cos(dr.coneHalfAngle * 1.6), L * g.scale.x);
    },
  };
}
