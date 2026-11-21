import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import { PROTOCOL_VERSION, decode, encode, loadCodec } from '../src/net/codec.js';
import { TIMEOUT_MS } from '../src/net/link.js';
import { INTERP_DELAY_TICKS } from '../src/net/interpolation.js';
import { JITTER_MAX, createGuestInputQueue, createNetSession, parseNetOptions } from '../src/net/session.js';
import { createLocalTransport } from '../src/net/transport-local.js';
import { createFakeBroadcast, createFakeClock } from './fake-net.js';
import { frame } from './frames.js';

await loadCodec();

const STEP_MS = 1000 / 60;
const bit = (action) => 1 << ACTIONS.indexOf(action);

// A fake input: player 1 holds `held` (pressed on every tick, like frame() makes it); no player 2.
function fakeInput() {
  const input = { held: [], aim: 0 };
  input.sample = () => {
    const f = frame(input.held);
    f.aim = input.aim;
    return [f, frame([], null, false)];
  };
  return input;
}

// Host and guest sessions over the local transport and a fake BroadcastChannel, on one manual clock.
function world({ delayMs = 0, lagMs = 0 } = {}) {
  const clock = createFakeClock();
  const bus = createFakeBroadcast(clock, { delayMs });
  let ids = 0;
  let seed = 0;
  const transport = createLocalTransport({ BroadcastChannel: bus.BroadcastChannel, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, randomId: () => `peer${++ids}` });
  const sandbox = { map: 'map.walkway', ticks: 0, players: [{ x: 1, y: 2, vx: 0, vy: 0, onGround: true, crouching: false, aim: 0 }], enemies: [] };
  const make = (extra = {}) => {
    const session = createNetSession({
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      randomUint32s: (n) => Array.from({ length: n }, () => (seed += 7)),
      lagMs,
      mapKey: () => 'map.walkway',
      ...extra,
    });
    const input = fakeInput();
    const events = [];
    session.subscribe((e) => e.type !== 'state' && events.push(e));
    return { session, input, wrapped: session.wrapInput(input), events, lastFrames: null };
  };
  // `inSandbox` false: the host is on another screen (menus), so sandboxState() is null.
  const world_ = { inSandbox: true };
  const host = make({ sandboxState: () => (world_.inSandbox ? sandbox : null) });
  const guest = make();
  const peers = [host, guest];
  // One 60 Hz tick for every session: sample (as the harness does), advance time, afterFrame.
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const p of peers) p.lastFrames = p.wrapped.sample();
      clock.advance(STEP_MS);
      for (const p of peers) p.session.afterFrame(clock.now());
    }
  };
  const connect = () => {
    host.session.host({ transport });
    tick(1);
    guest.session.join(host.session.code(), { transport });
    tick(3);
  };
  return { clock, bus, transport, sandbox, host, guest, peers, make, tick, connect, world: world_ };
}

test('parseNetOptions: net=local, lag clamped, room', () => {
  assert.deepEqual(parseNetOptions('?net=local&lag=200&room=abc'), { local: true, lagMs: 200, room: 'abc' });
  assert.deepEqual(parseNetOptions(''), { local: false, lagMs: 0, room: null });
  assert.equal(parseNetOptions('?lag=9999').lagMs, 2000);
});

test('session: host and guest connect; the guest learns the host map', () => {
  const w = world();
  w.host.session.host({ transport: w.transport });
  assert.equal(w.host.session.state(), 'creating');
  w.tick(1);
  assert.equal(w.host.session.state(), 'waiting');
  assert.match(w.host.session.code(), /^[A-Z2-9]{6}$/);
  w.guest.session.join(w.host.session.code().toLowerCase(), { transport: w.transport });
  assert.equal(w.guest.session.state(), 'connecting');
  w.tick(3);
  assert.equal(w.host.session.state(), 'joined');
  assert.equal(w.guest.session.state(), 'connected');
  assert.deepEqual(w.guest.events, [{ type: 'connected', map: 'map.walkway' }]);
  const gv = w.guest.session.netView();
  const hv = w.host.session.netView();
  assert.deepEqual([hv.role(), hv.localSlot(), hv.peerPresent()], ['host', 0, true]);
  assert.deepEqual([gv.role(), gv.localSlot(), gv.peerPresent()], ['guest', 1, true]);
});

