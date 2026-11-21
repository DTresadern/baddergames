import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { ASSETS, GROUPS, TYPES, assetByKey, checkManifest, groupAssets } from '../src/assets/manifest.js';

const PUBLIC = new URL('../public/', import.meta.url);
const good = () => [{ key: 'a', path: 'content/x/a.png', type: 'texture', groups: ['boot'] }];
const BOOT_ONLY = ['boot'];
const problemsWith = (fields, groups = BOOT_ONLY) => checkManifest([{ ...good()[0], ...fields }], groups);

test('manifest: the real list has no problems and is frozen', () => {
  assert.deepEqual(checkManifest(ASSETS), []);
  assert.ok(Object.isFrozen(ASSETS));
  for (const entry of ASSETS) {
    assert.ok(Object.isFrozen(entry), entry.key);
    assert.ok(Object.isFrozen(entry.groups), entry.key);
  }
  assert.deepEqual(GROUPS, ['boot', 'menubg', 'sandbox']);
});

test('manifest: every path exists on disk under public/', () => {
  for (const { key, path } of ASSETS) {
    const file = new URL(path, PUBLIC);
    assert.ok(existsSync(file), `${key}: ${path} is missing`);
    assert.ok(statSync(file).isFile(), `${key}: ${path} is not a file`);
  }
});

test('checkManifest: a valid list has no problems', () => {
  assert.deepEqual(checkManifest(good(), BOOT_ONLY), []);
});

test('checkManifest: duplicate keys and missing keys', () => {
  const list = [...good(), ...good()];
  assert.deepEqual(checkManifest(list, BOOT_ONLY), ["'a': duplicate key"]);
  assert.match(problemsWith({ key: '' })[0], /entry 0: missing key/);
});

test('checkManifest: bad paths', () => {
  for (const path of ['/content/a.png', 'a.png', 'content/../a.png', 'content/x/', 'content//a.png', 'content\\a.png', 'content/a b.png', 'content/./a.png', 42]) {
    const problems = problemsWith({ path });
    assert.equal(problems.length, 1, String(path));
    assert.match(problems[0], /bad path/, String(path));
  }
});

test('checkManifest: unknown type and colour space', () => {
  assert.deepEqual(problemsWith({ type: 'video' }), ["'a': unknown type 'video'"]);
  assert.deepEqual(problemsWith({ colorSpace: 'raw' }), []);
  assert.deepEqual(problemsWith({ colorSpace: 'linear' }), ["'a': unknown colorSpace 'linear'"]);
  assert.deepEqual(problemsWith({ type: 'music', colorSpace: 'raw' }), ["'a': colorSpace is only for textures"]);
});

test('checkManifest: unknown or empty groups, and a group with no assets', () => {
  assert.deepEqual(problemsWith({ groups: ['menu'] }), ["'a': unknown group 'menu'", "group 'boot' has no assets"]);
  assert.deepEqual(problemsWith({ groups: [] }), ["'a': no groups", "group 'boot' has no assets"]);
  assert.deepEqual(problemsWith({ groups: undefined }), ["'a': no groups", "group 'boot' has no assets"]);
  assert.deepEqual(checkManifest(good(), ['boot', 'level1']), ["group 'level1' has no assets"]);
});

test('assetByKey and groupAssets: lookups, and loud errors naming the unknown key or group', () => {
  assert.equal(assetByKey('music.title').path, 'content/audio/music/titlescreen-1.mp3');
  assert.equal(assetByKey('logo.w8omg').colorSpace, 'raw');
  assert.throws(() => assetByKey('logo.nope'), /unknown asset key 'logo.nope'/);
  assert.deepEqual(groupAssets('boot').map((a) => a.key), ['logo.baddergames', 'logo.w8omg', 'music.title']);
  assert.deepEqual(groupAssets('menubg').map((a) => a.key), ['poster.classic', 'poster.thrash']);
  assert.equal(assetByKey('poster.thrash').path, 'content/textures/menubg/berserkerguy-thrash-2-1.png');
  assert.deepEqual(groupAssets('sandbox').map((a) => a.key), ['map.walkway', 'map.mvp-upper-1', 'map.moge3-cyberpunk', 'map.moge3-cyberpunk-blocks', 'map.depth-rows-test', 'atlas.blocks-placeholder', 'atlas.blocks-placeholder.index']);
  assert.equal(assetByKey('atlas.blocks-placeholder.index').type, 'json');
  assert.deepEqual(TYPES, ['texture', 'music', 'map', 'json']);
  assert.deepEqual(assetByKey('map.walkway'), { key: 'map.walkway', path: 'content/maps/walkway.json', type: 'map', groups: ['sandbox'] });
  assert.throws(() => groupAssets('nope'), /unknown group 'nope'/);
});
