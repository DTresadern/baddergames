// @ts-check
// three.js 2D build: bootstrap, bench hook wiring and the frame loop.
//
// Structure (mirrored by the other builds):
//   main.js     this file: renderer, camera, layer assembly, loop
//   stage.js    draw order (ORDER) and shared per-frame uniforms (time, camera, cone)
//   layers/     one module per scene element group, each returns { parts, update? }
//   effects/    reusable drawing helpers: ShapeBatch, GlowBatch, surface shaders
//
// Page options come from the URL (see shared/stress.js parseStress):
//   2d.html?rain=4000&lights=8&objects=1&seed=1&t=12   (t freezes time for screenshots)

import { installBench } from '@fw-eval/shared/bench-hook.js';
import * as THREE from 'three';
import { buildScene, cameraX, parallaxOffset } from '@fw-eval/shared/scene.js';
import { createCtx } from './stage.js';
import { createSky, createMist } from './layers/sky.js';
import { createCity } from './layers/city.js';
import { createTrain } from './layers/train.js';
import { createBillboards } from './layers/billboards.js';
import { createSmoke } from './layers/smoke.js';
import { createStructures } from './layers/structures.js';
import { createBridge } from './layers/bridge.js';
import { createClutter } from './layers/clutter.js';
import { createLights } from './layers/lights.js';
import { createGrowth } from './layers/growth.js';
import { createHunters } from './layers/hunters.js';
import { createDrone } from './layers/drone.js';
import { createDrips } from './layers/drips.js';
import { createRain } from './layers/rain.js';

const WIDTH = 1800, HEIGHT = 600; // canvas pixels, 3:1, DPR 1

/** @type {THREE.WebGLRenderer} */
let renderer;
const bench = installBench({
  framework: 'threejs',
  mode: '2d',
  version: THREE.REVISION,
  getFrameworkDrawCalls: () => renderer.info.render.calls,
});
const { stress, seed, t: frozenT } = bench.params;

// Colours in this project are plain sRGB hex values, used as-is (like PixiJS does).
// Turning off three.js colour management and writing linear output keeps them unchanged.
THREE.ColorManagement.enabled = false;

renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required');
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.setClearColor(0x000000, 1);
document.getElementById('app')?.appendChild(renderer.domElement);

// letterbox: keep 3:1 and fit the window; the drawing buffer stays 1800x600
function fit() {
  const s = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
  renderer.domElement.style.width = `${Math.floor(WIDTH * s)}px`;
  renderer.domElement.style.height = `${Math.floor(HEIGHT * s)}px`;
}
window.addEventListener('resize', fit);
fit();

// world x 0..1200, y 0..400 (y down) -> three.js x 0..1200, y 0..-400
const camera = new THREE.OrthographicCamera(0, 1200, 0, -400, -10, 10);

const world = buildScene(seed, stress);
const ctx = createCtx();
const layers = [
  createSky(world),
  createCity(world),
  createTrain(world, ctx),
  createBillboards(world, ctx),
  createSmoke(world),
  createStructures(world, ctx),
  createBridge(world, ctx),
  createClutter(world),
  createGrowth(world, ctx),
  createHunters(world, ctx),
  createLights(world, ctx),
  createDrone(world, ctx),
  createDrips(world, ctx),
  createRain(world, ctx),
  createMist(world, ctx),
];
const scene3 = new THREE.Scene();
const parts = layers.flatMap((l) => l.parts);
for (const p of parts) scene3.add(p.object);

const start = performance.now();
let first = true;

function frame() {
  requestAnimationFrame(frame);
  bench.frameBegin();
  const t = frozenT ?? (performance.now() - start) / 1000;
  ctx.time.value = t;
  ctx.cameraX.value = cameraX(world, t);
  for (const p of parts) p.object.position.x = parallaxOffset(world, p.depth, t);
  for (const l of layers) l.update?.(t);
  renderer.render(scene3, camera);
  bench.frameEnd();
  if (first) {
    first = false;
    bench.markFirstFrame();
    bench.setInfo({ triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? null });
  }
}
requestAnimationFrame(frame);
