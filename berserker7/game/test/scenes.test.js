import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initBackdrop, tickBackdrop } from '../src/scenes/backdrop.js';
import { initLoading, tickLoading } from '../src/scenes/loading.js';
import { initPause, tickPause } from '../src/scenes/pause.js';
import { initSceneA, tickSceneA } from '../src/scenes/scene-a.js';
import { initSceneB, tickSceneB } from '../src/scenes/scene-b.js';
import { initSlow, tickSlow } from '../src/scenes/slow.js';

const SIMS = {
  backdrop: [initBackdrop, tickBackdrop],
  sceneA: [initSceneA, tickSceneA],
  sceneB: [initSceneB, tickSceneB],
  pause: [initPause, tickPause],
  slow: [initSlow, tickSlow],
  loading: [initLoading, tickLoading],
};

const NO_INPUTS = Object.freeze([]);

function run(init, tick, n) {
  let state = init();
  for (let i = 0; i < n; i++) state = tick(state, NO_INPUTS, 1 / 60);
  return state;
}

for (const [name, [init, tick]] of Object.entries(SIMS)) {
  test(`${name}: state is plain data after ticking`, () => {
    for (const n of [0, 1, 600, 3600]) {
      const state = run(init, tick, n);
      assert.equal(state.ticks, n);
      assert.deepStrictEqual(structuredClone(state), state);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
    }
  });

  test(`${name}: simulation is repeatable`, () => {
    assert.deepStrictEqual(run(init, tick, 1000), run(init, tick, 1000));
  });

  test(`${name}: ticking a snapshot continues identically`, () => {
    const state = run(init, tick, 300);
    let copy = structuredClone(state);
    let original = state;
    for (let i = 0; i < 300; i++) {
      original = tick(original, NO_INPUTS, 1 / 60);
      copy = tick(copy, NO_INPUTS, 1 / 60);
    }
    assert.deepStrictEqual(copy, original);
  });
}

test('sceneB: balls stay inside the box', () => {
  let state = initSceneB();
  for (let i = 0; i < 5000; i++) {
    state = tickSceneB(state);
    for (const ball of state.balls) {
      assert.ok(Number.isInteger(ball.x) && Number.isInteger(ball.y));
      assert.ok(Math.abs(ball.x) <= 1600 && ball.y >= -900 && ball.y < 1200);
    }
  }
});
