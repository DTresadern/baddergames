// The harness with the real input sampler and fake devices.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDevices, press, release, setSurface } from '../src/input/devices.js';
import { clearAimOrigins, createInput, sampleInput, setAimOrigin } from '../src/input/sampler.js';
import { harnessWith, settle, STEP } from './fakes.js';

function fakeInput() {
  const devices = createDevices();
  setSurface(devices, 800, 600);
  const input = createInput();
  let samples = 0;
  return {
    devices,
    input,
    samples: () => samples,
    sample() {
      samples += 1;
      return sampleInput(input, devices, []);
    },
    setAimOrigin: (player, x, y) => setAimOrigin(input, player, x, y),
    clearAimOrigins: () => clearAimOrigins(input),
  };
}

// A main scene that records the inputs each tick receives.
async function recordingHarness(options) {
  const seen = [];
  const { harness } = harnessWith([['main', {}, {
    tick: (state, inputs) => {
      seen.push(inputs);
      return state;
    },
  }]], options);
  harness.setMain('main');
  await settle(harness);
  seen.length = 0;
  return { harness, seen };
}

test('harness: ticks receive the input frames; onInputs is called once per step, before the ticks', async () => {
  const fake = fakeInput();
  const order = [];
  let ticks = 0;
  const { harness, seen } = await recordingHarness({
    input: fake,
    onInputs: (inputs) => order.push(['onInputs', inputs, ticks]),
  });
  harness.records.get('main').scene.tick = (state, inputs) => {
    ticks += 1;
    seen.push(inputs);
    return state;
  };
  order.length = 0;
  harness.frame(3 * STEP);
  assert.equal(seen.length, 3);
  assert.equal(order.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(order[i][1], seen[i], 'onInputs and tick get the same frames');
    assert.equal(order[i][2], i, 'onInputs runs before that step ticks');
    assert.equal(seen[i].length, 2);
    assert.equal(seen[i][0].player, 0);
  }
  assert.equal(harness.lastInputs, seen[2]);
});

test('harness: several ticks in one frame see pressed only on the first', async () => {
  const fake = fakeInput();
  const { harness, seen } = await recordingHarness({ input: fake });
  press(fake.devices, 'key:Space');
  harness.frame(3 * STEP);
  assert.deepEqual(seen.map((inputs) => inputs[0].actions.jump), [
    { held: true, pressed: true, released: false },
    { held: true, pressed: false, released: false },
    { held: true, pressed: false, released: false },
  ]);
});

test('harness: a tap within one frame is held for one tick and released on the next', async () => {
  const fake = fakeInput();
  const { harness, seen } = await recordingHarness({ input: fake });
  press(fake.devices, 'mouse:0');
  release(fake.devices, 'mouse:0');
  harness.frame(2 * STEP);
  assert.deepEqual(seen.map((inputs) => inputs[0].actions.primaryFire), [
    { held: true, pressed: true, released: false },
    { held: false, pressed: false, released: true },
  ]);
});

test('harness: a frame with no step does not sample, so the next step still sees the press', async () => {
  const fake = fakeInput();
  const { harness, seen } = await recordingHarness({ input: fake });
  const before = fake.samples();
  press(fake.devices, 'key:KeyE');
  release(fake.devices, 'key:KeyE');
  harness.frame(STEP / 3);
  assert.equal(fake.samples(), before);
  harness.frame(STEP);
  assert.equal(seen.at(-1)[0].actions.interact.pressed, true);
});

test('harness: input is sampled even when no scene ticks', async () => {
  const fake = fakeInput();
  const calls = [];
  const { harness } = harnessWith([], { input: fake, onInputs: (inputs) => calls.push(inputs) });
  harness.frame(2 * STEP);
  assert.equal(fake.samples(), 2);
  assert.equal(calls.length, 2);
});

test('harness: without an input option every tick gets an empty array', async () => {
  const { harness, seen } = await recordingHarness();
  harness.frame(2 * STEP);
  assert.equal(seen.length, 2);
  for (const inputs of seen) {
    assert.ok(Array.isArray(inputs));
    assert.equal(inputs.length, 0);
    assert.ok(Object.isFrozen(inputs));
  }
  assert.equal(harness.lastInputs, seen[1]);
});

test('harness: view.setAimOrigin forwards to the input, and is a no-op without one', async () => {
  const fake = fakeInput();
  const { harness } = harnessWith([], { input: fake });
  harness.view.setAimOrigin(1, 12, 34);
  assert.deepEqual(fake.input.perPlayer[1].aimOrigin, { x: 12, y: 34 });
  const bare = harnessWith([]).harness;
  assert.doesNotThrow(() => bare.view.setAimOrigin(0, 1, 2));
  const partial = harnessWith([], { input: { sample: () => [] } }).harness;
  assert.doesNotThrow(() => partial.view.setAimOrigin(0, 1, 2));
});

test('harness: aim origins are kept only while a scene that sets them is drawn', async () => {
  const fake = fakeInput();
  let drawsOrigin = true;
  const { harness } = harnessWith([['main', {}, {
    draw: (state, view) => {
      if (drawsOrigin) view.setAimOrigin(0, 100, 200);
    },
  }]], { input: fake });
  harness.setMain('main');
  await settle(harness, STEP);
  harness.frame(STEP);
  assert.deepEqual(fake.input.perPlayer[0].aimOrigin, { x: 100, y: 200 });
  drawsOrigin = false;
  harness.frame(STEP);
  assert.equal(fake.input.perPlayer[0].aimOrigin, null);
});
