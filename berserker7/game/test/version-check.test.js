import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OUTDATED_TEXT, checkForNewerBuild, createOutdatedNotice, isOutdated } from '../src/ui/version-check.js';

const RUNNING = { sha: 'aaaaaaa', builtAt: '2026-11-19T10:00:00.000Z' };
const NEWER = { sha: 'bbbbbbb', builtAt: '2026-11-19T11:00:00.000Z' };
const OLDER = { sha: 'ccccccc', builtAt: '2026-11-19T09:00:00.000Z' };

test('isOutdated: the same version is not outdated', () => {
  assert.equal(isOutdated(RUNNING, { ...RUNNING }), false);
});

test('isOutdated: a different sha built later is outdated', () => {
  assert.equal(isOutdated(RUNNING, NEWER), true);
});

test('isOutdated: a different sha built earlier is not outdated', () => {
  assert.equal(isOutdated(RUNNING, OLDER), false);
});

test('isOutdated: the same sha built later is not outdated', () => {
  assert.equal(isOutdated(RUNNING, { sha: RUNNING.sha, builtAt: NEWER.builtAt }), false);
});

test('isOutdated: malformed published data is not outdated', () => {
  const bad = [
    null,
    undefined,
    'text',
    42,
    [],
    {},
    { sha: 'bbbbbbb' },
    { builtAt: NEWER.builtAt },
    { sha: 123, builtAt: NEWER.builtAt },
    { sha: 'bbbbbbb', builtAt: 1763550000000 },
    { sha: 'bbbbbbb', builtAt: 'not a date' },
    { sha: 'bbbbbbb', builtAt: '' },
  ];
  for (const published of bad) assert.equal(isOutdated(RUNNING, published), false, JSON.stringify(published));
});

test('isOutdated: no running build (dev) or a bad running build is never outdated', () => {
  assert.equal(isOutdated(null, NEWER), false);
  assert.equal(isOutdated(undefined, NEWER), false);
  assert.equal(isOutdated({ sha: 'aaaaaaa', builtAt: 'nope' }, NEWER), false);
});

const respond = (body, ok = true) => async () => ({ ok, json: async () => body });

// One fake timer: `fire()` runs its callback, as if the timeout passed.
function fakeTimers() {
  const t = { cb: null, cleared: 0 };
  t.setTimeout = (cb) => ((t.cb = cb), 1);
  t.clearTimeout = () => {
    t.cleared += 1;
  };
  t.fire = () => t.cb();
  return t;
}

function check(fetch, extra = {}) {
  const timers = fakeTimers();
  return checkForNewerBuild({ running: RUNNING, fetch, now: () => 1234, ...timers, ...extra });
}

test('checkForNewerBuild: a newer published build gives true', async () => {
  assert.equal(await check(respond(NEWER)), true);
});

test('checkForNewerBuild: the same or an older published build gives false', async () => {
  assert.equal(await check(respond(RUNNING)), false);
  assert.equal(await check(respond(OLDER)), false);
});

test('checkForNewerBuild: a rejected fetch gives false', async () => {
  assert.equal(await check(async () => { throw new TypeError('offline'); }), false);
});

test('checkForNewerBuild: a non-OK response gives false', async () => {
  assert.equal(await check(respond(NEWER, false)), false);
});

test('checkForNewerBuild: bad JSON gives false', async () => {
  const fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } });
  assert.equal(await check(fetch), false);
});

test('checkForNewerBuild: a fetch that never answers is aborted at the timeout and gives false', async () => {
  const timers = fakeTimers();
  let signal = null;
  const fetch = (url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  const result = checkForNewerBuild({ running: RUNNING, fetch, now: () => 1, timeoutMs: 5000, ...timers });
  assert.equal(signal.aborted, false);
  timers.fire();
  assert.equal(signal.aborted, true);
  assert.equal(await result, false);
});

test('checkForNewerBuild: the timeout is set from timeoutMs and cleared when done', async () => {
  const delays = [];
  const timers = fakeTimers();
  const setTimeout = (cb, ms) => (delays.push(ms), timers.setTimeout(cb));
  await check(respond(NEWER), { setTimeout, clearTimeout: timers.clearTimeout, timeoutMs: 777 });
  assert.deepEqual(delays, [777]);
  assert.equal(timers.cleared, 1);
});

test('checkForNewerBuild: no running build (dev) gives false without fetching', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => NEWER };
  };
  const timers = fakeTimers();
  for (const running of [null, undefined]) {
    assert.equal(await checkForNewerBuild({ running, fetch, now: () => 1, ...timers }), false);
  }
  assert.equal(calls, 0);
});

test('checkForNewerBuild: fetches version.json with a cache buster and no-store', async () => {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push([url, options]);
    return { ok: true, json: async () => RUNNING };
  };
  await check(fetch);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'version.json?t=1234');
  assert.equal(seen[0][1].cache, 'no-store');
  assert.ok(seen[0][1].signal instanceof AbortSignal);
  await check(fetch, { url: 'other.json' });
  assert.equal(seen[1][0], 'other.json?t=1234');
});

// A minimal DOM: just what createOutdatedNotice uses.
function fakeDocument() {
  const make = (tag) => ({ tag, attrs: {}, hidden: false, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } });
  const appended = [];
  const holder = (list) => ({ append: (el) => list.push(el) });
  const head = [];
  const body = [];
  return { createElement: make, head: holder(head), body: holder(body), headList: head, bodyList: body, appended };
}

test('createOutdatedNotice: #b7-outdated, hidden at first, the exact text, show and hide', () => {
  const doc = fakeDocument();
  const notice = createOutdatedNotice({ document: doc });
  const el = notice.element;
  assert.equal(el.id, 'b7-outdated');
  assert.equal(el.attrs.role, 'status');
  assert.equal(el.hidden, true);
  assert.equal(
    el.textContent,
    'You are on an old version. Hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac) to get the latest.',
  );
  assert.equal(OUTDATED_TEXT, el.textContent);
  assert.deepEqual(doc.bodyList, [el]);
  assert.match(doc.headList[0].textContent, /#b7-outdated/);
  notice.show();
  assert.equal(el.hidden, false);
  notice.hide();
  assert.equal(el.hidden, true);
});
