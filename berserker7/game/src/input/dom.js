// Browser wiring for the input system: listens to keyboard, mouse, wheel and focus
// events, polls gamepads each tick, and hands everything to the pure functions in
// devices.js and sampler.js. Nothing else in the game listens to input events.

import { loadBindings } from './bindings.js';
import {
  createDevices,
  moveMouse,
  press,
  release,
  releaseAll,
  setSurface,
  snapshotPad,
  wheel,
} from './devices.js';
import { createInput, sampleInput, setAimOrigin } from './sampler.js';

// Keys whose browser default (scrolling, moving focus, activating a focused button) is blocked.
const BLOCKED_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const SIDE_BUTTONS = new Set([3, 4]); // back and forward: would navigate the page

function isEditable(target) {
  return Boolean(target && (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable));
}

// Reading window.localStorage can itself throw (storage blocked); null then.
export function browserStorage(win) {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPads(nav) {
  try {
    if (typeof nav?.getGamepads !== 'function') return [];
    return Array.from(nav.getGamepads() ?? [], (pad) => (pad ? snapshotPad(pad) : null));
  } catch {
    return []; // for example blocked by a permissions policy
  }
}

export function attachInput({
  window: win,
  canvas,
  storage = browserStorage(win),
  navigator: nav = win.navigator,
  now = () => win.performance.now(),
  ...options // passed to createInput: players, deadZone, axisThreshold, triggerThreshold
}) {
  const devices = createDevices();
  const input = createInput({ ...options, bindings: loadBindings(storage) });
  const controller = new AbortController();
  const { signal } = controller;
  const doc = win.document;

  win.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;
    if (BLOCKED_KEYS.has(e.code)) e.preventDefault();
    press(devices, `key:${e.code}`);
  }, { signal });

  // Released even in a text field, so a key pressed in the game and let go there does not stick.
  win.addEventListener('keyup', (e) => {
    if (!isEditable(e.target) && BLOCKED_KEYS.has(e.code)) e.preventDefault();
    release(devices, `key:${e.code}`);
  }, { signal });

  win.addEventListener('blur', () => releaseAll(devices), { signal });
  doc?.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') releaseAll(devices);
  }, { signal });

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    press(devices, `mouse:${e.button}`);
  }, { signal });

  win.addEventListener('mouseup', (e) => {
    if (SIDE_BUTTONS.has(e.button)) e.preventDefault();
    release(devices, `mouse:${e.button}`);
  }, { signal });

  win.addEventListener('auxclick', (e) => {
    if (SIDE_BUTTONS.has(e.button)) e.preventDefault();
  }, { signal });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  win.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    setSurface(devices, rect.width, rect.height);
    moveMouse(devices, e.clientX - rect.left, e.clientY - rect.top);
  }, { signal });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheel(devices, e.deltaY, e.deltaMode, now());
  }, { passive: false, signal });

  // Polling in sample() is the source of truth; the events are only shown in the input panel.
  const padEvent = (e) => {
    input.debug.lastPadEvent = { type: e.type, index: e.gamepad?.index ?? null, id: String(e.gamepad?.id ?? '') };
  };
  win.addEventListener('gamepadconnected', padEvent, { signal });
  win.addEventListener('gamepaddisconnected', padEvent, { signal });

  function sample() {
    if (devices.surface.width === 0) {
      const rect = canvas.getBoundingClientRect();
      setSurface(devices, rect.width, rect.height);
    }
    return sampleInput(input, devices, readPads(nav));
  }

  return {
    sample,
    setAimOrigin: (player, x, y) => setAimOrigin(input, player, x, y),
    debug: input.debug,
    devices,
    input,
    detach: () => controller.abort(),
  };
}
