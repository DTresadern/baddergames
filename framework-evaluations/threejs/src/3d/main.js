// @ts-check
// three.js 3D build: bootstrap, bench hook wiring and the frame loop.
//
// Structure (same in every build):
//   main.js     this file: renderer, camera, post-processing, layer assembly, loop
//   stage.js    world -> 3D mapping (depthGroup), camera constants, per-frame context
//   layers/     one module per scene element group, each returns { parts, update? }
//   effects/    batching (InstancedMesh / merged geometry), halos, materials, fog
//
// Page options come from the URL (see shared/stress.js parseStress):
//   3d.html?rain=4000&lights=8&objects=1&seed=1&t=12   (t freezes time for screenshots)
//   bloom=0 turns the bloom pass off (default on).

import { installBench } from '@fw-eval/shared/bench-hook.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildScene, cameraX } from '@fw-eval/shared/scene.js';
import { createCtx, D, CAM_H } from './stage.js';
import { installHazeFog, createEnvironment } from './effects/materials.js';
import { createSkyBackground, createMist } from './layers/sky.js';
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
  mode: '3d',
  version: THREE.REVISION,
  getFrameworkDrawCalls: () => renderer.info.render.calls,
});
const { stress, seed, t: frozenT } = bench.params;
const useBloom = new URLSearchParams(location.search).get('bloom') !== '0';

// Colour handling differs from the 2D build on purpose: lights and reflections need linear
// maths, so three.js colour management stays ON (hex colours are sRGB and converted to
// linear on input) and the output is converted back to sRGB. Unlit colours therefore come
// out unchanged, as in 2D. No tone mapping, so the palette is not shifted.
renderer = new THREE.WebGLRenderer({ antialias: !useBloom, powerPreference: 'high-performance' });
if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required');
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.setClearColor(0x000000, 1);
// several render calls per frame with post-processing: count them all, reset per frame
renderer.info.autoReset = false;
document.getElementById('app')?.appendChild(renderer.domElement);

function fit() {
  const s = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
  renderer.domElement.style.width = `${Math.floor(WIDTH * s)}px`;
  renderer.domElement.style.height = `${Math.floor(HEIGHT * s)}px`;
}
window.addEventListener('resize', fit);
fit();

// Camera at height CAM_H, D in front of the depth-0 plane, looking straight down -Z.
// Off-axis frustum: the depth-0 plane shows x 0..1200, y 0..400 exactly (see stage.js).
const NEAR = 40, FAR = D * 14;
const camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, NEAR, FAR);
camera.position.set(0, CAM_H, D);
{
  const k = NEAR / D;
  camera.projectionMatrix.makePerspective(-600 * k, 600 * k, (200 - CAM_H) * k, (-200 - CAM_H) * k, NEAR, FAR);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

const scene = buildScene(seed, stress);
const root = new THREE.Scene();
root.add(camera); // the mist overlay is a child of the camera
installHazeFog(root, scene);
const ctx = createCtx();
root.background = createSkyBackground(scene);
ctx.env = createEnvironment(renderer, scene);

// ambient: bruised-navy sky light from above, near-black bounce from below, and a cold
// rim light from the hazy city behind
root.add(new THREE.HemisphereLight(0x5a6c90, 0x0c0d10, 1.4));
const rim = new THREE.DirectionalLight(0x8090b0, 0.9);
rim.position.set(-300, 500, -600);
root.add(rim);
// weak cold fill from the camera side so the figures and crates read as forms
const fill = new THREE.DirectionalLight(0x7f8db0, 0.7);
fill.position.set(-200, 300, 800);
root.add(fill);

const layers = [
  createCity(scene),
  createTrain(scene, ctx),
  createBillboards(scene, ctx),
  createSmoke(scene),
  createStructures(scene, ctx),
  createBridge(scene, ctx),
  createClutter(scene),
  createGrowth(scene, ctx),
  createHunters(scene, ctx),
  createLights(scene, ctx),
  createDrone(scene, ctx),
  createDrips(scene, ctx),
  createRain(scene, ctx),
];
for (const l of layers) for (const p of l.parts) root.add(p);
// the mist is a screen overlay: its quad rides on the camera and draws after everything
const mist = createMist(scene, ctx);
for (const p of mist.parts) camera.add(p);

/** @type {Record<string, number>} */
const info = {};
for (const l of layers) Object.assign(info, l.info ?? {});

/** @type {EffectComposer | null} */
let composer = null;
if (useBloom) {
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  composer.setSize(WIDTH, HEIGHT);
  composer.addPass(new RenderPass(root, camera));
  // threshold 1.0: only emissive surfaces pushed above 1 (lamps, windows, screens, pods) bloom
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(WIDTH / 2, HEIGHT / 2), 0.7, 0.45, 1.0));
  composer.addPass(new OutputPass());
}

const start = performance.now();
let first = true;

function loop() {
  requestAnimationFrame(loop);
  bench.frameBegin();
  renderer.info.reset();
  const t = frozenT ?? (performance.now() - start) / 1000;
  ctx.time.value = t;
  camera.position.x = cameraX(scene, t);
  for (const l of layers) l.update?.(t);
  mist.update?.(t);
  if (composer) composer.render();
  else renderer.render(root, camera);
  bench.frameEnd();
  if (first) {
    first = false;
    bench.markFirstFrame();
    bench.setInfo({
      ...info,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? null,
      bloom: useBloom,
      pointLights: scene.lamps.length,
    });
  }
}
requestAnimationFrame(loop);
