// createLoader with fake texture loading, fake music and the real asset cache. No browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Data3DTexture, NoColorSpace, SRGBColorSpace } from 'three';
import { createLoader } from '../src/assets/loader.js';
import { assetByKey, groupAssets } from '../src/assets/manifest.js';
import { withPoster } from '../src/scenes/poster.js';
import { acquireJson, acquireMap } from '../src/assets/maps.js';
import { acquireTexture } from '../src/assets/textures.js';
import { acquireLut } from '../src/assets/luts.js';
import { createAssetCache } from '../src/engine/asset-cache.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeTexture(path) {
  const texture = { path, disposed: 0, colorSpace: null, image: { width: 10, height: 10 } };
  texture.dispose = () => {
    texture.disposed += 1;
  };
  return texture;
}

// Every load waits until the test settles it: gates[path].resolve() or .reject(error).
// The default listing is the real boot group plus the classic poster, as main.js builds it.
function setup({ listGroup = withPoster(groupAssets, 'poster.classic') } = {}) {
  const gates = {};
  const loads = [];
  const gate = (path) => {
    loads.push(path);
    return new Promise((resolve, reject) => {
      gates[path] = { resolve, reject };
    });
  };
  const loadTexture = (path) => gate(path).then(() => fakeTexture(path));
  const music = { preload: (url) => gate(url) };
  const errors = [];
  const log = { error: (...args) => errors.push(args) };
  const assets = createAssetCache();
  const loader = createLoader({ assets, music, loadTexture, log, listGroup });
  return { loader, assets, gates, loads, errors, loadTexture };
}

const BOOT_PATHS = withPoster(groupAssets, 'poster.classic')('boot').map((a) => a.path);

test('loader: progress steps forward per asset and reaches exactly 1 when done', async () => {
  const { loader, gates, loads } = setup();
  assert.deepEqual(loader.status('boot'), { progress: 0, done: false, error: null });
  const done = loader.load('boot');
  await flush();
  assert.deepEqual(loads.sort(), [...BOOT_PATHS].sort());
  const seen = [];
  // Settle in reverse order: progress only counts, it does not care which asset finished.
  for (const path of [...BOOT_PATHS].reverse()) {
    gates[path].resolve();
    await flush();
    seen.push(loader.status('boot').progress);
  }
  await done;
  assert.deepEqual(seen, [0.25, 0.5, 0.75, 1]);
  assert.deepEqual(loader.status('boot'), { progress: 1, done: true, error: null });
});

test('loader: load twice gives the same promise and loads each asset once', async () => {
  const { loader, gates, loads } = setup();
  const first = loader.load('boot');
  assert.equal(loader.load('boot'), first);
  await flush();
  for (const path of BOOT_PATHS) gates[path].resolve();
  await first;
  assert.equal(loads.length, BOOT_PATHS.length);
});

test('loader: an asset in two groups is loaded once; each group counts it', async () => {
  const lists = {
    a: [assetByKey('logo.baddergames'), assetByKey('music.title')],
    b: [assetByKey('logo.baddergames'), assetByKey('poster.classic')],
  };
  const { loader, gates, loads } = setup({ listGroup: (group) => lists[group] });
  const a = loader.load('a');
  const b = loader.load('b');
  await flush();
  assert.equal(loads.filter((p) => p === assetByKey('logo.baddergames').path).length, 1);
  gates[assetByKey('logo.baddergames').path].resolve();
  await flush();
  assert.equal(loader.status('a').progress, 0.5);
  assert.equal(loader.status('b').progress, 0.5);
  gates[assetByKey('music.title').path].resolve();
  gates[assetByKey('poster.classic').path].resolve();
  await Promise.all([a, b]);
  assert.equal(loads.length, 3);
});

