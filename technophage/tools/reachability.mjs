// Level traversal check using the game's real movement physics (no teleporting).
//
// For every mid-level chunk, mirrored and not, in a normal zone and a cave zone, it
// builds a level of [start, chunk, exit] and explores every place a hunter can stand or
// climb, trying walks, walk-offs, jumps (several heights, timings and air dashes),
// ladders and catwalk drop-throughs. It then reports:
//   BLOCKED  the exit cannot be reached (the chunk cannot be crossed)
//   TRAP     a place that can be reached but has no way back to the exit
// Breakable blocks count as solid, so the main route never depends on shooting walls.
//
// Usage: node tools/reachability.mjs            all chunks
//        node tools/reachability.mjs strict     same, walking, full jumps and ladders only
//        node tools/reachability.mjs 2 5        only chunks 2 and 5
//        node tools/reachability.mjs full 3     full generated levels, 3 seeds per zone

import { World, newPlayerData } from '../src/sim.js';
import { Level, CHUNKS } from '../src/level.js';
import { ZONES, DT, TILE, T } from '../src/config.js';

// strict: only walking, full-height jumps and ladders (no dashes, no timing tricks).
const STRICT = process.argv.includes('strict');
const NO = { mx: 0, up: false, down: false, jump: false, jumpPressed: false, dashPressed: false, fire: false, discPressed: false, aim: 0, slot: -1, cycle: 0 };

function makeWorld(zoneIndex, seed, layout) {
  const w = new World({ role: 'host', zoneIndex, seed, playerData: [newPlayerData(0, 'T')], localIdx: [0] });
  if (layout) w.level = new Level(zoneIndex, seed, ZONES[zoneIndex], layout);
  w.level.gateClosed = false;
  // Treat breakable blocks as solid even though they can be shot
  return w;
}

// Input programs. Each returns the input for tick t, or null when it has finished.
// Moves that leave the ground end as soon as the hunter lands again
const untilLanded = (f) => (t, s) => {
  if (!s.p.onGround) s.air = true;
  if (s.air && s.p.onGround && t > 3) return null;
  return f(t, s);
};

function programs(climbing) {
  const out = [];
  if (climbing) {
    out.push({ name: 'climb-up', f: (t) => (t < 14 ? { ...NO, up: true } : null) });
    out.push({ name: 'climb-down', f: (t) => (t < 14 ? { ...NO, down: true } : null) });
    for (const d of [-1, 1]) {
      out.push({ name: 'ladder-step-off', f: (t) => (t < 30 ? { ...NO, mx: d } : null) });
      for (const hold of [60, 10])
        out.push({ name: 'ladder-jump', f: untilLanded((t) => (t < 90 ? { ...NO, mx: d, jump: t < hold, jumpPressed: t === 0 } : null)) });
    }
    return out;
  }
  for (const d of [-1, 1]) {
    out.push({ name: 'walk', f: (t, s) => (Math.abs(s.p.x - s.x0) < TILE && t < 40 ? { ...NO, mx: d } : null) });
    out.push({ name: 'walk-off-steer', f: untilLanded((t) => (t < 120 ? { ...NO, mx: d } : null)) });
  }
  out.push({ name: 'ladder-up', f: (t) => (t < 30 ? { ...NO, up: true } : null), ladder: true });
  out.push({ name: 'ladder-down', f: (t) => (t < 30 ? { ...NO, down: true } : null), ladder: true });
  out.push({ name: 'drop-through', f: (t) => (t < 60 ? { ...NO, down: t < 10, jumpPressed: t === 0 } : null) });
  for (const d of [-1, 0, 1]) {
    for (const delay of STRICT ? [0] : [0, 12]) {
      if (d === 0 && delay) continue;
      for (const hold of STRICT ? [60] : [60, 10]) {
        for (const dash of d && !STRICT ? [-1, 14] : [-1]) {
          out.push({
            name: `jump d${d} delay${delay} hold${hold} dash${dash}`,
            f: untilLanded((t) => (t < 120 ? { ...NO, mx: t >= delay ? d : 0, jump: t < hold, jumpPressed: t === 0, dashPressed: t === dash } : null)),
          });
        }
      }
    }
    // jump and grab a ladder
    out.push({ name: 'jump-grab', f: untilLanded((t) => (t < 90 ? { ...NO, mx: d, up: t > 4, jump: t < 60, jumpPressed: t === 0 } : null)), ladder: true });
  }
  return out;
}

function keyOf(w, p) {
  const cx = p.x + p.w / 2;
  if (p.climbing) return `L${Math.floor(cx / TILE)},${Math.floor((p.y + p.h / 2) / TILE)}`;
  return `G${Math.floor(cx / TILE)},${Math.round((p.y + p.h) / TILE)}`;
}

function place(p, st) {
  Object.assign(p, { x: st.x, y: st.y, vx: 0, vy: 0, onGround: !st.climbing, climbing: st.climbing, coyote: 0.1, jumpBuf: 0, jumpHeld: false, dropT: 0, dashT: 0, dashCd: 0, state: 'alive', overdrive: 0 });
}

