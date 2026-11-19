import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SAMPLES, STEP_MS, createClockSync } from '../src/net/clock-sync.js';

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);

test('clock sync: nothing before the first sample', () => {
  assert.deepEqual(createClockSync().estimate(), { rttMs: null, offsetTicks: 0, samples: 0 });
});

test('clock sync: offset and RTT from one sample', () => {
  const clock = createClockSync();
  // Pong took 100 ms round trip; the remote said tick 500; we were at tick 200 on arrival.
  clock.add({ sent: 1000, received: 1100, remoteTick: 500, localTick: 200 });
  const e = clock.estimate();
  assert.equal(e.rttMs, 100);
  near(e.offsetTicks, 500 + 50 / STEP_MS - 200, 'offset');
});

test('clock sync: symmetric delay gives the true offset', () => {
  // Remote runs exactly 1000 ticks ahead. One-way delay 120 ms each way.
  const remoteTickAt = (ms) => 1000 + ms / STEP_MS;
  const localTickAt = (ms) => ms / STEP_MS;
  const clock = createClockSync();
  const sent = 5000;
  const reply = sent + 120;
  const received = reply + 120;
  clock.add({ sent, received, remoteTick: remoteTickAt(reply), localTick: localTickAt(received) });
  near(clock.estimate().offsetTicks, 1000, 'offset');
});

test('clock sync: uses the smallest-RTT sample of the last 16', () => {
  const clock = createClockSync();
  clock.add({ sent: 0, received: 30, remoteTick: 100, localTick: 0 }); // best so far
  clock.add({ sent: 0, received: 300, remoteTick: 900, localTick: 0 });
  assert.equal(clock.estimate().rttMs, 30);
  near(clock.estimate().offsetTicks, 100 + 15 / STEP_MS, 'offset');
  // After 16 more samples, the best one has left the window.
  for (let i = 0; i < MAX_SAMPLES; i++) clock.add({ sent: 0, received: 80 + i, remoteTick: 10, localTick: 0 });
  assert.equal(clock.estimate().rttMs, 80);
  assert.equal(clock.estimate().samples, MAX_SAMPLES);
});