test('session: guest inputs reach the host as inputs[1], after a 2-entry jitter buffer', () => {
  const w = world();
  w.connect();
  w.guest.input.held = ['moveRight'];
  w.guest.input.aim = 1.25;
  w.tick(1); // guest sends its first input; the host gets it next tick
  w.tick(1);
  // One entry queued: the host still waits.
  assert.equal(w.host.lastFrames[1].actions.moveRight.held, false);
  w.tick(1);
  const f = w.host.lastFrames[1];
  assert.deepEqual([f.player, f.connected, f.actions.moveRight.held, f.aim, f.pointer], [1, true, true, 1.25, null]);
  // Player 1 on the host is still the host's own input.
  assert.equal(w.host.lastFrames[0].actions.moveRight.held, false);
  // The guest's pause key never reaches the host.
  w.guest.input.held = ['pause', 'moveRight'];
  w.tick(4);
  assert.equal(w.host.lastFrames[1].actions.pause.pressed, false);
  assert.equal(w.host.lastFrames[1].actions.moveRight.held, true);
});

test('session: outside the Sandbox the host gets slot 1 as a disconnected frame (no menu control)', () => {
  const w = world();
  w.connect();
  w.world.inSandbox = false;
  w.guest.input.held = ['jump', 'interact'];
  w.tick(4);
  const f = w.host.lastFrames[1];
  assert.equal(f.connected, false);
  assert.equal(f.actions.jump.held, true); // the queue still advances; the frame is just not connected
  w.world.inSandbox = true;
  w.tick(1);
  assert.equal(w.host.lastFrames[1].connected, true);
});

test('session: snapshots reach the guest with the ack; the host player is interpolated', () => {
  const w = world({ delayMs: 30 });
  w.connect();
  w.tick(30);
  w.sandbox.players = [
    { x: 4, y: 2, vx: 1, vy: 0, onGround: true, crouching: false, aim: 0.5, row: -1, hop: null, presses: { down: 255, jump: 255 }, health: 100, inventory: [], meleeTicks: 0, meleeDir: 1, fireTicks: 0 },
    { x: 9, y: 3, vx: 0, vy: 0, onGround: false, crouching: true, aim: -1, row: 0, hop: { to: 1, t: 4, y0: 3, y1: 1, fall: false }, presses: { down: 255, jump: 2 }, health: 40, inventory: [], meleeTicks: 12, meleeDir: -1, fireTicks: 5 },
  ];
  w.sandbox.ticks = 500;
  w.sandbox.enemies = [{ id: 3, type: 'walker', x: 7, y: 0, vx: 1, vy: 0, onGround: true, awake: true, aim: 0, crouching: false, health: 20, attackCooldown: 5 }];
  assert.deepEqual(w.guest.session.netView().remoteEnemies(), [], 'the host has sent no enemies yet');
  w.tick(30);
  const gv = w.guest.session.netView();
  const snap = gv.takeSnapshot();
  assert.ok(snap);
  assert.equal(snap.players.length, 2);
  assert.deepEqual(snap.players[1], w.sandbox.players[1]);
  assert.equal(snap.wt, 500);
  assert.deepEqual(snap.enemies, [{ id: 3, type: 'walker', x: 7, y: 0, awake: true, health: 20 }]);
  assert.ok(snap.ack > 0, `ack ${snap.ack}`);
  assert.equal(gv.takeSnapshot(), null, 'taken once');
  // Inputs after the ack are the ones the host has not applied yet: a few ticks' worth.
  const pending = gv.inputsAfter(snap.ack);
  assert.ok(pending.length >= 1 && pending.length < 20, `${pending.length} pending`);
  assert.ok(pending.every((e) => e.tick > snap.ack));
  const remote = gv.remotePlayer();
  assert.ok(Math.abs(remote.x - 4) < 1e-9);
  assert.equal(remote.depth, -1, 'the host player carries its drawn depth');
  assert.deepEqual(gv.remoteEnemies(), [{ id: 3, type: 'walker', x: 7, y: 0, vx: 0, vy: 0, aim: 0, awake: true, health: 20 }]);
  assert.deepEqual([remote.health, remote.meleeTicks, remote.meleeDir], [100, 0, 1], 'combat fields travel through the interpolation');
  const stats = w.guest.session.stats();
  assert.equal(stats.role, 'guest');
  assert.ok(stats.pingMs >= 60 && stats.pingMs < 120, `ping ${stats.pingMs}`);
  assert.ok(stats.msgsIn > 20 && stats.msgsOut > 50, JSON.stringify(stats));
});

