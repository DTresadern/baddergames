import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ACTIONS, WHEEL_SETTINGS } from '../src/input/actions.js';
import {
  createDevices,
  moveMouse,
  press,
  release,
  releaseAll,
  setSurface,
  snapshotPad,
  wheel,
} from '../src/input/devices.js';
import { createInput, normaliseAngle, sampleInput, setAimOrigin } from '../src/input/sampler.js';

function setup(options) {
  const devices = createDevices();
  setSurface(devices, 800, 600);
  const input = createInput(options);
  return { devices, input };
}

// A standard-mapping gamepad snapshot: 17 buttons, 4 axes.
function pad(index, { buttons = {}, axes = [0, 0, 0, 0], mapping = 'standard', id = `pad ${index}` } = {}) {
  return {
    index,
    id,
    mapping,
    connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => {
      const value = buttons[i] ?? 0;
      return { pressed: value > 0, value };
    }),
    axes,
  };
}

const edge = (frame, action) => {
  const { held, pressed, released } = frame.actions[action];
  return [held, pressed, released];
};

test('edges: a tap between two ticks gives pressed on one tick and released on the next', () => {
  const { devices, input } = setup();
  press(devices, 'key:Space');
  release(devices, 'key:Space');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'jump'), [true, true, false]);
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'jump'), [false, false, true]);
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'jump'), [false, false, false]);
});

test('edges: holding for several ticks gives one pressed, then one released', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyD');
  const frames = Array.from({ length: 5 }, () => sampleInput(input, devices)[0]);
  assert.deepEqual(frames.map((f) => edge(f, 'moveRight')), [
    [true, true, false],
    [true, false, false],
    [true, false, false],
    [true, false, false],
    [true, false, false],
  ]);
  release(devices, 'key:KeyD');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveRight'), [false, false, true]);
});

test('edges: key repeat does not add a press', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyE');
  sampleInput(input, devices);
  press(devices, 'key:KeyE'); // repeat
  press(devices, 'key:KeyE');
  assert.equal(devices.sources['key:KeyE'].presses, 0);
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'interact'), [true, false, false]);
  assert.equal(input.debug.players[0].totals.interact.pressed, 1);
});

test('edges: two sources for one action count as one action', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyA');
  sampleInput(input, devices);
  release(devices, 'key:KeyA');
  press(devices, 'key:ArrowLeft');
  sampleInput(input, devices);
  press(devices, 'key:KeyA');
  sampleInput(input, devices);
  release(devices, 'key:ArrowLeft'); // KeyA still down
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveLeft'), [true, false, false]);
  release(devices, 'key:KeyA');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveLeft'), [false, false, true]);
});

test('edges: releaseAll gives released for everything held', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyW');
  press(devices, 'mouse:0');
  sampleInput(input, devices);
  releaseAll(devices);
  const frame = sampleInput(input, devices)[0];
  assert.deepEqual(edge(frame, 'moveUp'), [false, false, true]);
  assert.deepEqual(edge(frame, 'primaryFire'), [false, false, true]);
  assert.equal(devices.sources['key:KeyW'].down, false);
});

test('aim: mouse not moved keeps the angle; mouse moved computes it from the aim origin', () => {
  const { devices, input } = setup();
  assert.equal(sampleInput(input, devices)[0].aim, 0);
  moveMouse(devices, 400, 100); // straight up from the canvas centre (400, 300)
  assert.equal(sampleInput(input, devices)[0].aim, Math.PI / 2);
  assert.equal(sampleInput(input, devices)[0].aim, Math.PI / 2, 'unchanged when the mouse did not move');
  setAimOrigin(input, 0, 100, 100);
  moveMouse(devices, 0, 100); // left of the origin
  assert.equal(sampleInput(input, devices)[0].aim, Math.PI);
  moveMouse(devices, 200, 200); // right and down
  assert.equal(sampleInput(input, devices)[0].aim, -Math.PI / 4);
  setAimOrigin(input, 0, null, null); // back to the canvas centre
  moveMouse(devices, 400, 600);
  assert.equal(sampleInput(input, devices)[0].aim, -Math.PI / 2);
});

