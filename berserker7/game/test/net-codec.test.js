import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS } from '../src/input/actions.js';
import { readFileSync } from 'node:fs';
import {
  MAX_BOLTS,
  MAX_ENEMIES,
  MAX_MESSAGE_BYTES,
  MAX_PICKUPS,
  MESSAGES,
  PROTOCOL_VERSION,
  decode,
  encode,
  frameFromMasks,
  frameMasks,
  inputMessage,
  loadCodec,
  snapMessage,
  snapshotFromMessage,
} from '../src/net/codec.js';
import { Packr } from 'msgpackr';
import { frame } from './frames.js';

await loadCodec();
// A plain msgpackr instance, to craft raw input the codec itself would never produce.
const plain = new Packr({ useRecords: false, moreTypes: false, mapsAsObjects: true });

const player = (x, extra = {}) => ({ x, y: 2.5, vx: -3, vy: 0.25, onGround: true, crouching: false, aim: 1.5, row: 0, hop: null, presses: { down: 255, jump: 255 }, health: 100, inventory: [], meleeTicks: 0, meleeDir: 1, fireTicks: 0, ...extra });
const walker = (id, x, y, awake, health = 30) => ({ id, type: 'walker', x, y, awake, health });

const SAMPLES = {
  hello: { t: 'hello', v: PROTOCOL_VERSION },
  welcome: { t: 'welcome', map: 'map.walkway', slot: 1, tick: 1234 },
  reject: { t: 'reject', reason: 'full' },
  map: { t: 'map', map: 'map.mvp-upper-1' },
  input: { t: 'input', tick: 99, held: 5, pressed: 1, aim: -0.5, rs: 'A' },
  snap: snapMessage({ tick: 10, ack: -1, wt: 8, players: [player(1), player(2, { crouching: true })], enemies: [walker(4, 3, -2, true, 20)] }),
  ping: { t: 'ping', id: 3, time: 12345.5 },
  pong: { t: 'pong', id: 3, time: 12345.5, tick: 600 },
  bye: { t: 'bye' },
};

test('codec: every message type round-trips unchanged, as Uint8Array bytes', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(MESSAGES).sort());
  for (const [type, msg] of Object.entries(SAMPLES)) {
    const bytes = encode(msg);
    assert.ok(bytes instanceof Uint8Array, type);
    assert.equal(Buffer.isBuffer(bytes), false, type);
    assert.deepEqual(decode(bytes), msg, type);
  }
});

test('codec: loadCodec is cached; a failed load is forgotten so a retry works; encode and decode throw before load', async () => {
  const fresh = await import('../src/net/codec.js?fresh');
  assert.equal(fresh.codecLoaded(), false);
  assert.throws(() => fresh.encode({ t: 'bye' }), /not loaded \(call loadCodec first\)/);
  assert.throws(() => fresh.decode(new Uint8Array([0x80])), /not loaded \(call loadCodec first\)/);
  let calls = 0;
  await assert.rejects(fresh.loadCodec(() => (calls++, Promise.reject(new Error('offline')))), /offline/);
  assert.equal(fresh.codecLoaded(), false);
  const first = fresh.loadCodec(() => (calls++, Promise.resolve({ Packr })));
  assert.equal(fresh.loadCodec(() => assert.fail('loaded twice')), first);
  await first;
  assert.equal(calls, 2);
  assert.equal(fresh.codecLoaded(), true);
  assert.deepEqual(fresh.decode(fresh.encode({ t: 'bye' })), { t: 'bye' });
});

test('encode: output is a fresh buffer of its own, not msgpackr\'s shared one', () => {
  const a = encode(SAMPLES.snap);
  const aCopy = Uint8Array.from(a);
  const b = encode(SAMPLES.ping);
  assert.notEqual(a.buffer, b.buffer);
  for (const bytes of [a, b]) {
    assert.equal(bytes.byteOffset, 0);
    assert.equal(bytes.buffer.byteLength, bytes.byteLength);
  }
  assert.deepEqual(a, aCopy, 'a later encode did not change an earlier one');
});

