// Bindings: the default table with the player's saved overrides applied.
//
// Override shape (saved as JSON under STORAGE_KEY): the same as DEFAULT_BINDINGS but
// partial, { keyboardMouse?: { [action]: string[] }, gamepad?: { [action]: string[] } }.
// Unknown schemes and actions are ignored. An override value that is not an array of
// valid source strings for its scheme leaves that action on its default. An empty
// array is valid and unbinds the action.

import { ACTIONS, DEFAULT_BINDINGS, SCHEMES, deepFreeze } from './actions.js';

export const STORAGE_KEY = 'b7.bindings';

// Source string formats per scheme (see actions.js).
const SOURCE_PATTERNS = {
  keyboardMouse: [/^key:[A-Za-z0-9]+$/, /^mouse:[0-4]$/, /^wheel:[+-]$/],
  gamepad: [/^button:([0-9]|[12][0-9]|3[01])$/, /^axis:[0-7]:[+-]$/],
};

export function isValidSource(scheme, source) {
  return typeof source === 'string' && (SOURCE_PATTERNS[scheme] ?? []).some((pattern) => pattern.test(source));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validOverride(scheme, value) {
  return Array.isArray(value) && value.every((source) => isValidSource(scheme, source));
}

// A full, frozen table (both schemes, every action): defaults with valid overrides applied.
export function resolveBindings(saved) {
  const overrides = isPlainObject(saved) ? saved : {};
  const table = {};
  for (const scheme of SCHEMES) {
    const schemeOverrides = Object.hasOwn(overrides, scheme) && isPlainObject(overrides[scheme]) ? overrides[scheme] : {};
    table[scheme] = {};
    for (const action of ACTIONS) {
      const value = Object.hasOwn(schemeOverrides, action) ? schemeOverrides[action] : undefined;
      table[scheme][action] = validOverride(scheme, value) ? [...value] : [...DEFAULT_BINDINGS[scheme][action]];
    }
  }
  return deepFreeze(table);
}

// Reads the saved overrides from a storage object (localStorage in the browser).
// Missing storage, missing key, unparseable JSON or a throwing storage give the defaults.
export function loadBindings(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return resolveBindings(text == null ? null : JSON.parse(text));
  } catch {
    return resolveBindings(null);
  }
}

// Writes the overrides. Returns false when the storage is missing or throws.
export function saveBindings(storage, overrides) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    return true;
  } catch {
    return false;
  }
}
