// Wire-format benchmark: JSON vs MessagePack (@msgpack/msgpack, msgpackr) for the game's
// snapshot (host -> guest, 30/s) and input (guest -> host, 60/s) messages.
//
// Measures, for two message sets ("current" = messages as src/net/codec.js builds them,
// "quantised" = positions/velocities as 1/256-tile integers and aim as 1/65536-turn integers):
//   - payload bytes per message (mean/min/max),
//   - encode and decode time per message (median and p95, nanoseconds),
//   - payload bandwidth for a two-player session (no transport/IP overhead).
// Every format x set x message is round-trip checked first; any mismatch exits 1.
// Messages are deterministic (seeded PRNG). msgpackr runs with native acceleration disabled
// (browsers cannot use the native addon) and with plain MessagePack settings (no records).
//
// Run (from berserker7/game):
//   node tools/bench-codec.mjs [--iterations N] [--json]
//   npm run bench:codec -- --iterations 300
// --iterations N = measured batches per combination (default 300); warm-up = max(50, N/10).
// --json prints the raw results as JSON instead of tables.

process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED = 'true';

import assert from 'node:assert/strict';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack';
import { ACTIONS } from '../src/input/actions.js';
import { snapMessage, inputMessage, encode as codecEncode, decode as codecDecode } from '../src/net/codec.js';

const { Packr } = await import('msgpackr');
const pkgVersion = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const itIdx = args.indexOf('--iterations');
const ITERATIONS = itIdx >= 0 ? Number(args[itIdx + 1]) : 300;
if (!Number.isInteger(ITERATIONS) || ITERATIONS < 1) {
  console.error('--iterations needs a positive integer');
  process.exit(2);
}
const WARMUP = Math.max(50, Math.floor(ITERATIONS / 10));
const POOL = 512;
const SNAP_PER_S = 30;
const INPUT_PER_S = 60;
const startAll = process.hrtime.bigint();

// --- deterministic samples ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xb7b7b7);
const between = (lo, hi) => lo + rnd() * (hi - lo);
const aim = () => between(-Math.PI, Math.PI);

function player() {
  const grounded = rnd() < 0.7;
  return {
    x: between(-18, 20),
    y: grounded ? Math.floor(between(-12, 9)) : between(-12, 9),
    vx: rnd() < 0.3 ? 0 : between(-8, 8),
    vy: grounded ? 0 : between(-20, 16),
    onGround: grounded,
    crouching: rnd() < 0.1,
    aim: aim(),
  };
}

const snaps = [];
const inputs = [];
for (let i = 0; i < POOL; i++) {
  const tick = 1000 + i * 2;
  snaps.push(snapMessage({ tick, ack: tick - 1 - Math.floor(rnd() * 4), players: [player(), player()] }));
  const actions = {};
  for (const name of ACTIONS) actions[name] = { held: false, pressed: false };
  const heldCount = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < heldCount; k++) actions[ACTIONS[Math.floor(rnd() * ACTIONS.length)]].held = true;
  if (rnd() < 0.15) actions[ACTIONS[Math.floor(rnd() * ACTIONS.length)]].pressed = true;
  inputs.push(inputMessage(1000 + i, { connected: true, actions, aim: aim() }));
}

// Codec-shape validation: the messages are real codec messages.
for (const m of [...snaps, ...inputs]) assert.deepStrictEqual(codecDecode(codecEncode(m)), m);

// Quantised set. `+ 0` turns -0 into 0 so round-trips compare equal.
const q256 = (v) => Math.round(v * 256) + 0;
const qTurn = (a) => Math.round((a / (2 * Math.PI)) * 65536) + 0;
const quantSnap = (m) => {
  const out = { ...m };
  for (let i = 0; i < 2; i++) {
    for (const f of ['x', 'y', 'vx', 'vy']) out[f + i] = q256(m[f + i]);
    out[`a${i}`] = qTurn(m[`a${i}`]);
  }
  return out;
};
const quantInput = (m) => ({ ...m, aim: qTurn(m.aim) });
const sets = {
  current: { snap: snaps, input: inputs },
  quantised: { snap: snaps.map(quantSnap), input: inputs.map(quantInput) },
};

