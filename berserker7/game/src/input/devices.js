// Keyboard, mouse and wheel state as a plain object, changed only by these functions
// (dom.js calls them from browser events). See berserker7/AGENTS.md, Input.

// Wheel rule (see wheel()).
export const WHEEL_STEP_PIXELS = 40;
export const WHEEL_LOCK_MS = 250;
export const WHEEL_QUIET_MS = 120;

export function createDevices() {
  return {
    // Latches keyed by source string ('key:Space', 'mouse:0', 'wheel:+'):
    // { down, presses }; presses counts since the last sample.
    sources: {},
    // Mouse position in CSS px relative to the canvas top-left; `moved` since the last sample.
    mouse: { x: 0, y: 0, moved: false },
    // Canvas size in CSS px, for the default aim origin (the canvas centre).
    surface: { width: 0, height: 0 },
    wheelSteps: 0, // whole wheel steps since the last sample, signed (+ = scroll down)
    wheelAcc: 0, // pixel-mode distance not yet turned into a step
    wheelLocked: false,
    wheelStepAt: 0, // time (ms) of the last pixel-mode step
    wheelLastAt: -Infinity, // time (ms) of the last wheel event
  };
}

function latch(dev, source) {
  let entry = dev.sources[source];
  if (!entry) {
    entry = { down: false, presses: 0 };
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

// A press without being down (wheel steps).
export function tap(dev, source) {
  latch(dev, source).presses += 1;
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

function wheelStep(dev, sign) {
  dev.wheelSteps += sign;
  tap(dev, sign > 0 ? 'wheel:+' : 'wheel:-');
}

// Line and page events: one step each. Pixel events accumulate to one step, then lock
// until WHEEL_LOCK_MS after the step and WHEEL_QUIET_MS without any wheel event.
export function wheel(dev, deltaY, deltaMode, now) {
  const quietSince = dev.wheelLastAt;
  dev.wheelLastAt = now;
  if (deltaMode === 1 || deltaMode === 2) {
    if (deltaY !== 0) wheelStep(dev, Math.sign(deltaY));
    return;
  }
  if (dev.wheelLocked) {
    if (now - dev.wheelStepAt < WHEEL_LOCK_MS || now - quietSince < WHEEL_QUIET_MS) return;
    dev.wheelLocked = false;
  }
  dev.wheelAcc += deltaY;
  if (Math.abs(dev.wheelAcc) >= WHEEL_STEP_PIXELS) {
    wheelStep(dev, Math.sign(dev.wheelAcc));
    dev.wheelAcc = 0;
    dev.wheelLocked = true;
    dev.wheelStepAt = now;
  }
}

// Called by the sampler after each tick: counts and movement start again from zero.
export function clearLatches(dev) {
  for (const entry of Object.values(dev.sources)) entry.presses = 0;
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
