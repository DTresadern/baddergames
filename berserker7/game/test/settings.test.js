// The settings store with fake storage objects, no browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEGACY_BINDINGS_KEY,
  SETTINGS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  browserStorage,
  createSettingsStore,
  defaultSettings,
  parseSettings,
} from '../src/settings/store.js';

const DEFAULTS = {
  version: 1,
  musicVolume: 0.35,
  showVersionLabel: true,
  bindings: {},
  lastChoice: { campaign: 'megacity', difficulty: 'normal' },
  progress: {},
};

// Fake storage backed by an object; `calls` lists every call as [method, key].
function memoryStorage(initial = {}) {
  const data = { ...initial };
  const calls = [];
  return {
    data,
    calls,
    count: (method) => calls.filter(([m]) => m === method).length,
    getItem(key) {
      calls.push(['getItem', key]);
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      calls.push(['setItem', key]);
      data[key] = String(value);
    },
    removeItem(key) {
      calls.push(['removeItem', key]);
      delete data[key];
    },
  };
}

const saved = (storage) => JSON.parse(storage.data[SETTINGS_KEY]);
const parse = (object, options) => parseSettings(JSON.stringify(object), options);

test('defaults: no saved data gives the default settings', () => {
  assert.deepEqual(parseSettings(null), DEFAULTS);
  assert.deepEqual(defaultSettings(), DEFAULTS);
  assert.equal(SETTINGS_VERSION, 1);
  const store = createSettingsStore({ storage: memoryStorage() });
  assert.deepEqual(store.get(), DEFAULTS);
});

test('defaults: creating the store with nothing saved writes nothing', () => {
  const storage = memoryStorage();
  createSettingsStore({ storage });
  assert.equal(storage.count('setItem'), 0);
  assert.equal(storage.count('removeItem'), 0);
});

test('get: the result is deeply frozen and changing a copy of it leaves the store alone', () => {
  const store = createSettingsStore({ storage: memoryStorage() });
  const settings = store.get();
  assert.ok(Object.isFrozen(settings));
  assert.ok(Object.isFrozen(settings.lastChoice));
  assert.ok(Object.isFrozen(settings.bindings));
  assert.ok(Object.isFrozen(settings.progress));
  assert.throws(() => {
    settings.musicVolume = 0;
  }, TypeError);
  assert.throws(() => {
    settings.lastChoice.difficulty = 'hard';
  }, TypeError);
  const copy = structuredClone(settings);
  copy.musicVolume = 0;
  assert.equal(store.get().musicVolume, 0.35);
});

test('set: the value passed in is copied, not kept', () => {
  const store = createSettingsStore({ storage: memoryStorage() });
  const choice = { campaign: 'megacity', difficulty: 'hard' };
  store.set({ lastChoice: choice });
  assert.notEqual(store.get().lastChoice, choice);
  assert.equal(Object.isFrozen(choice), false);
});

test('load: each invalid musicVolume falls back for that setting only', () => {
  for (const bad of [-0.1, 1.1, 'loud', null, true, [0.5], {}, NaN]) {
    const settings = parseSettings(`{"version":1,"musicVolume":${JSON.stringify(bad) ?? 'null'},"showVersionLabel":false}`);
    assert.equal(settings.musicVolume, 0.35, String(bad));
    assert.equal(settings.showVersionLabel, false);
  }
  assert.equal(parse({ version: 1, musicVolume: 0 }).musicVolume, 0);
  assert.equal(parse({ version: 1, musicVolume: 1 }).musicVolume, 1);
  assert.equal(parse({ version: 1, musicVolume: 0.8 }).musicVolume, 0.8);
  assert.equal(parseSettings('{"version":1,"musicVolume":1e999}').musicVolume, 0.35, 'Infinity');
});

test('load: each invalid showVersionLabel falls back for that setting only', () => {
  for (const bad of [0, 1, 'true', null, [], {}]) {
    const settings = parse({ version: 1, showVersionLabel: bad, musicVolume: 0.5 });
    assert.equal(settings.showVersionLabel, true, JSON.stringify(bad));
    assert.equal(settings.musicVolume, 0.5);
  }
  assert.equal(parse({ version: 1, showVersionLabel: false }).showVersionLabel, false);
});

