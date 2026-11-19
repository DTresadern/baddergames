import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJoin } from '../src/scenes/join.js';
import { JOIN_MESSAGES, joinMessage, submitJoinCode } from '../src/ui/join-form.js';
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

// A net session stand-in: a role and state, and a log of the calls the Join button makes.
function fakeNet(role, state) {
  const calls = [];
  return { calls, role: () => role, state: () => state, leave: () => calls.push(['leave']), join: (code, opts) => calls.push(['join', code, opts.transport]) };
}

test('join button: an invalid code shows its message and leaves a host or a connected guest alone', () => {
  for (const [role, state] of [['host', 'joined'], ['host', 'waiting'], ['guest', 'connected'], [null, 'idle']]) {
    const net = fakeNet(role, state);
    const messages = [];
    assert.equal(submitJoinCode('ab1', { net, transport: 'T', setMessage: (m) => messages.push(m) }), false);
    assert.deepEqual(net.calls, [], `${role} ${state}`);
    assert.deepEqual(messages, [JOIN_MESSAGES.invalid]);
  }
});

test('join button: an invalid code cancels a join still connecting; a valid code joins', () => {
  const connecting = fakeNet('guest', 'connecting');
  const messages = [];
  submitJoinCode('', { net: connecting, transport: 'T', setMessage: (m) => messages.push(m) });
  assert.deepEqual(connecting.calls, [['leave']]);
  assert.deepEqual(messages, [JOIN_MESSAGES.invalid]);
  const hosting = fakeNet('host', 'joined');
  assert.equal(submitJoinCode('abc-def', { net: hosting, transport: 'T', setMessage: (m) => messages.push(m) }), true);
  assert.deepEqual(hosting.calls, [['join', 'abc-def', 'T']]);
  assert.equal(messages.at(-1), JOIN_MESSAGES.connecting);
});
