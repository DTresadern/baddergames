// @ts-check
// Print markdown tables from bench/results/results.json (and lines of code).
//   node bench/report.js            (npm run report)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { countLoc } from './loc.js';

const path = join(import.meta.dirname, 'results', 'results.json');
if (!existsSync(path)) {
  console.error('No bench/results/results.json yet: run `npm run bench` first.');
  process.exit(1);
}
const results = JSON.parse(readFileSync(path, 'utf8'));
const builds = Object.entries(results.builds ?? {}).filter(([, b]) => b.built);

/** @param {string[]} head @param {(string | number | null | undefined)[][]} rows */
function table(head, rows) {
  const fmt = (/** @type {any} */ v) => (v === null || v === undefined ? '-' : String(v));
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map((_, i) => (i === 0 ? '---' : '---:')).join('|')}|`);
  for (const r of rows) console.log(`| ${r.map(fmt).join(' | ')} |`);
  console.log('');
}
/** @param {number} n */
const kb = (n) => (n / 1024).toFixed(1);

const env = results.env ?? {};
console.log('## Environment\n');
table(['item', 'value'], [
  ['browser', `${env.browser?.product} (${env.browser?.headless ? 'headless' : 'headed'})`],
  ['GPU', env.gpu?.renderer],
  ['frame rate uncapped', `${env.frameRateCheck?.uncapped} (trivial page median rAF ${env.frameRateCheck?.medianIntervalMs} ms)`],
  ['flags', (env.browser?.flags ?? []).join(' ')],
  ['OS', `${env.os?.platform} ${env.os?.release} (${env.os?.cpu}, ${env.os?.cpus} threads, ${env.os?.memoryGb} GB)`],
  ['node', env.node],
  ['viewport', env.viewport ? `${env.viewport.width}x${env.viewport.height} DPR ${env.viewport.scale}` : null],
  ['updated', results.updatedAt],
]);

console.log('## Bundle size (JS the page loads)\n');
table(['build', 'version', 'minified kB', 'gzip -9 kB', 'brotli kB'],
  builds.map(([id, b]) => [id, b.version, kb(b.bundle.js.raw), kb(b.bundle.js.gzip), kb(b.bundle.js.brotli)]));

console.log('## Startup (median of fresh loads, ms since navigation start)\n');
table(['build', 'loads', 'module start', 'first frame', 'first frame presented', 'DOMContentLoaded'],
  builds.map(([id, b]) => [id, b.startup?.loads, b.startup?.median?.moduleStartMs, b.startup?.median?.firstFrameMs,
    b.startup?.median?.firstFramePresentedMs, b.startup?.median?.navigation?.domContentLoadedMs]));

console.log('## Frame time per stress level (ms; lower is better)\n');
/** @type {(string | number | null)[][]} */
const rows = [];
for (const [id, b] of builds) {
  for (const [level, l] of Object.entries(/** @type {Record<string, any>} */ (b.levels ?? {}))) {
    rows.push([id, level, l.frames.mean, l.frames.meanRange ? `${l.frames.meanRange[0]}–${l.frames.meanRange[1]}` : '-', l.frames.p95, l.frames.p99, l.frames.fps, l.frames.cpuMean, l.frames.drawCalls, l.frames.frameworkDrawCalls, kb(l.heap.usedSize)]);
  }
}
table(['build', 'level', 'mean', 'mean range (runs)', 'p95', 'p99', 'fps', 'JS+submit mean', 'draw calls (hook)', 'draw calls (framework)', 'JS heap kB after GC'], rows);

// readback cost: the same builds measured without sync=1 (npm run bench -- --no-sync --levels base)
const noSyncPath = join(import.meta.dirname, 'results', 'results-nosync.json');
if (existsSync(noSyncPath)) {
  const noSync = JSON.parse(readFileSync(noSyncPath, 'utf8'));
  console.log('## Size of the readback cost (base level, mean ms)\n');
  console.log('Without `sync=1` frames overlap and queue, so only the mean is shown and it is not a per-frame time.\n');
  table(['build', 'mean with sync=1', 'mean without sync', 'difference'],
    builds.map(([id, b]) => {
      const a = b.levels?.base?.frames?.mean, n = noSync.builds?.[id]?.levels?.base?.frames?.mean;
      return [id, a ?? null, n ?? null, typeof a === 'number' && typeof n === 'number' ? Math.round((a - n) * 1000) / 1000 : null];
    }));
}

console.log('## Lines of code (non-blank, non-comment)\n');
table(['part', 'files', 'code', 'comments'], Object.entries(countLoc()).map(([k, v]) => [k, v.files, v.code, v.comment]));