test('codec: the largest message fits well inside MAX_MESSAGE_BYTES', () => {
  const extreme = (x) => ({
    x, y: -12345.678901234, vx: -777.123456789, vy: 0.25123456789, onGround: true, crouching: true, aim: -3.14159265358979,
    row: -64, hop: { to: -63, t: 14, y0: -99999.123456789, y1: -99998.123456789, fall: true }, presses: { down: 254, jump: 254 },
    health: 99, inventory: ['plasmaPistol'], meleeTicks: 17, meleeDir: -1, fireTicks: 29,
  });
  const enemy = (i) => ({ id: 65535 - i, type: 'walker', x: -99999.123456789 + i, y: 12345.678901234, awake: true, health: 29 });
  const bolt = (i) => ({ id: 65535 - i, x: -99999.123456789 + i, y: 12345.678901234, angle: -3.14159265358979 + i * 0.001, row: -64 });
  const pickups = Array.from({ length: MAX_PICKUPS }, (_, id) => ({ id, taken: true }));
  const big = (enemies, bolts) => ({
    tick: 2 ** 31 - 1, ack: 2 ** 31 - 1, wt: 2 ** 31 - 1, players: [extreme(99999.123456789), extreme(-99999.123456789)],
    enemies: Array.from({ length: enemies }, (_, i) => enemy(i)), pickups, bolts: Array.from({ length: bolts }, (_, i) => bolt(i)),
  });
  const worst = encode(snapMessage(big(MAX_ENEMIES, MAX_BOLTS))).byteLength;
  const noBolts = encode(snapMessage(big(MAX_ENEMIES, 0))).byteLength;
  const perBolt = (encode(snapMessage(big(MAX_ENEMIES, 1))).byteLength - noBolts);
  // The test level's real enemy count, values at the same extremes, every bolt in flight.
  const level = JSON.parse(readFileSync(new URL('../public/content/maps/moge3-cyberpunk-blocks.json', import.meta.url), 'utf8'));
  const levelEnemies = level.spawns.filter((s) => s.type === 'enemy').length;
  const levelBytes = encode(snapMessage(big(levelEnemies, MAX_BOLTS))).byteLength;
  console.log(`snap bytes: worst case (2 players, ${MAX_ENEMIES} enemies, ${MAX_BOLTS} bolts) ${worst}; no bolts ${noBolts}; one bolt in flight ${perBolt}; this level (${levelEnemies} enemies, ${MAX_BOLTS} bolts) ${levelBytes}; limit ${MAX_MESSAGE_BYTES}`);
  assert.ok(worst <= 1700, `worst case ${worst} (1689 with bolts, pickups and fire ticks, protocol 8)`);
  assert.ok(worst < MAX_MESSAGE_BYTES - 300, 'a margin of at least 300 bytes');
  assert.ok(levelEnemies <= MAX_ENEMIES);
  assert.equal(MAX_MESSAGE_BYTES, 2048);
});

test('decode: unknown fields dropped, numbers clamped, integers rounded; a new object', () => {
  const raw = plain.pack({ t: 'input', tick: 7.6, held: -4, pressed: 1, aim: 99, rs: 'B', extra: { a: 1 } });
  assert.deepEqual(decode(Uint8Array.from(raw)), { t: 'input', tick: 8, held: 0, pressed: 1, aim: Math.PI, rs: 'B' });
  const snap = decode(Uint8Array.from(plain.pack({ ...SAMPLES.snap, x0: 1e9, vx1: -5000 })));
  assert.equal(snap.x0, 100000);
  assert.equal(snap.vx1, -1000);
  const extra = decode(Uint8Array.from(plain.pack({ t: 'bye', junk: 'x' })));
  assert.deepEqual(extra, { t: 'bye' });
});