test('aim: angles stay in (-PI, PI] and -0 becomes 0', () => {
  assert.equal(normaliseAngle(-Math.PI), Math.PI);
  assert.ok(Object.is(normaliseAngle(-0), 0));
  const { devices, input } = setup();
  moveMouse(devices, 400, 300); // on the origin: atan2(-0, 0)
  assert.ok(Object.is(sampleInput(input, devices)[0].aim, 0));
});

test('aim: right stick inside the dead zone keeps the angle; outside sets it', () => {
  const { devices, input } = setup();
  const p2 = (axes) => sampleInput(input, devices, [pad(0, { axes })])[1];
  assert.equal(p2([0, 0, 0, -1]).aim, Math.PI / 2); // stick up
  assert.equal(p2([0, 0, 0.1, 0.15]).aim, Math.PI / 2, 'inside the dead zone');
  assert.equal(p2([0, 0, 0.24, 0]).aim, Math.PI / 2, 'just inside the dead zone');
  assert.equal(p2([0, 0, 0.2, -0.2]).aim, Math.PI / 4, 'radial: length 0.28 is outside, though each axis is below 0.25');
  assert.equal(p2([0, 0, -0.5, 0.5]).aim, (-3 * Math.PI) / 4);
  assert.equal(p2([0, 0, 0, 0]).aim, (-3 * Math.PI) / 4, 'released stick keeps the angle');
});

test('aim: with both, a moved mouse wins; an unmoved mouse lets the stick set it', () => {
  const { devices, input } = setup();
  const pads = () => [pad(0), pad(1, { axes: [0, 0, 1, 0] })]; // player 1 is on pad 1, stick right
  moveMouse(devices, 400, 0); // up
  assert.equal(sampleInput(input, devices, pads())[0].aim, Math.PI / 2);
  assert.equal(sampleInput(input, devices, pads())[0].aim, 0);
});

test('gamepad: triggers count as buttons above the threshold only', () => {
  const { devices, input } = setup();
  const fire = (value) => sampleInput(input, devices, [pad(0, { buttons: { 7: value, 6: value } })])[1].actions;
  assert.equal(fire(0.2).primaryFire.held, false); // pressed is true in the snapshot, but below 0.3
  assert.equal(fire(0.2).secondaryFire.held, false);
  assert.equal(fire(0.35).primaryFire.pressed, true);
  assert.equal(fire(0.35).secondaryFire.held, true);
  assert.equal(fire(0.3).primaryFire.released, true);
});

test('gamepad: the left stick moves past the axis threshold; the d-pad moves too', () => {
  const { devices, input } = setup();
  const p2 = (options) => sampleInput(input, devices, [pad(0, options)])[1].actions;
  assert.equal(p2({ axes: [0.45, 0, 0, 0] }).moveRight.held, false);
  assert.equal(p2({ axes: [0.6, 0, 0, 0] }).moveRight.held, true);
  assert.equal(p2({ axes: [-0.6, 0.7, 0, 0] }).moveLeft.held, true);
  const down = p2({ buttons: { 13: 1 } });
  assert.equal(down.moveDown.held, true);
  assert.equal(down.weaponMenu.held, false);
});

test('gamepad: the weapon menu is held on View/Back (button 8)', () => {
  const { devices, input } = setup();
  const p2 = (options) => sampleInput(input, devices, [pad(0, options)])[1].actions;
  assert.deepEqual(Object.values(p2({ buttons: { 8: 1 } }).weaponMenu), [true, true, false]);
  assert.deepEqual(Object.values(p2({ buttons: { 8: 1 } }).weaponMenu), [true, false, false]);
  assert.deepEqual(Object.values(p2({}).weaponMenu), [false, false, true]);
});

test('gamepad: player 2 is not connected without a pad, connected when one appears, released on disconnect', () => {
  const { devices, input } = setup();
  let [p1, p2] = sampleInput(input, devices, []);
  assert.equal(p1.connected, true);
  assert.equal(p2.connected, false);
  assert.equal(input.debug.players[1].device, 'not connected');

  [p1, p2] = sampleInput(input, devices, [null, pad(0, { buttons: { 0: 1 }, id: 'Pad A' })]);
  assert.equal(p2.connected, true);
  assert.deepEqual(edge(p2, 'jump'), [true, true, false]);
  assert.equal(edge(p1, 'jump')[0], false, 'player 1 does not use the only pad');
  assert.equal(input.debug.players[1].device, 'gamepad Pad A');

  p2 = sampleInput(input, devices, [pad(0, { buttons: { 0: 1 } })])[1];
  assert.deepEqual(edge(p2, 'jump'), [true, false, false]);

  p2 = sampleInput(input, devices, [])[1];
  assert.equal(p2.connected, false);
  assert.deepEqual(edge(p2, 'jump'), [false, false, true]);
  p2 = sampleInput(input, devices, [{ ...pad(0, { buttons: { 0: 1 } }), connected: false }])[1];
  assert.equal(p2.connected, false, 'a snapshot marked not connected counts as gone');
  assert.deepEqual(edge(p2, 'jump'), [false, false, false]);
});

