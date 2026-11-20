// Wire messages: the only code that builds or parses them. encode(msg) -> Uint8Array,
// decode(bytes) -> msg | null. The bytes are plain MessagePack (msgpackr 2.1.4, no records or
// extensions). msgpackr loads lazily with PeerJS (online-libs.js): await loadCodec() before the
// first encode or decode; both throw until then. A later step may add quantised integers, which
// only changes this file.
//
// Every message is flat: `t` (its type) plus the fields listed for that type in MESSAGES, each a
// number, boolean or short string. No nested objects or arrays; player fields are per slot
// (x0, y0, ... x1, y1, ...). decode returns a new plain object with only the listed fields,
// numbers clamped to their range and integers rounded; anything malformed gives null. encode runs
// the same checks and throws, since a malformed outgoing message is a bug on our side.
//
// The helpers below the table turn input frames and Sandbox players into messages and back;
// nothing outside src/net/ builds message objects by hand.

import { ACTIONS } from '../input/actions.js';
import { SANDBOX_MAPS } from '../scenes/sandbox.js';
import { ENEMY_ID_MAX, ENEMY_TYPES, MAX_ENEMIES } from '../world/enemy.js';
import { HOP_TICKS, PRESS_NONE, ROW_LIMIT, ROW_SCHEMES } from '../world/rows.js';

// 6: players carry hf (the hop is a fall). 5: players carry row, hop and press ages; input carries the row scheme. 4: enemies carry id and
// type; 3: snap carries wt and enemies; 2: MessagePack bytes (1 was JSON text).
export const PROTOCOL_VERSION = 6;
// Largest message accepted or sent, in MessagePack bytes. The largest message (a snap with two
// players and MAX_ENEMIES enemies) is 1128 bytes at worst (every field at full-precision extremes);
// 2048 leaves wide margin.
export const MAX_MESSAGE_BYTES = 2048;
// Players a snapshot can carry (slot 0 is the host, slot 1 the guest).
export const MAX_PLAYERS = 2;
// Enemies a snapshot can carry (defined with the enemies, world/enemy.js).
export { MAX_ENEMIES };

// msgpackr, once loaded. loadCodec() takes the loader as an argument so tests can pass their own.
let packr = null;
let loading = null;

// Loads msgpackr once (the promise is kept; a failed load is forgotten so a retry can work).
export function loadCodec(load = () => import('./online-libs.js')) {
  if (loading === null) {
    loading = load().then(
      ({ Packr }) => {
        packr = new Packr({ useRecords: false, structures: undefined, moreTypes: false, structuredClone: false, mapsAsObjects: true, variableMapSize: true });
      },
      (err) => {
        loading = null;
        throw err;
      },
    );
  }
  return loading;
}

export const codecLoaded = () => packr !== null;

function requireCodec() {
  if (packr === null) throw new Error('codec: not loaded (call loadCodec first)');
  return packr;
}

// Bit masks over ACTIONS index order must fit in a 32-bit signed integer.
if (ACTIONS.length >= 31) throw new Error(`codec: ${ACTIONS.length} actions do not fit an input bit mask`);
const MASK_MAX = 2 ** ACTIONS.length - 1;
const TICK_MAX = 2 ** 31 - 1;
const POSITION_LIMIT = 100000; // tiles
const SPEED_LIMIT = 1000; // tiles/s
const TIME_LIMIT = 1e12; // ms

// Field specs.
const int = (min, max) => Object.freeze({ kind: 'int', min, max });
const num = (min, max) => Object.freeze({ kind: 'number', min, max });
const bool = Object.freeze({ kind: 'boolean' });
const oneOf = (...values) => Object.freeze({ kind: 'enum', values: Object.freeze(values) });
const text = (pattern, maxLength) => Object.freeze({ kind: 'string', pattern, maxLength });
export const SPECS = Object.freeze({ int, num, bool, oneOf, text });

