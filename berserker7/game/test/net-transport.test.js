import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { decode, encode, loadCodec } from '../src/net/codec.js';
import { LOCAL_JOIN_TIMEOUT_MS, createLocalTransport } from '../src/net/transport-local.js';
import { createLink, createRawChannel } from '../src/net/link.js';
import { HOST_RETRIES, JOIN_TIMEOUT_MS, PEER_ID_PREFIX, createPeerTransport, peerErrorReason } from '../src/net/transport-peer.js';
import { createFakeBroadcast, createFakeClock } from './fake-net.js';

await loadCodec();

function localSetup() {
  const clock = createFakeClock();
  const bus = createFakeBroadcast(clock);
  let n = 0;
  const transport = createLocalTransport({ BroadcastChannel: bus.BroadcastChannel, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, randomId: () => `id${++n}` });
  return { clock, bus, transport };
}

const HI = new Uint8Array([1, 2]);
const YO = new Uint8Array([3, 4, 5]);
const HELLO = encode({ t: 'hello', v: 1 });
const BYE = encode({ t: 'bye' });
const listen = (channel, log) => channel.listen({ data: (d) => log.push(d), close: () => log.push('closed') });

test('local transport: host and guest open a channel and exchange bytes both ways', () => {
  const { clock, transport } = localSetup();
  const events = [];
  let hostChannel;
  transport.host({ makeCode: () => 'ABCDEF', onReady: (c) => events.push(`ready ${c}`), onGuest: (ch) => (hostChannel = ch), onError: (r) => events.push(r) });
  clock.advance(0);
  let guestChannel;
  transport.join('ABCDEF', { onOpen: (ch) => (guestChannel = ch), onError: (r) => events.push(r) });
  clock.advance(0);
  clock.advance(0);
  assert.deepEqual(events, ['ready ABCDEF']);
  const atHost = [];
  const atGuest = [];
  listen(hostChannel, atHost);
  listen(guestChannel, atGuest);
  guestChannel.send(HI);
  hostChannel.send(YO);
  clock.advance(0);
  assert.deepEqual([atHost, atGuest], [[HI], [YO]]);
  guestChannel.close();
  clock.advance(0);
  assert.deepEqual(atHost, [HI, 'closed']);
});

test('local transport: a second joiner gets reject full and nothing else; no host gives not-found', () => {
  const { clock, bus, transport } = localSetup();
  transport.host({ makeCode: () => 'ABCDEF', onReady() {}, onGuest() {}, onError() {} });
  transport.join('ABCDEF', { onOpen() {}, onError() {} });
  clock.advance(10);
  let third;
  transport.join('ABCDEF', { onOpen: (ch) => (third = ch), onError: assert.fail });
  clock.advance(10);
  const got = [];
  listen(third, got);
  assert.deepEqual(got.map(decode), [{ t: 'reject', reason: 'full' }]);
  assert.equal(bus.posted.filter((p) => p.data.k === 'accept').length, 1);
  const errors = [];
  transport.join('ZZZZZZ', { onOpen: assert.fail, onError: (r) => errors.push(r) });
  clock.advance(LOCAL_JOIN_TIMEOUT_MS - 1);
  assert.deepEqual(errors, []);
  clock.advance(1);
  assert.deepEqual(errors, ['not-found']);
});

// A fake PeerJS: peers by id on one bus; connections are linked EventEmitters.
function fakePeerLib(clock, taken = new Set()) {
  const peers = new Map();
  let anon = 0;
  class FakeConn extends EventEmitter {
    constructor(peer) {
      super();
      this.peer = peer;
      this.other = null;
      this.open = false;
    }
    send(data) {
      const other = this.other;
      // Destroying the sending peer tears down its connection: data still in flight is lost.
      clock.setTimeout(() => {
        if (!this.peer.destroyed) other.emit('data', data);
      }, 0);
    }
    close() {
      if (!this.open) return;
      this.open = false;
      this.other.open = false;
      clock.setTimeout(() => {
        this.emit('close');
        this.other.emit('close');
      }, 0);
    }
  }
  class FakePeer extends EventEmitter {
    constructor(id = `anon${++anon}`) {
      super();
      this.id = id;
      this.destroyed = false;
      this.conns = [];
      clock.setTimeout(() => {
        if (taken.has(id) || peers.has(id)) this.emit('error', { type: 'unavailable-id' });
        else {
          peers.set(id, this);
          this.emit('open', id);
        }
      }, 0);
    }
    connect(id, options) {
      this.lastOptions = options;
      const mine = new FakeConn(this);
      clock.setTimeout(() => {
        const target = peers.get(id);
        if (!target) {
          this.emit('error', { type: 'peer-unavailable' });
          return;
        }
        const theirs = new FakeConn(target);
        mine.other = theirs;
        theirs.other = mine;
        mine.open = theirs.open = true;
        this.conns.push(mine);
        target.conns.push(theirs);
        target.emit('connection', theirs);
        clock.setTimeout(() => {
          theirs.emit('open');
          mine.emit('open');
        }, 0);
      }, 0);
      return mine;
    }
    reconnect() {
      this.reconnects = (this.reconnects ?? 0) + 1;
    }
    destroy() {
      this.destroyed = true;
      if (peers.get(this.id) === this) peers.delete(this.id);
      // Destroying a peer closes its open connections, at both ends.
      for (const conn of this.conns) {
        if (!conn.open) continue;
        conn.open = false;
        conn.other.open = false;
        clock.setTimeout(() => {
          conn.emit('close');
          conn.other.emit('close');
        }, 0);
      }
    }
  }
  return { FakePeer, peers };
}

