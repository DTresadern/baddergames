// Fade transition as plain data: { duration, t, swapped, to, params }.
// Alpha (screen darkness) goes 0 -> 1 over the first half and 1 -> 0 over the
// second. The harness swaps the main scene once, at the end of the frame in
// which t reached the midpoint. These functions are pure: they return new objects.

// `fromAlpha` lets a new fade start at the darkness of one it replaces.
export function createTransition({ duration, to, params, fromAlpha = 0 }) {
  return { duration, t: (fromAlpha * duration) / 2, swapped: false, to, params };
}

export function transitionAlpha({ duration, t }) {
  const half = duration / 2;
  if (t <= half) return t / half;
  return Math.max(0, (duration - t) / half);
}

// `hold`: do not go past the midpoint (screen stays black), used while the
// incoming scene is still loading and there is nothing to show in its place.
export function advanceTransition(tr, dt, hold = false) {
  let t = tr.t + dt;
  if (hold) t = Math.min(t, tr.duration / 2);
  return { ...tr, t };
}

export function swapDue(tr) {
  return !tr.swapped && tr.t >= tr.duration / 2;
}

export function markSwapped(tr) {
  return { ...tr, swapped: true };
}

export function transitionDone(tr) {
  return tr.swapped && tr.t >= tr.duration;
}
