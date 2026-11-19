// Tells the player when the running build is older than the published one. The build writes
// version.json ({ sha, builtAt }) next to index.html; the main menu fetches it on every entry.
// Pure and never throws: any failure counts as "not outdated". The notice is #b7-outdated,
// bottom centre. textContent only.

export const OUTDATED_TEXT =
  'You are on an old version. Hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac) to get the latest.';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// True only when `published` is a different, later build than `running` ({ sha, builtAt }).
export function isOutdated(running, published) {
  try {
    if (!isPlainObject(running) || !isPlainObject(published)) return false;
    if (typeof published.sha !== 'string' || typeof published.builtAt !== 'string') return false;
    const publishedAt = Date.parse(published.builtAt);
    const runningAt = Date.parse(running.builtAt);
    if (Number.isNaN(publishedAt) || Number.isNaN(runningAt)) return false;
    return published.sha !== running.sha && publishedAt > runningAt;
  } catch {
    return false;
  }
}

// Resolves true when the published build is newer; false on any failure or with no `running`
// (dev). The cache buster and `no-store` get past the 10 minute cache of version.json.
export async function checkForNewerBuild({
  running,
  fetch,
  now,
  url = 'version.json',
  timeoutMs = 5000,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
}) {
  if (!running) return false;
  let timer = null;
  try {
    const controller = new AbortController();
    timer = setTimer(() => controller.abort(), timeoutMs);
    const response = await fetch(`${url}?t=${now()}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return false;
    return isOutdated(running, await response.json());
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimer(timer);
  }
}

// Bottom centre, 24 px up: above the bottom-right version label (about 19 px tall) and below the
// menu panel (see AGENTS.md). 12 px text so it stays one line at 800 px wide. Not clickable.
const STYLE = `
#b7-outdated { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 4;
  width: max-content; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 6px 8px;
  font: 12px/1.35 monospace; text-align: center; color: #eee; background: rgba(10, 12, 18, 0.92);
  border: 1px solid #556; border-radius: 4px; pointer-events: none; }
#b7-outdated[hidden] { display: none; }
`;

export function createOutdatedNotice({ document: doc, parent = doc.body }) {
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);
  const el = doc.createElement('div');
  el.id = 'b7-outdated';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.textContent = OUTDATED_TEXT;
  parent.append(el);
  return {
    element: el,
    show() {
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}
