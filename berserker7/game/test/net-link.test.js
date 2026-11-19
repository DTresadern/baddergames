import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MESSAGE_BYTES, decode, encode, loadCodec } from '../src/net/codec.js';
import { MAX_MESSAGES_PER_SECOND, TIMEOUT_MS, clampLag, createLink, createRawChannel } from '../src/net/link.js';
import { createFakeClock } from './fake-net.js';

await loadCodec();

// A link over a channel that records what is sent; the wire holds the sent bytes.
function setup({ lagMs = 0 } = {}) {
  const clock = createFakeClock();
  const wire = [];
  const got = [];
  const closes = [];
  let channelClosed = 0;
  const channel = createRawChannel({ send: (t) => wire.push({ time: clock.now(), bytes: t }), close: () => (channelClosed += 1) });
  const link = createLink({
    channel,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    lagMs,
    onMessage: (m) => got.push(m),
    onClose: (r) => closes.push(r),
  });
  return { clock, wire, got, closes, link, channel, channelClosed: () => channelClosed };
}

const ping = (id) => encode({ t: 'ping', id, time: 1 });

test('link: decodes received bytes; drops strings, malformed and oversize ones', () => {
  const { channel, got } = setup();
  channel.deliver(ping(1));
  channel.deliver(JSON.stringify({ t: 'ping', id: 1, time: 1 })); // a string, even valid JSON
  channel.deliver(new Uint8Array([0xc1]));
  channel.deliver(42);
  channel.deliver(null);
  channel.deliver(new Uint8Array(MAX_MESSAGE_BYTES + 1));
  assert.deepEqual(got, [{ t: 'ping', id: 1, time: 1 }]);
});

test('link: the 201st message in one second is dropped; the next window is accepted', () => {
  const { channel, got, clock } = setup();
  for (let i = 0; i < MAX_MESSAGES_PER_SECOND + 1; i++) channel.deliver(ping(i));
  assert.equal(MAX_MESSAGES_PER_SECOND, 200);
  assert.equal(got.length, 200);
  assert.equal(got.at(-1).id, 199);
  clock.advance(999);
  channel.deliver(ping(500));
  assert.equal(got.length, 200);
  clock.advance(1);
  channel.deliver(ping(501));
  assert.equal(got.at(-1).id, 501);
});

test('link: lag delays sends and keeps their order', () => {
  const { link, wire, clock } = setup({ lagMs: 200 });
  link.send({ t: 'ping', id: 1, time: 1 });
  clock.advance(50);
  link.send({ t: 'ping', id: 2, time: 1 });
  link.send({ t: 'ping', id: 3, time: 1 });
  clock.advance(149);
  assert.equal(wire.length, 0);
  clock.advance(1);
  assert.deepEqual(wire.map((w) => decode(w.bytes).id), [1]);
  clock.advance(50);
  assert.deepEqual(wire.map((w) => decode(w.bytes).id), [1, 2, 3]);
  assert.deepEqual(wire.map((w) => w.time), [1200, 1250, 1250]);
  assert.deepEqual([clampLag(-5), clampLag(5000), clampLag('x'), clampLag('150')], [0, 2000, 0, 150]);
});

test('link: no lag sends at once; encode errors throw', () => {
  const { link, wire } = setup();
  link.send({ t: 'bye' });
  assert.equal(wire.length, 1);
  assert.throws(() => link.send({ t: 'ping' }));
});

test('link: messages and bytes per second, in and out; lastReceived', () => {
  const { link, channel, clock } = setup();
  const bytes = ping(1);
  channel.deliver(bytes);
  channel.deliver(bytes);
  link.send({ t: 'bye' });
  assert.deepEqual(link.stats(), { msgsOut: 1, bytesOut: encode({ t: 'bye' }).byteLength, msgsIn: 2, bytesIn: 2 * bytes.byteLength, lastReceived: 1000 });
  channel.deliver('not bytes');
  assert.equal(link.stats().bytesIn, 2 * bytes.byteLength, 'a non-bytes delivery counts 0 bytes');
  clock.advance(500);
  channel.deliver(bytes);
  assert.equal(link.stats().msgsIn, 4);
  clock.advance(500);
  assert.deepEqual([link.stats().msgsIn, link.stats().msgsOut, link.stats().lastReceived], [1, 0, 1500]);
});

test('link: silence for TIMEOUT_MS closes it as dropped; messages keep it open', () => {
  const { channel, clock, closes, channelClosed } = setup();
  assert.equal(TIMEOUT_MS, 5000);
  clock.advance(4000);
  channel.deliver(ping(1));
  clock.advance(4999);
  assert.deepEqual(closes, []);
  clock.advance(1);
  assert.deepEqual(closes, ['dropped']);
  assert.equal(channelClosed(), 1);
  assert.equal(clock.pending(), 0);
});

test('link: close once, onClose once; a remote close gives closed; lagged sends flush on close', () => {
  const a = setup({ lagMs: 300 });
  a.link.send({ t: 'bye' });
  a.link.close('left');
  a.link.close('again');
  a.channel.remoteClosed();
  assert.deepEqual(a.closes, ['left']);
  assert.equal(a.channelClosed(), 1);
  assert.equal(a.wire.length, 1, 'the bye went out at close');
  a.link.send({ t: 'bye' });
  assert.equal(a.wire.length, 1, 'nothing is sent after close');
  const b = setup();
  b.channel.remoteClosed();
  assert.deepEqual(b.closes, ['closed']);
  assert.equal(b.link.closed(), true);
});

test('raw channel: data before listen is kept; nothing after close', () => {
  const sent = [];
  const ch = createRawChannel({ send: (b) => sent.push(b), close() {} });
  ch.deliver('a');
  ch.deliver('b');
  const got = [];
  ch.listen({ data: (d) => got.push(d), close: () => got.push('closed') });
  assert.deepEqual(got, ['a', 'b']);
  ch.close();
  ch.send('x');
  ch.deliver('c');
  assert.deepEqual([sent, got], [[], ['a', 'b']]);
});

test('createRawChannel: getStats is null without one, passes it through, and is null once closed', () => {
  assert.equal(createRawChannel({ send() {}, close() {} }).getStats(), null);
  const ch = createRawChannel({ send() {}, close() {}, getStats: () => 'stats' });
  assert.equal(ch.getStats(), 'stats');
  ch.close();
  assert.equal(ch.getStats(), null);
});