test('session: with a 200 ms one-way delay the guest draws the host player and enemies moving on every tick', () => {
  // 12 ticks each way: snapshots (every 2nd tick) arrive 12 ticks late. Drawn at the estimated host
  // tick now, the sample would be past the newest snapshot and hold there, so the drawn position
  // would only change when a snapshot arrives (every 2nd tick).
  const w = world({ delayMs: 12 * STEP_MS });
  w.connect();
  const move = (t) => {
    w.sandbox.players = [{ x: t * 0.1, y: 2, vx: 6, vy: 0, onGround: true, crouching: false, aim: 0 }];
    w.sandbox.enemies = [{ id: 4, type: 'walker', x: 20 - t * 0.1, y: 0, vx: -6, vy: 0, onGround: true, awake: true, aim: 0, crouching: false }];
  };
  // Let pings and snapshots fill the clock samples and the buffers.
  for (let t = 0; t < 120; t++) {
    move(t);
    w.tick(1);
  }
  const gv = w.guest.session.netView();
  assert.ok(w.guest.session.stats().pingMs >= 390, `ping ${w.guest.session.stats().pingMs}`);
  let px = gv.remotePlayer().x;
  let ex = gv.remoteEnemies()[0].x;
  for (let t = 120; t < 180; t++) {
    move(t);
    w.tick(1);
    const p = gv.remotePlayer().x;
    const e = gv.remoteEnemies()[0].x;
    assert.ok(p > px + 1e-6, `player x moved at tick ${t}: ${px} -> ${p}`);
    assert.ok(e < ex - 1e-6, `enemy x moved at tick ${t}: ${ex} -> ${e}`);
    px = p;
    ex = e;
  }
});

test('session: guest enemies by id: a new id appears, a missing id is removed, the others interpolate on untouched', () => {
  const enemy = (id, x) => ({ id, type: 'walker', x, y: 0, vx: 0, vy: 0, onGround: true, awake: true, aim: 0, crouching: false });
  // Two identical worlds; in `cut`, enemy 1 (the middle of the list) disappears halfway.
  const run = (cut) => {
    const w = world({ delayMs: 30 });
    w.connect();
    const out = [];
    for (let t = 0; t < 40; t++) {
      w.sandbox.enemies = [enemy(0, t * 0.05), enemy(1, 10 + t * 0.05), enemy(2, 20 - t * 0.05)];
      if (cut && t >= 20) w.sandbox.enemies.splice(1, 1);
      if (t >= 30) w.sandbox.enemies.push(enemy(9, 50));
      w.tick(1);
      out.push(w.guest.session.netView().remoteEnemies());
    }
    return out;
  };
  const full = run(false);
  const cut = run(true);
  const byId = (list, id) => list?.find((e) => e.id === id);
  // The removed id is gone at the end; it was there before.
  assert.ok(byId(cut[15], 1), 'enemy 1 present before the cut');
  assert.equal(byId(cut.at(-1), 1), undefined, 'enemy 1 removed');
  assert.deepEqual(cut.at(-1).map((e) => e.id), [0, 2, 9]);
  // The others interpolate exactly as without the removal, on every tick.
  full.forEach((list, t) => {
    for (const id of [0, 2]) assert.deepEqual(byId(cut[t], id), byId(list, id), `enemy ${id} at tick ${t}`);
  });
  // A new id appears, created from its snapshot data.
  assert.equal(byId(full[25], 9), undefined);
  assert.deepEqual(byId(full.at(-1), 9), { id: 9, type: 'walker', x: 50, y: 0, vx: 0, vy: 0, aim: 0, awake: true, health: 30 });
});