let errPos = 0;
let errVel = 0;
let errAim = 0;
const absmax = (cur, v) => Math.max(cur, Math.abs(v));
snaps.forEach((m, k) => {
  const q = sets.quantised.snap[k];
  for (let i = 0; i < 2; i++) {
    for (const f of ['x', 'y']) errPos = absmax(errPos, q[f + i] / 256 - m[f + i]);
    for (const f of ['vx', 'vy']) errVel = absmax(errVel, q[f + i] / 256 - m[f + i]);
    errAim = absmax(errAim, (q[`a${i}`] / 65536) * 2 * Math.PI - m[`a${i}`]);
  }
});
inputs.forEach((m, k) => {
  errAim = absmax(errAim, (sets.quantised.input[k].aim / 65536) * 2 * Math.PI - m.aim);
});
const quantError = { positionTiles: errPos, velocityTilesPerS: errVel, aimRadians: errAim };
assert.ok(errPos <= 1 / 512 + 1e-12 && errVel <= 1 / 512 + 1e-12 && errAim <= Math.PI / 65536 + 1e-12, 'quantisation error above expected bound');

// --- formats ---
const packr = new Packr({ useRecords: false, structuredClone: false, moreTypes: false, mapsAsObjects: true });
const formats = {
  json: { enc: (o) => JSON.stringify(o), dec: (s) => JSON.parse(s), size: (s) => Buffer.byteLength(s), len: (s) => s.length },
  msgpack: { enc: (o) => mpEncode(o), dec: (b) => mpDecode(b), size: (b) => b.byteLength, len: (b) => b.length },
  msgpackr: { enc: (o) => packr.pack(o), dec: (b) => packr.unpack(b), size: (b) => b.byteLength, len: (b) => b.length },
};
const fmtNames = Object.keys(formats);

// msgpackr output must be plain MessagePack readable by @msgpack/msgpack, and vice versa.
const failures = [];
for (const [setName, set] of Object.entries(sets)) {
  for (const type of ['snap', 'input']) {
    for (const m of set[type]) {
      try {
        assert.deepStrictEqual(mpDecode(packr.pack(m)), m);
        assert.deepStrictEqual(packr.unpack(mpEncode(m)), m);
      } catch (e) {
        failures.push(`msgpackr/msgpack interop ${setName} ${type}: ${e.message.split('\n')[0]}`);
        break;
      }
    }
  }
}
// Round-trip every format x set x message.
const roundTripLines = [];
for (const fmtName of fmtNames) {
  for (const [setName, set] of Object.entries(sets)) {
    let ok = 0;
    for (const type of ['snap', 'input']) {
      for (const m of set[type]) {
        try {
          assert.deepStrictEqual(formats[fmtName].dec(formats[fmtName].enc(m)), m);
          ok++;
        } catch {
          failures.push(`round-trip ${fmtName} ${setName} ${type} tick ${m.tick}`);
        }
      }
    }
    roundTripLines.push(`round-trip OK: ${fmtName} / ${setName} (${ok} messages)`);
  }
}
if (failures.length) {
  console.error('FAILURES:\n' + failures.join('\n'));
  process.exit(1);
}

// --- measurement ---
let sink = 0;
const ns = (a, b) => Number(b - a);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return { median: pct(s, 0.5), p95: pct(s, 0.95) };
};

function batch(fn, pool, key) {
  let acc = 0;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < pool.length; i++) acc += fn(pool[i])[key];
  const t1 = process.hrtime.bigint();
  sink += acc;
  return ns(t0, t1) / pool.length;
}

const results = [];
const timings = {}; // key -> samples
for (const [setName, set] of Object.entries(sets)) {
  for (const type of ['snap', 'input']) {
    const msgs = set[type];
    const encoded = {};
    for (const f of fmtNames) encoded[f] = msgs.map(formats[f].enc);
    for (const op of ['enc', 'dec']) {
      for (const f of fmtNames) for (let i = 0; i < WARMUP; i++) batch(formats[f][op], op === 'enc' ? msgs : encoded[f], op === 'enc' ? 'length' : 'tick');
      for (const f of fmtNames) timings[`${setName}|${type}|${op}|${f}`] = [];
      for (let r = 0; r < ITERATIONS; r++) {
        for (let k = 0; k < fmtNames.length; k++) {
          const f = fmtNames[(k + r) % fmtNames.length];
          timings[`${setName}|${type}|${op}|${f}`].push(batch(formats[f][op], op === 'enc' ? msgs : encoded[f], op === 'enc' ? 'length' : 'tick'));
        }
      }
    }
  }
}

