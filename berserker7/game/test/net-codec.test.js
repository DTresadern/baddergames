import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import {
  MAX_MESSAGE_BYTES,
  MESSAGES,
  PROTOCOL_VERSION,
  byteLength,
  decode,
  encode,
  frameFromMasks,
  frameMasks,
  inputMessage,
  snapMessage,
  snapshotFromMessage,
} from '../src/net/codec.js';
import { frame } from './frames.js';

const player = (x, extra = {}) => ({ x, y: 2.5, vx: -3, vy: 0.25, onGround: true, crouching: false, aim: 1.5, ...extra });

const SAMPLES = {
  hello: { t: 'hello', v: PROTOCOL_VERSION },
  welcome: { t: 'welcome', map: 'map.walkway', slot: 1, tick: 1234 },
  reject: { t: 'reject', reason: 'full' },
  map: { t: 'map', map: 'map.mvp-upper-1' },
  input: { t: 'input', tick: 99, held: 5, pressed: 1, aim: -0.5 },
  snap: snapMessage({ tick: 10, ack: -1, players: [player(1), player(2, { crouching: true })] }),
  ping: { t: 'ping', id: 3, time: 12345.5 },
  pong: { t: 'pong', id: 3, time: 12345.5, tick: 600 },
  bye: { t: 'bye' },
};

test('codec: every message type round-trips unchanged', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(MESSAGES).sort());
  for (const [type, msg] of Object.entries(SAMPLES)) {
    const text = encode(msg);
    assert.equal(typeof text, 'string', type);
    assert.deepEqual(decode(text), msg, type);
  }
});

test('codec: messages are flat (no field spec is an object or array of values)', () => {
  for (const [type, fields] of Object.entries(MESSAGES)) {
    for (const [name, spec] of Object.entries(fields)) {
      assert.ok(['int', 'number', 'boolean', 'enum', 'string'].includes(spec.kind), `${type}.${name}`);
    }
  }
});

test('decode: unknown fields dropped, numbers clamped, integers rounded; a new object', () => {
  const raw = JSON.stringify({ t: 'input', tick: 7.6, held: -4, pressed: 1, aim: 99, extra: { a: 1 } });
  assert.deepEqual(decode(raw), { t: 'input', tick: 8, held: 0, pressed: 1, aim: Math.PI });
  const snap = decode(JSON.stringify({ ...SAMPLES.snap, x0: 1e9, vx1: -5000 }));
  assert.equal(snap.x0, 100000);
  assert.equal(snap.vx1, -1000);
});

test('decode: malformed input gives null', () => {
  const ok = { t: 'ping', id: 1, time: 5 };
  const bad = [
    42,
    null,
    'not json',
    '[1,2]',
    'null',
    '"text"',
    JSON.stringify({ t: 'nope' }),
    JSON.stringify({ id: 1, time: 5 }),
    JSON.stringify({ t: 'ping', id: 1 }), // missing field
    JSON.stringify({ t: 'ping', id: '1', time: 5 }), // wrong type
    JSON.stringify({ t: 'ping', id: { n: 1 }, time: 5 }), // nested object
    JSON.stringify({ t: 'ping', id: [1], time: 5 }), // array
    '{"t":"ping","id":1,"time":1e999}', // Infinity
    JSON.stringify({ t: 'reject', reason: 'bored' }), // not in the enum
    JSON.stringify({ t: 'snap', ...SAMPLES.snap, g0: 1 }), // boolean as number
    JSON.stringify({ t: 'toString' }),
    JSON.stringify({ ...ok, pad: 'x'.repeat(MAX_MESSAGE_BYTES) }), // oversize
  ];
  for (const text of bad) assert.equal(decode(text), null, String(text).slice(0, 60));
  assert.deepEqual(decode(JSON.stringify(ok)), ok);
});

test('encode: throws on a malformed message', () => {
  assert.throws(() => encode({ t: 'ping', id: 1 }), /time/);
  assert.throws(() => encode({ t: 'ping', id: NaN, time: 1 }), /id/);
  assert.throws(() => encode({ t: 'ping', id: 1, time: Infinity }), /time/);
  assert.throws(() => encode({ t: 'wat' }), /unknown type/);
  assert.throws(() => encode({ t: 'bye', extra: 1 }), /unknown field/);
  assert.throws(() => encode([]), /plain object/);
});

test('byteLength: UTF-8 bytes', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('é'), 2);
  assert.equal(byteLength('€'), 3);
  assert.equal(byteLength('😀'), 4);
});

test('input frames: masks round-trip; released derived from the previous held mask', () => {
  assert.ok(ACTIONS.length < 31);
  const f = frame(['moveRight', 'jump']);
  f.aim = 0.75;
  f.actions.dash = { held: true, pressed: false, released: false };
  const msg = inputMessage(42, f);
  assert.deepEqual(decode(encode(msg)), msg);
  const prevHeld = 1 << ACTIONS.indexOf('moveLeft');
  const back = frameFromMasks(msg, prevHeld);
  assert.deepEqual(back, {
    player: 1,
    connected: true,
    actions: Object.fromEntries(ACTIONS.map((a) => [a, {
      held: ['moveRight', 'jump', 'dash'].includes(a),
      pressed: ['moveRight', 'jump'].includes(a),
      released: a === 'moveLeft',
    }])),
    aim: 0.75,
    wheel: 0,
    pointer: null,
    activated: false,
  });
  assert.deepEqual(frameMasks(back), { held: msg.held, pressed: msg.pressed });
  // A disconnected frame sends nothing held.
  assert.deepEqual(frameMasks(frame(['jump'], null, false)), { held: 0, pressed: 0 });
});

test('snapshots: players round-trip; n limits the list', () => {
  const players = [player(1), player(-7.25, { onGround: false, crouching: true, aim: -3 })];
  const msg = decode(encode(snapMessage({ tick: 5, ack: 3, players })));
  assert.deepEqual(snapshotFromMessage(msg), { tick: 5, ack: 3, players });
  const one = decode(encode(snapMessage({ tick: 6, ack: -1, players: players.slice(0, 1) })));
  assert.equal(one.n, 1);
  assert.deepEqual(snapshotFromMessage(one).players, [players[0]]);
  // Players carry a size in the Sandbox; it is not sent.
  const sized = decode(encode(snapMessage({ tick: 1, ack: -1, players: [{ ...player(0), size: { width: 1 } }] })));
  assert.equal('size' in snapshotFromMessage(sized).players[0], false);
});