async function peerSetup(taken) {
  const clock = createFakeClock();
  const lib = fakePeerLib(clock, taken);
  const transport = createPeerTransport({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, loadPeer: async () => lib.FakePeer });
  const run = async (ms = 0) => {
    await new Promise((r) => setImmediate(r));
    clock.advance(ms);
  };
  return { clock, lib, transport, run };
}

test('peer transport: error mapping', () => {
  assert.deepEqual(
    ['peer-unavailable', 'network', 'server-error', 'socket-error', 'browser-incompatible', 'webrtc'].map(peerErrorReason),
    ['not-found', 'server', 'server', 'server', 'unsupported', 'failed'],
  );
});

test('peer transport: host retries a taken code; guest joins with raw serialization; a second guest is rejected', async () => {
  const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC'];
  const { lib, transport, run } = await peerSetup(new Set([PEER_ID_PREFIX + 'AAAAAA', PEER_ID_PREFIX + 'BBBBBB']));
  const ready = [];
  let hostChannel;
  transport.host({ makeCode: () => codes.shift(), onReady: (c) => ready.push(c), onGuest: (ch) => (hostChannel = ch), onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  assert.deepEqual(ready, ['CCCCCC']);
  assert.ok(HOST_RETRIES >= 2);
  let guestChannel;
  transport.join('CCCCCC', { onOpen: (ch) => (guestChannel = ch), onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  assert.ok(hostChannel && guestChannel);
  const anon = [...lib.peers.values()].find((p) => p.id.startsWith('anon'));
  assert.deepEqual(anon.lastOptions, { reliable: true, serialization: 'raw' });
  const got = [];
  listen(hostChannel, got);
  guestChannel.send(HELLO);
  await run();
  assert.deepEqual(got, [HELLO]);
  let third;
  transport.join('CCCCCC', { onOpen: (ch) => (third = ch), onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  const thirdGot = [];
  listen(third, thirdGot);
  await run(1000);
  assert.deepEqual(thirdGot.map((t) => (t === 'closed' ? t : decode(t))), [{ t: 'reject', reason: 'full' }, 'closed']);
});

test('peer transport: the host bye reaches the guest before the connection closes', async () => {
  const { transport, run } = await peerSetup();
  let hostChannel;
  const hostHandle = transport.host({ makeCode: () => 'CCCCCC', onReady() {}, onGuest: (ch) => (hostChannel = ch), onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  let guestChannel;
  transport.join('CCCCCC', { onOpen: (ch) => (guestChannel = ch), onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  assert.ok(hostChannel && guestChannel);
  const got = [];
  listen(guestChannel, got);
  hostChannel.send(BYE);
  hostChannel.close();
  hostHandle.close();
  await run(1000);
  assert.deepEqual(got, [BYE, 'closed']);
});

test('peer transport: an unknown code is not-found; no answer is timeout', async () => {
  const { transport, run } = await peerSetup();
  const errors = [];
  transport.join('ZZZZZZ', { onOpen: assert.fail, onError: (r) => errors.push(r) });
  for (let i = 0; i < 3; i++) await run();
  assert.deepEqual(errors, ['not-found']);
  const clock = createFakeClock();
  const stuck = createPeerTransport({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, loadPeer: () => new Promise(() => {}) });
  const late = [];
  stuck.join('ABCDEF', { onOpen: assert.fail, onError: (r) => late.push(r) });
  clock.advance(JOIN_TIMEOUT_MS);
  assert.deepEqual(late, ['timeout']);
});

test('peer transport: an ArrayBuffer from the connection reaches the link as a Uint8Array; a string is dropped', async () => {
  const { clock, lib, transport, run } = await peerSetup();
  let hostChannel;
  transport.host({ makeCode: () => 'CCCCCC', onReady() {}, onGuest: (ch) => (hostChannel = ch), onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  transport.join('CCCCCC', { onOpen() {}, onError: assert.fail });
  for (let i = 0; i < 5; i++) await run();
  const raw = [];
  const messages = [];
  hostChannel.listen({ data: (d) => raw.push(d), close() {} });
  const conn = lib.peers.get(PEER_ID_PREFIX + 'CCCCCC').conns[0];
  const sent = encode({ t: 'ping', id: 9, time: 3 });
  conn.emit('data', sent.buffer.slice(sent.byteOffset, sent.byteOffset + sent.byteLength));
  assert.equal(raw.length, 1);
  assert.ok(raw[0] instanceof Uint8Array);
  assert.deepEqual(decode(raw[0]), { t: 'ping', id: 9, time: 3 });
  // The same delivery through a link: bytes decode, a string is dropped.
  const channel2 = createRawChannel({ send() {}, close() {} });
  createLink({ channel: channel2, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onMessage: (m) => messages.push(m) });
  channel2.deliver(raw[0]);
  channel2.deliver(JSON.stringify({ t: 'ping', id: 9, time: 3 }));
  assert.deepEqual(messages, [{ t: 'ping', id: 9, time: 3 }]);
});
