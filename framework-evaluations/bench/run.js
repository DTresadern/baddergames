// @ts-check
// Benchmark runner for all four builds. Run from framework-evaluations/:
//
//   npm run bench                                  full run: every build x every stress level
//   npm run bench -- --quick                       base level only, fewer frames (smoke test)
//   npm run bench -- --only threejs-2d,pixijs-2d   limit to some builds
//   npm run bench -- --levels base,rain-16000      limit to some stress levels (ids as in
//                                                  results.json), full frame counts and repeats;
//                                                  the build's other levels already in the
//                                                  results file are kept
//   npm run bench -- --no-sync                     no GPU readback per frame; writes
//                                                  results-nosync.json (only means are meaningful)
//   npm run screenshots                            screenshots at t=12 into screenshots/
//   extra flags: --no-build (reuse dist/), --headed (visible window)
//
// Requires the dedicated Chromium automation library: set CDP_LIB to the absolute path
// of the chromium-automation skill's scripts/cdp.mjs.
//
// Steps: vite build (production) -> bundle sizes from the Vite manifest -> tiny static
// server for dist/ -> one Chromium -> per build: startup (median of N fresh loads),
// then per stress level: warm-up, frame sample, heap after forced GC, draw calls.
// Writes bench/results/results.json (summary, committed) and bench/results/raw/<time>.json.

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import os from 'node:os';
import { stressLevels, stressQuery, BASE } from '../shared/stress.js';

const ROOT = join(import.meta.dirname, '..');
const RESULTS_DIR = join(ROOT, 'bench', 'results');
const SHOTS_DIR = join(ROOT, 'screenshots');
const VIEWPORT = { width: 1800, height: 600, scale: 1 };
const SCREENSHOT_T = 12;

/** Every build the evaluation knows about. */
const BUILDS = [
  { id: 'threejs-2d', framework: 'threejs', mode: '2d' },
  // bloom off: PixiJS 3D uses no post-processing, so this is the like-for-like 3D pair
  { id: 'threejs-3d', framework: 'threejs', mode: '3d', query: '&bloom=0' },
  // the same build with its UnrealBloomPass on, to show what post-processing costs
  { id: 'threejs-3d-bloom', framework: 'threejs', mode: '3d', query: '&bloom=1' },
  { id: 'pixijs-2d', framework: 'pixijs', mode: '2d' },
  { id: 'pixijs-3d', framework: 'pixijs', mode: '3d' },
];

/**
 * Chromium flags. Verified on the development machine (see README):
 *  - without --ignore-gpu-blocklist/--enable-gpu, headless Chromium falls back to
 *    SwiftShader (software WebGL);
 *  - without --disable-gpu-vsync/--disable-frame-rate-limit, requestAnimationFrame is
 *    capped at the display rate (16.7 ms), so frame time would measure vsync, not work.
 */
