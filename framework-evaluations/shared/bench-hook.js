// @ts-check
// In-page benchmark instrumentation, identical for all four builds.
// No dependency on three.js or PixiJS: it measures through browser APIs only.
//
// Usage in a build's main.js (import this module FIRST, before the framework
// creates its WebGL context, so the draw-call wrappers are in place):
//
//   import { installBench } from '@fw-eval/shared/bench-hook.js';
//   const bench = installBench({ framework: 'threejs', mode: '2d', version: REVISION,
//                                getFrameworkDrawCalls: () => renderer.info.render.calls });
//   function loop() {
//     bench.frameBegin();
//     renderer.render(scene, camera);
//     bench.frameEnd();
//     if (first) bench.markFirstFrame();
//     requestAnimationFrame(loop);
//   }
//
// The runner (bench/run.js) then reads `window.__bench`:
//   ready, framework, mode, version, stress, seed, t, startup, gl,
//   sample(nFrames) -> Promise<FrameStats>, heap()
//
// GPU sync (`?sync=1`, which the runner always sets): after each frame the hook reads one
// pixel back from the renderer's context. readPixels waits until the GPU has finished the
// frame, so each frame's time includes its GPU work. Without it, an uncapped headless page
// queues frames and then blocks in bursts, so per-frame percentiles describe the queue,
// not the frame. The readback adds its own cost, which differs between builds.

import { parseStress } from './stress.js';

/**
 * @typedef {{ frames: number, mean: number, p50: number, p95: number, p99: number,
 *   min: number, max: number, fps: number, cpuMean: number, cpuP95: number,
 *   drawCalls: number, drawCallsMax: number, frameworkDrawCalls: number | null }} FrameStats
 */

const MODULE_START = performance.now();
const RING = 4096;

/** Draw-call methods that issue GPU draws, wrapped on every context prototype below. */
const DRAW_METHODS = [
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
  'drawRangeElements',
];
/** Extension methods (WEBGL_multi_draw and ANGLE_instanced_arrays). multiDraw counts drawcount draws. */
const EXT_METHODS = {
  multiDrawArraysWEBGL: 'multi', multiDrawElementsWEBGL: 'multi',
  multiDrawArraysInstancedWEBGL: 'multi', multiDrawElementsInstancedWEBGL: 'multi',
  multiDrawArraysInstancedBaseInstanceWEBGL: 'multi', multiDrawElementsInstancedBaseVertexBaseInstanceWEBGL: 'multi',
  drawArraysInstancedBaseInstanceWEBGL: 'single', drawElementsInstancedBaseVertexBaseInstanceWEBGL: 'single',
  drawArraysInstancedANGLE: 'single', drawElementsInstancedANGLE: 'single',
};

let installed = false;
let drawCount = 0; // draws since the last frameBegin
let setupDraws = 0; // draws issued outside frameBegin/frameEnd
let inFrame = false;
/** @type {(WebGLRenderingContext | WebGL2RenderingContext)[]} */
const contexts = [];

function countDraw(n = 1) {
  if (inFrame) drawCount += n;
  else setupDraws += n;
}

