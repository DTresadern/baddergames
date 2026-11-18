// The settings store: the only code that reads or writes localStorage. One versioned JSON
// object under one key, each setting checked on its own. Format, load rules, upgrades and how
// to add a setting: see berserker7/AGENTS.md, Settings and session.
// Pure apart from the storage object it is given, so Node tests cover it.

import { MUSIC_VOLUME } from '../audio/music.js';
import { CAMPAIGNS, DEFAULT_DIFFICULTY, DIFFICULTIES } from '../data/campaigns.js';
import { ACTIONS, SCHEMES, deepFreeze } from '../input/actions.js';
import { isPlainObject, isValidSource } from '../input/bindings.js';

export const SETTINGS_KEY = 'b7.settings';
export const LEGACY_BINDINGS_KEY = 'b7.bindings'; // the format before the store: bindings overrides only
export const SETTINGS_VERSION = 1;

// UPGRADES[n](data) turns version n data into version n + 1 data. Version 1 is the first format.
export const UPGRADES = {};

const INVALID = Symbol('invalid');

// A copy through JSON, or INVALID when the value cannot be saved as JSON.
function jsonCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return INVALID;
  }
}

function checkBindings(value) {
  if (!isPlainObject(value)) return INVALID; // the default is {}
  const cleaned = {};
  for (const scheme of SCHEMES) {
    if (!Object.hasOwn(value, scheme) || !isPlainObject(value[scheme])) continue;
    for (const action of ACTIONS) {
      if (!Object.hasOwn(value[scheme], action)) continue;
      const list = value[scheme][action];
      if (!Array.isArray(list) || !list.every((source) => isValidSource(scheme, source))) continue;
      cleaned[scheme] ??= {};
      cleaned[scheme][action] = [...list];
    }
  }
  return cleaned;
}

const defaultLastChoice = () => ({ campaign: CAMPAIGNS[0].id, difficulty: DEFAULT_DIFFICULTY });

function checkLastChoice(value) {
  if (!isPlainObject(value)) return INVALID;
  const defaults = defaultLastChoice();
  const campaign = Object.hasOwn(value, 'campaign') && typeof value.campaign === 'string' ? value.campaign : defaults.campaign;
  const difficulty =
    Object.hasOwn(value, 'difficulty') && DIFFICULTIES.includes(value.difficulty) ? value.difficulty : defaults.difficulty;
  return { campaign, difficulty };
}

// One entry per setting: its name, a function giving a fresh default, and a check that returns
// the cleaned value or INVALID (the setting then takes its default). To add a setting, add an entry.
export const SETTINGS = Object.freeze([
  {
    name: 'musicVolume',
    default: () => MUSIC_VOLUME,
    check: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : INVALID),
  },
  {
    name: 'showVersionLabel',
    default: () => true,
    check: (v) => (typeof v === 'boolean' ? v : INVALID),
  },
  { name: 'bindings', default: () => ({}), check: checkBindings },
  { name: 'lastChoice', default: defaultLastChoice, check: checkLastChoice },
  // Reserved for saved games and campaign progress; nothing uses it yet. Not a setting: reset() keeps it.
  { name: 'progress', default: () => ({}), check: (v) => (isPlainObject(v) ? jsonCopy(v) : INVALID) },
]);

const BY_NAME = new Map(SETTINGS.map((setting) => [setting.name, setting]));

export function defaultSettings() {
  const settings = { version: SETTINGS_VERSION };
  for (const setting of SETTINGS) settings[setting.name] = setting.default();
  return settings;
}

// Checks each setting of `data` on its own; an invalid or missing one takes its default.
function cleanSettings(data, version) {
  const settings = { version };
  for (const setting of SETTINGS) {
    const value = Object.hasOwn(data, setting.name) ? setting.check(data[setting.name]) : INVALID;
    settings[setting.name] = value === INVALID ? setting.default() : value;
  }
  return settings;
}

// Saved text (or null) to a complete, cleaned settings object. Never throws.
// `version` and `upgrades` are injectable for tests; the result has that version.
export function parseSettings(text, { version = SETTINGS_VERSION, upgrades = UPGRADES } = {}) {
  const fallback = () => ({ ...defaultSettings(), version });
  let data;
  try {
    data = text == null ? null : JSON.parse(text);
  } catch {
    return fallback();
  }
  if (!isPlainObject(data) || !Number.isInteger(data.version) || data.version < 1) return fallback();
  // A higher version (saved by a newer build) is checked as the current format, best effort.
  for (let from = data.version; from < version; from++) {
    if (!Object.hasOwn(upgrades, from) || typeof upgrades[from] !== 'function') return fallback();
    try {
      data = upgrades[from](data);
    } catch {
      return fallback();
    }
    if (!isPlainObject(data)) return fallback();
  }
  return cleanSettings(data, version);
}

// Reads the browser's localStorage. Reading window.localStorage can itself throw (storage
// blocked); null then.
export function browserStorage(win) {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

// `storage` is { getItem, setItem, removeItem } or null. Any storage failure leaves the game
// working in memory, with nothing saved and no console output.
export function createSettingsStore({ storage = null } = {}) {
  const attempt = (fn) => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const read = (key) => (storage ? attempt(() => storage.getItem(key)) ?? null : null);
  const save = () => {
    if (storage) attempt(() => storage.setItem(SETTINGS_KEY, JSON.stringify(current)));
  };

  const saved = read(SETTINGS_KEY);
  let current = deepFreeze(parseSettings(saved));

  // One-time move of the old bindings key into the settings.
  const legacy = read(LEGACY_BINDINGS_KEY);
  if (legacy !== null) {
    if (saved === null) {
      let bindings = {};
      try {
        const cleaned = checkBindings(JSON.parse(legacy));
        if (cleaned !== INVALID) bindings = cleaned;
      } catch {
        // unparseable: no overrides
      }
      current = deepFreeze({ ...current, bindings });
    }
    attempt(() => storage.removeItem(LEGACY_BINDINGS_KEY));
    save();
  }

  const subscribers = new Set();

  // Replaces the settings with `next`; saves and notifies once, only when something changed.
  function commit(next) {
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    current = deepFreeze(next);
    save();
    for (const fn of [...subscribers]) fn(current);
    return true;
  }

  return {
    // Deeply frozen and replaced (never changed) by each change, so callers cannot change the store.
    get: () => current,
    // Applies the valid values of `patch` (a partial object of setting names); ignores the rest.
    // Returns true when something changed.
    set(patch) {
      if (!isPlainObject(patch)) return false;
      const next = { ...current };
      for (const name of Object.keys(patch)) {
        const setting = BY_NAME.get(name);
        if (!setting) continue;
        const value = setting.check(patch[name]);
        if (value !== INVALID) next[name] = value;
      }
      return commit(next);
    },
    // Every setting back to its default, except `progress`, which is kept.
    reset() {
      return commit({ ...defaultSettings(), progress: current.progress });
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