test('gamepad: two standard pads put both players on pads; non-standard pads are ignored', () => {
  const { devices, input } = setup();
  const pads = [pad(3, { id: 'B', buttons: { 0: 1 } }), pad(0, { id: 'Odd', mapping: '' }), pad(1, { id: 'A' })];
  const [p1, p2] = sampleInput(input, devices, pads);
  assert.equal(input.debug.players[0].device, 'keyboard + mouse, gamepad B');
  assert.equal(input.debug.players[1].device, 'gamepad A');
  assert.deepEqual(input.debug.ignoredPads, ['Odd']);
  assert.equal(p1.actions.jump.pressed, true);
  assert.equal(p2.actions.jump.held, false);
});

test('gamepad: each player keeps its pad; unplugging the first pad does not move the other', () => {
  const { devices, input } = setup();
  const a = pad(0, { id: 'A' });
  const b = pad(1, { id: 'B', buttons: { 0: 1 } }); // jump held on pad B
  let [p1, p2] = sampleInput(input, devices, [a, b]);
  assert.equal(input.perPlayer[1].padIndex, 0, 'player 2 gets the first free pad');
  assert.equal(input.perPlayer[0].padIndex, 1, 'player 1 gets the next');
  assert.deepEqual(edge(p1, 'jump'), [true, true, false]);

  [p1, p2] = sampleInput(input, devices, [null, b]); // pad A (index 0) unplugged
  assert.equal(input.debug.players[0].device, 'keyboard + mouse, gamepad B');
  assert.deepEqual(edge(p1, 'jump'), [true, false, false], 'player 1 keeps its held jump');
  assert.equal(p2.connected, false);
  assert.deepEqual(edge(p2, 'jump'), [false, false, false], 'no press on player 2');
  assert.equal(input.perPlayer[1].padIndex, null);

  [p1, p2] = sampleInput(input, devices, [a, b]); // plugged back in
  assert.equal(p2.connected, true);
  assert.equal(input.perPlayer[1].padIndex, 0);
  assert.deepEqual(edge(p2, 'jump'), [false, false, false]);
  assert.deepEqual(edge(p1, 'jump'), [true, false, false]);
});

test('gamepad: a pad is kept even when a lower index connects later', () => {
  const { devices, input } = setup();
  sampleInput(input, devices, [null, pad(1, { id: 'B' })]);
  assert.equal(input.debug.players[1].device, 'gamepad B');
  sampleInput(input, devices, [pad(0, { id: 'A' }), pad(1, { id: 'B' })]);
  assert.equal(input.debug.players[1].device, 'gamepad B');
  assert.equal(input.debug.players[0].device, 'keyboard + mouse, gamepad A');
  sampleInput(input, devices, [pad(0, { id: 'A' }), null]); // B unplugged: player 2 empty, player 1 keeps A
  assert.equal(input.debug.players[1].device, 'not connected');
  assert.equal(input.debug.players[0].device, 'keyboard + mouse, gamepad A');
});

test('gamepad: snapshotPad makes a plain copy of a Gamepad-like object', () => {
  const gamepad = {
    index: 2,
    id: 'Xbox',
    mapping: 'standard',
    connected: true,
    timestamp: 5,
    buttons: [{ pressed: true, value: 1, touched: true }, null],
    axes: [0.5, -1],
  };
  assert.deepEqual(snapshotPad(gamepad), {
    index: 2,
    id: 'Xbox',
    mapping: 'standard',
    connected: true,
    buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }],
    axes: [0.5, -1],
  });
});

