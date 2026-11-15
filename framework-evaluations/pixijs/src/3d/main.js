// @ts-check
// PixiJS 3D build (pixi.js + @pixi/3d): bootstrap, bench hook wiring and the frame loop.
//
// Structure (mirrors threejs/src/2d):
//   main.js     this file: application, View3D, camera, lights, layer assembly, loop
//   stage.js    world -> 3D mapping (X, Y, Z, S, P3), the deck slope, per-frame context
//   layers/     one module per scene element group, each returns { nodes, update? }
//   effects/    MeshBuilder (merged procedural geometry), shared materials, glow sprites
//
// Page options come from the URL (see shared/stress.js parseStress):
//   3d.html?rain=4000&lights=8&objects=1&seed=1&t=12   (t freezes time for screenshots)
//
// The frame loop is manual (autoStart: false + requestAnimationFrame), so exactly one
// render sits between bench.frameBegin() and bench.frameEnd(), as in the three.js build.

import { installBench } from '@fw-eval/shared/bench-hook.js';
import { Application, VERSION } from 'pixi.js';
import { Container3D, DirectionalLight, View3D } from '@pixi/3d';
import { buildScene, cameraX } from '@fw-eval/shared/scene.js';
import { D, FOV, createCtx } from './stage.js';
import { createSky } from './layers/sky.js';
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

const WIDTH = 1800, HEIGHT = 600; // canvas pixels, 3:1, resolution 1

// Neither pixi.js 8.23 nor @pixi/3d 0.1.0 exposes a per-frame draw-call counter
// (no renderer.info equivalent), so only the hook's own WebGL count is reported.
const bench = installBench({ framework: 'pixijs', mode: '3d', version: `pixi.js ${VERSION} + @pixi/3d 0.1.0` });
const { stress, seed, t: frozenT } = bench.params;
const world = buildScene(seed, stress);
const P = world.palette;

const app = new Application();
await app.init({
  width: WIDTH,
  height: HEIGHT,
  resolution: 1,
  preference: 'webgl',
  antialias: true,
  autoStart: false,
  backgroundColor: P.skyMid,
  powerPreference: 'high-performance',
});
const gl = /** @type {any} */ (app.renderer).gl;
if (!(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required');
document.getElementById('app')?.appendChild(app.canvas);

// letterbox: keep 3:1 and fit the window; the drawing buffer stays 1800x600
function fit() {
  const s = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
  app.canvas.style.width = `${Math.floor(WIDTH * s)}px`;
  app.canvas.style.height = `${Math.floor(HEIGHT * s)}px`;
}
window.addEventListener('resize', fit);
fit();

// Distance haze: the view's exponential fog. Fog depth is the view-space distance, which
// is D * (1 + depth) here, so 1 - exp(-0.12 * (1 + depth)) gives 0.11 at the bridge
// (the 2D builds' rain mist) rising to 0.70 at depth 9, close to scene.js hazeAt().
const view = new View3D({
  width: WIDTH,
  height: HEIGHT,
  resolution: 1,
  environment: { skyColor: 0x56667e, groundColor: 0x1a1c22, intensity: 1.1 },
  fog: { type: 'exponential', color: 0x3c4a62, density: 0.12 / D },
  toneMapping: 'none',
  shadowQuality: 'medium',
});
app.stage.addChild(view);

const camera = view.camera;
camera.fov = FOV;
camera.near = 20;
camera.far = D * 14;
camera.position.set(0, 0, D);

const ctx = createCtx();
// cool moonlight from the upper left: shapes the boxes, no shadows (its box would span the whole city)
const moon = new DirectionalLight({ color: 0x9fb4d8, intensity: 1.1 });
moon.rotation.set(-0.7, -0.5, 0);
const layers = [
  createSky(world),
  createCity(world),
  createTrain(world),
  createBillboards(world, ctx),
  createSmoke(world),
  createStructures(world),
  createBridge(world),
  createClutter(world),
  createGrowth(world),
  createHunters(world),
  // the drone (its spot light) before the lamps: past 32 lights the last ones are dropped
  createDrone(world, ctx),
  createLights(world),
  createDrips(world),
  createRain(world, ctx),
];
// view.root also holds the camera; keep content in its own container
const content = new Container3D({ label: 'content' });
content.addChild(moon);
for (const l of layers) for (const n of l.nodes) content.addChild(n);
view.root.addChild(content);

/** @type {Record<string, number>} */
const info = {};
for (const l of layers) Object.assign(info, l.info ?? {});
bench.setInfo({ ...info, lightsShadedMax: 32, cameraDistance: Math.round(D) });

const start = performance.now();
let first = true;

function frame() {
  requestAnimationFrame(frame);
  bench.frameBegin();
  const t = frozenT ?? (performance.now() - start) / 1000;
  camera.position.x = cameraX(world, t);
  for (const m of ctx.timed) m.data.time = t;
  for (const l of layers) l.update?.(t);
  app.renderer.render(app.stage);
  bench.frameEnd();
  if (first) {
    first = false;
    bench.markFirstFrame();
  }
}
requestAnimationFrame(frame);