function explore(w) {
  const L = w.level;
  // Breakables count as solid already (BREAK is solid until destroyed)
  const p = w.players[0];
  const start = L.starts[0];
  // settle the player at the start
  p.x = start.x - p.w / 2;
  p.y = start.y - p.h - 1;
  for (let i = 0; i < 30; i++) w.controlPlayer(p, NO, DT);
  const states = new Map();
  const edges = new Map();
  const queue = [];
  const add = (from) => {
    const k = keyOf(w, p);
    if (from) edges.get(from).add(k);
    if (!states.has(k)) {
      states.set(k, { x: p.x, y: p.y, climbing: p.climbing, key: k });
      edges.set(k, new Set());
      queue.push(k);
    }
    return k;
  };
  const startKey = add(null);
  const fx = w.fx;
  while (queue.length) {
    const k = queue.shift();
    const st = states.get(k);
    for (const prog of programs(st.climbing)) {
      place(p, st);
      const s = { p, x0: st.x };
      let t = 0, ended = false;
      for (; t < 300; t++) {
        let inp = prog.f(t, s);
        if (!inp) {
          inp = NO;
          ended = true;
        }
        inp.aim = 0;
        w.controlPlayer(p, inp, DT);
        fx.length = 0;
        if (p.y > L.pxH + 50) break; // fell out of the world: respawns, not a trap
        if (prog.ladder && p.climbing && !st.climbing) {
          add(k);
          break;
        }
        if (st.climbing && p.climbing && ended) {
          add(k);
          break;
        }
        if (t > 3 && ended && p.onGround && Math.abs(p.vy) < 1 && Math.abs(p.vx) < 1) {
          add(k);
          break;
        }
        if (t > 3 && !st.climbing && p.climbing && !prog.ladder) {
          add(k);
          break;
        }
      }
    }
  }
  // Goal: standing on the exit lift
  const ex = L.exit;
  const goals = [...states.values()].filter((st) => !st.climbing && st.x + p.w > ex.x && st.x < ex.x + ex.w && st.y + p.h <= ex.y + ex.h + 2 && st.y + p.h > ex.y);
  // Reverse reachability from the goals
  const rev = new Map([...states.keys()].map((k) => [k, []]));
  for (const [a, set] of edges) for (const b of set) rev.get(b).push(a);
  const canFinish = new Set(goals.map((g) => g.key));
  const q = [...canFinish];
  while (q.length) {
    const k = q.shift();
    for (const a of rev.get(k)) if (!canFinish.has(a)) canFinish.add(a), q.push(a);
  }
  const traps = [...states.values()].filter((st) => !canFinish.has(st.key));
  // Pickups and checkpoints a hunter can touch from some reachable place (jumping counts)
  const items = [...L.pickups.map((k) => ({ kind: k.kind, x: k.x, y: k.y })), ...L.checkpoints.map((c) => ({ kind: 'checkpoint', x: c.x, y: c.y }))];
  const missed = items.filter((it) => ![...states.values()].some((st) => Math.abs(st.x + p.w / 2 - it.x) < TILE * 1.5 && it.y - TILE * 4.5 < st.y + p.h && st.y + p.h <= it.y + 2));
  return { states, goals, traps, missed, startKey, finishable: canFinish.has(startKey) };
}

function describe(keys, offset) {
  return keys
    .map((st) => st.key)
    .map((k) => {
      const [kind, rest] = [k[0], k.slice(1)];
      const [x, y] = rest.split(',').map(Number);
      return `${kind === 'L' ? 'ladder' : 'stand'}@col${x - offset},row${y}`;
    })
    .slice(0, 12)
    .join(' ');
}

const args = process.argv.slice(2).filter((a) => a !== 'strict');
let failures = 0;
const t0 = Date.now();
if (args[0] === 'full') {
  const seeds = Number(args[1] || 3);
  for (let z = 0; z < ZONES.length; z++) {
    for (let s = 1; s <= seeds; s++) {
      const w = makeWorld(z, s * 104729 + z, null);
      const r = explore(w);
      const bad = !r.finishable || r.traps.length;
      if (bad) failures++;
      const maxCol = Math.max(...[...r.states.keys()].map((k) => Number(k.slice(1).split(',')[0])));
      const piece = w.level.pieces.find((pc) => maxCol >= pc.x0 && maxCol < pc.x0 + pc.w);
      const where = piece ? `furthest: chunk ${piece.k} col ${maxCol - piece.x0}` : '';
      const loc = (st) => {
        const col = Math.floor((st.x + 13) / TILE);
        const pc = w.level.pieces.find((q) => col >= q.x0 && col < q.x0 + q.w);
        return `${st.climbing ? 'ladder' : 'stand'}@chunk ${pc ? pc.k : '?'} col ${pc ? col - pc.x0 : col} row ${Math.round((st.y + 60) / TILE)}`;
      };
      console.log(`zone ${z} seed ${s}: ${r.finishable ? 'exit reachable' : 'BLOCKED, ' + where}, ${r.states.size} places, ${r.traps.length ? 'TRAPS ' + r.traps.slice(0, 6).map(loc).join(', ') : 'no traps'}`);
    }
  }
} else {
  const list = args.length ? args.map(Number) : CHUNKS.mid.map((_, i) => i);
  for (const ci of list) {
    for (const zone of [0, 3]) {
      for (const mirror of [false, true]) {
        const w = makeWorld(zone, 4242, [{ k: 'start' }, { k: ci, mirror }, { k: 'exit' }]);
        const r = explore(w);
        const offset = 1 + CHUNKS.start[0].length; // border column + start chunk
        const bad = !r.finishable || r.traps.length;
        if (bad) failures++;
        console.log(
          `chunk ${ci}${mirror ? ' mirrored' : ''} ${ZONES[zone].cave ? '(cave)' : '      '}: ` +
            `${r.finishable ? 'ok     ' : 'BLOCKED'} ${r.states.size} places${r.traps.length ? ', TRAPS: ' + describe(r.traps, offset) : ''}` +
            (r.missed.length ? `  (out of reach: ${r.missed.map((m) => `${m.kind}@col${Math.floor(m.x / TILE) - offset},row${Math.floor(m.y / TILE) - 1}`).join(' ')})` : ''),
        );
      }
    }
  }
}
console.log(`${failures ? 'FAILED: ' + failures : 'ALL PASSABLE, NO TRAPS'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
