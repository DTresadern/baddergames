// Per-tick input frames, one per player, from the device state and gamepad snapshots.
// Frame shape, edge rules, aim and player assignment: see berserker7/AGENTS.md, Input.

import { ACTIONS, DEFAULT_BINDINGS, SCHEMES } from './actions.js';
import { parseSource } from './bindings.js';
import { clearLatches } from './devices.js';

// Which devices each player uses. `pad: n` = the n-th connected standard gamepad, by index.
export const PLAYER_DEVICES = Object.freeze([
  Object.freeze({ keyboardMouse: true, pad: 1 }),
  Object.freeze({ keyboardMouse: false, pad: 0 }),
]);

const TRIGGERS = [6, 7]; // standard mapping: left and right trigger
const STICK_X = 2; // right stick
const STICK_Y = 3;

// Parses each binding once: { keyboardMouse: { [action]: parsed[] }, gamepad: {...} }.
function compile(bindings) {
  const compiled = {};
  for (const scheme of SCHEMES) {
    compiled[scheme] = {};
    for (const action of ACTIONS) {
      compiled[scheme][action] = (bindings[scheme]?.[action] ?? [])
        .map((source) => parseSource(scheme, source))
        .filter((parsed) => parsed !== null);
    }
  }
  return compiled;
}

function emptyTotals() {
  return Object.fromEntries(ACTIONS.map((action) => [action, { pressed: 0, released: 0 }]));
}

export function createInput({
  players = PLAYER_DEVICES,
  bindings = DEFAULT_BINDINGS,
  deadZone = 0.25, // radial, for the aim stick
  axisThreshold = 0.5, // digital axis sources
  triggerThreshold = 0.3,
} = {}) {
  return {
    players,
    compiled: compile(bindings),
    deadZone,
    axisThreshold,
    triggerThreshold,
    perPlayer: players.map(() => ({
      prevHeld: Object.fromEntries(ACTIONS.map((action) => [action, false])),
      aim: 0,
      aimOrigin: null, // CSS px of the canvas; null = canvas centre
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

// Where a player is on screen, in CSS px of the canvas; null for x or y = canvas centre.
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

function padSourceDown(input, pad, parsed) {
  if (parsed.kind === 'button') {
    const button = pad.buttons[parsed.index];
    if (!button) return false;
    return TRIGGERS.includes(parsed.index) ? button.value > input.triggerThreshold : button.pressed;
  }
  if (parsed.kind === 'axis') return (pad.axes[parsed.index] ?? 0) * parsed.sign >= input.axisThreshold;
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
      let tapped = false; // a bound source was pressed since the last tick
      if (keyboardMouse) {
        for (const parsed of input.compiled.keyboardMouse[action]) {
          const latch = devices.sources[parsed.source];
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
      // A new press while held counts as released + pressed on the same tick.
      actions[action] = {
        held,
        pressed: held && (!prevHeld || tapped),
        released: prevHeld && (!held || tapped),
      };
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