test('load: bindings are cleaned to known schemes, known actions and valid source lists', () => {
  const settings = parse({
    version: 1,
    musicVolume: 0.5,
    bindings: {
      keyboardMouse: {
        jump: ['key:KeyJ'],
        dash: [],
        melee: ['button:1'], // a gamepad source in the keyboard scheme
        pause: 'key:Escape', // not a list
        notAnAction: ['key:KeyZ'],
        moveLeft: ['key:KeyA', 'nonsense'], // one bad source drops the whole list
      },
      gamepad: { jump: ['button:3', 'axis:1:-'], secondaryFire: ['key:KeyQ'] },
      notAScheme: { jump: ['key:KeyJ'] },
      extra: 1,
    },
  });
  assert.deepEqual(settings.bindings, { keyboardMouse: { jump: ['key:KeyJ'], dash: [] }, gamepad: { jump: ['button:3', 'axis:1:-'] } });
  assert.equal(settings.musicVolume, 0.5);
});

test('load: bindings that are not a plain object give {}; a non-object scheme is dropped', () => {
  for (const bad of [null, 3, 'text', [], [1, 2], true]) {
    assert.deepEqual(parse({ version: 1, bindings: bad }).bindings, {}, JSON.stringify(bad));
  }
  assert.deepEqual(parse({ version: 1, bindings: { gamepad: ['button:1'], keyboardMouse: { jump: ['key:KeyK'] } } }).bindings, {
    keyboardMouse: { jump: ['key:KeyK'] },
  });
});

test('load: a __proto__ key in bindings is ignored', () => {
  const text = '{"version":1,"bindings":{"__proto__":{"jump":["key:KeyZ"]},"keyboardMouse":{"__proto__":["key:KeyZ"],"jump":["key:KeyK"]}}}';
  const settings = parseSettings(text);
  assert.deepEqual(settings.bindings, { keyboardMouse: { jump: ['key:KeyK'] } });
  assert.equal(Object.getPrototypeOf(settings.bindings), Object.prototype);
  assert.equal({}.jump, undefined);
});

test('load: lastChoice fields fall back independently', () => {
  assert.deepEqual(parse({ version: 1, lastChoice: { campaign: 'caverns', difficulty: 'extreme' } }).lastChoice, {
    campaign: 'caverns',
    difficulty: 'extreme',
  });
  assert.deepEqual(parse({ version: 1, lastChoice: { campaign: 3, difficulty: 'hard' } }).lastChoice, { campaign: 'megacity', difficulty: 'hard' });
  assert.deepEqual(parse({ version: 1, lastChoice: { campaign: 'caverns', difficulty: 'impossible' } }).lastChoice, {
    campaign: 'caverns',
    difficulty: 'normal',
  });
  assert.deepEqual(parse({ version: 1, lastChoice: { difficulty: 'easy' } }).lastChoice, { campaign: 'megacity', difficulty: 'easy' });
  for (const bad of [null, 'megacity', [], 7]) {
    assert.deepEqual(parse({ version: 1, lastChoice: bad }).lastChoice, DEFAULTS.lastChoice, JSON.stringify(bad));
  }
  assert.deepEqual(parse({ version: 1, lastChoice: { campaign: 'a', difficulty: 'easy', more: 1 } }).lastChoice, {
    campaign: 'a',
    difficulty: 'easy',
  });
});

test('load: progress is kept exactly as saved (deep copy); anything but a plain object gives {}', () => {
  const progress = { slots: [{ id: 1, level: 'a', flags: { x: true, y: null } }], total: 4.5 };
  const settings = parse({ version: 1, progress });
  assert.deepEqual(settings.progress, progress);
  assert.notEqual(settings.progress, progress);
  for (const bad of [null, 3, 'x', [], [{}]]) assert.deepEqual(parse({ version: 1, progress: bad }).progress, {});
});

test('load: unknown top-level fields are dropped; the result always has the current version', () => {
  const settings = parse({ version: 1, other: 1, musicVolume: 0.2 });
  assert.equal('other' in settings, false);
  assert.equal(settings.version, SETTINGS_VERSION);
  assert.deepEqual(Object.keys(settings), ['version', ...SETTINGS.map((s) => s.name)]);
});