test('session: a third peer gets full', () => {
  const w = world();
  w.connect();
  const third = w.make();
  w.peers.push(third);
  third.session.join(w.host.session.code(), { transport: w.transport });
  w.tick(3);
  assert.deepEqual(third.events, [{ type: 'ended', reason: 'full', wasConnected: false }]);
  assert.equal(third.session.active(), false);
  assert.equal(w.guest.session.state(), 'connected');
  assert.equal(w.host.session.state(), 'joined');
});

test('session: guest leaves -> host state left and continues; a new guest can join', () => {
  const w = world();
  w.connect();
  w.guest.session.leave();
  assert.deepEqual(w.guest.events.at(-1), { type: 'ended', reason: 'left', wasConnected: true });
  w.tick(2);
  assert.equal(w.host.session.state(), 'left');
  assert.equal(w.host.session.active(), true);
  assert.equal(w.host.session.netView().peerPresent(), false);
  assert.equal(w.host.lastFrames[1].connected, false, 'player 2 is the local pad again');
  w.guest.session.join(w.host.session.code(), { transport: w.transport });
  w.tick(3);
  assert.equal(w.host.session.state(), 'joined');
  assert.equal(w.guest.session.state(), 'connected');
});

test('session: host leaves -> guest ended with host-left', () => {
  const w = world();
  w.connect();
  w.host.session.leave();
  assert.equal(w.host.session.state(), 'idle');
  w.tick(2);
  assert.deepEqual(w.guest.events.at(-1), { type: 'ended', reason: 'host-left', wasConnected: true });
  assert.equal(w.guest.session.netView().localSlot(), 0);
});

test('session: silence drops the link on both sides', () => {
  const w = world();
  w.connect();
  w.bus.cut();
  w.tick(10); // pings go out but nothing arrives
  w.clock.advance(TIMEOUT_MS);
  assert.deepEqual(w.guest.events.at(-1), { type: 'ended', reason: 'dropped', wasConnected: true });
  assert.equal(w.host.session.state(), 'left');
});

test('session: invalid code ends before any network; an unknown code is not-found', () => {
  const w = world();
  w.guest.session.join('ab1', { transport: w.transport });
  assert.deepEqual(w.guest.events, [{ type: 'ended', reason: 'invalid', wasConnected: false }]);
  assert.equal(w.bus.posted.length, 0);
  w.guest.session.join('ZZZZZZ', { transport: w.transport });
  w.tick(150);
  assert.deepEqual(w.guest.events.at(-1), { type: 'ended', reason: 'not-found', wasConnected: false });
});

test('session: a guest with another protocol version is rejected', () => {
  const w = world();
  w.host.session.host({ transport: w.transport });
  w.tick(1);
  let channel;
  w.transport.join(w.host.session.code(), { onOpen: (c) => (channel = c), onError: assert.fail });
  w.tick(2);
  const got = [];
  channel.listen({ data: (d) => got.push(decode(d)), close: () => got.push('closed') });
  channel.send(encode({ t: 'hello', v: PROTOCOL_VERSION + 1 }));
  w.tick(3);
  assert.deepEqual(got, [{ t: 'reject', reason: 'version' }, 'closed']);
  assert.equal(w.host.session.state(), 'waiting');
});

test('guest input queue: waits for 2 entries, repeats held when empty, keeps presses when over-full', () => {
  const q = createGuestInputQueue();
  const J = bit('jump');
  const R = bit('moveRight');
  q.push({ tick: 1, held: R, pressed: R, aim: 0 });
  assert.equal(q.next().actions.moveRight.held, false, 'buffering');
  assert.equal(q.ack(), -1);
  q.push({ tick: 2, held: R, pressed: 0, aim: 0 });
  q.push({ tick: 2, held: 0, pressed: 0, aim: 0 }); // not newer: ignored
  let f = q.next();
  assert.deepEqual([f.actions.moveRight.held, f.actions.moveRight.pressed, q.ack()], [true, true, 1]);
  f = q.next();
  assert.deepEqual([f.actions.moveRight.held, f.actions.moveRight.pressed, q.ack()], [true, false, 2]);
  // Empty: held repeats, no presses, ack unchanged.
  f = q.next();
  assert.deepEqual([f.actions.moveRight.held, f.actions.moveRight.pressed, q.ack()], [true, false, 2]);
  // Over-full: the dropped entry's jump press moves to the next entry.
  q.push({ tick: 3, held: J, pressed: J, aim: 0 });
  for (let t = 4; t <= 3 + JITTER_MAX; t++) q.push({ tick: t, held: 0, pressed: 0, aim: 0 });
  assert.equal(q.size(), JITTER_MAX);
  f = q.next();
  assert.deepEqual([q.ack(), f.actions.jump.pressed, f.actions.jump.held], [4, true, false]);
  // released comes from the previous held mask.
  assert.equal(f.actions.moveRight.released, true);
  assert.equal(f.rowScheme, 'A', 'no rs: scheme A');
  // The row scheme travels with each entry and repeats while the queue is empty.
  const r = createGuestInputQueue();
  r.push({ tick: 1, held: 0, pressed: 0, aim: 0, rs: 'B' });
  r.push({ tick: 2, held: 0, pressed: 0, aim: 0, rs: 'B' });
  assert.deepEqual([r.next().rowScheme, r.next().rowScheme, r.next().rowScheme], ['B', 'B', 'B']);
});

