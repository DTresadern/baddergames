import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import { PROTOCOL_VERSION, decode, encode } from '../src/net/codec.js';
import { TIMEOUT_MS } from '../src/net/link.js';
import { JITTER_MAX, OFFLINE_NET, createGuestInputQueue, createNetSession, parseNetOptions } from '../src/net/session.js';
import { createLocalTransport } from '../src/net/transport-local.js';
import { createFakeBroadcast, createFakeClock } from './fake-net.js';
import { frame } from './frames.js';

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
  const sandbox = { map: 'map.walkway', players: [{ x: 1, y: 2, vx: 0, vy: 0, onGround: true, crouching: false, aim: 0 }] };
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
  const host = make({ sandboxState: () => sandbox });
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
  return { clock, bus, transport, sandbox, host, guest, peers, make, tick, connect };
}

test('parseNetOptions: net=local, lag clamped, room', () => {
  assert.deepEqual(parseNetOptions('?net=local&lag=200&room=abc'), { local: true, lagMs: 200, room: 'abc' });
  assert.deepEqual(parseNetOptions(''), { local: false, lagMs: 0, room: null });
  assert.equal(parseNetOptions('?lag=9999').lagMs, 2000);
  assert.equal(OFFLINE_NET.localSlot(), 0);
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

test('session: snapshots reach the guest with the ack; the host player is interpolated', () => {
  const w = world({ delayMs: 30 });
  w.connect();
  w.tick(30);
  w.sandbox.players = [
    { x: 4, y: 2, vx: 1, vy: 0, onGround: true, crouching: false, aim: 0.5 },
    { x: 9, y: 3, vx: 0, vy: 0, onGround: false, crouching: true, aim: -1 },
  ];
  w.tick(30);
  const gv = w.guest.session.netView();
  const snap = gv.takeSnapshot();
  assert.ok(snap);
  assert.equal(snap.players.length, 2);
  assert.deepEqual(snap.players[1], w.sandbox.players[1]);
  assert.ok(snap.ack > 0, `ack ${snap.ack}`);
  assert.equal(gv.takeSnapshot(), null, 'taken once');
  // Inputs after the ack are the ones the host has not applied yet: a few ticks' worth.
  const pending = gv.inputsAfter(snap.ack);
  assert.ok(pending.length >= 1 && pending.length < 20, `${pending.length} pending`);
  assert.ok(pending.every((e) => e.tick > snap.ack));
  const remote = gv.remotePlayer();
  assert.ok(Math.abs(remote.x - 4) < 1e-9);
  const stats = w.guest.session.stats();
  assert.equal(stats.role, 'guest');
  assert.ok(stats.pingMs >= 60 && stats.pingMs < 120, `ping ${stats.pingMs}`);
  assert.ok(stats.msgsIn > 20 && stats.msgsOut > 50, JSON.stringify(stats));
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
  channel.listen({ text: (t) => got.push(decode(t)), close: () => got.push('closed') });
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
});