test('loader: a missing file rejects the group, names the path, logs once, and never becomes done', async () => {
  const { loader, gates, errors } = setup();
  const done = loader.load('boot');
  await flush();
  const missing = assetByKey('logo.w8omg').path;
  gates[assetByKey('logo.baddergames').path].resolve();
  await flush();
  const cause = new Error('404');
  gates[missing].reject(cause);
  await assert.rejects(done, (error) => error.message === `Could not load ${missing}` && error.cause === cause);
  const status = loader.status('boot');
  assert.equal(status.error, `Could not load ${missing}`);
  assert.equal(status.done, false);
  assert.equal(status.progress, 0.25);
  // The rest finishing later changes nothing.
  for (const path of BOOT_PATHS) if (path !== missing) gates[path].resolve();
  await flush();
  assert.equal(loader.status('boot').done, false);
  assert.equal(loader.status('boot').error, `Could not load ${missing}`);
  assert.deepEqual(errors, [[`Could not load ${missing}`, cause]]);
  assert.equal(loader.load('boot'), done, 'no retry: the same rejected promise');
});

test('loader: a failing music preload is reported the same way', async () => {
  const { loader, gates, errors } = setup();
  const done = loader.load('boot');
  await flush();
  const path = assetByKey('music.title').path;
  gates[path].reject(new Error('decode'));
  await assert.rejects(done, new RegExp(`Could not load ${path}`));
  assert.equal(errors.length, 1);
});

test('loader: an unknown group throws', () => {
  const { loader } = setup();
  assert.throws(() => loader.load('nope'), /unknown group 'nope'/);
  assert.throws(() => loader.status('nope'), /unknown group 'nope'/);
});

test('loader: a scene acquiring a preloaded texture gets the same object at once; releasing it keeps the texture', async () => {
  const { loader, assets, gates, loads, loadTexture } = setup();
  const done = loader.load('boot');
  await flush();
  for (const path of BOOT_PATHS) gates[path].resolve();
  await done;
  const key = 'logo.baddergames';
  assert.equal(assets.count(key), 1, 'the loader holds it');
  const preloaded = await assets.acquire(key, () => assert.fail('exists')).ready;
  assets.release(key);
  // A scene, through the harness's context.acquire, which forwards to the same cache.
  const texture = await acquireTexture((k, create) => assets.acquire(k, create), key, loadTexture);
  assert.equal(texture, preloaded);
  assert.equal(loads.length, BOOT_PATHS.length, 'no second load');
  assert.equal(assets.count(key), 2);
  assets.release(key); // the scene unloads
  await flush();
  assert.equal(assets.count(key), 1);
  assert.equal(texture.disposed, 0);
});

test('acquireTexture: colour space from the manifest (sRGB by default, raw for the w8omg logo)', async () => {
  const assets = createAssetCache();
  const acquire = (k, create) => assets.acquire(k, create);
  const load = async (path) => fakeTexture(path);
  assert.equal((await acquireTexture(acquire, 'logo.baddergames', load)).colorSpace, SRGBColorSpace);
  assert.equal((await acquireTexture(acquire, 'logo.w8omg', load)).colorSpace, NoColorSpace);
  assert.throws(() => acquireTexture(acquire, 'music.title', load), /not a texture/);
  assert.throws(() => acquireTexture(acquire, 'logo.nope', load), /unknown asset key/);
});

test('loader: a map asset loads as JSON through the asset cache, once, and the cache entry is shared', async () => {
  const loads = [];
  const json = { format: 1, name: 'walkway' };
  const loadJson = (path) => {
    loads.push(path);
    return Promise.resolve(json);
  };
  const loadTexture = async (path) => fakeTexture(path);
  const assets = createAssetCache();
  const loader = createLoader({ assets, music: {}, loadJson, loadTexture, loadLut: async () => new Data3DTexture(), log: { error() {} } });
  await loader.load('sandbox');
  await loader.load('sandbox');
  const maps = ['walkway', 'mvp-upper-1', 'moge3-cyberpunk', 'moge3-cyberpunk-blocks', 'depth-rows-test'].map((name) => `content/maps/${name}.json`);
  assert.deepEqual(loads, [...maps, 'content/textures/environment/blocks-placeholder.json']);
  assert.equal(await acquireMap(assets.acquire, 'map.walkway', loadJson), json);
  assert.equal(loads.length, 6);
  assert.equal(assets.count('map.walkway'), 2);
  assert.deepEqual(loader.status('sandbox'), { progress: 1, done: true, error: null });
  assert.throws(() => acquireMap(assets.acquire, 'music.title', loadJson), /not a map/);
});

