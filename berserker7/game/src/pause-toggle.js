// Pause key: any player's `pause` press (Escape, gamepad start) closes the pause overlay when it
// is open, and otherwise opens it, unless the main scene is not pausable (the menus).
// Used as the harness's onInputs.

export function togglePauseOnPress(harness, inputs, overlay = 'pause') {
  if (!inputs.some((frame) => frame.actions.pause.pressed)) return;
  if (harness.layers.overlays.includes(overlay)) harness.closeOverlay(overlay);
  else if (canPause(harness)) harness.openOverlay(overlay);
}

function canPause(harness) {
  const { main } = harness.layers;
  if (main === null || main === undefined) return true; // no main scene: nothing to protect
  return harness.records.get(main)?.settings.pausable !== false;
}
