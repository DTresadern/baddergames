// Pause key: any player's `pause` press (Escape, gamepad start) opens the pause overlay,
// or closes it when it is open. Used as the harness's onInputs.

export function togglePauseOnPress(harness, inputs, overlay = 'pause') {
  if (!inputs.some((frame) => frame.actions.pause.pressed)) return;
  if (harness.layers.overlays.includes(overlay)) harness.closeOverlay(overlay);
  else harness.openOverlay(overlay);
}