// Per player slot i: x, y (bottom centre, tiles), vx, vy (tiles/s), g (onGround), c (crouching),
// a (aim, radians); depth rows (world/rows.js): r (row), h (a hop is active), ht (hop target row),
// hn (hop ticks done), hy0, hy1 (hop start and landing y), hf (the hop is a fall), pd, pj (down and jump press ages).
const PLAYER_FIELDS = Object.freeze({
  x: num(-POSITION_LIMIT, POSITION_LIMIT),
  y: num(-POSITION_LIMIT, POSITION_LIMIT),
  vx: num(-SPEED_LIMIT, SPEED_LIMIT),
  vy: num(-SPEED_LIMIT, SPEED_LIMIT),
  g: bool,
  c: bool,
  a: num(-Math.PI, Math.PI),
  r: int(-ROW_LIMIT, ROW_LIMIT),
  h: bool,
  ht: int(-ROW_LIMIT, ROW_LIMIT),
  hn: int(0, HOP_TICKS),
  hy0: num(-POSITION_LIMIT, POSITION_LIMIT),
  hy1: num(-POSITION_LIMIT, POSITION_LIMIT),
  hf: bool,
  pd: int(0, PRESS_NONE),
  pj: int(0, PRESS_NONE),
});
// Per enemy slot i: ei (stable id), et (type name, one of ENEMY_TYPES), ex, ey (bottom centre,
// tiles), ew (awake). An unknown type makes the whole message invalid, like any bad field.
const ENEMY_FIELDS = Object.freeze({
  ei: int(0, ENEMY_ID_MAX),
  et: oneOf(...ENEMY_TYPES),
  ex: num(-POSITION_LIMIT, POSITION_LIMIT),
  ey: num(-POSITION_LIMIT, POSITION_LIMIT),
  ew: bool,
});
const slots = (fieldSpecs, count) => {
  const fields = {};
  for (let i = 0; i < count; i++) {
    for (const [name, spec] of Object.entries(fieldSpecs)) fields[`${name}${i}`] = spec;
  }
  return fields;
};

// type -> { field: spec }. Direction in brackets.
export const MESSAGES = Object.freeze({
  // (guest -> host) first message on a new link
  hello: Object.freeze({ v: int(0, TICK_MAX) }),
  // (host -> guest) accepted: the host's Sandbox map, the guest's player slot, the host's tick
  welcome: Object.freeze({ map: oneOf(...SANDBOX_MAPS), slot: int(1, MAX_PLAYERS - 1), tick: int(0, TICK_MAX) }),
  // (host -> guest) refused; the host closes the link after it
  reject: Object.freeze({ reason: oneOf('full', 'version') }),
  // (host -> guest) the host's Sandbox map changed
  map: Object.freeze({ map: oneOf(...SANDBOX_MAPS) }),
  // (guest -> host) one input frame: held and pressed bit masks over ACTIONS, aim in radians, rs
  // the row scheme (the host simulates the guest's player with it)
  input: Object.freeze({ tick: int(0, TICK_MAX), held: int(0, MASK_MAX), pressed: int(0, MASK_MAX), aim: num(-Math.PI, Math.PI), rs: oneOf(...ROW_SCHEMES) }),
  // (host -> guest) Sandbox players and enemies: ack = last guest input tick applied (-1 none),
  // wt = the host's world tick (its Sandbox state.ticks), n = player count, ne = enemy count
  snap: Object.freeze({
    tick: int(0, TICK_MAX),
    ack: int(-1, TICK_MAX),
    wt: int(0, TICK_MAX),
    n: int(1, MAX_PLAYERS),
    ...slots(PLAYER_FIELDS, MAX_PLAYERS),
    ne: int(0, MAX_ENEMIES),
    ...slots(ENEMY_FIELDS, MAX_ENEMIES),
  }),
  // (both) clock and round-trip time; `time` is the sender's clock in ms, echoed in the pong
  ping: Object.freeze({ id: int(0, TICK_MAX), time: num(0, TIME_LIMIT) }),
  pong: Object.freeze({ id: int(0, TICK_MAX), time: num(0, TIME_LIMIT), tick: int(0, TICK_MAX) }),
  // (both) leaving
  bye: Object.freeze({}),
});

