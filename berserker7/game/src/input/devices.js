// Keyboard, mouse and wheel state as a plain object, changed only by these functions
// (dom.js calls them from browser events). See berserker7/AGENTS.md, Input.

import { WHEEL_SETTINGS } from './actions.js';

export function createDevices({ wheel = WHEEL_SETTINGS } = {}) {
  return {
    // Latches keyed by source string ('key:Space', 'mouse:0', 'wheel:+'): { down, presses,
    // pulses }; presses (key or button went down) and pulses (wheel steps) count since the last sample.
    sources: {},
    // Mouse position in CSS px relative to the canvas top-left; `moved` since the last sample.
    mouse: { x: 0, y: 0, moved: false },
    // Canvas size in CSS px, for the default aim origin (the canvas centre).
    surface: { width: 0, height: 0 },
    wheelSteps: 0, // whole wheel steps since the last sample, signed (+ = scroll down)
    wheelSettings: wheel,
    // The touchpad swipe in progress: direction (1, -1, 0 = none), distance, whether it
    // has given its step, and the time (ms) of its last event with distance.
    swipe: { sign: 0, distance: 0, stepped: false, lastAt: -Infinity },
  };
}

function latch(dev, source) {
  let entry = dev.sources[source];
  if (!entry) {
    entry = { down: false, presses: 0, pulses: 0 };
    dev.sources[source] = entry;
  }
  return entry;
}

// A press while already down (key repeat) is ignored.
export function press(dev, source) {
  const entry = latch(dev, source);
  if (entry.down) return;
  entry.down = true;
  entry.presses += 1;
}

export function release(dev, source) {
  const entry = dev.sources[source];
  if (entry) entry.down = false;
}

// Wheel steps: pressed for the tick they land in, without being down.
function pulse(dev, source, count) {
  latch(dev, source).pulses += count;
}

// Window blur, tab hidden: everything held is released.
export function releaseAll(dev) {
  for (const entry of Object.values(dev.sources)) entry.down = false;
}

export function moveMouse(dev, x, y) {
  dev.mouse.x = x;
  dev.mouse.y = y;
  dev.mouse.moved = true;
}

export function setSurface(dev, width, height) {
  dev.surface.width = width;
  dev.surface.height = height;
}

function wheelSteps(dev, steps) {
  dev.wheelSteps += steps;
  pulse(dev, steps > 0 ? 'wheel:+' : 'wheel:-', Math.abs(steps));
}

function swipeDistance(dev, deltaY, now) {
  const { swipePixels, swipeEndMs } = dev.wheelSettings;
  const { swipe } = dev;
  const sign = Math.sign(deltaY);
  if (sign !== swipe.sign || now - swipe.lastAt >= swipeEndMs) {
    Object.assign(swipe, { sign, distance: 0, stepped: false });
  }
  swipe.lastAt = now;
  if (swipe.stepped) return;
  swipe.distance += Math.abs(deltaY);
  if (swipe.distance >= swipePixels) {
    swipe.stepped = true;
    wheelSteps(dev, sign);
  }
}

// One wheel event. Zero distance is ignored. Line and page modes: one step per unit.
// Pixel mode: whole notches step at once; other distances are a touchpad swipe.
export function wheel(dev, deltaY, deltaMode, now) {
  if (!deltaY) return;
  if (deltaMode === 1 || deltaMode === 2) {
    const units = Math.abs(deltaY);
    wheelSteps(dev, Math.sign(deltaY) * (Number.isInteger(units) && units > 1 ? units : 1));
    return;
  }
  const notches = deltaY / dev.wheelSettings.notchPixels;
  if (Number.isInteger(notches)) wheelSteps(dev, notches);
  else swipeDistance(dev, deltaY, now);
}

// Called by the sampler after each tick: counts and movement start again from zero.
export function clearLatches(dev) {
  for (const entry of Object.values(dev.sources)) {
    entry.presses = 0;
    entry.pulses = 0;
  }
  dev.mouse.moved = false;
  dev.wheelSteps = 0;
}

// A plain copy of a Gamepad (or any object shaped like one).
export function snapshotPad(pad) {
  return {
    index: pad.index,
    id: String(pad.id),
    mapping: pad.mapping,
    connected: pad.connected !== false,
    buttons: Array.from(pad.buttons ?? [], (b) => ({ pressed: Boolean(b?.pressed), value: Number(b?.value) || 0 })),
    axes: Array.from(pad.axes ?? [], (v) => Number(v) || 0),
  };
}
