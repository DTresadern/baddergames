import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, DEFAULT_BINDINGS, SCHEMES } from '../src/input/actions.js';
import { isValidSource, parseSource, resolveBindings } from '../src/input/bindings.js';

const DEFAULTS_JSON = JSON.stringify(DEFAULT_BINDINGS);

test('bindings: every action has a binding list in both schemes, and the table is deeply frozen', () => {
  for (const scheme of SCHEMES) {
    assert.deepEqual(Object.keys(DEFAULT_BINDINGS[scheme]), ACTIONS);
    for (const action of ACTIONS) {
      assert.ok(Array.isArray(DEFAULT_BINDINGS[scheme][action]));
      for (const source of DEFAULT_BINDINGS[scheme][action]) assert.ok(isValidSource(scheme, source), source);
      assert.ok(Object.isFrozen(DEFAULT_BINDINGS[scheme][action]));
    }
    assert.ok(Object.isFrozen(DEFAULT_BINDINGS[scheme]));
  }
  assert.ok(Object.isFrozen(DEFAULT_BINDINGS));
  assert.equal(ACTIONS.length, 23);
});

test('bindings: no saved overrides gives the defaults', () => {
  for (const saved of [undefined, null, 3, 'text', [], [1, 2]]) {
    assert.deepEqual(resolveBindings(saved), DEFAULT_BINDINGS);
  }
});

test('bindings: a valid override replaces one action; an empty list unbinds it', () => {
  const table = resolveBindings({ keyboardMouse: { jump: ['key:KeyK', 'mouse:1'], melee: [] } });
  assert.deepEqual(table.keyboardMouse.jump, ['key:KeyK', 'mouse:1']);
  assert.deepEqual(table.keyboardMouse.melee, []);
  assert.deepEqual(table.keyboardMouse.dash, DEFAULT_BINDINGS.keyboardMouse.dash);
  assert.deepEqual(table.gamepad, DEFAULT_BINDINGS.gamepad);
  assert.equal(JSON.stringify(DEFAULT_BINDINGS), DEFAULTS_JSON);
});

test('bindings: an invalid override value falls back for that action only', () => {
  const table = resolveBindings({
    keyboardMouse: {
      jump: 'key:KeyK', // not an array
      melee: ['key:KeyK', 7], // not all strings
      dash: ['button:3'], // gamepad source in the keyboard scheme
      interact: ['key:KeyF'], // valid
      noSuchAction: ['key:KeyZ'],
    },
    gamepad: {
      jump: ['button:32'], // index out of range
      melee: ['axis:8:+'], // axis out of range
      dash: ['axis:1'], // no sign
      interact: ['button:10', 'axis:3:-'], // valid
    },
    noSuchScheme: { jump: ['key:KeyZ'] },
  });
  for (const action of ['jump', 'melee', 'dash']) {
    assert.deepEqual(table.keyboardMouse[action], DEFAULT_BINDINGS.keyboardMouse[action], action);
    assert.deepEqual(table.gamepad[action], DEFAULT_BINDINGS.gamepad[action], action);
  }
  assert.deepEqual(table.keyboardMouse.interact, ['key:KeyF']);
  assert.deepEqual(table.gamepad.interact, ['button:10', 'axis:3:-']);
  assert.equal(Object.hasOwn(table.keyboardMouse, 'noSuchAction'), false);
  assert.equal(Object.hasOwn(table, 'noSuchScheme'), false);
});

test('bindings: source string formats', () => {
  const valid = [
    ['keyboardMouse', 'key:Space'], ['keyboardMouse', 'key:Digit9'], ['keyboardMouse', 'mouse:0'],
    ['keyboardMouse', 'mouse:4'], ['keyboardMouse', 'wheel:+'], ['keyboardMouse', 'wheel:-'],
    ['gamepad', 'button:0'], ['gamepad', 'button:31'], ['gamepad', 'axis:0:-'], ['gamepad', 'axis:7:+'],
  ];
  const invalid = [
    ['keyboardMouse', 'key:'], ['keyboardMouse', 'mouse:5'], ['keyboardMouse', 'wheel:up'],
    ['keyboardMouse', 'button:0'], ['gamepad', 'button:-1'], ['gamepad', 'button:1.5'],
    ['gamepad', 'button:01x'], ['gamepad', 'axis:2:'], ['gamepad', 'key:Space'], ['nope', 'key:Space'],
  ];
  for (const [scheme, source] of valid) assert.ok(isValidSource(scheme, source), source);
  for (const [scheme, source] of invalid) assert.equal(isValidSource(scheme, source), false, source);
});

test('bindings: a __proto__ key in the overrides is ignored', () => {
  const saved = JSON.parse('{"__proto__": {"jump": ["key:KeyZ"]}, "keyboardMouse": {"__proto__": ["key:KeyZ"]}}');
  assert.deepEqual(resolveBindings(saved), DEFAULT_BINDINGS);
  assert.equal(JSON.stringify(DEFAULT_BINDINGS), DEFAULTS_JSON);
});

test('bindings: the resolved table is a copy; changing it is impossible and leaves the defaults alone', () => {
  const table = resolveBindings({ keyboardMouse: { jump: ['key:KeyK'] } });
  assert.notEqual(table.keyboardMouse.dash, DEFAULT_BINDINGS.keyboardMouse.dash);
  assert.throws(() => table.keyboardMouse.dash.push('key:KeyZ'), TypeError);
  assert.throws(() => DEFAULT_BINDINGS.keyboardMouse.jump.push('key:KeyZ'), TypeError);
  assert.equal(JSON.stringify(DEFAULT_BINDINGS), DEFAULTS_JSON);
});

test('bindings: parseSource gives the parsed form, or null when the source is not valid for the scheme', () => {
  assert.deepEqual(parseSource('keyboardMouse', 'key:KeyA'), { kind: 'latch', source: 'key:KeyA' });
  assert.deepEqual(parseSource('keyboardMouse', 'wheel:-'), { kind: 'latch', source: 'wheel:-' });
  assert.deepEqual(parseSource('gamepad', 'button:31'), { kind: 'button', index: 31 });
  assert.deepEqual(parseSource('gamepad', 'axis:3:-'), { kind: 'axis', index: 3, sign: -1 });
  assert.deepEqual(parseSource('gamepad', 'axis:0:+'), { kind: 'axis', index: 0, sign: 1 });
  assert.equal(parseSource('gamepad', 'button:32'), null);
  assert.equal(parseSource('keyboardMouse', 'button:1'), null);
  assert.equal(parseSource('gamepad', 42), null);
});
