// A short notice at the top centre of the page (#b7-notice), for example "The host left the
// game." Dismissed by a click or after NOTICE_MS. One at a time; a new one replaces the text.
// textContent only.

export const NOTICE_MS = 6000;

const STYLE = `
#b7-notice { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 4;
  max-width: calc(100vw - 32px); box-sizing: border-box; padding: 8px 14px; font: 14px/1.4 monospace;
  color: #eee; background: rgba(10, 12, 18, 0.92); border: 1px solid #556; border-radius: 4px; cursor: pointer; }
#b7-notice[hidden] { display: none; }
`;

export function createNotice({ document: doc, parent = doc.body, setTimeout: setTimer, clearTimeout: clearTimer }) {
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);
  const el = doc.createElement('div');
  el.id = 'b7-notice';
  el.hidden = true;
  el.setAttribute('role', 'status');
  parent.append(el);
  let timer = null;
  const hide = () => {
    el.hidden = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  el.addEventListener('click', hide);
  return {
    element: el,
    show(text) {
      el.textContent = text;
      el.hidden = false;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(hide, NOTICE_MS);
    },
    hide,
  };
}