function wrapPrototypes() {
  for (const Ctx of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!Ctx) continue;
    const proto = /** @type {any} */ (Ctx.prototype);
    for (const name of DRAW_METHODS) {
      const original = proto[name];
      if (typeof original !== 'function' || original.__benchWrapped) continue;
      /** @this {any} @param {any[]} args */
      const wrapped = function (...args) {
        countDraw(1);
        return original.apply(this, args);
      };
      wrapped.__benchWrapped = true;
      proto[name] = wrapped;
    }
    // extension objects are created on demand: wrap them as they are handed out
    const getExtension = proto.getExtension;
    if (typeof getExtension === 'function' && !getExtension.__benchWrapped) {
      /** @this {any} @param {string} name */
      const wrappedGet = function (name) {
        const ext = getExtension.call(this, name);
        if (ext && !ext.__benchWrapped) {
          for (const [method, kind] of Object.entries(EXT_METHODS)) {
            const fn = ext[method];
            if (typeof fn !== 'function') continue;
            /** @this {any} @param {any[]} args */
            ext[method] = function (...args) {
              // multiDraw*(mode, ...arrays, drawcount): drawcount is the last argument
              countDraw(kind === 'multi' ? Number(args[args.length - 1]) || 0 : 1);
              return fn.apply(this, args);
            };
          }
          try { ext.__benchWrapped = true; } catch { /* frozen object: fine */ }
        }
        return ext;
      };
      wrappedGet.__benchWrapped = true;
      proto.getExtension = wrappedGet;
    }
  }
  // remember every WebGL context so we can report the GPU string
  const canvasProto = /** @type {any} */ (HTMLCanvasElement.prototype);
  const getContext = canvasProto.getContext;
  canvasProto.getContext = function (/** @type {string} */ type, /** @type {any} */ opts) {
    const ctx = getContext.call(this, type, opts);
    if (ctx && /webgl/.test(type) && !contexts.includes(ctx)) contexts.push(ctx);
    return ctx;
  };
}

/** @param {number[]} sorted @param {number} p 0..1 */
function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** @param {number} v */
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Install the instrumentation and expose `window.__bench`.
 * @param {{ framework: string, mode: string, version: string,
 *           getFrameworkDrawCalls?: () => number }} options
 */