test('load: unparseable JSON, non-object JSON and a missing or invalid version give all defaults', () => {
  const cases = [
    '{not json',
    '',
    'null',
    '3',
    '"text"',
    '[]',
    '[1]',
    '{}',
    '{"musicVolume":0.9}',
    '{"version":0,"musicVolume":0.9}',
    '{"version":-1,"musicVolume":0.9}',
    '{"version":1.5,"musicVolume":0.9}',
    '{"version":"1","musicVolume":0.9}',
    '{"version":null,"musicVolume":0.9}',
  ];
  for (const text of cases) assert.deepEqual(parseSettings(text), DEFAULTS, text);
});

test('version upgrades: version 1 data goes through each step in order', () => {
  const order = [];
  const upgrades = {
    1: (data) => {
      order.push(1);
      assert.equal(data.version, 1);
      return { ...data, version: 2, musicVolume: data.volume ?? data.musicVolume };
    },
    2: (data) => {
      order.push(2);
      assert.equal(data.version, 2);
      return { ...data, version: 3, showVersionLabel: !data.hideLabel };
    },
  };
  const settings = parse({ version: 1, volume: 0.6, hideLabel: true }, { version: 3, upgrades });
  assert.deepEqual(order, [1, 2]);
  assert.equal(settings.musicVolume, 0.6);
  assert.equal(settings.showVersionLabel, false);
  assert.equal(settings.version, 3);
  // Data already at version 2 only runs the second step.
  order.length = 0;
  parse({ version: 2 }, { version: 3, upgrades });
  assert.deepEqual(order, [2]);
});

test('version upgrades: a missing step or a throwing step gives all defaults', () => {
  const data = { version: 1, musicVolume: 0.9 };
  const missing = parse(data, { version: 3, upgrades: { 1: (d) => ({ ...d, version: 2 }) } });
  assert.deepEqual(missing, { ...DEFAULTS, version: 3 });
  const throwing = parse(data, { version: 2, upgrades: { 1: () => { throw new Error('bad'); } } });
  assert.deepEqual(throwing, { ...DEFAULTS, version: 2 });
  const notObject = parse(data, { version: 2, upgrades: { 1: () => 'nope' } });
  assert.deepEqual(notObject, { ...DEFAULTS, version: 2 });
  // The real table has no steps yet and version 1 needs none.
  assert.equal(parse(data).musicVolume, 0.9);
});

test('version upgrades: a version higher than the current one is checked as the current format', () => {
  const settings = parse({ version: 7, musicVolume: 0.1, showVersionLabel: 'yes', newField: 1, lastChoice: { campaign: 'a', difficulty: 'hard' } });
  assert.equal(settings.version, 1);
  assert.equal(settings.musicVolume, 0.1);
  assert.equal(settings.showVersionLabel, true);
  assert.equal('newField' in settings, false);
  assert.deepEqual(settings.lastChoice, { campaign: 'a', difficulty: 'hard' });
});

test('store: saved settings are loaded', () => {
  const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ ...DEFAULTS, musicVolume: 0.2, showVersionLabel: false }) });
  const store = createSettingsStore({ storage });
  assert.equal(store.get().musicVolume, 0.2);
  assert.equal(store.get().showVersionLabel, false);
});

test('legacy bindings: moved into the settings when there are no saved settings', () => {
  const legacy = JSON.stringify({ keyboardMouse: { jump: ['key:KeyJ'] }, gamepad: { jump: ['bad'] }, unknown: {} });
  const storage = memoryStorage({ [LEGACY_BINDINGS_KEY]: legacy });
  const store = createSettingsStore({ storage });
  assert.deepEqual(store.get().bindings, { keyboardMouse: { jump: ['key:KeyJ'] } });
  assert.equal(LEGACY_BINDINGS_KEY in storage.data, false);
  assert.deepEqual(saved(storage), store.get());
  assert.equal(storage.count('setItem'), 1);
});

test('legacy bindings: saved settings win when both exist, and the legacy key is removed', () => {
  const storage = memoryStorage({
    [SETTINGS_KEY]: JSON.stringify({ ...DEFAULTS, bindings: { gamepad: { jump: ['button:5'] } } }),
    [LEGACY_BINDINGS_KEY]: JSON.stringify({ keyboardMouse: { jump: ['key:KeyJ'] } }),
  });
  const store = createSettingsStore({ storage });
  assert.deepEqual(store.get().bindings, { gamepad: { jump: ['button:5'] } });
  assert.equal(LEGACY_BINDINGS_KEY in storage.data, false);
  assert.deepEqual(saved(storage).bindings, { gamepad: { jump: ['button:5'] } });
});

