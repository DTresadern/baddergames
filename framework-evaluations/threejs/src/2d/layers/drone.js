// @ts-check
// Patrol drone with a sweeping searchlight cone (position/angle from droneState()).

import * as THREE from 'three';
import { ShapeBatch, flatShader } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { ORDER } from '../stage.js';
import { droneState, parallaxOffset } from '@fw-eval/shared/scene.js';

const CONE_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const CONE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLength;
  uniform float uTanHalf;
  varying vec2 vLocal;
  void main() {
    float along = vLocal.x / uLength;                       // 0 at the lens, 1 at the far end
    float across = abs(vLocal.y) / max(0.001, vLocal.x * uTanHalf);  // 0 centre, 1 edge
    float a = pow(1.0 - along, 1.6) * (1.0 - smoothstep(0.55, 1.0, across));
    a += 0.6 * smoothstep(0.12, 0.0, along);                // hot spot at the lens
    gl_FragColor = vec4(uColor * a * 0.55, 1.0);
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

  // body, drawn around (0,0)
  const b = new ShapeBatch();
  b.line(-w * 0.62, -h * 0.55, w * 0.62, -h * 0.55, 3, P.gunmetalDark); // rotor arm
  for (const sx of [-1, 1]) {
    b.rect(sx * w * 0.62 - 3, -h * 0.75, 6, 6, P.gunmetal);
    b.circle(sx * w * 0.62, -h * 0.85, 13, P.steelHighlight, 0.18, 16, 0, Math.PI * 2, 2.2); // blurred rotor
  }
  b.rect(-w / 2, -h / 2, w, h, [P.gunmetalLight, P.gunmetalDark]);
  b.rect(-w * 0.3, -h * 0.85, w * 0.55, h * 0.4, P.gunmetal);
  b.rect(-w / 2, -h / 2, w, 1.5, P.steelHighlight, 0.6);
  b.rect(-w * 0.15, h * 0.5, 6, 6, P.gunmetalDark); // landing struts
  b.rect(w * 0.05, h * 0.5, 6, 6, P.gunmetalDark);
  b.rect(w * 0.32, h * 0.05, 12, 10, P.gunmetalDark); // searchlight housing
  b.circle(w * 0.32 + 12, h * 0.1 + 5, 4, P.amberPale);
  const body = b.build(ORDER.drone);

  const glows = new GlowBatch();
  glows.add(w * 0.32 + 12, h * 0.1 + 5, 18, 18, dr.color, 1.0); // lens (local coords, y down like the body)
  glows.add(-w * 0.5, 0, 6, 6, P.warningRed, 0.9, BLINK.red, 2);
  const lens = glows.build(ORDER.drone + 1, { time: ctx.time, core: 0.3 });

  // cone: apex at the lens, pointing along local +x
  const L = dr.coneLength, tanHalf = Math.tan(dr.coneHalfAngle);
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, L, L * tanHalf, 0, L, -L * tanHalf, 0], 3));
  const coneMat = flatShader({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, additive: true,
    uniforms: {
      uColor: { value: new THREE.Color().setHex(dr.color, THREE.LinearSRGBColorSpace) },
      uLength: { value: L }, uTanHalf: { value: tanHalf },
    },
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.renderOrder = ORDER.drone - 1;
  cone.frustumCulled = false;

  const craft = new THREE.Group();
  craft.add(body, lens);
  const lensLocal = new THREE.Vector2(w * 0.32 + 12, -(h * 0.1 + 5));
  const outer = new THREE.Group();
  outer.add(cone, craft);

  return {
    parts: [{ object: outer, depth: dr.depth }],
    update(t) {
      const s = droneState(scene, t);
      craft.position.set(s.x, -s.y, 0);
      craft.rotation.z = -s.tilt;
      // lens position in world space (y down) for the cone apex
      const c = Math.cos(-s.tilt), sn = Math.sin(-s.tilt);
      const lx = s.x + lensLocal.x * c - lensLocal.y * sn;
      const ly = -(-s.y + lensLocal.x * sn + lensLocal.y * c);
      cone.position.set(lx, -ly, 0);
      cone.rotation.z = -s.angle; // world angle is y-down; three.js rotation is y-up
      // the rain shader brightens drops inside the cone (world space, so add parallax)
      ctx.cone.value.set(lx + parallaxOffset(scene, dr.depth, t), ly, s.angle, dr.coneHalfAngle);
    },
  };
}
