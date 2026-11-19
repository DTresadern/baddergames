import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJoin } from '../src/scenes/join.js';
import { JOIN_MESSAGES, joinMessage } from '../src/ui/join-form.js';
import { frame } from './frames.js';

test('join scene: enter shows the form, exit hides it; a pause press goes back; not pausable', () => {
  const calls = [];
  const form = { show: () => calls.push('show'), hide: () => calls.push('hide') };
  const scene = createJoin({ form, screens: { closeJoin: () => calls.push('back') } });
  assert.deepEqual(scene.settings, { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false });
  const state = scene.enter();
  scene.tick(state, [frame(['moveDown', 'jump'])]);
  assert.deepEqual(calls, ['show']);
  scene.tick(state, [frame(['pause'])]);
  scene.exit();
  assert.deepEqual(calls, ['show', 'back', 'hide']);
});

test('join messages: one per reason; unknown reasons get the generic one', () => {
  for (const reason of ['invalid', 'not-found', 'full', 'version', 'dropped', 'host-left', 'server', 'timeout', 'unsupported', 'failed']) {
    assert.equal(typeof JOIN_MESSAGES[reason], 'string', reason);
  }
  assert.equal(new Set(Object.values(JOIN_MESSAGES)).size, Object.keys(JOIN_MESSAGES).length, 'all different');
  assert.equal(joinMessage('invalid'), 'Room codes are 6 letters and digits.');
  assert.equal(joinMessage('???'), JOIN_MESSAGES.failed);
});