const CHROMIUM_FLAGS = [
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--force-device-scale-factor=1',
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
];

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (/** @type {string} */ f) => argv.includes(f);
const valueOf = (/** @type {string} */ f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const listOf = (/** @type {string} */ f) => valueOf(f)?.split(',').map((v) => v.trim()).filter(Boolean) ?? null;
const opts = {
  quick: has('--quick'),
  screenshots: has('--screenshots'),
  build: !has('--no-build'),
  headed: has('--headed'),
  sync: !has('--no-sync'),
  only: listOf('--only'),
  levels: listOf('--levels'),
};
const FRAMES = opts.quick ? { warmup: 30, sample: 120, startupLoads: 3, repeats: 1 } : { warmup: 60, sample: 300, startupLoads: 5, repeats: 3 };
// sync=1 (unless --no-sync): the hook waits for the GPU after each frame (see
// shared/bench-hook.js), so frame times include GPU work instead of queueing bursts
const SYNC = opts.sync ? '&sync=1' : '';
const RESULTS_FILE = opts.sync ? 'results.json' : 'results-nosync.json';

const selected = BUILDS.filter((b) => !opts.only || opts.only.includes(b.id));
if (!selected.length) fail(`--only matched no build. Known: ${BUILDS.map((b) => b.id).join(', ')}`);

const ALL_LEVELS = stressLevels();
const unknownLevels = (opts.levels ?? []).filter((id) => !ALL_LEVELS.some((l) => l.id === id));
if (unknownLevels.length) fail(`--levels: unknown ${unknownLevels.join(', ')}. Known: ${ALL_LEVELS.map((l) => l.id).join(', ')}`);
const LEVELS = opts.levels ? ALL_LEVELS.filter((l) => opts.levels?.includes(l.id))
  : opts.quick ? ALL_LEVELS.filter((l) => l.id === 'base') : ALL_LEVELS;

const CDP_LIB = process.env.CDP_LIB;
if (!CDP_LIB) {
  fail('CDP_LIB is not set. Set it to the absolute path of the chromium-automation skill\'s scripts/cdp.mjs, e.g.\n' +
    '  CDP_LIB=/path/to/chromium-automation/scripts/cdp.mjs npm run bench');
}
if (!existsSync(CDP_LIB)) fail(`CDP_LIB points to a missing file: ${CDP_LIB}`);
const { launch } = await import(pathToFileURL(CDP_LIB).href);

// ---------------------------------------------------------------------------
// build and bundle sizes
// ---------------------------------------------------------------------------
const frameworks = [...new Set(selected.map((b) => b.framework))];
if (opts.build) {
  for (const fw of frameworks) {
    log(`building ${fw} (vite build)`);
    const r = spawnSync('npm', ['run', 'build', '--workspace', fw], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) fail(`vite build failed for ${fw}`);
  }
}

/**
 * Bytes of the JS (and CSS) a page loads, from the Vite manifest: the entry chunk plus
 * its static imports, recursively. Dynamic imports are listed separately.
 * @param {string} fw @param {string} page
 */
function bundleSize(fw, page) {
  const dist = join(ROOT, fw, 'dist');
  const manifestPath = join(dist, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = manifest[page];
  if (!entry || !entry.file?.endsWith('.js')) return null; // placeholder page: no script
  /** @type {Set<string>} */ const js = new Set();
  /** @type {Set<string>} */ const css = new Set();
  /** @type {Set<string>} */ const dynamic = new Set();
  /** @param {string} key */
  const walk = (key) => {
    const chunk = manifest[key];
    if (!chunk || js.has(chunk.file)) return;
    js.add(chunk.file);
    for (const c of chunk.css ?? []) css.add(c);
    for (const i of chunk.imports ?? []) walk(i);
    for (const d of chunk.dynamicImports ?? []) dynamic.add(manifest[d]?.file ?? d);
  };
  walk(page);
  /** @param {Set<string>} files */
  const measure = (files) => {
    let raw = 0, gzip = 0, brotli = 0;
    for (const f of files) {
      const buf = readFileSync(join(dist, f));
      raw += buf.length;
      gzip += gzipSync(buf, { level: 9 }).length;
      brotli += brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length;
    }
    return { files: [...files], raw, gzip, brotli };
  };
  return { js: measure(js), css: measure(css), html: statSync(join(dist, page)).size, dynamicImports: [...dynamic] };
}

// ---------------------------------------------------------------------------
// static server for the dist/ folders: /<framework>/<file>
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const [, fw, ...rest] = url.pathname.split('/');
  const file = normalize(join(ROOT, fw ?? '', 'dist', ...rest));
  if (!frameworks.includes(fw) || !file.startsWith(join(ROOT, fw, 'dist')) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': /** @type {Record<string,string>} */ (MIME)[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
const addr = server.address();
const PORT = typeof addr === 'object' && addr ? addr.port : 0;
log(`serving dist/ on http://127.0.0.1:${PORT}`);

// ---------------------------------------------------------------------------
// browser work
// ---------------------------------------------------------------------------
/** @type {any} */ let s = null;
const results = loadResults();
const raw = { startedAt: new Date().toISOString(), options: opts, builds: /** @type {Record<string, any>} */ ({}) };
let exitCode = 0;
try {
  s = await launch({
    purpose: opts.screenshots ? 'fw-eval: capture build screenshots' : 'fw-eval: benchmark framework builds',
    headless: !opts.headed,
    args: CHROMIUM_FLAGS,
    maxLifetimeS: 3600,
  });
  await s.setViewport(VIEWPORT);
  await s.send('Network.setCacheDisabled', { cacheDisabled: true });

  const env = await environment();
  log(`browser ${env.browser.product}, ${env.browser.headless ? 'headless' : 'headed'}; frame-rate check: ${env.frameRateCheck.medianIntervalMs} ms median rAF interval (uncapped: ${env.frameRateCheck.uncapped})`);

  for (const b of selected) {
    const page = `${b.mode}.html`;
    const bundle = bundleSize(b.framework, page);
    if (!bundle) {
      log(`${b.id}: not built yet (placeholder page), skipped`);
      results.builds[b.id] = { framework: b.framework, mode: b.mode, built: false };
      continue;
    }
    const base = `http://127.0.0.1:${PORT}/${b.framework}/${page}`;
    if (opts.screenshots) {
      await screenshot(b, `${base}?${stressQuery(BASE)}&seed=1&t=${SCREENSHOT_T}${b.query ?? ''}`);
      continue;
    }
    log(`${b.id}: bundle ${kb(bundle.js.raw)} min, ${kb(bundle.js.gzip)} gzip`);
    const entry = { framework: b.framework, mode: b.mode, built: true, quick: opts.quick, measuredAt: new Date().toISOString(),
      version: /** @type {string | null} */ (null), pageErrors: /** @type {string[] | undefined} */ (undefined), bundle, startup: /** @type {any} */ (null), gl: null, info: null,
      levels: /** @type {Record<string, any>} */ ({ ...(opts.levels ? results.builds[b.id]?.levels : undefined) }) };

    const runs = [];
    for (let i = 0; i < FRAMES.startupLoads; i++) {
      await s.goto('about:blank');
      await s.goto(`${base}?${stressQuery(BASE)}&seed=1${SYNC}${b.query ?? ''}`);
      await waitReady(b.id);
      runs.push(await s.evaluate('window.__bench.startup'));
    }
    // `median` is per field: each timing's median over the loads, so fields can come from different loads
    entry.startup = { loads: runs.length, median: fieldMedians(runs), runs };
    log(`${b.id}: startup first frame ${entry.startup.median.firstFrameMs} ms (median of ${runs.length})`);

    for (const level of LEVELS) {
      await s.goto('about:blank');
      const runs = [];
      for (let r = 0; r < FRAMES.repeats; r++) {
        if (r) await s.goto('about:blank');
        await s.goto(`${base}?${stressQuery(level.stress)}&seed=1${SYNC}${b.query ?? ''}`);
        await waitReady(b.id);
        await s.evaluate(`window.__bench.sample(${FRAMES.warmup}).then(() => true)`);
        runs.push(await s.evaluate(`window.__bench.sample(${FRAMES.sample})`));
      }
      const means = runs.map((f) => f.mean);
      // every field from one run, the one with the median mean, so p95/p99/cpu match the mean
      const frames = { ...medianRun(runs), runs: runs.length, meanRange: [Math.min(...means), Math.max(...means)] };
      // heap is read once, after the last of the repeats, not from the median run
      await s.send('HeapProfiler.collectGarbage');
      const heap = await s.send('Runtime.getHeapUsage');
      const perfMemory = await s.evaluate('window.__bench.heap()');
      const info = await s.evaluate('({ version: window.__bench.version, gl: window.__bench.gl(), info: window.__bench.info, stress: window.__bench.stress, setupDrawCalls: window.__bench.setupDrawCalls })');
      entry.version = info.version;
      entry.gl = info.gl;
      entry.info = info.info;
      // per level: --levels keeps older levels, so each records when and on which bundle it ran
      entry.levels[level.id] = {
        measuredAt: new Date().toISOString(), bundleGzip: bundle.js.gzip,
        stress: info.stress, frames, runs,
        heap: { usedSize: heap.usedSize, totalSize: heap.totalSize, performanceMemory: perfMemory },
        setupDrawCalls: info.setupDrawCalls,
      };
      log(`${b.id} ${level.id}: mean ${frames.mean} ms, p95 ${frames.p95} ms, ${frames.fps} fps, draws ${frames.drawCalls} (framework ${frames.frameworkDrawCalls}), heap ${kb(heap.usedSize)}`);
    }
    const errors = [...s.log.exceptions, ...s.log.console.filter((/** @type {any} */ c) => c.type === 'error').map((/** @type {any} */ c) => c.text)];
    if (errors.length) { entry.pageErrors = [...new Set(errors)]; log(`${b.id}: page errors: ${entry.pageErrors.join(' | ')}`); }
    s.log.exceptions.length = 0; s.log.console.length = 0;
    results.builds[b.id] = entry;
    raw.builds[b.id] = entry;
  }

  if (!opts.screenshots) {
    results.env = env;
    results.gpuSync = opts.sync;
    results.updatedAt = new Date().toISOString();
    mkdirSync(join(RESULTS_DIR, 'raw'), { recursive: true });
    writeFileSync(join(RESULTS_DIR, RESULTS_FILE), JSON.stringify(results, null, 2) + '\n');
    writeFileSync(join(RESULTS_DIR, 'raw', `${raw.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify({ ...raw, env }, null, 2) + '\n');
    log(`wrote bench/results/${RESULTS_FILE}`);
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  if (s) await s.close().catch((/** @type {any} */ e) => { console.error('browser close failed:', e.message); exitCode = 1; });
  server.close();
}
process.exit(exitCode);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** @param {string} id */
async function waitReady(id) {
  try {
    await s.waitFor('window.__bench && window.__bench.ready', { timeout: 60000 });
  } catch (e) {
    const errs = [...s.log.exceptions, ...s.log.console.filter((/** @type {any} */ c) => c.type === 'error').map((/** @type {any} */ c) => c.text)];
    throw new Error(`${id}: page never became ready. Page errors: ${errs.join(' | ') || 'none'}\n${/** @type {Error} */ (e).message}`);
  }
}

/** @param {{ id: string, framework: string, mode: string, query?: string }} b @param {string} url */
async function screenshot(b, url) {
  await s.goto(url);
  await waitReady(b.id);
  await s.evaluate('window.__bench.sample(10).then(() => true)');
  mkdirSync(SHOTS_DIR, { recursive: true });
  const path = join(SHOTS_DIR, `${b.id}.png`);
  await s.screenshot({ path });
  log(`${b.id}: screenshot ${path.slice(ROOT.length + 1)}`);
}

/** Browser, GPU, OS and the frame-rate check. */
async function environment() {
  const version = await s.send('Browser.getVersion');
  // trivial page: measure the rAF interval to confirm the frame rate is uncapped
  await s.goto('about:blank');
  const check = await s.evaluate(`new Promise((resolve) => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 100; document.body.appendChild(c);
    const gl = c.getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const iv = []; let last = 0;
    function f(now) {
      if (last) iv.push(now - last); last = now;
      gl.clearColor(Math.random(), 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (iv.length < 240) requestAnimationFrame(f);
      else { iv.sort((a, b) => a - b); resolve({ median: iv[120], renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null }); }
    }
    requestAnimationFrame(f);
  })`);
  const median = Math.round(check.median * 1000) / 1000;
  return {
    browser: { product: version.product, revision: version.revision, userAgent: version.userAgent, headless: !opts.headed, flags: CHROMIUM_FLAGS },
    gpu: { renderer: check.renderer, vendor: check.vendor, software: /swiftshader|llvmpipe|software/i.test(String(check.renderer)) },
    frameRateCheck: { medianIntervalMs: median, uncapped: median < 15, note: 'trivial WebGL2 clear per frame on about:blank' },
    os: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? null, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1e9) },
    node: process.version,
    viewport: VIEWPORT,
  };
}

function loadResults() {
  const p = join(RESULTS_DIR, RESULTS_FILE);
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { /* start fresh */ }
  }
  return { builds: {} };
}

/** Lower median: the middle value for an odd count. @param {number[]} v */
function median(v) {
  const a = [...v].sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) / 2)] : null;
}

/** The run whose mean is the median of the runs' means. @param {any[]} runs */
function medianRun(runs) {
  const m = median(runs.map((r) => r.mean));
  return runs.find((r) => r.mean === m);
}

/**
 * Median of each field across runs, independently (one level deep for `navigation`),
 * over the runs where it is a number; null when it is a number in none.
 * @param {any[]} runs
 */
function fieldMedians(runs) {
  /** @param {any[]} v */
  const med = (v) => median(v.filter((x) => typeof x === 'number'));
  /** @type {Record<string, any>} */ const out = {};
  for (const k of Object.keys(runs[0] ?? {})) {
    const first = runs[0][k];
    if (first && typeof first === 'object') {
      out[k] = {};
      for (const k2 of Object.keys(first)) out[k][k2] = med(runs.map((r) => r[k]?.[k2]));
    } else out[k] = med(runs.map((r) => r[k]));
  }
  return out;
}

/** @param {number} n */
function kb(n) { return `${(n / 1024).toFixed(1)} kB`; }
/** @param {string} msg */
function log(msg) { console.log(`[bench] ${msg}`); }
/** @param {string} msg @returns {never} */
function fail(msg) { console.error(`[bench] ${msg}`); process.exit(2); }