test('legacy bindings: unparseable or non-object legacy data gives {} and is removed', () => {
  for (const legacy of ['{not json', '"text"', '[1]']) {
    const storage = memoryStorage({ [LEGACY_BINDINGS_KEY]: legacy });
    const store = createSettingsStore({ storage });
    assert.deepEqual(store.get(), DEFAULTS, legacy);
    assert.equal(LEGACY_BINDINGS_KEY in storage.data, false);
    assert.deepEqual(saved(storage), DEFAULTS);
  }
});

test('legacy bindings: with no legacy key, nothing is written on creation', () => {
  const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify(DEFAULTS) });
  createSettingsStore({ storage });
  assert.equal(storage.count('setItem'), 0);
  assert.equal(storage.count('removeItem'), 0);
});

test('progress: kept exactly through load, save, set of other settings and reset', () => {
  const progress = { saves: [{ slot: 1, hp: 80 }], campaigns: { megacity: { level: 3 } } };
  const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ ...DEFAULTS, progress }) });
  const store = createSettingsStore({ storage });
  assert.deepEqual(store.get().progress, progress);
  store.set({ musicVolume: 0.9 });
  assert.deepEqual(saved(storage).progress, progress);
  store.set({ progress: { ...progress, extra: true } });
  assert.deepEqual(store.get().progress, { ...progress, extra: true });
  store.reset();
  assert.deepEqual(store.get().progress, { ...progress, extra: true });
  assert.deepEqual(saved(storage).progress, { ...progress, extra: true });
  assert.equal(store.get().musicVolume, 0.35);
});

test('set: invalid values and unknown names are ignored without throwing', () => {
  const storage = memoryStorage();
  const store = createSettingsStore({ storage });
  const changed = store.set({ musicVolume: 5, showVersionLabel: 'no', lastChoice: 3, bindings: 7, progress: [], nope: 1, version: 9 });
  assert.equal(changed, false);
  assert.deepEqual(store.get(), DEFAULTS);
  assert.equal(storage.count('setItem'), 0);
  for (const patch of [null, undefined, 3, 'x', []]) assert.equal(store.set(patch), false);
});

test('set: a bindings value that is not a plain object does not clear the saved bindings', () => {
  const store = createSettingsStore({ storage: memoryStorage() });
  store.set({ bindings: { gamepad: { jump: ['button:2'] } } });
  assert.equal(store.set({ bindings: 7 }), false);
  assert.deepEqual(store.get().bindings, { gamepad: { jump: ['button:2'] } });
  const patch = JSON.parse('{"__proto__":{"musicVolume":0.9},"showVersionLabel":false}');
  assert.equal(store.set(patch), true);
  assert.equal(store.get().musicVolume, 0.35);
  assert.equal(store.get().showVersionLabel, false);
});

test('set: valid values apply even when others in the patch are invalid', () => {
  const store = createSettingsStore({ storage: memoryStorage() });
  assert.equal(store.set({ musicVolume: 0.5, showVersionLabel: 'no' }), true);
  assert.equal(store.get().musicVolume, 0.5);
  assert.equal(store.get().showVersionLabel, true);
});

test('set: no change means no save and no notification; a change means one of each', () => {
  const storage = memoryStorage();
  const store = createSettingsStore({ storage });
  const seen = [];
  store.subscribe((s) => seen.push(s));
  store.set({ musicVolume: 0.35 });
  store.set({ lastChoice: { campaign: 'megacity', difficulty: 'normal' } });
  store.set({});
  assert.equal(storage.count('setItem'), 0);
  assert.equal(seen.length, 0);
  store.set({ musicVolume: 0.5, showVersionLabel: false });
  assert.equal(storage.count('setItem'), 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].musicVolume, 0.5);
  assert.equal(seen[0], store.get());
  assert.deepEqual(saved(storage), store.get());
  store.set({ musicVolume: 0.5 });
  assert.equal(storage.count('setItem'), 1);
  assert.equal(seen.length, 1);
});

test('set: lastChoice and bindings are cleaned like a load', () => {
  const store = createSettingsStore({ storage: memoryStorage() });
  store.set({ lastChoice: { campaign: 'caverns', difficulty: 'bad' }, bindings: { gamepad: { jump: ['button:2'], bad: [] } } });
  assert.deepEqual(store.get().lastChoice, { campaign: 'caverns', difficulty: 'normal' });
  assert.deepEqual(store.get().bindings, { gamepad: { jump: ['button:2'] } });
});

