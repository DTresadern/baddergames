// The players' health on screen (#b7-hud), bottom-left: one line per present player slot,
// "P1 100/100". Shown while the Sandbox is the main scene (main.js passes its players, or null to
// hide it). textContent only; the DOM is touched only when the text changes.

import { PLAYER_HEALTH } from '../world/combat.js';

const STYLE = `
#b7-hud { position: fixed; left: 16px; bottom: 24px; z-index: 1; padding: 4px 8px; white-space: pre;
  font: 14px/1.4 monospace; color: #fff; background: rgba(10, 12, 18, 0.6); border-radius: 4px; pointer-events: none; }
#b7-hud[hidden] { display: none; }
`;

// The HUD text for a players list (index = slot; empty slots skipped).
export function healthText(players) {
  return players
    .map((p, slot) => (p ? `P${slot + 1} ${p.health}/${PLAYER_HEALTH}` : null))
    .filter((line) => line !== null)
    .join('\n');
}

export function createHealthHud({ document: doc, parent = doc.body }) {
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);
  const el = doc.createElement('div');
  el.id = 'b7-hud';
  el.hidden = true;
  parent.append(el);
  let shown = '';
  return {
    element: el,
    // `players`: the Sandbox's state.players, or null (not in the Sandbox: hidden).
    update(players) {
      const hidden = players === null;
      if (el.hidden !== hidden) el.hidden = hidden;
      if (hidden) return;
      const text = healthText(players);
      if (text === shown) return;
      shown = text;
      el.textContent = text;
    },
  };
}