test('loader: a map that fails to load rejects the group naming the path', async () => {
  const errors = [];
  const loader = createLoader({
    assets: createAssetCache(),
    music: {},
    loadTexture: async (path) => fakeTexture(path),
    loadJson: () => Promise.reject(new Error('HTTP 404')),
    loadLut: async () => new Data3DTexture(),
    log: { error: (...args) => errors.push(args) },
  });
  await assert.rejects(loader.load('sandbox'), /Could not load content\/maps\/walkway.json/);
  assert.equal(loader.status('sandbox').error, 'Could not load content/maps/walkway.json');
});

test('loader: a json asset (the block atlas index) loads through acquireJson; the type is checked both ways', async () => {
  const loads = [];
  const index = { tileSize: 64, columns: 7, rows: 4, tiles: {} };
  const loadJson = (path) => {
    loads.push(path);
    return Promise.resolve(path.endsWith('blocks-placeholder.json') ? index : { format: 1 });
  };
  const assets = createAssetCache();
  const loader = createLoader({ assets, music: {}, loadJson, loadTexture: async (path) => fakeTexture(path), loadLut: async () => new Data3DTexture(), log: { error() {} } });
  await loader.load('sandbox');
  const key = 'atlas.blocks-placeholder.index';
  assert.equal(assets.count(key), 1, 'the loader holds it');
  assert.equal(await acquireJson(assets.acquire, key, loadJson), index);
  assert.equal(loads.filter((p) => p === assetByKey(key).path).length, 1, 'loaded once');
  assert.equal((await acquireTexture(assets.acquire, 'atlas.blocks-placeholder', () => assert.fail('preloaded'))).path, 'content/textures/environment/blocks-placeholder.png');
  assert.throws(() => acquireJson(assets.acquire, 'map.walkway', loadJson), /'map.walkway' is a map, not a json/);
  assert.throws(() => acquireJson(assets.acquire, 'atlas.blocks-placeholder', loadJson), /is a texture, not a json/);
  assert.throws(() => acquireMap(assets.acquire, key, loadJson), /is a json, not a map/);
});

test('loader: a lut asset (the palette LUT) loads through acquireLut, once, never through music.preload; a failure names the path', async () => {
  const loads = [];
  const lut = new Data3DTexture();
  const loadLut = (path) => {
    loads.push(path);
    return Promise.resolve(lut);
  };
  const preloaded = [];
  const assets = createAssetCache();
  const loader = createLoader({ assets, music: { preload: (url) => preloaded.push(url) }, loadJson: async () => ({}), loadTexture: async (path) => fakeTexture(path), loadLut, log: { error() {} } });
  await loader.load('sandbox');
  assert.deepEqual(loads, [assetByKey('lut.shared32').path, assetByKey('lut.shared64').path]);
  assert.deepEqual(preloaded, [], 'nothing in the sandbox group is music');
  for (const key of ['lut.shared32', 'lut.shared64']) {
    assert.equal(assets.count(key), 1, `the loader holds ${key}`);
    assert.equal(await acquireLut(assets.acquire, key, () => assert.fail('preloaded')), lut);
  }
  const errors = [];
  const failing = createLoader({
    assets: createAssetCache(),
    music: {},
    loadJson: async () => ({}),
    loadTexture: async (path) => fakeTexture(path),
    loadLut: () => Promise.reject(new Error('HTTP 404')),
    log: { error: (...args) => errors.push(args) },
  });
  await assert.rejects(failing.load('sandbox'), /Could not load content\/textures\/lut\/shared.lut32.png/);
  // Each failing asset is logged once: both LUTs.
  assert.deepEqual(errors.map(([message]) => message), ['Could not load content/textures/lut/shared.lut32.png', 'Could not load content/textures/lut/shared.lut64.png']);
});