test('session: an invalid code typed while hosting changes nothing', () => {
  const w = world();
  w.connect();
  const before = w.host.events.length;
  const code = w.host.session.code();
  assert.equal(w.host.session.join('ab1', { transport: w.transport }), false);
  assert.equal(w.host.session.state(), 'joined');
  assert.equal(w.host.session.role(), 'host');
  assert.equal(w.host.session.code(), code);
  assert.equal(w.host.events.length, before);
  w.tick(10);
  assert.equal(w.guest.session.state(), 'connected');
  assert.equal(w.guest.events.some((e) => e.type === 'ended'), false);
});

test('session: connectionStats is null when idle, and the channel stats only while connected', () => {
  const w = world();
  // A transport whose channels have getStats, to see the session pass it through.
  const withStats = {
    ...w.transport,
    host: (opts) => w.transport.host({ ...opts, onGuest: (ch) => opts.onGuest(Object.assign(ch, { getStats: () => 'host-stats' })) }),
    join: (code, opts) => w.transport.join(code, { ...opts, onOpen: (ch) => opts.onOpen(Object.assign(ch, { getStats: () => 'guest-stats' })) }),
  };
  assert.equal(w.host.session.connectionStats(), null);
  w.host.session.host({ transport: withStats });
  w.tick(1);
  assert.equal(w.host.session.connectionStats(), null); // waiting, no guest yet
  w.guest.session.join(w.host.session.code(), { transport: withStats });
  assert.equal(w.guest.session.connectionStats(), null); // connecting
  w.tick(3);
  assert.equal(w.host.session.connectionStats(), 'host-stats');
  assert.equal(w.guest.session.connectionStats(), 'guest-stats');
  w.guest.session.leave();
  assert.equal(w.guest.session.connectionStats(), null);
  w.tick(3);
  assert.equal(w.host.session.connectionStats(), null); // guest left
});

