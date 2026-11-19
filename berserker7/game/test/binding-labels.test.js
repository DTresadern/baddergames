import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBindings } from '../src/input/bindings.js';
import { createInput, PLAYER_DEVICES } from '../src/input/sampler.js';
import { primaryLabel, schemeFor, sourceLabel } from '../src/debug/binding-labels.js';

test('sourceLabel: keyboard', () => {
  assert.equal(sourceLabel('key:KeyA'), 'A');
  assert.equal(sourceLabel('key:Space'), 'Space');
  assert.equal(sourceLabel('key:Digit1'), '1');
  assert.equal(sourceLabel('key:ShiftLeft'), 'L-Shift');
  assert.equal(sourceLabel('key:ControlRight'), 'R-Ctrl');
  assert.equal(sourceLabel('key:ArrowLeft'), '←');
  assert.equal(sourceLabel('key:ArrowDown'), '↓');
  assert.equal(sourceLabel('key:Escape'), 'Esc');
  assert.equal(sourceLabel('key:Numpad5'), 'Num 5');
  assert.equal(sourceLabel('key:F1'), 'F1');
  assert.equal(sourceLabel('key:Semicolon'), 'Semicolon');
});

test('sourceLabel: mouse and wheel', () => {
  assert.equal(sourceLabel('mouse:0'), 'LMB');
  assert.equal(sourceLabel('mouse:2'), 'RMB');
  assert.equal(sourceLabel('mouse:4'), 'Mouse 5');
  assert.equal(sourceLabel('wheel:+'), 'Wheel ↓');
  assert.equal(sourceLabel('wheel:-'), 'Wheel ↑');
});

test('sourceLabel: gamepad buttons and axes', () => {
  assert.equal(sourceLabel('button:0'), 'A');
  assert.equal(sourceLabel('button:7'), 'RT');
  assert.equal(sourceLabel('button:12'), 'D-pad ↑');
  assert.equal(sourceLabel('button:20'), 'Button 20');
  assert.equal(sourceLabel('axis:0:-'), 'L-stick ←');
  assert.equal(sourceLabel('axis:1:+'), 'L-stick ↓');
  assert.equal(sourceLabel('axis:2:+'), 'R-stick →');
  assert.equal(sourceLabel('axis:5:-'), 'Axis 5−');
});

test('sourceLabel: invalid strings give null', () => {
  for (const bad of ['', 'nope', 'key:', 'mouse:9', 'wheel:x', 'button:x', 'axis:0', 'axis:0:*', null, 5]) {
    assert.equal(sourceLabel(bad), null, String(bad));
  }
});

test('primaryLabel: default bindings', () => {
  const table = resolveBindings({});
  assert.equal(primaryLabel(table, 'keyboardMouse', 'moveLeft'), 'A');
  assert.equal(primaryLabel(table, 'keyboardMouse', 'jump'), 'Space');
  assert.equal(primaryLabel(table, 'keyboardMouse', 'primaryFire'), 'LMB');
  assert.equal(primaryLabel(table, 'keyboardMouse', 'nextWeapon'), 'Wheel ↓');
  assert.equal(primaryLabel(table, 'gamepad', 'moveLeft'), 'L-stick ←');
  assert.equal(primaryLabel(table, 'gamepad', 'jump'), 'A');
  assert.equal(primaryLabel(table, 'gamepad', 'primaryFire'), 'RT');
  assert.equal(primaryLabel(table, 'gamepad', 'weapon1'), null);
  assert.equal(primaryLabel(table, 'gamepad', 'noSuchAction'), null);
});

test('primaryLabel: saved override replaces the default', () => {
  const table = resolveBindings({ keyboardMouse: { jump: ['key:KeyK'] } });
  assert.equal(primaryLabel(table, 'keyboardMouse', 'jump'), 'K');
});

test('schemeFor: player devices', () => {
  assert.equal(schemeFor(PLAYER_DEVICES[0]), 'keyboardMouse');
  assert.equal(schemeFor(PLAYER_DEVICES[1]), 'gamepad');
});

test('createInput keeps the bindings table it was given', () => {
  const table = resolveBindings({});
  assert.equal(createInput({ bindings: table }).bindings, table);
});