test('wheel: steps press nextWeapon and previousWeapon for one tick', () => {
  const { devices, input } = setup();
  wheel(devices, 1, 1, 0);
  let frame = sampleInput(input, devices)[0];
  assert.deepEqual(edge(frame, 'nextWeapon'), [true, true, false]);
  assert.deepEqual(edge(frame, 'previousWeapon'), [false, false, false]);
  wheel(devices, -1, 1, 10);
  frame = sampleInput(input, devices)[0];
  assert.deepEqual(edge(frame, 'nextWeapon'), [false, false, true]);
  assert.deepEqual(edge(frame, 'previousWeapon'), [true, true, false]);
  assert.equal(frame.wheel, -1);
  assert.equal(sampleInput(input, devices)[1].wheel, 0, 'a pad-only player gets no wheel');
});

test('frames are plain data: structuredClone and a JSON round trip give equal frames', () => {
  const { devices, input } = setup();
  press(devices, 'key:Space');
  moveMouse(devices, 100, 300); // aim PI
  wheel(devices, -1, 1, 0);
  const pads = [pad(0, { buttons: { 7: 1 }, axes: [0, 0, 0, 0.9] })];
  for (const frames of [sampleInput(input, devices, pads), sampleInput(input, devices, pads), sampleInput(input, devices)]) {
    for (const frame of frames) {
      assert.deepStrictEqual(structuredClone(frame), frame);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(frame)), frame);
      assert.deepEqual(Object.keys(frame.actions), ACTIONS);
    }
  }
});

test('frames are new objects every tick', () => {
  const { devices, input } = setup();
  const a = sampleInput(input, devices);
  const b = sampleInput(input, devices);
  assert.notEqual(a[0], b[0]);
  assert.notEqual(a[0].actions, b[0].actions);
  assert.notEqual(a[0].actions.jump, b[0].actions.jump);
});

test('edges: pressing a second source while the action is held gives no edge', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyD');
  sampleInput(input, devices);
  press(devices, 'key:ArrowRight');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveRight'), [true, false, false]);
});

test('edges: releasing one of two held sources gives no edge; releasing the last gives released', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyD');
  press(devices, 'key:ArrowRight');
  sampleInput(input, devices);
  release(devices, 'key:KeyD');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveRight'), [true, false, false]);
  release(devices, 'key:ArrowRight');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveRight'), [false, false, true]);
});

test('edges: a short tap of a second source while the action is held gives no edge', () => {
  const { devices, input } = setup();
  press(devices, 'key:KeyD');
  sampleInput(input, devices);
  press(devices, 'key:ArrowRight');
  release(devices, 'key:ArrowRight');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveRight'), [true, false, false]);
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'moveRight'), [true, false, false]);
  assert.deepEqual(input.debug.players[0].totals.moveRight, { pressed: 1, released: 0 });
});

test('edges: releasing and pressing the same key again between two ticks gives no edge', () => {
  const { devices, input } = setup();
  press(devices, 'key:Space');
  sampleInput(input, devices);
  release(devices, 'key:Space');
  press(devices, 'key:Space');
  assert.deepEqual(edge(sampleInput(input, devices)[0], 'jump'), [true, false, false]);
});

// Recorded in Chrome on Linux (mouse wheel and laptop touchpad); see the fixture's `source`.
const RECORDINGS = JSON.parse(readFileSync(new URL('./fixtures/wheel-recordings.json', import.meta.url), 'utf8'));

// Replays recorded events; returns the down steps and up steps (negative) separately.
function replay(events) {
  const devices = createDevices();
  let down = 0;
  let up = 0;
  for (const { deltaY, deltaMode, t } of events) {
    const before = devices.wheelSteps;
    wheel(devices, deltaY, deltaMode, t);
    const steps = devices.wheelSteps - before;
    if (steps > 0) down += steps;
    else up += steps;
  }
  return { down, up, steps: devices.wheelSteps };
}

test('wheel recordings: the notch size matches the settings', () => {
  assert.equal(RECORDINGS.notchPixels, WHEEL_SETTINGS.notchPixels);
});

test('wheel recordings: slow mouse wheel gives 3 steps down and 3 up', () => {
  const { down, up } = replay(RECORDINGS.sequences['mouse-slow']);
  assert.equal(down, RECORDINGS.expected['mouse-slow'].down);
  assert.equal(-up, RECORDINGS.expected['mouse-slow'].up);
});

