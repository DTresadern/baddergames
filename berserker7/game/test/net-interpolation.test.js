import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTERP_CAP, INTERP_DELAY_TICKS, createInterpolationBuffer, lerpAngle } from '../src/net/interpolation.js';

const p = (x, y, aim = 0, extra = {}) => ({ x, y, vx: 0, vy: 0, onGround: true, crouching: false, aim, ...extra });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('interpolation: lerps x and y between the bracketing snapshots', () => {
  const buf = createInterpolationBuffer();
  assert.equal(buf.sampleAt(5), null);
  buf.push(10, p(0, 0));
  buf.push(12, p(4, 2));
  buf.push(14, p(8, 2, 0, { onGround: false, crouching: true }));
  const s = buf.sampleAt(11);
  assert.deepEqual([s.x, s.y], [2, 1]);
  const late = buf.sampleAt(13.5);
  assert.ok(near(late.x, 7));
  // Booleans come from the earlier entry.
  assert.deepEqual([late.onGround, late.crouching], [true, false]);
  assert.equal(INTERP_DELAY_TICKS, 6);
});

test('interpolation: clamps at both ends, no extrapolation', () => {
  const buf = createInterpolationBuffer();
  buf.push(10, p(1, 1));
  buf.push(12, p(3, 1));
  assert.deepEqual(buf.sampleAt(0), p(1, 1));
  assert.deepEqual(buf.sampleAt(100), p(3, 1));
  // The sample is a copy.
  buf.sampleAt(100).x = 99;
  assert.equal(buf.sampleAt(100).x, 3);
});

test('interpolation: duplicate and older ticks ignored; capped', () => {
  const buf = createInterpolationBuffer();
  buf.push(10, p(1, 1));
  buf.push(10, p(5, 5));
  buf.push(8, p(5, 5));
  assert.equal(buf.size(), 1);
  for (let t = 11; t < 11 + INTERP_CAP + 5; t++) buf.push(t, p(t, 0));
  assert.equal(buf.size(), INTERP_CAP);
});

test('interpolation: aim turns the short way across ±PI', () => {
  const a = 0.9 * Math.PI;
  const b = -0.9 * Math.PI;
  const mid = lerpAngle(a, b, 0.5);
  assert.ok(near(Math.abs(mid), Math.PI), `mid ${mid}`);
  assert.ok(near(lerpAngle(a, b, 0.25), 0.95 * Math.PI));
  assert.ok(near(lerpAngle(b, a, 0.25), -0.95 * Math.PI));
  assert.ok(near(lerpAngle(0.2, 0.6, 0.5), 0.4));
  const buf = createInterpolationBuffer();
  buf.push(0, p(0, 0, a));
  buf.push(4, p(0, 0, b));
  assert.ok(near(buf.sampleAt(1).aim, 0.95 * Math.PI));
});

test('interpolation: fields it does not know (a bolt\'s angle and row) come from the earlier entry', () => {
  const buf = createInterpolationBuffer();
  buf.push(10, p(0, 0, 0, { angle: 0.5, row: 0 }));
  buf.push(12, p(4, 2, 0, { angle: 2, row: 1 }));
  const mid = buf.sampleAt(11);
  assert.deepEqual([mid.x, mid.y, mid.angle, mid.row], [2, 1, 0.5, 0]);
});
