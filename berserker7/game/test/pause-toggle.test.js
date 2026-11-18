import assert from 'node:assert/strict';
import { test } from 'node:test';
import { togglePauseOnPress } from '../src/pause-toggle.js';

// A harness that applies overlay requests at once and records them.
function fakeHarness(mainSettings = null) {
  const calls = [];
  const harness = {
    layers: { main: null, overlays: [] },
    records: new Map(),
    openOverlay(id) {
      calls.push(['open', id]);
      harness.layers.overlays.push(id);
    },
    closeOverlay(id) {
      calls.push(['close', id]);
      harness.layers.overlays.splice(harness.layers.overlays.indexOf(id), 1);
    },
  };
  if (mainSettings) {
    harness.layers.main = 'main';
    harness.records.set('main', { settings: mainSettings });
  }
  return { harness, calls };
}

// Frames for two players; `pause` is { held, pressed, released } per player.
function frames(p1 = {}, p2 = {}) {
  const pause = ({ held = false, pressed = false }) => ({ held, pressed, released: false });
  return [
    { player: 0, connected: true, actions: { pause: pause(p1) } },
    { player: 1, connected: true, actions: { pause: pause(p2) } },
  ];
}

test('pause toggle: a press opens the pause overlay, the next press closes it', () => {
  const { harness, calls } = fakeHarness();
  togglePauseOnPress(harness, frames({ held: true, pressed: true }));
  assert.deepEqual(calls, [['open', 'pause']]);
  togglePauseOnPress(harness, frames({ held: true, pressed: true }));
  assert.deepEqual(calls, [['open', 'pause'], ['close', 'pause']]);
});

test('pause toggle: player 2 toggles too; both pressing in one tick toggles once', () => {
  const { harness, calls } = fakeHarness();
  togglePauseOnPress(harness, frames({}, { held: true, pressed: true }));
  assert.deepEqual(calls, [['open', 'pause']]);
  togglePauseOnPress(harness, frames({ held: true, pressed: true }, { held: true, pressed: true }));
  assert.deepEqual(calls, [['open', 'pause'], ['close', 'pause']]);
});

test('pause toggle: held without pressed, no press and no frames do nothing', () => {
  const { harness, calls } = fakeHarness();
  togglePauseOnPress(harness, frames({ held: true }, { held: true }));
  togglePauseOnPress(harness, frames());
  togglePauseOnPress(harness, []);
  assert.deepEqual(calls, []);
});

test('pause toggle: a pause overlay already open is closed, other overlays are left alone', () => {
  const { harness, calls } = fakeHarness();
  harness.layers.overlays.push('menu', 'pause');
  togglePauseOnPress(harness, frames({ held: true, pressed: true }));
  assert.deepEqual(calls, [['close', 'pause']]);
  assert.deepEqual(harness.layers.overlays, ['menu']);
});

test('pause toggle: a press does not open pause over a non-pausable main scene', () => {
  const { harness, calls } = fakeHarness({ pausable: false });
  togglePauseOnPress(harness, frames({ held: true, pressed: true }));
  assert.deepEqual(calls, []);
});

test('pause toggle: a press opens pause over a pausable main scene', () => {
  const { harness, calls } = fakeHarness({ pausable: true });
  togglePauseOnPress(harness, frames({ held: true, pressed: true }));
  assert.deepEqual(calls, [['open', 'pause']]);
});

test('pause toggle: an open pause overlay still closes over a non-pausable main scene', () => {
  const { harness, calls } = fakeHarness({ pausable: false });
  harness.layers.overlays.push('pause');
  togglePauseOnPress(harness, frames({ held: true, pressed: true }));
  assert.deepEqual(calls, [['close', 'pause']]);
});
