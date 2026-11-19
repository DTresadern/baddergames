import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withCodec } from '../src/net/lazy-transport.js';

const tick = () => new Promise((r) => setImmediate(r));

function inner() {
  const calls = [];
  const closes = [];
  return {
    calls,
    closes,
    kind: 'fake',
    host: (opts) => (calls.push(['host', opts]), { close: () => closes.push('host') }),
    join: (code, opts) => (calls.push(['join', code, opts]), { close: () => closes.push('join') }),
  };
}

test('withCodec: kind passes through; host and join start the inner transport after the load', async () => {
  const t = inner();
  let release;
  const loading = new Promise((r) => (release = r));
  const lazy = withCodec(t, () => loading);
  assert.equal(lazy.kind, 'fake');
  const hostOpts = { onError: assert.fail };
  const handle = lazy.host(hostOpts);
  lazy.join('ABCDEF', { onError: assert.fail });
  await tick();
  assert.deepEqual(t.calls, [], 'nothing starts before the load finishes');
  release();
  await tick();
  assert.deepEqual(t.calls.map((c) => c[0]), ['host', 'join']);
  assert.equal(t.calls[0][1], hostOpts);
  handle.close();
  assert.deepEqual(t.closes, ['host'], 'close after the start closes the inner handle');
});

test('withCodec: close before the load finishes never starts the inner transport', async () => {
  const t = inner();
  let release;
  const lazy = withCodec(t, () => new Promise((r) => (release = r)));
  const handle = lazy.join('ABCDEF', { onError: assert.fail });
  handle.close();
  release();
  await tick();
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.closes, []);
});

test('withCodec: a failed load gives unsupported, unless closed', async () => {
  const t = inner();
  const lazy = withCodec(t, () => Promise.reject(new Error('offline')));
  const errors = [];
  lazy.host({ onError: (r) => errors.push(r) });
  lazy.join('ABCDEF', { onError: (r) => errors.push(r) });
  const closedHandle = lazy.host({ onError: (r) => errors.push(`late ${r}`) });
  closedHandle.close();
  await tick();
  assert.deepEqual(errors, ['unsupported', 'unsupported']);
  assert.deepEqual(t.calls, []);
});