export function installBench({ framework, mode, version, getFrameworkDrawCalls }) {
  if (!installed) {
    wrapPrototypes();
    installed = true;
  }
  const search = new URLSearchParams(location.search);
  const params = parseStress(search);
  const gpuSync = search.get('sync') === '1';
  const syncPixel = new Uint8Array(4);
  /** @type {WebGLRenderingContext | WebGL2RenderingContext | null} */
  let syncGl = null;

  // ring buffers, one entry per frame
  const interval = new Float64Array(RING); // ms between successive frameBegin calls (rAF interval)
  const cpu = new Float64Array(RING); // ms between frameBegin and frameEnd (JS + GL submit time)
  const draws = new Float64Array(RING);
  const fwDraws = new Float64Array(RING);
  let frameIndex = 0;
  let lastBegin = 0;
  let beginAt = 0;
  /** @type {{ target: number, resolve: () => void }[]} */
  const waiters = [];

  const startup = {
    moduleStartMs: r3(MODULE_START), // since navigation start (performance.timeOrigin)
    firstFrameMs: /** @type {number | null} */ (null), // first render submitted
    firstFramePresentedMs: /** @type {number | null} */ (null), // next animation frame after it
    navigation: /** @type {Record<string, number> | null} */ (null),
  };

  /** @param {number} from frame index (inclusive) @param {number} to (exclusive) @returns {FrameStats} */
  function stats(from, to) {
    const n = Math.min(to - from, RING);
    const iv = [], cp = [];
    let dSum = 0, dMax = 0, fSum = 0;
    for (let k = to - n; k < to; k++) {
      const j = k % RING;
      iv.push(interval[j]);
      cp.push(cpu[j]);
      dSum += draws[j];
      dMax = Math.max(dMax, draws[j]);
      fSum += fwDraws[j];
    }
    const sortedIv = [...iv].sort((a, b) => a - b);
    const sortedCp = [...cp].sort((a, b) => a - b);
    const mean = iv.reduce((a, b) => a + b, 0) / (n || 1);
    return {
      frames: n,
      mean: r3(mean),
      p50: r3(quantile(sortedIv, 0.5)),
      p95: r3(quantile(sortedIv, 0.95)),
      p99: r3(quantile(sortedIv, 0.99)),
      min: r3(sortedIv[0] ?? 0),
      max: r3(sortedIv[n - 1] ?? 0),
      fps: r3(mean > 0 ? 1000 / mean : 0),
      cpuMean: r3(cp.reduce((a, b) => a + b, 0) / (n || 1)),
      cpuP95: r3(quantile(sortedCp, 0.95)),
      drawCalls: r3(dSum / (n || 1)),
      drawCallsMax: dMax,
      frameworkDrawCalls: getFrameworkDrawCalls ? r3(fSum / (n || 1)) : null,
    };
  }

  function frameBegin() {
    const now = performance.now();
    beginAt = now;
    if (lastBegin) interval[frameIndex % RING] = now - lastBegin;
    lastBegin = now;
    drawCount = 0;
    inFrame = true;
  }

  function frameEnd() {
    inFrame = false;
    const submitted = performance.now(); // JS + GL submit, before any GPU wait
    if (gpuSync) {
      // readPixels from whatever framebuffer the framework left bound (the canvas after
      // a normal render); no GL state is changed, so framework state caches stay valid
      syncGl ??= rendererContext();
      syncGl?.readPixels(0, 0, 1, 1, syncGl.RGBA, syncGl.UNSIGNED_BYTE, syncPixel);
    }
    const j = frameIndex % RING;
    // the first frame has no previous frame: count its interval as its CPU time
    if (frameIndex === 0) interval[j] = performance.now() - beginAt;
    cpu[j] = submitted - beginAt;
    draws[j] = drawCount;
    fwDraws[j] = getFrameworkDrawCalls ? getFrameworkDrawCalls() : 0;
    frameIndex++;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (frameIndex >= waiters[i].target) {
        waiters.splice(i, 1)[0].resolve();
      }
    }
  }

  function markFirstFrame() {
    if (startup.firstFrameMs !== null) return;
    startup.firstFrameMs = r3(performance.now());
    requestAnimationFrame(() => {
      startup.firstFramePresentedMs = r3(performance.now());
      const nav = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0]);
      if (nav) {
        startup.navigation = {
          responseEndMs: r3(nav.responseEnd),
          domInteractiveMs: r3(nav.domInteractive),
          domContentLoadedMs: r3(nav.domContentLoadedEventEnd),
          loadEventEndMs: r3(nav.loadEventEnd),
          transferBytes: nav.transferSize,
        };
      }
      bench.ready = true;
    });
  }

  /**
   * GPU/driver strings from the renderer's WebGL context. Frameworks may create
   * throwaway probe contexts first (PixiJS creates a support probe it then loses and a
   * 1x1 test context), so take the last live context whose canvas is in the page,
   * falling back to the last live one.
   */
  function rendererContext() {
    const live = contexts.filter((c) => !c.isContextLost());
    const onPage = live.filter((c) => c.canvas instanceof HTMLCanvasElement && c.canvas.isConnected);
    return onPage.at(-1) ?? live.at(-1) ?? null;
  }

  function glInfo() {
    const gl = rendererContext();
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      version: gl.getParameter(gl.VERSION),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      antialias: gl.getContextAttributes()?.antialias ?? null,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      gpuSync,
    };
  }

  const bench = {
    ready: false,
    framework,
    mode,
    version,
    stress: params.stress,
    seed: params.seed,
    t: params.t,
    startup,
    /** setup draws (outside frameBegin/frameEnd), e.g. shader warm-up */
    get setupDrawCalls() { return setupDraws; },
    get frames() { return frameIndex; },
    /** free-form build info (e.g. triangle counts), set by the build */
    info: /** @type {Record<string, unknown>} */ ({}),
    gl: glInfo,
    /**
     * Resolve with statistics over the next n frames.
     * @param {number} n
     * @returns {Promise<FrameStats>}
     */
    sample(n) {
      const start = frameIndex;
      return new Promise((resolve) => {
        waiters.push({ target: start + n, resolve: () => resolve(stats(start, start + n)) });
      });
    },
    /** JS heap from performance.memory (Chromium only), bytes. */
    heap() {
      const m = /** @type {any} */ (performance).memory;
      return m ? { usedJSHeapSize: m.usedJSHeapSize, totalJSHeapSize: m.totalJSHeapSize } : null;
    },
  };
  /** @type {any} */ (window).__bench = bench;

  return {
    frameBegin,
    frameEnd,
    markFirstFrame,
    /** page options parsed from the URL: { stress, seed, t } */
    params,
    /** @param {Record<string, unknown>} info */
    setInfo(info) { Object.assign(bench.info, info); },
  };
}
