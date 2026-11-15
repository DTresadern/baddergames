// @ts-check
// Sky: a gradient background texture. Mist: a soft rain veil and vignette on a screen
// quad that main.js attaches to the camera, drawn after everything.

import * as THREE from 'three';
import { frustumRect } from '../stage.js';
import { lerpColor } from '@fw-eval/shared/scene.js';
import { NOISE_GLSL, fragmentTail } from '../effects/materials.js';

/**
 * The sky is the scene background: a vertical gradient texture (generated in code, one
 * texel per world y) that fills the frame behind everything and does not move with the
 * camera, like the 2D sky. main.js assigns it to the scene's `background`.
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {THREE.DataTexture}
 */
export function createSkyBackground(scene) {
  const H = scene.world.height;
  const data = new Uint8Array(H * 4);
  const stops = scene.sky.stops;
  for (let y = 0; y < H; y++) {
    let i = 0;
    while (i < stops.length - 2 && y > stops[i + 1].y) i++;
    const a = stops[i], b = stops[i + 1];
    const c = lerpColor(a.color, b.color, Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y))));
    // texture row 0 is the bottom of the frame
    data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], (H - 1 - y) * 4);
  }
  const tex = new THREE.DataTexture(data, 1, H);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Overlay} parts in camera space: add them to the camera
 */
export function createMist(scene, ctx) {
  const dist = 60;
  const r = frustumRect(dist);
  const geo = new THREE.PlaneGeometry(r.right - r.left, r.top - r.bottom);
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 w = vec2(vUv.x * 1200.0, (1.0 - vUv.y) * 400.0); // world-like coords, y down
        vec2 p = vec2(w.x * 0.012 + w.y * 0.002, w.y * 0.004 - uTime * 0.35);
        float sheets = fbm(p * vec2(1.0, 3.0));
        float yd = 1.0 - vUv.y;
        float band = smoothstep(0.0, 0.45, yd) * (1.0 - smoothstep(0.75, 1.0, yd));
        float a = uOpacity * (0.35 + 0.9 * sheets) * (0.4 + 0.6 * band);
        // vignette: darker top edge and floor
        float dark = 0.35 * smoothstep(0.125, 0.0, yd) + 0.45 * smoothstep(0.775, 1.0, yd);
        vec3 c = uColor * a;
        gl_FragColor = vec4(c, a + dark);
        ${fragmentTail('')}
      }
    `,
    uniforms: {
      uTime: ctx.time,
      uColor: { value: new THREE.Color(scene.haze.far) },
      uOpacity: { value: scene.haze.mistOpacity },
    },
    // premultiplied "over": colour already multiplied by its own alpha, dark part adds alpha only
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set((r.left + r.right) / 2, (r.top + r.bottom) / 2, -dist);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  return { parts: [mesh] };
}
