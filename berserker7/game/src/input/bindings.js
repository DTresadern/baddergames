// Bindings: the default table with the player's saved overrides applied, and the source
// string parser. Override shape and fallback rules: see berserker7/AGENTS.md, Input.

import { ACTIONS, DEFAULT_BINDINGS, SCHEMES, deepFreeze } from './actions.js';

export const STORAGE_KEY = 'b7.bindings';

// Source string formats per scheme (see actions.js), bounded: mouse 0-4, button 0-31, axis 0-7.
const KEYBOARD_MOUSE_SOURCE = /^(?:key:[A-Za-z0-9]+|mouse:[0-4]|wheel:[+-])$/;
const BUTTON_SOURCE = /^button:([0-9]|[12][0-9]|3[01])$/;
const AXIS_SOURCE = /^axis:([0-7]):([+-])$/;

// Parses one source string for a scheme. Returns null when it is not valid there, else
// { kind: 'latch', source } (keyboard, mouse, wheel), { kind: 'button', index } or
// { kind: 'axis', index, sign } (sign 1 or -1).
export function parseSource(scheme, source) {
  if (typeof source !== 'string') return null;
  if (scheme === 'keyboardMouse') return KEYBOARD_MOUSE_SOURCE.test(source) ? { kind: 'latch', source } : null;
  if (scheme !== 'gamepad') return null;
  let m = BUTTON_SOURCE.exec(source);
  if (m) return { kind: 'button', index: Number(m[1]) };
  m = AXIS_SOURCE.exec(source);
  if (m) return { kind: 'axis', index: Number(m[1]), sign: m[2] === '+' ? 1 : -1 };
  return null;
}

export function isValidSource(scheme, source) {
  return parseSource(scheme, source) !== null;
}

export function isPlainObject(value) {
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