test('decode: malformed bytes give null', () => {
  const ok = { t: 'ping', id: 1, time: 5 };
  const packed = (v) => Uint8Array.from(plain.pack(v));
  const good = packed(ok);
  const bad = [
    42,
    null,
    undefined,
    'not bytes',
    JSON.stringify(ok), // a JSON string, even a valid one
    [1, 2],
    new ArrayBuffer(4), // not a Uint8Array
    new Uint8Array(0), // empty
    good.slice(0, good.length - 2), // truncated
    new Uint8Array([0xc1]), // never-used MessagePack byte
    Uint8Array.from([...good, 0]), // trailing byte
    Uint8Array.from([...good, ...good]), // two messages
    packed([1, 2]), // not a map
    packed(7),
    packed(null),
    packed('ping'),
    packed({ t: 'nope' }),
    packed({ id: 1, time: 5 }),
    packed({ t: 'toString' }),
    packed({ t: 'ping', id: 1 }), // missing field
    packed({ t: 'ping', id: '1', time: 5 }), // wrong type
    packed({ t: 'ping', id: { n: 1 }, time: 5 }), // nested object
    packed({ t: 'ping', id: [1], time: 5 }), // array
    packed({ t: 'ping', id: 1, time: NaN }),
    packed({ t: 'ping', id: 1, time: Infinity }),
    packed({ t: 'ping', id: 1, time: -Infinity }),
    packed({ t: 'reject', reason: 'bored' }), // not in the enum
    packed({ ...SAMPLES.snap, g0: 1 }), // boolean as number
    packed(new Date(0)), // an extension type decoded to a non-plain object
    packed(new Set([1])),
  ];
  for (const bytes of bad) assert.equal(decode(bytes), null, String(bytes).slice(0, 60));
  assert.deepEqual(decode(good), ok);
});

test('decode: over MAX_MESSAGE_BYTES gives null, even when otherwise valid; the limit is exact', () => {
  const ok = { t: 'ping', id: 1, time: 5 };
  const padded = (n) => Uint8Array.from(plain.pack({ ...ok, pad: 'x'.repeat(n) }));
  assert.deepEqual(decode(padded(100)), ok);
  const over = padded(MAX_MESSAGE_BYTES);
  assert.ok(over.byteLength > MAX_MESSAGE_BYTES);
  assert.equal(decode(over), null);
  assert.equal(decode(new Uint8Array(MAX_MESSAGE_BYTES + 1)), null);
  // The limit is exact: a message of MAX_MESSAGE_BYTES bytes decodes, one byte more does not.
  let n = 0;
  while (padded(n).byteLength < MAX_MESSAGE_BYTES) n += 1;
  assert.equal(padded(n).byteLength, MAX_MESSAGE_BYTES);
  assert.deepEqual(decode(padded(n)), ok);
  assert.equal(decode(padded(n + 1)), null);
  // encode's size check cannot be reached with a valid message: every field is a short number,
  // boolean or pattern-limited string, so the largest message is far below the limit.
  assert.throws(() => encode({ t: 'map', map: 'x'.repeat(MAX_MESSAGE_BYTES + 1) }), /map/);
});

test('encode: throws on a malformed message', () => {
  assert.throws(() => encode({ t: 'ping', id: 1 }), /time/);
  assert.throws(() => encode({ t: 'ping', id: NaN, time: 1 }), /id/);
  assert.throws(() => encode({ t: 'ping', id: 1, time: Infinity }), /time/);
  assert.throws(() => encode({ t: 'wat' }), /unknown type/);
  assert.throws(() => encode({ t: 'bye', extra: 1 }), /unknown field/);
  assert.throws(() => encode([]), /plain object/);
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
    rowScheme: 'A',
  });
  assert.deepEqual(frameMasks(back), { held: msg.held, pressed: msg.pressed });
  // A disconnected frame sends nothing held.
  assert.deepEqual(frameMasks(frame(['jump'], null, false)), { held: 0, pressed: 0 });
});