test('subscribe: unsubscribe stops notifications; others keep receiving them', () => {
  const store = createSettingsStore({ storage: memoryStorage() });
  const a = [];
  const b = [];
  const stopA = store.subscribe((s) => a.push(s.musicVolume));
  store.subscribe((s) => b.push(s.musicVolume));
  store.set({ musicVolume: 0.1 });
  stopA();
  store.set({ musicVolume: 0.2 });
  assert.deepEqual(a, [0.1]);
  assert.deepEqual(b, [0.1, 0.2]);
});

test('reset: defaults for every setting but progress; saves and notifies only when something changed', () => {
  const storage = memoryStorage();
  const store = createSettingsStore({ storage });
  let notified = 0;
  store.subscribe(() => notified++);
  assert.equal(store.reset(), false);
  assert.equal(storage.count('setItem'), 0);
  assert.equal(notified, 0);
  store.set({ musicVolume: 0.9, showVersionLabel: false, lastChoice: { campaign: 'x', difficulty: 'hard' }, bindings: { gamepad: { jump: [] } } });
  assert.equal(notified, 1);
  assert.equal(store.reset(), true);
  assert.equal(notified, 2);
  assert.equal(storage.count('setItem'), 2);
  assert.deepEqual(store.get(), DEFAULTS);
  assert.deepEqual(saved(storage), DEFAULTS);
});

test('saved settings load back into a new store unchanged', () => {
  const storage = memoryStorage();
  const first = createSettingsStore({ storage });
  first.set({ musicVolume: 0.7, lastChoice: { campaign: 'megacity', difficulty: 'extreme' }, bindings: { keyboardMouse: { jump: ['key:KeyJ'] } } });
  const second = createSettingsStore({ storage });
  assert.deepEqual(second.get(), first.get());
});

// Blocked storage: the store works in memory and prints nothing.
function silenceConsole(t) {
  const output = [];
  for (const method of ['error', 'warn', 'log', 'info', 'debug']) t.mock.method(console, method, (...args) => output.push([method, args]));
  return output;
}

function exercise(store) {
  const seen = [];
  store.subscribe((s) => seen.push(s));
  assert.deepEqual(store.get(), DEFAULTS);
  assert.equal(store.set({ musicVolume: 0.5 }), true);
  assert.equal(store.get().musicVolume, 0.5);
  assert.equal(store.set({ musicVolume: 0.5 }), false);
  assert.equal(store.reset(), true);
  assert.deepEqual(store.get(), DEFAULTS);
  assert.equal(seen.length, 2);
}

test('blocked storage: storage null works in memory with no console output', (t) => {
  const output = silenceConsole(t);
  exercise(createSettingsStore({ storage: null }));
  exercise(createSettingsStore());
  assert.deepEqual(output, []);
});

test('blocked storage: a storage whose every method throws works in memory with no console output', (t) => {
  const output = silenceConsole(t);
  const deny = () => {
    throw new Error('denied');
  };
  exercise(createSettingsStore({ storage: { getItem: deny, setItem: deny, removeItem: deny } }));
  assert.deepEqual(output, []);
});

test('blocked storage: legacy bindings with a throwing removeItem or setItem do not throw', (t) => {
  const output = silenceConsole(t);
  const storage = memoryStorage({ [LEGACY_BINDINGS_KEY]: '{"gamepad":{"jump":["button:3"]}}' });
  storage.removeItem = () => {
    throw new Error('denied');
  };
  storage.setItem = () => {
    throw new Error('denied');
  };
  const store = createSettingsStore({ storage });
  assert.deepEqual(store.get().bindings, { gamepad: { jump: ['button:3'] } });
  assert.deepEqual(output, []);
});

test('browserStorage: the window\'s localStorage, or null when reading it throws or it is missing', () => {
  const storage = memoryStorage();
  assert.equal(browserStorage({ localStorage: storage }), storage);
  assert.equal(
    browserStorage({
      get localStorage() {
        throw new Error('SecurityError');
      },
    }),
    null,
  );
  assert.equal(browserStorage({}), null);
  assert.equal(browserStorage({ localStorage: null }), null);
  assert.equal(browserStorage(undefined), null);
});
