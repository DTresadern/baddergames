// @ts-check
// PixiJS 2D build: bootstrap, bench hook wiring and the frame loop.
//
// Structure (mirrors the three.js 2D build file for file):
//   main.js     this file: Application, layer assembly, draw order, loop
//   stage.js    draw order (ORDER) and the shared per-frame uniforms (time, camera, cone)
//   layers/     one module per scene element group, each returns { parts, update? }
//   effects/    reusable drawing helpers: ShapeBatch (Graphics), GlowBatch, surface shaders
//
// Page options come from the URL (see shared/stress.js parseStress):
//   2d.html?rain=4000&lights=8&objects=1&seed=1&t=12   (t freezes time for screenshots)

import { installBench } from '@fw-eval/shared/bench-hook.js';
import { Application, Container, RenderLayer, VERSION } from 'pixi.js';
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

const WIDTH = 1800, HEIGHT = 600; // canvas pixels, 3:1, resolution 1

// PixiJS 8.23 has no public per-frame draw-call counter (no renderer stat for it in the
// package source), so getFrameworkDrawCalls is not passed; the hook's own WebGL
// wrapper still counts every draw.
const bench = installBench({ framework: 'pixijs', mode: '2d', version: VERSION });
const { stress, seed, t: frozenT } = bench.params;

async function main() {
  const app = new Application();
  await app.init({
    width: WIDTH, height: HEIGHT, resolution: 1, antialias: true,
    preference: 'webgl', preferWebGLVersion: 2, powerPreference: 'high-performance',
    background: 0x000000,
    // no ticker: the loop below calls renderer.render() itself, once per frame
    autoStart: false,
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

  // world x 0..1200, y 0..400 (y down, like PixiJS) -> canvas 1800x600
  const root = new Container();
  root.scale.set(WIDTH / 1200);
  app.stage.addChild(root);

  const scene = buildScene(seed, stress);
  const ctx = createCtx();
  const layers = [
    createSky(scene),
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
    createMist(scene, ctx),
  ];
  const parts = layers.flatMap((l) => l.parts);
  for (const p of parts) root.addChild(p.object);

  // Global painter's order: every drawable leaf carries zIndex = ORDER value; one sorted
  // RenderLayer draws them in that order while their transforms still come from their parts.
  const order = new RenderLayer({ sortableChildren: true });
  root.addChild(order);
  /** @param {Container} o @returns {Container[]} */
  const leaves = (o) => (o.children.length ? o.children.flatMap(leaves) : [o]);
  const drawables = parts.flatMap((p) => leaves(p.object));
  order.attach(...drawables);

  const uniforms = ctx.frame.uniforms;
  const start = performance.now();
  let first = true;

  function loop() {
    requestAnimationFrame(loop);
    bench.frameBegin();
    const t = frozenT ?? (performance.now() - start) / 1000;
    uniforms.uTime = t;
    uniforms.uCameraX = cameraX(scene, t);
    for (const p of parts) p.object.x = parallaxOffset(scene, p.depth, t);
    for (const l of layers) l.update?.(t);
    app.renderer.render(app.stage);
    bench.frameEnd();
    if (first) {
      first = false;
      bench.markFirstFrame();
      bench.setInfo({ drawables: drawables.length, renderer: app.renderer.name, webgl2: true });
    }
  }
  requestAnimationFrame(loop);
}

main().catch((e) => { console.error(e); throw e; });