test('snapshots: players, the world tick and enemies round-trip; n and ne limit the lists', () => {
  const players = [player(1), player(-7.25, { onGround: false, crouching: true, aim: -3 })];
  const enemies = [walker(0, 22.5, 0, false), walker(7, -3.25, 6, true, 10)];
  const msg = decode(encode(snapMessage({ tick: 5, ack: 3, wt: 4, players, enemies })));
  assert.deepEqual(snapshotFromMessage(msg), { tick: 5, ack: 3, wt: 4, players, enemies, pickupsTaken: 0, bolts: [] });
  const one = decode(encode(snapMessage({ tick: 6, ack: -1, wt: 0, players: players.slice(0, 1) })));
  assert.equal(one.n, 1);
  assert.equal(one.ne, 0);
  assert.deepEqual(snapshotFromMessage(one).players, [players[0]]);
  assert.deepEqual(snapshotFromMessage(one).enemies, []);
  // Players and enemies carry more in the Sandbox (size, velocity...); only the listed fields go.
  const sized = decode(encode(snapMessage({ tick: 1, ack: -1, wt: 1, players: [{ ...player(0), size: { width: 1 } }], enemies: [{ ...enemies[0], vx: 2, size: {} }] })));
  assert.equal('size' in snapshotFromMessage(sized).players[0], false);
  assert.deepEqual(snapshotFromMessage(sized).enemies, [enemies[0]]);
  // More than MAX_ENEMIES: the first MAX_ENEMIES are sent.
  const many = Array.from({ length: MAX_ENEMIES + 3 }, (_, i) => walker(i, i, 0, false));
  assert.deepEqual(snapshotFromMessage(decode(encode(snapMessage({ tick: 1, ack: -1, wt: 1, players, enemies: many })))).enemies, many.slice(0, MAX_ENEMIES));
});

test('input frames: the row scheme travels as rs into frameFromMasks\' rowScheme', () => {
  const f = { ...frame(['moveDown']), rowScheme: 'B' };
  const msg = decode(encode(inputMessage(3, f)));
  assert.equal(msg.rs, 'B');
  assert.equal(frameFromMasks(msg).rowScheme, 'B');
  assert.equal(inputMessage(3, frame([])).rs, 'A', 'no scheme on the frame: A');
  assert.equal(frameFromMasks({ held: 0, pressed: 0, aim: 0 }).rowScheme, 'A');
  assert.equal(decode(Uint8Array.from(plain.pack({ ...msg, rs: 'C' }))), null, 'unknown scheme');
});

test('snapshots: each player slot carries its row, hop and press ages', () => {
  const players = [
    player(1, { row: -1, hop: { to: 0, t: 7, y0: -2.5, y1: 0, fall: true }, presses: { down: 255, jump: 3 } }),
    player(2, { row: 1, presses: { down: 0, jump: 12 } }),
  ];
  const back = snapshotFromMessage(decode(encode(snapMessage({ tick: 5, ack: 3, wt: 4, players }))));
  assert.deepEqual(back.players, players);
  const scripted = [player(1, { row: 1, hop: { to: 0, t: 3, y0: -2, y1: 0, fall: false } })];
  assert.deepEqual(snapshotFromMessage(decode(encode(snapMessage({ tick: 5, ack: 3, wt: 4, players: scripted })))).players, scripted);
  // Missing fields (a player made before rows): row 0, no hop, no recent press.
  const old = snapshotFromMessage(decode(encode(snapMessage({ tick: 5, ack: 3, wt: 4, players: [{ x: 0, y: 0, vx: 0, vy: 0, onGround: true, crouching: false, aim: 0 }] }))));
  assert.deepEqual([old.players[0].row, old.players[0].hop, old.players[0].presses], [0, null, { down: 255, jump: 255 }]);
  // ... and before combat: full health, nothing carried, no swing.
  assert.deepEqual([old.players[0].health, old.players[0].inventory, old.players[0].meleeTicks, old.players[0].meleeDir], [100, [], 0, 1]);
});