const INVALID = Symbol('invalid');
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// The cleaned value, or INVALID.
function check(spec, value) {
  switch (spec.kind) {
    case 'int':
      return typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), spec.min, spec.max) : INVALID;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? clamp(value, spec.min, spec.max) : INVALID;
    case 'boolean':
      return typeof value === 'boolean' ? value : INVALID;
    case 'enum':
      return spec.values.includes(value) ? value : INVALID;
    case 'string':
      return typeof value === 'string' && value.length <= spec.maxLength && spec.pattern.test(value) ? value : INVALID;
    default:
      return INVALID;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

// A new message with only the listed fields, cleaned; or a string saying what is wrong.
function clean(msg) {
  if (!isPlainObject(msg)) return 'not a plain object';
  if (typeof msg.t !== 'string' || !Object.hasOwn(MESSAGES, msg.t)) return `unknown type ${String(msg.t)}`;
  const out = { t: msg.t };
  for (const [name, spec] of Object.entries(MESSAGES[msg.t])) {
    const value = check(spec, msg[name]);
    if (value === INVALID) return `${msg.t}.${name}: bad value ${String(msg[name])}`;
    out[name] = value;
  }
  return out;
}

export function encode(msg) {
  const out = clean(msg);
  if (typeof out === 'string') throw new Error(`codec: cannot encode: ${out}`);
  for (const name of Object.keys(msg)) {
    if (name !== 't' && !Object.hasOwn(MESSAGES[msg.t], name)) throw new Error(`codec: cannot encode: unknown field ${msg.t}.${name}`);
  }
  // pack returns a view into msgpackr's shared buffer, which the next pack overwrites: copy it
  // into a Uint8Array of its own.
  const bytes = new Uint8Array(requireCodec().pack(out));
  if (bytes.byteLength > MAX_MESSAGE_BYTES) throw new Error(`codec: ${msg.t} message over ${MAX_MESSAGE_BYTES} bytes`);
  return bytes;
}

export function decode(bytes) {
  const codec = requireCodec();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_MESSAGE_BYTES) return null;
  let parsed;
  try {
    parsed = codec.unpack(bytes); // throws on truncated input and on trailing bytes
  } catch {
    return null;
  }
  const out = clean(parsed);
  return typeof out === 'string' ? null : out;
}

// --- message helpers ---

export const helloMessage = () => ({ t: 'hello', v: PROTOCOL_VERSION });
export const welcomeMessage = (map, slot, tick) => ({ t: 'welcome', map, slot, tick });
export const rejectMessage = (reason) => ({ t: 'reject', reason });
export const mapMessage = (map) => ({ t: 'map', map });
export const pingMessage = (id, time) => ({ t: 'ping', id, time });
export const pongMessage = (ping, tick) => ({ t: 'pong', id: ping.id, time: ping.time, tick });
export const byeMessage = () => ({ t: 'bye' });

// Held and pressed bit masks of an input frame (bit i = ACTIONS[i]).
export function frameMasks(frame) {
  let held = 0;
  let pressed = 0;
  ACTIONS.forEach((action, i) => {
    const a = frame?.connected ? frame.actions[action] : null;
    if (a?.held) held |= 1 << i;
    if (a?.pressed) pressed |= 1 << i;
  });
  return { held, pressed };
}

// The input message for a player's frame on `tick`.
export function inputMessage(tick, frame) {
  const aim = frame?.connected && Number.isFinite(frame.aim) ? frame.aim : 0;
  return { t: 'input', tick, ...frameMasks(frame), aim, rs: frame?.rowScheme === 'B' ? 'B' : 'A' };
}

