import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BAR_HEIGHT, barRect, createBoot, errorLines, initBoot, labelRect, tickBoot } from '../src/scenes/boot.js';
import { frame } from './frames.js';

const loading = (progress) => ({ progress, done: false, error: null });
const DONE = { progress: 1, done: true, error: null };
const FAILED = { progress: 0.5, done: false, error: 'Could not load content/textures/logos/w8omg.png' };
const click = () => frame(['primaryFire'], null, true, true);
const idle = () => frame([]);
const gamepadPress = () => ({ ...frame(['jump']), player: 1 }); // activated is false on gamepad frames

test('tickBoot: copies the loader status into the state', () => {
  const state = initBoot();
  for (const p of [0, 0.25, 0.5]) {
    tickBoot(state, [idle()], loading(p));
    assert.equal(state.progress, p);
    assert.equal(state.done, false);
  }
  tickBoot(state, [idle()], DONE);
  assert.deepEqual([state.progress, state.done, state.error, state.ticks], [1, true, null, 4]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
});

test('tickBoot: no start before done; a press during loading does not carry over', () => {
  const state = initBoot();
  tickBoot(state, [click()], loading(0.75));
  assert.equal(state.request, null);
  tickBoot(state, [idle()], DONE);
  assert.equal(state.request, null, 'the earlier press is gone');
});

test('tickBoot: start once on an activated frame after done', () => {
  const state = initBoot();
  tickBoot(state, [idle()], DONE);
  tickBoot(state, [click()], DONE);
  assert.equal(state.request, 'start');
  tickBoot(state, [click()], DONE);
  assert.equal(state.request, null, 'only once');
});

test('tickBoot: no start on an error, a gamepad press, a disconnected or a non-activating frame', () => {
  const failed = initBoot();
  tickBoot(failed, [click()], FAILED);
  assert.equal(failed.request, null);
  assert.equal(failed.error, FAILED.error);
  const state = initBoot();
  tickBoot(state, [idle(), gamepadPress()], DONE);
  assert.equal(state.request, null, 'gamepad');
  tickBoot(state, [frame(['pause'])], DONE);
  assert.equal(state.request, null, 'Escape is pressed but not activated');
  tickBoot(state, [frame([], null, false, true)], DONE);
  assert.equal(state.request, null, 'disconnected');
});

test('boot scene: enter starts the boot group and swallows its rejection; tick asks for the intro on start', async () => {
  const calls = [];
  const status = { ...DONE };
  const loader = {
    load: (group) => {
      calls.push(['load', group]);
      return Promise.reject(new Error('logged by the loader'));
    },
    status: (group) => {
      calls.push(['status', group]);
      return status;
    },
  };
  const screens = { startIntro: () => calls.push(['startIntro']) };
  const boot = createBoot({ loader, screens });
  assert.deepEqual(boot.settings, { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false });
  const state = boot.enter();
  await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the test run
  boot.tick(state, [idle()]);
  boot.tick(state, [click()]);
  assert.deepEqual(calls, [['load', 'boot'], ['status', 'boot'], ['status', 'boot'], ['startIntro']]);
});

test('barRect: centred, at most 400 px and 70% of the width', () => {
  assert.deepEqual(barRect(1920, 1080), { x: 760, y: (1080 - BAR_HEIGHT) / 2, width: 400, height: BAR_HEIGHT });
  const phone = barRect(360, 640);
  assert.ok(Math.abs(phone.width - 252) < 1e-9);
  assert.ok(Math.abs(phone.x - 54) < 1e-9);
});

test('labelRect: full size when it fits; shrunk uniformly with 16 px each side on a phone', () => {
  assert.deepEqual(labelRect(1920, 1080, 360, 72), { x: 780, y: 504, width: 360, height: 72 });
  const phone = labelRect(360, 640, 360, 72);
  assert.ok(Math.abs(phone.width - 328) < 1e-9);
  assert.ok(Math.abs(phone.x - 16) < 1e-9);
  assert.ok(Math.abs(phone.height / phone.width - 72 / 360) < 1e-9);
});

test('errorLines: the path gets its own line', () => {
  assert.deepEqual(errorLines('Could not load content/a.png'), ['Could not load', 'content/a.png']);
  assert.deepEqual(errorLines('something else'), ['something else']);
});