test('snapshots: an unknown enemy type or a bad id makes the snap invalid; a repeated id is dropped', () => {
  const base = encode(snapMessage({ tick: 5, ack: 3, wt: 4, players: [player(1)], enemies: [walker(1, 0, 0, false)] }));
  const raw = decode(base);
  assert.equal(decode(Uint8Array.from(plain.pack({ ...raw, et0: 'dragon' }))), null, 'unknown type');
  assert.equal(decode(Uint8Array.from(plain.pack({ ...raw, ei0: 'one' }))), null, 'id not a number');
  assert.throws(() => encode({ ...raw, et0: 'dragon' }), /et0/);
  const twice = snapMessage({ tick: 5, ack: 3, wt: 4, players: [player(1)], enemies: [walker(2, 1, 0, false), walker(2, 9, 0, true)] });
  assert.deepEqual(snapshotFromMessage(decode(encode(twice))).enemies, [walker(2, 1, 0, false)]);
});

test('snapshots: fire ticks, the taken pickups mask and bolts round-trip; a repeated bolt id is dropped; nb limits the list', () => {
  const players = [player(1, { inventory: ['plasmaPistol'], fireTicks: 30 }), player(2, { fireTicks: 7 })];
  const bolts = [{ id: 3, x: 4.25, y: 1.5, angle: -0.3, row: 0 }, { id: 65535, x: -2, y: 9, angle: 3, row: -1 }];
  const pickups = [{ id: 0, taken: true }, { id: 1, taken: false }, { id: 7, taken: true }];
  const msg = decode(encode(snapMessage({ tick: 5, ack: 3, wt: 4, players, enemies: [], pickups, bolts })));
  assert.deepEqual([msg.ft0, msg.ft1, msg.iv0, msg.pk, msg.nb], [30, 7, 1, 0b10000001, 2]);
  const back = snapshotFromMessage(msg);
  assert.deepEqual(back.players, players);
  assert.deepEqual(back.bolts, bolts);
  assert.equal(back.pickupsTaken, 0b10000001);
  // Only the listed fields travel (owner and age stay on the host).
  const extra = snapshotFromMessage(decode(encode(snapMessage({ tick: 5, ack: 3, wt: 4, players, bolts: [{ ...bolts[0], owner: 1, age: 9 }] }))));
  assert.deepEqual(extra.bolts, [bolts[0]]);
  const twice = snapMessage({ tick: 5, ack: 3, wt: 4, players, bolts: [bolts[0], { ...bolts[1], id: 3 }] });
  assert.deepEqual(snapshotFromMessage(decode(encode(twice))).bolts, [bolts[0]]);
  const many = Array.from({ length: MAX_BOLTS + 2 }, (_, i) => ({ id: i, x: i, y: 0, angle: 0, row: 0 }));
  assert.deepEqual(snapshotFromMessage(decode(encode(snapMessage({ tick: 1, ack: -1, wt: 1, players, bolts: many })))).bolts, many.slice(0, MAX_BOLTS));
  // Clamped: fire ticks to the charge, an out-of-range mask to 2^MAX_PICKUPS - 1.
  const raw = decode(encode(snapMessage({ tick: 1, ack: -1, wt: 1, players })));
  const clamped = decode(Uint8Array.from(plain.pack({ ...raw, ft0: 99, pk: 9999 })));
  assert.deepEqual([clamped.ft0, clamped.pk], [30, 2 ** MAX_PICKUPS - 1]);
  assert.equal(decode(Uint8Array.from(plain.pack({ ...raw, ba0: 'up' }))), null, 'a bad bolt field');
});

test('protocol 8: version, peer id prefix and local channel name change together', async () => {
  const { PEER_ID_PREFIX } = await import('../src/net/transport-peer.js');
  const { LOCAL_CHANNEL_PREFIX } = await import('../src/net/transport-local.js');
  assert.equal(PROTOCOL_VERSION, 8);
  assert.equal(PEER_ID_PREFIX, 'berserker7-v8-');
  assert.equal(LOCAL_CHANNEL_PREFIX, 'b7-net-v8-');
});
