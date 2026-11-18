// Per-tick input frames, one per player, built from the device state and gamepad snapshots.
//
// Frame (plain data, new objects every tick):
//   { player, connected, actions: { [action]: { held, pressed, released } }, aim, wheel }
//
// Edges, per action, from all its bound sources on the player's devices:
//   downNow = any source down; tapped = any source pressed since the last tick;
//   held = downNow || tapped (a tap shorter than one tick is held for exactly one tick);
//   pressed = held && !prevHeld; released = prevHeld && !held.
// sampleInput clears the latches, so when one frame runs several ticks only the first
// sees a press. Known limit: releasing and pressing the same action again between two
// ticks while it is held gives no second pressed.
//
// Aim: radians, y up (0 = right, +PI/2 = up on screen), range (-PI, PI], starts at 0.
// The mouse sets it when it moved since the last tick, from the player's aim origin.
// Otherwise the right stick sets it when outside the radial dead zone. Otherwise it
// keeps its value. So the mouse wins when both moved in one tick.

import { ACTIONS, DEFAULT_BINDINGS } from './actions.js';
import { clearLatches } from './devices.js';

// Which devices each player uses. `pad: n` = the n-th connected gamepad with the
// standard mapping, ordered by gamepad index. One pad: player 2 on it. Two pads: both
// players on pads, and player 1 also keeps keyboard + mouse.
export const PLAYER_DEVICES = Object.freeze([
  Object.freeze({ keyboardMouse: true, pad: 1 }),
  Object.freeze({ keyboardMouse: false, pad: 0 }),
]);

const TRIGGERS = [6, 7]; // standard mapping: left and right trigger
const STICK_X = 2; // right stick
const STICK_Y = 3;

function parseSource(source) {
  let m = /^button:(\d+)$/.exec(source);
  if (m) return { kind: 'button', index: Number(m[1]) };
  m = /^axis:(\d+):([+-])$/.exec(source);
  if (m) return { kind: 'axis', index: Number(m[1]), sign: m[2] === '+' ? 1 : -1 };
  return { kind: 'latch', source };
}

// Parses each binding once: { keyboardMouse: { [action]: parsed[] }, gamepad: {...} }.
function compile(bindings) {
  const compiled = {};
  for (const scheme of ['keyboardMouse', 'gamepad']) {
    compiled[scheme] = {};
    for (const action of ACTIONS) compiled[scheme][action] = (bindings[scheme]?.[action] ?? []).map(parseSource);
  }
  return compiled;
}

function emptyTotals() {
  return Object.fromEntries(ACTIONS.map((action) => [action, { pressed: 0, released: 0 }]));
}

export function createInput({
  players = PLAYER_DEVICES,
  bindings = DEFAULT_BINDINGS,
  deadZone = 0.25,
  axisThreshold = 0.5,
  triggerThreshold = 0.3,
} = {}) {
  return {
    players,
    bindings,
    compiled: compile(bindings),
    deadZone,
    axisThreshold,
    triggerThreshold,
    // Per player: last tick's held per action, aim angle, aim origin in CSS px (null = canvas centre).
    perPlayer: players.map(() => ({
      prevHeld: Object.fromEntries(ACTIONS.map((action) => [action, false])),
      aim: 0,
      aimOrigin: null,
    })),
    // Read by the input panel; not part of the frames.
    debug: {
      ticks: 0,
      ignoredPads: [], // ids of connected gamepads without the standard mapping
      lastPadEvent: null, // set by dom.js: { type, index, id }
      players: players.map(() => ({ device: 'not connected', frame: null, totals: emptyTotals(), wheel: 0 })),
    },
  };
}

export function setBindings(input, bindings) {
  input.bindings = bindings;
  input.compiled = compile(bindings);
}

// Where a player is on screen, in CSS px of the canvas; mouse aim is measured from here.
// null for x or y goes back to the canvas centre.
export function setAimOrigin(input, player, x, y) {
  const entry = input.perPlayer[player];
  if (!entry) return;
  entry.aimOrigin = x == null || y == null ? null : { x, y };
}

