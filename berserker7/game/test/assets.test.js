import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetCache } from '../src/engine/asset-cache.js';
import { createResourceList } from '../src/engine/resources.js';

function fakeAsset(log, name) {
  return { name, dispose: () => log.push(`dispose ${name}`) };
}

test('asset is created on first acquire only and disposed on the last release', () => {
  const log = [];
  const cache = createAssetCache();
  let creates = 0;
  const create = () => {
    creates += 1;
    return fakeAsset(log, 'checker');
  };
  const a = cache.acquire('checker', create);
  const b = cache.acquire('checker', create);
  assert.equal(a, b);
  assert.equal(creates, 1);
  assert.equal(cache.count('checker'), 2);
  cache.release('checker');
  assert.equal(cache.count('checker'), 1);
  assert.deepEqual(log, []);
  cache.release('checker');
  assert.equal(cache.count('checker'), 0);
  assert.deepEqual(cache.keys(), []);
  assert.deepEqual(log, ['dispose checker']);
  cache.acquire('checker', create); // created again after being freed
  assert.equal(creates, 2);
});

test('releasing an unknown or fully released key throws', () => {
  const cache = createAssetCache();
  assert.throws(() => cache.release('nope'), /unknown key 'nope'/);
  cache.acquire('x', () => fakeAsset([], 'x'));
  cache.release('x');
  assert.throws(() => cache.release('x'), /unknown key/);
});

test('resource list disposes in reverse order and empties', () => {
  const log = [];
  const list = createResourceList();
  const geometry = list.track(fakeAsset(log, 'geometry'));
  list.track(fakeAsset(log, 'material'));
  assert.equal(geometry.name, 'geometry');
  assert.equal(list.count(), 2);
  list.disposeAll();
  assert.deepEqual(log, ['dispose material', 'dispose geometry']);
  assert.equal(list.count(), 0);
  list.disposeAll();
  assert.equal(log.length, 2);
});
