import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawOrder, readSettings, setLife, shouldDraw, shouldTick } from '../src/engine/scene.js';

const rec = (life, settings = {}) => ({ id: 'x', life, settings: readSettings({ settings }) });

test('legal lifecycle path', () => {
  const r = { id: 'x', life: 'unloaded' };
  for (const next of ['loading', 'ready', 'active', 'suspended', 'active', 'unloaded', 'loading', 'ready', 'unloaded']) {
    setLife(r, next);
    assert.equal(r.life, next);
  }
  for (const from of ['ready', 'active', 'suspended']) {
    const r2 = { id: 'x', life: from };
    setLife(r2, 'unloaded');
    assert.equal(r2.life, 'unloaded');
  }
});

test('illegal lifecycle changes throw', () => {
  const illegal = [
    ['unloaded', 'active'],
    ['unloaded', 'ready'],
    ['loading', 'active'],
    ['ready', 'suspended'],
    ['active', 'ready'],
    ['active', 'loading'],
    ['suspended', 'loading'],
    ['active', 'bogus'],
  ];
  for (const [from, to] of illegal) {
    assert.throws(() => setLife({ id: 'x', life: from }, to), /illegal lifecycle change/, `${from} -> ${to}`);
  }
});

test('settings: defaults, and invalid values throw', () => {
  assert.deepEqual({ ...readSettings({}) }, { tick: 'uncovered', drawCovered: true, leave: 'suspend' });
  assert.equal(readSettings({ settings: { leave: 'snapshot' } }).leave, 'snapshot');
  assert.throws(() => readSettings({ settings: { tick: 'sometimes' } }), /tick/);
  assert.throws(() => readSettings({ settings: { leave: 'vanish' } }), /leave/);
  assert.throws(() => readSettings({ settings: { drawCovered: 'yes' } }), /drawCovered/);
});

test('coverage: background under main and overlays, main under overlays, overlays under higher overlays', () => {
  const layers = { background: ['bg'], main: 'm', overlays: ['o1', 'o2'] };
  assert.deepEqual(drawOrder(layers, 'm'), [
    { id: 'bg', layer: 'background', covered: true },
    { id: 'm', layer: 'main', covered: true },
    { id: 'o1', layer: 'overlay', covered: true },
    { id: 'o2', layer: 'overlay', covered: false },
  ]);
  assert.deepEqual(drawOrder({ background: ['bg'], main: null, overlays: [] }, null), [
    { id: 'bg', layer: 'background', covered: false },
  ]);
  assert.deepEqual(drawOrder({ background: [], main: 'm', overlays: [] }, 'm'), [
    { id: 'm', layer: 'main', covered: false },
  ]);
});

test('tick settings: always, uncovered, never', () => {
  for (const covered of [false, true]) {
    assert.equal(shouldTick(rec('active', { tick: 'always' }), 'background', covered, 'local'), true);
    assert.equal(shouldTick(rec('active', { tick: 'never' }), 'background', covered, 'local'), false);
    assert.equal(shouldTick(rec('active', { tick: 'uncovered' }), 'background', covered, 'local'), !covered);
  }
});

test('local pause stops the main scene; online pause does not', () => {
  const main = rec('active', { tick: 'uncovered' });
  assert.equal(shouldTick(main, 'main', true, 'local'), false);
  assert.equal(shouldTick(main, 'main', true, 'online'), true);
  // the online rule is for the main layer only
  assert.equal(shouldTick(main, 'overlay', true, 'online'), false);
  assert.equal(shouldTick(main, 'background', true, 'online'), false);
});

test('only active scenes tick or draw', () => {
  for (const life of ['unloaded', 'loading', 'ready', 'suspended']) {
    assert.equal(shouldTick(rec(life, { tick: 'always' }), 'main', false, 'local'), false);
    assert.equal(shouldDraw(rec(life), false), false);
  }
});

test('drawCovered', () => {
  assert.equal(shouldDraw(rec('active', { drawCovered: true }), true), true);
  assert.equal(shouldDraw(rec('active', { drawCovered: false }), true), false);
  assert.equal(shouldDraw(rec('active', { drawCovered: false }), false), true);
});