test('session: guest bolts by id: null before the first snapshot, drawn at the enemies\' tick, only between their first and last snapshot', () => {
  const bolt = (id, x) => ({ id, owner: 0, x, y: 1, angle: 0.25, row: 0, age: 3 });
  const enemy = (id, x) => ({ id, type: 'walker', x, y: 0, vx: 0, vy: 0, onGround: true, awake: true, aim: 0, crouching: false });
  const run = (cut) => {
    const w = world({ delayMs: 30 });
    w.connect();
    const out = [];
    for (let t = 0; t < 40; t++) {
      // Bolt 1 moves exactly like enemy 5, so both are sampled at one tick.
      w.sandbox.bolts = [bolt(0, t * 0.5), bolt(1, 10 + t * 0.5), bolt(2, 20 + t * 0.5)];
      w.sandbox.enemies = [enemy(5, 10 + t * 0.5)];
      if (cut && t >= 20) {
        w.sandbox.bolts.splice(1, 1);
        w.sandbox.enemies = [];
      }
      if (t >= 30) w.sandbox.bolts.push(bolt(9, 50));
      w.tick(1);
      const gv = w.guest.session.netView();
      out.push({ bolts: gv.remoteBolts(), enemies: gv.remoteEnemies() });
    }
    w.guest.session.leave();
    w.tick(2);
    assert.equal(w.guest.session.netView().remoteBolts(), null, 'none after leaving');
    return out;
  };
  const before = world();
  assert.equal(before.guest.session.netView().remoteBolts(), null, 'not a guest');
  before.world.inSandbox = false; // the host is on a menu: no snapshots
  before.connect();
  assert.equal(before.guest.session.state(), 'connected');
  assert.equal(before.guest.session.netView().remoteBolts(), null, 'no snapshot yet');
  before.world.inSandbox = true;
  before.tick(2);
  assert.deepEqual(before.guest.session.netView().remoteBolts(), [], 'the host has sent no bolts yet');
  const full = run(false);
  const cut = run(true);
  const byId = (list, id) => list?.find((b) => b.id === id);
  assert.deepEqual(Object.keys(byId(full[15].bolts, 1)).sort(), ['angle', 'id', 'row', 'x', 'y'], 'only the drawn fields');
  let paired = 0;
  for (const { bolts, enemies } of full) {
    // Before the draw tick reaches bolt 1's first snapshot it is not drawn (enemy 5 is, held there).
    if (!byId(bolts, 1) || !enemies?.length) continue;
    paired += 1;
    assert.equal(byId(bolts, 1).x, enemies[0].x, 'bolt 1 and enemy 5 at the same draw tick');
    assert.deepEqual([byId(bolts, 1).angle, byId(bolts, 1).row], [0.25, 0]);
  }
  assert.ok(paired > 25, `bolt 1 drawn with enemy 5 on ${paired} ticks`);
  assert.ok(byId(cut[15].bolts, 1), 'bolt 1 present before the cut');
  assert.deepEqual(cut.at(-1).bolts.map((b) => b.id), [0, 2, 9]);
  // A bolt missing from the snapshots (it hit something) is drawn until the draw tick passes its
  // last entry, so it leaves after the enemy (removed with the snapshot) and never jumps back.
  const enemyGone = cut.findIndex(({ enemies }) => enemies && !byId(enemies, 5));
  const boltGone = cut.findIndex(({ bolts }, t) => t > 15 && bolts && !byId(bolts, 1));
  assert.ok(enemyGone > 15 && boltGone >= enemyGone, `bolt 1 leaves at ${boltGone}, enemy 5 at ${enemyGone}`);
  assert.ok(boltGone - enemyGone <= INTERP_DELAY_TICKS + 2, 'within the interpolation delay of the enemy');
  for (let t = boltGone; t < cut.length; t++) assert.equal(byId(cut[t].bolts, 1), undefined, `bolt 1 stays gone at ${t}`);
  const lastX = byId(cut[boltGone - 1].bolts, 1).x;
  assert.ok(lastX > byId(cut[enemyGone - 1].bolts, 1).x, 'bolt 1 keeps moving after the cut');
  full.forEach(({ bolts }, t) => {
    for (const id of [0, 2]) assert.deepEqual(byId(cut[t].bolts, id), byId(bolts, id), `bolt ${id} at tick ${t}`);
  });
  // A new bolt is not drawn before the draw tick reaches its first snapshot, then from there.
  const shown = full.findIndex(({ bolts }) => byId(bolts, 9));
  assert.ok(shown > 30, `bolt 9 first drawn at ${shown}, after it was fired at 30`);
  assert.deepEqual(byId(full[shown].bolts, 9), { id: 9, x: 50, y: 1, angle: 0.25, row: 0 });
});

test('session: the host sends its taken pickups; the guest snapshot carries the mask and fire ticks', () => {
  const w = world();
  w.connect();
  w.sandbox.players = [{ x: 1, y: 2, vx: 0, vy: 0, onGround: true, crouching: false, aim: 0, inventory: ['plasmaPistol'], fireTicks: 30 }];
  w.sandbox.pickups = [{ id: 0, item: 'plasmaPistol', x: 2.5, y: 0, taken: true }, { id: 1, item: 'plasmaPistol', x: 6.5, y: 0, taken: false }];
  w.tick(4);
  const snap = w.guest.session.netView().takeSnapshot();
  assert.equal(snap.pickupsTaken, 1);
  assert.deepEqual([snap.players[0].inventory, snap.players[0].fireTicks], [['plasmaPistol'], 30]);
});
