// Fixed-step clock. The renderer produces real time; the simulation consumes it
// in steps of exactly `step` seconds. Each frame's time is capped at `maxFrame`
// and each frame runs at most `maxSteps` steps, so a slow frame slows the game
// down instead of making it fall further behind every frame.

// Absorbs float rounding, so that, for example, 15 frames of 1/60 s give 15 steps.
const EPSILON = 1e-9;

export const STEP_SECONDS = 1 / 60;

export function createClock({ step = STEP_SECONDS, maxFrame = 0.25, maxSteps = 8 } = {}) {
  return { step, maxFrame, maxSteps, accumulator: 0 };
}

// Frame time limited to [0, maxFrame]; negative or invalid times count as 0.
export function clampFrame(clock, frameSeconds) {
  return frameSeconds > 0 ? Math.min(frameSeconds, clock.maxFrame) : 0;
}

// Adds this frame's time and returns the number of steps to run now. All whole
// steps leave the accumulator, so it stays below one step; when there are more
// than maxSteps, the extra steps are dropped and the game slows down.
export function advanceClock(clock, frameSeconds) {
  clock.accumulator += clampFrame(clock, frameSeconds);
  const steps = Math.floor(clock.accumulator / clock.step + EPSILON);
  clock.accumulator = Math.max(0, clock.accumulator - steps * clock.step);
  return Math.min(steps, clock.maxSteps);
}
