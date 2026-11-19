// DOM panel showing the input system's per-player state: device, aim, wheel steps, and
// for each action whether it is held now and how many pressed and released edges it had.
// Reads the input's debug data (outside the frames); refreshes about 10 times per second.
// Collapsed at start, at every window width.
//
// Stable hooks for browser scripts:
//   #b7-input, #b7-input-toggle, #b7-input-body, [data-field="ignored"], [data-field="pad-event"]
//   [data-player="0"|"1"] [data-field="device"|"aim"|"wheel"]
//   [data-player="..."] [data-action-row="<action>"] with attributes
//     data-held ("true" | "false"), data-pressed, data-released (running counts)
//     and [data-field="key"]: chip with the primary binding for the player's scheme (set once at
//     mount; hidden and empty when the action is unbound)

import { ACTIONS } from '../input/actions.js';
import { primaryLabel, schemeFor } from './binding-labels.js';

const REFRESH_MS = 100;

const STYLE = `
#b7-input { position: fixed; top: 8px; left: 8px; z-index: 2; width: min(340px, calc(100vw - 16px));
  max-height: calc(100vh - 40px); overflow: auto; box-sizing: border-box; font: 11px/1.35 monospace;
  color: #ddd; background: rgba(10, 12, 18, 0.85); border: 1px solid #444; border-radius: 4px; }
/* On narrow windows: bottom-left, 24 px up, so it does not cover the version label (bottom-right, about 17 px tall). */
@media (max-width: 760px) {
  #b7-input { top: auto; bottom: 24px; max-height: 35vh; }
}
#b7-input-toggle { position: sticky; top: 0; width: 100%; padding: 4px 6px; font: inherit; color: inherit;
  text-align: left; background: #222838; border: 0; cursor: pointer; }
#b7-input-body { padding: 4px 6px 6px; }
#b7-input section { padding-top: 3px; border-top: 1px solid #333; margin-top: 3px; }
#b7-input .b7-dim { color: #999; }
#b7-input .b7-rows { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 8px; }
#b7-input [data-action-row] { display: flex; gap: 4px; white-space: nowrap; }
#b7-input [data-action-row] .b7-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
#b7-input .b7-key { flex: none; font-size: 10px; padding: 0 4px; border-radius: 3px; color: #ffd27a;
  background: #3b3220; border: 1px solid #6b5a2e; }
#b7-input [data-action-row][data-held="true"] .b7-key { color: #1a1405; background: #ffc83d; border-color: #ffe08a; }
#b7-input [data-action-row][data-held="true"] { color: #fff; background: #3a5a3a; }
`;

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setAttr(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function mountInputPanel({ input, parent = document.body, win = window }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const { debug } = input;
  const root = document.createElement('section');
  root.id = 'b7-input';
  root.innerHTML = `
    <button id="b7-input-toggle" type="button" aria-expanded="false">Input ▸</button>
    <div id="b7-input-body" hidden>
      <div><span class="b7-dim">ignored pads</span> <span data-field="ignored"></span></div>
      <div><span class="b7-dim">last pad event</span> <span data-field="pad-event"></span></div>
      ${debug.players
        .map(
          (_, player) => `<section data-player="${player}">
            <b>Player ${player + 1}</b> <span data-field="device"></span><br>
            <span class="b7-dim">aim</span> <span data-field="aim"></span>
            <span class="b7-dim">wheel steps</span> <span data-field="wheel"></span><br>
            <span class="b7-dim">action: held pressed/released</span>
            <div class="b7-rows">${ACTIONS.map(
              (action) => `<div data-action-row="${action}"><span class="b7-name">${action}</span>` +
                `<span class="b7-key" data-field="key"></span>` +
                `<span data-field="held"></span><span data-field="counts"></span></div>`,
            ).join('')}</div>
          </section>`,
        )
        .join('')}
    </div>`;
  parent.append(root);

  const toggle = root.querySelector('#b7-input-toggle');
  const body = root.querySelector('#b7-input-body');
  function setOpen(open) {
    body.hidden = !open;
    toggle.textContent = open ? 'Input ▾' : 'Input ▸';
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => {
    setOpen(body.hidden);
    toggle.blur(); // keys go to the game, not this button
  });

  const sections = debug.players.map((_, player) => {
    const section = root.querySelector(`[data-player="${player}"]`);
    const field = (name) => section.querySelector(`[data-field="${name}"]`);
    const rows = ACTIONS.map((action) => {
      const row = section.querySelector(`[data-action-row="${action}"]`);
      const keyChip = row.querySelector('[data-field="key"]');
      const label = primaryLabel(input.input.bindings, schemeFor(input.input.players[player]), action);
      keyChip.textContent = label ?? '';
      keyChip.hidden = !label;
      return { action, row, held: row.querySelector('[data-field="held"]'), counts: row.querySelector('[data-field="counts"]') };
    });
    return { device: field('device'), aim: field('aim'), wheel: field('wheel'), rows };
  });

  function refresh() {
    setText(root.querySelector('[data-field="ignored"]'), debug.ignoredPads.join(', ') || 'none');
    const event = debug.lastPadEvent;
    setText(root.querySelector('[data-field="pad-event"]'), event ? `${event.type} #${event.index} ${event.id}` : '—');
    debug.players.forEach((info, player) => {
      const view = sections[player];
      setText(view.device, info.device);
      setText(view.aim, info.frame ? `${((info.frame.aim * 180) / Math.PI).toFixed(0)}°` : '—');
      setText(view.wheel, String(info.wheel));
      for (const { action, row, held, counts } of view.rows) {
        const isHeld = Boolean(info.frame?.actions[action].held);
        const { pressed, released } = info.totals[action];
        setAttr(row, 'data-held', String(isHeld));
        setAttr(row, 'data-pressed', String(pressed));
        setAttr(row, 'data-released', String(released));
        setText(held, isHeld ? '●' : '·');
        setText(counts, `${pressed}/${released}`);
      }
    });
  }

  refresh();
  win.setInterval(refresh, REFRESH_MS);
  return root;
}