for (const [setName, set] of Object.entries(sets)) {
  for (const f of fmtNames) {
    const row = { set: setName, format: f };
    for (const type of ['snap', 'input']) {
      const sizes = set[type].map((m) => formats[f].size(formats[f].enc(m)));
      row[type] = {
        bytes: { mean: sizes.reduce((a, b) => a + b, 0) / sizes.length, min: Math.min(...sizes), max: Math.max(...sizes) },
        encNs: stats(timings[`${setName}|${type}|enc|${f}`]),
        decNs: stats(timings[`${setName}|${type}|dec|${f}`]),
      };
    }
    row.hostToGuestBps = row.snap.bytes.mean * SNAP_PER_S;
    row.guestToHostBps = row.input.bytes.mean * INPUT_PER_S;
    row.totalBps = row.hostToGuestBps + row.guestToHostBps;
    results.push(row);
  }
}

const elapsedS = ns(startAll, process.hrtime.bigint()) / 1e9;
const meta = {
  node: process.version,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  libraries: {
    '@msgpack/msgpack': pkgVersion('@msgpack/msgpack'),
    msgpackr: pkgVersion('msgpackr'),
  },
  iterations: ITERATIONS,
  warmupBatches: WARMUP,
  poolSize: POOL,
};

if (asJson) {
  console.log(JSON.stringify({ meta, quantError, results, elapsedSeconds: elapsedS, sink }, null, 2));
} else {
  console.log('codec-shape validation: OK (every current message passes codec encode/decode unchanged)');
  console.log('msgpackr <-> @msgpack/msgpack interop: OK (plain MessagePack)');
  for (const l of roundTripLines) console.log(l);
  console.log('');
  console.log(`Node ${meta.node} | CPU ${meta.cpu}`);
  console.log(`@msgpack/msgpack ${meta.libraries['@msgpack/msgpack']} | msgpackr ${meta.libraries.msgpackr} (native acceleration disabled)`);
  console.log(`iterations ${ITERATIONS} measured batches (+${WARMUP} warm-up) | pool ${POOL} snap + ${POOL} input messages, 2 players`);
  console.log(`Bandwidth is payload only (no transport/IP overhead): snap x ${SNAP_PER_S}/s host->guest, input x ${INPUT_PER_S}/s guest->host.`);
  console.log('');
  const f1 = (v) => v.toFixed(1);
  const t = (s) => `${Math.round(s.median)}/${Math.round(s.p95)}`;
  console.log('| set | format | snap bytes | input bytes | snap enc med/p95 ns | snap dec med/p95 ns | input enc med/p95 ns | input dec med/p95 ns | host→guest B/s | guest→host B/s |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.set} | ${r.format} | ${f1(r.snap.bytes.mean)} (${r.snap.bytes.min}-${r.snap.bytes.max}) | ${f1(r.input.bytes.mean)} (${r.input.bytes.min}-${r.input.bytes.max}) | ${t(r.snap.encNs)} | ${t(r.snap.decNs)} | ${t(r.input.encNs)} | ${t(r.input.decNs)} | ${Math.round(r.hostToGuestBps)} | ${Math.round(r.guestToHostBps)} |`);
  }
  console.log('');
  console.log(`Max quantisation error: position ${errPos.toExponential(3)} tiles (limit ${(1 / 512).toExponential(3)}), velocity ${errVel.toExponential(3)} tiles/s (limit ${(1 / 512).toExponential(3)}), aim ${errAim.toExponential(3)} rad (limit ${(Math.PI / 65536).toExponential(3)})`);
  console.log(`Total elapsed: ${elapsedS.toFixed(1)} s (sink ${sink})`);
}
