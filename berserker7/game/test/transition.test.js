import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceTransition,
  createTransition,
  markSwapped,
  swapDue,
  transitionAlpha,
  transitionDone,
} from '../src/engine/transition.js';
import { deferred, harnessWith, settle } from './fakes.js';

test('alpha rises over the first half and falls over the second', () => {
  const tr = createTransition({ duration: 1, to: 'b' });
  const at = (t) => transitionAlpha({ ...tr, t });
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(at), [0, 0.5, 1, 0.5, 0]);
  assert.equal(at(1.5), 0);
});

test('swap is due once, at the midpoint; done after the full duration', () => {
  let tr = createTransition({ duration: 1, to: 'b' });
  tr = advanceTransition(tr, 0.4);
  assert.equal(swapDue(tr), false);
  tr = advanceTransition(tr, 0.2);
  assert.equal(swapDue(tr), true);
  tr = markSwapped(tr);
  assert.equal(swapDue(tr), false);
  assert.equal(transitionDone(tr), false);
  tr = advanceTransition(tr, 0.4);
  assert.equal(transitionDone(tr), true);
});

test('hold keeps the fade at the midpoint (black)', () => {
  let tr = markSwapped({ ...createTransition({ duration: 1, to: 'b' }), t: 0.5 });
  tr = advanceTransition(tr, 0.3, true);
  assert.equal(tr.t, 0.5);
  assert.equal(transitionAlpha(tr), 1);
});

test('a new fade starts at the darkness of the one it replaces', () => {
  const tr = createTransition({ duration: 2, to: 'c', fromAlpha: 0.5 });
  assert.equal(transitionAlpha(tr), 0.5);
});

test('harness swaps at the end of the frame that reaches the midpoint', async () => {
  const alphas = [];
  const { harness, log } = harnessWith([['a'], ['b']], { drawTransition: (alpha) => alphas.push(alpha) });
  harness.setMain('a');
  harness.preload('b');
  await settle(harness);
  log.length = 0;
  harness.setMain('b', { fade: 1 });
  harness.frame(0.125); // request applied; fade starts at t = 0.125
  const mainAfter = [];
  for (let i = 0; i < 6; i++) {
    harness.frame(0.125);
    mainAfter.push(harness.layers.main);
  }
  // t after each frame: 0.25, 0.375, 0.5 (swap), 0.625, 0.75, 0.875
  assert.deepEqual(mainAfter, ['a', 'a', 'b', 'b', 'b', 'b']);
  // the swap frame still drew a
  const draws = log.filter((e) => e.endsWith('.draw'));
  assert.deepEqual(draws, ['a.draw', 'a.draw', 'a.draw', 'a.draw', 'b.draw', 'b.draw', 'b.draw']);
  harness.frame(0.125); // t = 1: done
  assert.equal(harness.transition, null);
  assert.deepEqual(alphas, [0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]);
  harness.frame(0.125);
  assert.equal(alphas.length, 7);
});

test('fade stays black at the midpoint until the incoming scene has loaded', async () => {
  const gate = deferred();
  const alphas = [];
  const { harness } = harnessWith([['a'], ['b', {}, { load: () => gate.promise }]], {
    drawTransition: (alpha) => alphas.push(alpha),
  });
  harness.setMain('a');
  await settle(harness);
  harness.setMain('b', { fade: 1 });
  for (let i = 0; i < 5; i++) harness.frame(0.125); // swap at the end of the 5th frame
  assert.equal(harness.layers.main, 'b');
  assert.equal(harness.records.get('b').life, 'loading');
  for (let i = 0; i < 4; i++) harness.frame(0.125);
  assert.deepEqual(alphas.slice(-4), [1, 1, 1, 1]);
  assert.equal(harness.transition.t, 0.5);

  gate.resolve();
  await harness.records.get('b').loaded;
  harness.frame(0.125); // b activated at the end of this frame; fade then continues
  assert.equal(harness.records.get('b').life, 'active');
  assert.equal(harness.transition.t, 0.625);
  harness.frame(0.125);
  assert.equal(alphas.at(-1), 0.75);
});

