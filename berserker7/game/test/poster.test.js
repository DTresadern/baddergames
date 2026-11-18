import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Texture } from 'three';
import { assetByKey, groupAssets } from '../src/assets/manifest.js';
import { createMainMenu } from '../src/scenes/main-menu.js';
import { createNewGame } from '../src/scenes/new-game.js';
import { POSTERS, pickPoster, withPoster } from '../src/scenes/poster.js';

const CLASSIC = 'poster.classic';
const THRASH = 'poster.thrash';
const fakeLog = () => {
  const warnings = [];
  return { warnings, warn: (...args) => warnings.push(args) };
};

test('POSTERS: the two backgrounds, frozen', () => {
  assert.deepEqual(POSTERS, [CLASSIC, THRASH]);
  assert.ok(Object.isFrozen(POSTERS));
});

test('pickPoster: equal chance by the injected random, split at 0.5', () => {
  const pick = (value) => pickPoster({ random: () => value, log: fakeLog() });
  assert.equal(pick(0), CLASSIC);
  assert.equal(pick(0.49), CLASSIC);
  assert.equal(pick(0.5), THRASH);
  assert.equal(pick(0.999), THRASH);
  assert.equal(pick(1), THRASH, 'an out of range random is clamped');
});

test('pickPoster: ?menubg forces one, whatever random says, without a warning', () => {
  const log = fakeLog();
  assert.equal(pickPoster({ search: '?menubg=classic', random: () => 0.99, log }), CLASSIC);
  assert.equal(pickPoster({ search: '?x=1&menubg=thrash', random: () => 0, log }), THRASH);
  assert.deepEqual(log.warnings, []);
});

test('pickPoster: an unknown value warns once naming the valid values, then picks at random', () => {
  for (const search of ['?menubg=nope', '?menubg=', '?menubg=toString']) {
    const log = fakeLog();
    assert.equal(pickPoster({ search, random: () => 0.7, log }), THRASH, search);
    assert.equal(log.warnings.length, 1, search);
    assert.match(log.warnings[0][0], /classic/);
    assert.match(log.warnings[0][0], /thrash/);
  }
});

test('pickPoster: no parameter, no warning', () => {
  const log = fakeLog();
  pickPoster({ search: '', random: () => 0.1, log });
  pickPoster({ search: '?other=1', random: () => 0.1, log });
  assert.deepEqual(log.warnings, []);
});

test('withPoster: the boot list holds exactly the picked poster; other groups pass through', () => {
  for (const [picked, other] of [[CLASSIC, THRASH], [THRASH, CLASSIC]]) {
    const list = withPoster(groupAssets, picked);
    const keys = list('boot').map((a) => a.key);
    assert.equal(keys.filter((k) => POSTERS.includes(k)).length, 1);
    assert.ok(keys.includes(picked));
    assert.ok(!keys.includes(other));
    assert.deepEqual(keys.slice(0, -1), groupAssets('boot').map((a) => a.key));
    assert.deepEqual(list('menubg'), groupAssets('menubg'));
  }
  assert.throws(() => withPoster(groupAssets, 'poster.nope'), /unknown poster 'poster.nope'/);
  assert.throws(() => withPoster(groupAssets, CLASSIC)('nope'), /unknown group 'nope'/);
});

test('scenes: an unknown or missing poster key throws', () => {
  const music = { play() {}, stop() {} };
  const deps = { screens: {}, settings: {}, session: {} };
  for (const poster of ['poster.nope', undefined, 'classic']) {
    assert.throws(() => createMainMenu({ music, screens: {}, poster }), /unknown poster/);
    assert.throws(() => createNewGame({ ...deps, poster }), /unknown poster/);
  }
});

test('main menu and New Game acquire the key they were given', async () => {
  const stub2d = { font: '', fillStyle: '', textAlign: '', textBaseline: '', fillText() {} };
  const createCanvas = () => ({ width: 0, height: 0, getContext: () => stub2d });
  for (const poster of POSTERS) {
    const loaded = [];
    const acquired = [];
    const context = {
      track: (x) => x,
      acquire: (key, load) => {
        acquired.push(key);
        return load();
      },
    };
    const loadTexture = async (path) => {
      loaded.push(path);
      return new Texture({ width: 2508, height: 1254 });
    };
    const menu = createMainMenu({ music: { play() {}, stop() {} }, screens: {}, poster, loadTexture, createCanvas });
    const newGame = createNewGame({ screens: {}, settings: {}, session: {}, poster, loadTexture, createCanvas });
    await menu.load(context);
    await newGame.load(context);
    assert.deepEqual(acquired, [poster, poster], poster);
    assert.equal(loaded.length, 2);
    assert.ok(loaded.every((path) => path === assetByKey(poster).path), poster);
  }
});
