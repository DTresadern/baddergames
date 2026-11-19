// Shared menu panel animation (pure). A panel opens as a thin line that widens, then grows to
// full height, then its items fade in; closing is the exact reverse in time. Callers keep the
// time in their scene state and advance it by dt; nothing here reads a clock.

export const PANEL_ANIM = Object.freeze({
  widthSeconds: 0.3,
  heightSeconds: 0.3,
  itemsSeconds: 0.2,
  lineHeight: 4, // CSS px
});

export const OPEN_SECONDS = PANEL_ANIM.widthSeconds + PANEL_ANIM.heightSeconds + PANEL_ANIM.itemsSeconds;
export const CLOSE_SECONDS = OPEN_SECONDS;

// Cubic ease-out, clamped to 0..1.
export function easeOut(x) {
  const c = Math.min(1, Math.max(0, x));
  return 1 - (1 - c) ** 3;
}

const { widthSeconds, heightSeconds, itemsSeconds, lineHeight } = PANEL_ANIM;

// Each factor is 0..1: width 0..0.3 s, height 0.3..0.6 s, items alpha 0.6..0.8 s.
export function openingAt(t) {
  return {
    width: easeOut(t / widthSeconds),
    height: easeOut((t - widthSeconds) / heightSeconds),
    items: easeOut((t - widthSeconds - heightSeconds) / itemsSeconds),
  };
}

// Items alpha 1 -> 0 over 0..0.2 s, height to the line over 0.2..0.5 s, width to 0 over 0.5..0.8 s
// (opening played backwards).
export function closingAt(t) {
  return openingAt(OPEN_SECONDS - t);
}

// Same centre; width is rect.width * width; height runs from the line to the full height.
// Width 0 means not shown: callers hide the mesh then (never scale a mesh to 0).
export function animRect(rect, { width, height }) {
  const w = rect.width * width;
  const h = Math.min(rect.height, lineHeight + (rect.height - lineHeight) * height);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}