test('wheel recordings: fast mouse spins count every notch (31 down, 38 up)', () => {
  assert.equal(replay(RECORDINGS.sequences['mouse-fast-down']).steps, RECORDINGS.expected['mouse-fast-down'].steps);
  assert.equal(replay(RECORDINGS.sequences['mouse-fast-up']).steps, RECORDINGS.expected['mouse-fast-up'].steps);
});

test('wheel recordings: a slow touchpad swipe gives one step', () => {
  assert.equal(replay(RECORDINGS.sequences['touchpad-slow-swipe-up']).steps, RECORDINGS.expected['touchpad-slow-swipe-up'].steps);
});

test('wheel recordings: a fast touchpad swipe down then up gives one step each way', () => {
  const { down, up } = replay(RECORDINGS.sequences['touchpad-fast-swipe-down-then-up']);
  assert.equal(down, RECORDINGS.expected['touchpad-fast-swipe-down-then-up'].down);
  assert.equal(-up, RECORDINGS.expected['touchpad-fast-swipe-down-then-up'].up);
});

test('wheel: zero-distance events are ignored and do not keep a swipe going', () => {
  const { devices } = setup();
  wheel(devices, 0, 0, 0);
  wheel(devices, -0, 0, 5);
  wheel(devices, 0, 1, 6);
  assert.equal(devices.wheelSteps, 0);
  wheel(devices, 45.5, 0, 10); // swipe step
  for (let t = 17; t < 400; t += 7) wheel(devices, -0, 0, t); // zero train, longer than 120 ms
  wheel(devices, 45.5, 0, 400); // the swipe ended 120 ms after its last distance: a new swipe
  assert.equal(devices.wheelSteps, 2);
});

test('wheel: a swipe gives one step until it ends after 120 ms without distance', () => {
  const { devices } = setup();
  let t = 0;
  for (let i = 0; i < 40; i++, t += 7) wheel(devices, 12.5, 0, t); // 500 px in one swipe
  assert.equal(devices.wheelSteps, 1);
  t += WHEEL_SETTINGS.swipeEndMs - 8; // 119 ms after the last event: still the same swipe
  wheel(devices, 50.5, 0, t);
  assert.equal(devices.wheelSteps, 1);
  t += WHEEL_SETTINGS.swipeEndMs; // 120 ms: a new swipe
  wheel(devices, 50.5, 0, t);
  assert.equal(devices.wheelSteps, 2);
});

test('wheel: a direction reversal starts a new swipe at once', () => {
  const { devices } = setup();
  wheel(devices, 30.5, 0, 0);
  wheel(devices, 30.5, 0, 7); // down step
  wheel(devices, -20.25, 0, 14);
  wheel(devices, -20.25, 0, 21); // up step, 7 ms later
  wheel(devices, 10.5, 0, 28); // down again: new swipe, 10.5 px so far
  assert.equal(devices.wheelSteps, 0);
  assert.equal(devices.swipe.distance, 10.5);
});

test('wheel: whole notches step at once, two per 240; line and page modes count their units', () => {
  const { devices, input } = setup();
  wheel(devices, 240, 0, 0);
  wheel(devices, -120, 0, 1);
  assert.equal(devices.wheelSteps, 1);
  wheel(devices, 3, 1, 2); // 3 lines
  wheel(devices, -1, 2, 3); // 1 page
  wheel(devices, 0.5, 1, 4); // fraction of a line: one step
  assert.equal(devices.wheelSteps, 4);
  assert.equal(sampleInput(input, devices)[0].wheel, 4);
  assert.equal(devices.wheelSteps, 0);
  assert.equal(sampleInput(input, devices)[0].wheel, 0);
});

test('wheel: steps on consecutive ticks press nextWeapon on every tick; the frame carries the full count', () => {
  const { devices, input } = setup();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    wheel(devices, 240, 0, i * 16); // 2 notches per tick
    const frame = sampleInput(input, devices)[0];
    seen.push([frame.wheel, ...edge(frame, 'nextWeapon')]);
  }
  const last = sampleInput(input, devices)[0];
  seen.push([last.wheel, ...edge(last, 'nextWeapon')]);
  assert.deepEqual(seen, [
    [2, true, true, false],
    [2, true, true, false],
    [2, true, true, false],
    [2, true, true, false],
    [0, false, false, true],
  ]);
  assert.equal(input.debug.players[0].wheel, 8);
});