// Angle in (-PI, PI], with -0 as 0 so frames survive a JSON round trip unchanged.
export function normaliseAngle(angle) {
  if (angle <= -Math.PI) return Math.PI;
  return angle === 0 ? 0 : angle;
}

function deadZoned(value, deadZone) {
  return Math.abs(value) < deadZone ? 0 : value;
}

function padSourceDown(input, pad, parsed) {
  if (parsed.kind === 'button') {
    const button = pad.buttons[parsed.index];
    if (!button) return false;
    return TRIGGERS.includes(parsed.index) ? button.value > input.triggerThreshold : button.pressed;
  }
  if (parsed.kind === 'axis') {
    const value = deadZoned(pad.axes[parsed.index] ?? 0, input.deadZone);
    return value * parsed.sign >= input.axisThreshold;
  }
  return false;
}

function deviceLabel(config, pad) {
  if (config.keyboardMouse && pad) return `keyboard + mouse, gamepad ${pad.id}`;
  if (config.keyboardMouse) return 'keyboard + mouse';
  if (pad) return `gamepad ${pad.id}`;
  return 'not connected';
}

function mouseAim(entry, devices) {
  const origin = entry.aimOrigin ?? { x: devices.surface.width / 2, y: devices.surface.height / 2 };
  return normaliseAngle(Math.atan2(-(devices.mouse.y - origin.y), devices.mouse.x - origin.x));
}

function stickAim(input, pad) {
  const x = pad.axes[STICK_X] ?? 0;
  const y = pad.axes[STICK_Y] ?? 0;
  if (Math.hypot(x, y) < input.deadZone) return null;
  return normaliseAngle(Math.atan2(-y, x));
}

// Builds this tick's frames and clears the device latches. `pads` are gamepad
// snapshots (snapshotPad), in any order, null entries allowed.
export function sampleInput(input, devices, pads = []) {
  const connectedPads = pads.filter((pad) => pad && pad.connected !== false);
  const standard = connectedPads.filter((pad) => pad.mapping === 'standard').sort((a, b) => a.index - b.index);
  input.debug.ignoredPads = connectedPads.filter((pad) => pad.mapping !== 'standard').map((pad) => pad.id);
  input.debug.ticks += 1;

  const frames = input.players.map((config, player) => {
    const entry = input.perPlayer[player];
    const pad = config.pad == null ? null : standard[config.pad] ?? null;
    const keyboardMouse = Boolean(config.keyboardMouse);
    const connected = keyboardMouse || pad !== null;

    const actions = {};
    for (const action of ACTIONS) {
      let downNow = false;
      let tapped = false;
      if (keyboardMouse) {
        for (const parsed of input.compiled.keyboardMouse[action]) {
          const latch = parsed.kind === 'latch' ? devices.sources[parsed.source] : undefined;
          if (!latch) continue;
          downNow ||= latch.down;
          tapped ||= latch.presses > 0;
        }
      }
      if (pad) {
        for (const parsed of input.compiled.gamepad[action]) downNow ||= padSourceDown(input, pad, parsed);
      }
      const held = downNow || tapped;
      const prevHeld = entry.prevHeld[action];
      actions[action] = { held, pressed: held && !prevHeld, released: prevHeld && !held };
      entry.prevHeld[action] = held;
    }

    if (keyboardMouse && devices.mouse.moved) entry.aim = mouseAim(entry, devices);
    else if (pad) entry.aim = stickAim(input, pad) ?? entry.aim;

    const frame = { player, connected, actions, aim: entry.aim, wheel: keyboardMouse ? devices.wheelSteps : 0 };

    const debug = input.debug.players[player];
    debug.device = deviceLabel(config, pad);
    debug.frame = frame;
    debug.wheel += frame.wheel;
    for (const action of ACTIONS) {
      if (actions[action].pressed) debug.totals[action].pressed += 1;
      if (actions[action].released) debug.totals[action].released += 1;
    }
    return frame;
  });

  clearLatches(devices);
  return frames;
}
