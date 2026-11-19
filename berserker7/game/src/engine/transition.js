// Fade transition as plain data: { duration, fadeOut, fadeIn, t, swapped, to, params }.
// Alpha (screen darkness) goes 0 -> 1 over `fadeOut` seconds and 1 -> 0 over `fadeIn`
// seconds; `duration` is their sum. By default each is half the duration. The harness
// swaps the main scene once, at the end of the frame in which t reached `fadeOut`.
// These functions are pure: they return new objects. A plain object without
// `fadeOut`/`fadeIn` is read as a symmetric fade (each `duration / 2`).

function fadeOutOf(tr) {
  return tr.fadeOut ?? tr.duration / 2;
}

function fadeInOf(tr) {
  return tr.fadeIn ?? tr.duration / 2;
}

// `fromAlpha` lets a new fade start at the darkness of one it replaces.
export function createTransition({ duration, fadeOut, fadeIn, to, params, fromAlpha = 0 }) {
  const out = fadeOut ?? duration / 2;
  const inn = fadeIn ?? duration / 2;
  return { duration: out + inn, fadeOut: out, fadeIn: inn, t: fromAlpha * out, swapped: false, to, params };
}

export function transitionAlpha(tr) {
  const out = fadeOutOf(tr);
  if (tr.t <= out) return tr.t / out;
  return Math.max(0, (tr.duration - tr.t) / fadeInOf(tr));
}

// `hold`: do not go past the midpoint (screen stays black), used while the
// incoming scene is still loading and there is nothing to show in its place.
export function advanceTransition(tr, dt, hold = false) {
  let t = tr.t + dt;
  if (hold) t = Math.min(t, fadeOutOf(tr));
  return { ...tr, t };
}

export function swapDue(tr) {
  return !tr.swapped && tr.t >= fadeOutOf(tr);
}

export function markSwapped(tr) {
  return { ...tr, swapped: true };
}

export function transitionDone(tr) {
  return tr.swapped && tr.t >= tr.duration;
}