test('the loading scene stands in for a main scene that is still loading', async () => {
  const gate = deferred();
  const { harness, log } = harnessWith(
    [['a'], ['slow', {}, { load: () => gate.promise }], ['loading', { tick: 'always' }]],
    { loadingScene: 'loading' },
  );
  harness.preload('loading');
  harness.setMain('a');
  await settle(harness);
  assert.equal(harness.records.get('loading').life, 'active');
  assert.equal(harness.records.get('loading').layer, null);

  harness.setMain('slow');
  harness.frame(0);
  log.length = 0;
  harness.frame(1 / 60);
  assert.equal(harness.layers.main, 'slow');
  assert.equal(harness.standIn, 'loading');
  assert.deepEqual(log, ['loading.draw']);
  assert.equal(harness.records.get('loading').state.ticks, 1);

  gate.resolve();
  await harness.records.get('slow').loaded;
  log.length = 0;
  harness.frame(1 / 60); // still the loading scene this frame; swap at its end
  assert.deepEqual(log, ['loading.draw', 'slow.enter']);
  assert.equal(harness.records.get('slow').life, 'active');
  harness.frame(1 / 60);
  assert.equal(log.at(-1), 'slow.draw');
  assert.equal(harness.standIn, null);
});

test('with a loading scene, a fade to a loading scene fades in to the stand-in', async () => {
  const gate = deferred();
  const alphas = [];
  const { harness } = harnessWith(
    [['a'], ['slow', {}, { load: () => gate.promise }], ['loading']],
    { loadingScene: 'loading', drawTransition: (alpha) => alphas.push(alpha) },
  );
  harness.preload('loading');
  harness.setMain('a');
  await settle(harness);
  harness.setMain('slow', { fade: 1 });
  for (let i = 0; i < 9; i++) harness.frame(0.125);
  assert.equal(harness.transition, null);
  assert.equal(harness.records.get('slow').life, 'loading');
  assert.deepEqual(alphas, [0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]);
  gate.resolve();
});

test('fromAlpha 1: the swap happens in the frame the request applies, then the new scene fades in', async () => {
  const alphas = [];
  const { harness, log } = harnessWith([['a'], ['b']], { drawTransition: (alpha) => alphas.push(alpha) });
  harness.setMain('a');
  harness.preload('b');
  await settle(harness);
  log.length = 0;
  harness.setMain('b', { fade: 2, fromAlpha: 1 });
  harness.frame(0.25); // applied: t starts at 1 (the midpoint), advances to 1.25, swaps
  assert.equal(harness.layers.main, 'b');
  assert.deepEqual(log.filter((e) => e.endsWith('.draw')), ['a.draw']);
  assert.deepEqual(alphas, [], 'no fade drawn before the request applied');
  for (let i = 0; i < 3; i++) harness.frame(0.25);
  assert.deepEqual(alphas, [0.75, 0.5, 0.25]);
  assert.equal(harness.transition, null);
  assert.deepEqual(log.filter((e) => e.endsWith('.draw')), ['a.draw', 'b.draw', 'b.draw', 'b.draw']);
});

test('fromAlpha overrides the current fade; without it a new fade starts at the current darkness', async () => {
  const { harness } = harnessWith([['a'], ['b'], ['c']]);
  harness.setMain('a');
  harness.preload('b');
  harness.preload('c');
  await settle(harness);
  harness.setMain('b', { fade: 1 });
  harness.frame(0.125);
  harness.frame(0.125); // t = 0.25: alpha 0.5
  harness.setMain('c', { fade: 1, fromAlpha: 0 });
  harness.frame(0); // applied; t = 0
  assert.equal(harness.transition.t, 0);
  harness.setMain('b', { fade: 1 });
  harness.frame(0.125); // applied at alpha 0 (t = 0), then advanced to 0.125
  assert.equal(harness.transition.t, 0.125);
});

test('fromAlpha outside 0..1 is rejected', () => {
  const { harness } = harnessWith([['a']]);
  for (const bad of [-0.1, 1.5, NaN, '1']) {
    assert.throws(() => harness.setMain('a', { fade: 1, fromAlpha: bad }), /fromAlpha must be 0..1/);
  }
});
