// Shared clock estimate from ping / pong samples. Pure.
// A sample is { sent, received, remoteTick, localTick }: our clock (ms) when the ping left and when
// its pong arrived, the replier's tick in the pong, and our tick when it arrived.
// rtt = received - sent; the remote tick now ≈ remoteTick + (rtt / 2) / STEP_MS;
// offset = that - localTick. The sample with the smallest RTT of the last MAX_SAMPLES is used,
// since a short round trip leaves the least room for one-way jitter.

import { STEP_SECONDS } from '../engine/clock.js';

export const STEP_MS = STEP_SECONDS * 1000;
export const MAX_SAMPLES = 16;

export function createClockSync() {
  const samples = [];
  let best = null;
  return {
    add({ sent, received, remoteTick, localTick }) {
      const rtt = Math.max(0, received - sent);
      samples.push({ rtt, offset: remoteTick + rtt / 2 / STEP_MS - localTick });
      if (samples.length > MAX_SAMPLES) samples.shift();
      best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    },
    // { rttMs, offsetTicks, samples }: rttMs is null and offsetTicks 0 before the first sample.
    estimate: () => ({ rttMs: best ? best.rtt : null, offsetTicks: best ? best.offset : 0, samples: samples.length }),
  };
}
