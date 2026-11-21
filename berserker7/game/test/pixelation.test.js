import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIXELATION_DEFAULT, PIXELATION_MODES, createPixelation, pixelationFactor } from '../src/scenes/pixelation.js';
import { createViewMode } from '../src/scenes/sandbox-3d.js';

test('pixelation factors: off 1, half 2, quarter 4, anything else 1', () => {
  assert.deepEqual(PIXELATION_MODES, ['off', 'half', 'quarter']);
  assert.equal(PIXELATION_DEFAULT, 'off');
  assert.equal(pixelationFactor('off'), 1);
  assert.equal(pixelationFactor('half'), 2);
  assert.equal(pixelationFactor('quarter'), 4);
  for (const bad of ['eighth', 'constructor', 'toString', undefined, null, 2]) assert.equal(pixelationFactor(bad), 1);
});

function fakeRenderer(ratio) {
  const calls = [];
  return { calls, domElement: { style: { imageRendering: '' } }, setPixelRatio: (r) => calls.push(r), getPixelRatio: () => calls.at(-1) ?? ratio };
}

test('createPixelation divides the base ratio and sets pixelated, and restores both at factor 1', () => {
  const renderer = fakeRenderer(2);
  const pixelation = createPixelation({ renderer, baseRatio: 2 });
  pixelation.apply(1);
  assert.deepEqual(renderer.calls, [], 'factor 1 at start changes nothing');
  pixelation.apply(2);
  assert.deepEqual(renderer.calls, [1]);
  assert.equal(renderer.domElement.style.imageRendering, 'pixelated');
  pixelation.apply(2);
  assert.deepEqual(renderer.calls, [1], 'no change, no call');
  pixelation.apply(4);
  assert.deepEqual(renderer.calls, [1, 0.5]);
  assert.equal(pixelation.factor(), 4);
  pixelation.apply(1);
  assert.deepEqual(renderer.calls, [1, 0.5, 2]);
  assert.equal(renderer.domElement.style.imageRendering, '');
});

test('view mode holder: pixelation off by default, ignores unknown modes', () => {
  const viewMode = createViewMode();
  assert.equal(viewMode.pixelation(), 'off');
  assert.equal(viewMode.setPixelation('quarter'), 'quarter');
  assert.equal(viewMode.setPixelation('eighth'), 'quarter');
  assert.equal(viewMode.setPixelation('half'), 'half');
  assert.equal(viewMode.pixelation(), 'half');
});
