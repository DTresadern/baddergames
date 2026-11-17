import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceClock, createClock } from '../src/engine/clock.js';

const STEP = 1 / 60;

test('one step per 1/60 s frame', () => {
  const clock = createClock();
  let total = 0;
  for (let i = 0; i < 120; i++) {
    const steps = advanceClock(clock, STEP);
    assert.equal(steps, 1);
    total += steps;
  }
  assert.equal(total, 120);
});

test('time below one step carries over to the next frame', () => {
  const clock = createClock();
  assert.equal(advanceClock(clock, 0.01), 0);
  assert.ok(Math.abs(clock.accumulator - 0.01) < 1e-12);
  assert.equal(advanceClock(clock, 0.01), 1);
  assert.ok(Math.abs(clock.accumulator - (0.02 - STEP)) < 1e-12);
});

test('two 1/120 s frames make one step', () => {
  const clock = createClock();
  assert.equal(advanceClock(clock, 1 / 120), 0);
  assert.equal(advanceClock(clock, 1 / 120), 1);
});

test('frame time is capped at 0.25 s', () => {
  const clock = createClock({ maxSteps: 100 });
  assert.equal(advanceClock(clock, 3), 15); // 0.25 s / (1/60 s)
  assert.ok(clock.accumulator < STEP);
});

test('at most maxSteps per frame; the leftover steps are dropped', () => {
  const clock = createClock({ maxFrame: 1 });
  assert.equal(advanceClock(clock, 0.2), 8); // 12 steps due
  assert.ok(clock.accumulator >= 0 && clock.accumulator < STEP);
  assert.equal(advanceClock(clock, 0), 0); // nothing left to catch up
});

test('a slow frame with the default settings runs 8 steps, not 15', () => {
  const clock = createClock();
  assert.equal(advanceClock(clock, 1), 8);
  assert.ok(clock.accumulator < STEP);
});

test('zero, negative and invalid frame times add nothing', () => {
  const clock = createClock();
  advanceClock(clock, 0.01);
  for (const t of [0, -1, Number.NaN, undefined]) {
    assert.equal(advanceClock(clock, t), 0);
    assert.ok(Math.abs(clock.accumulator - 0.01) < 1e-12);
  }
});
