import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession, createSessionHolder } from '../src/session.js';

test('session: plain frozen data with only campaign and difficulty', () => {
  const session = createSession({ campaign: 'megacity', difficulty: 'hard', extra: 1 });
  assert.deepEqual(session, { campaign: 'megacity', difficulty: 'hard' });
  assert.ok(Object.isFrozen(session));
  assert.equal(Object.getPrototypeOf(session), Object.prototype);
  for (const value of Object.values(session)) assert.equal(typeof value, 'string');
});

test('session: survives structuredClone and a JSON round trip unchanged', () => {
  const session = createSession({ campaign: 'megacity', difficulty: 'extreme' });
  assert.deepEqual(structuredClone(session), session);
  assert.deepEqual(JSON.parse(JSON.stringify(session)), session);
});

test('session holder: null at start; set, get and clear', () => {
  const holder = createSessionHolder();
  assert.equal(holder.get(), null);
  const session = createSession({ campaign: 'megacity', difficulty: 'easy' });
  holder.set(session);
  assert.equal(holder.get(), session);
  holder.clear();
  assert.equal(holder.get(), null);
});