// A full input frame from masks: `released` from the previous held mask; no pointer, no wheel,
// not an activation; always connected; `rowScheme` from rs ('A' when missing).
export function frameFromMasks({ held, pressed, aim, rs }, prevHeld = 0, player = 1) {
  const actions = {};
  ACTIONS.forEach((action, i) => {
    const bit = 1 << i;
    actions[action] = { held: (held & bit) !== 0, pressed: (pressed & bit) !== 0, released: (prevHeld & bit) !== 0 && (held & bit) === 0 };
  });
  return { player, connected: true, actions, aim, wheel: 0, pointer: null, activated: false, rowScheme: rs ?? 'A' };
}

// A snap message from Sandbox players (first MAX_PLAYERS) and enemies (first MAX_ENEMIES, the full
// list each time); empty slots are zeros (enemy type: the first type). `wt` is the host's world tick.
export function snapMessage({ tick, ack, wt, players, enemies = [] }) {
  const msg = { t: 'snap', tick, ack, wt, n: Math.min(players.length, MAX_PLAYERS) };
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    msg[`x${i}`] = p ? p.x : 0;
    msg[`y${i}`] = p ? p.y : 0;
    msg[`vx${i}`] = p ? p.vx : 0;
    msg[`vy${i}`] = p ? p.vy : 0;
    msg[`g${i}`] = p ? p.onGround : false;
    msg[`c${i}`] = p ? p.crouching : false;
    msg[`a${i}`] = p ? p.aim : 0;
    const hop = p?.hop ?? null;
    msg[`r${i}`] = p?.row ?? 0;
    msg[`h${i}`] = hop !== null;
    msg[`ht${i}`] = hop ? hop.to : 0;
    msg[`hn${i}`] = hop ? hop.t : 0;
    msg[`hy0${i}`] = hop ? hop.y0 : 0;
    msg[`hy1${i}`] = hop ? hop.y1 : 0;
    msg[`hf${i}`] = hop ? hop.fall === true : false;
    msg[`pd${i}`] = p ? p.presses?.down ?? PRESS_NONE : 0;
    msg[`pj${i}`] = p ? p.presses?.jump ?? PRESS_NONE : 0;
  }
  msg.ne = Math.min(enemies.length, MAX_ENEMIES);
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const e = enemies[i];
    msg[`ei${i}`] = e ? e.id : 0;
    msg[`et${i}`] = e ? e.type : ENEMY_TYPES[0];
    msg[`ex${i}`] = e ? e.x : 0;
    msg[`ey${i}`] = e ? e.y : 0;
    msg[`ew${i}`] = e ? e.awake : false;
  }
  return msg;
}

// { tick, ack, wt, players, enemies }: players are { x, y, vx, vy, onGround, crouching, aim, row,
// hop, presses } (no size: the receiver adds its own map's player size); enemies are { id, type, x, y, awake }, an
// id repeated in one message is dropped (the first one is kept).
export function snapshotFromMessage(msg) {
  const players = [];
  for (let i = 0; i < msg.n; i++) {
    const hop = msg[`h${i}`] ? { to: msg[`ht${i}`], t: msg[`hn${i}`], y0: msg[`hy0${i}`], y1: msg[`hy1${i}`], fall: msg[`hf${i}`] } : null;
    players.push({
      x: msg[`x${i}`], y: msg[`y${i}`], vx: msg[`vx${i}`], vy: msg[`vy${i}`], onGround: msg[`g${i}`], crouching: msg[`c${i}`], aim: msg[`a${i}`],
      row: msg[`r${i}`], hop, presses: { down: msg[`pd${i}`], jump: msg[`pj${i}`] },
    });
  }
  const enemies = [];
  const ids = new Set();
  for (let i = 0; i < msg.ne; i++) {
    const id = msg[`ei${i}`];
    if (ids.has(id)) continue;
    ids.add(id);
    enemies.push({ id, type: msg[`et${i}`], x: msg[`ex${i}`], y: msg[`ey${i}`], awake: msg[`ew${i}`] });
  }
  return { tick: msg.tick, ack: msg.ack, wt: msg.wt, players, enemies };
}
