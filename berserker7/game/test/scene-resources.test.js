// Runs the three.js scenes in a harness with a fake renderer (no WebGL) and
// checks that every geometry, material and texture they draw with is disposed
// when the harness unloads them. The pause scene (needs a DOM canvas) and the
// slow scene (2 s load) are left out. The main menu gets a fake texture loader,
// canvas and music.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Texture } from 'three';
import { createHarness } from '../src/engine/harness.js';
import { createDevices, press, setSurface } from '../src/input/devices.js';
import { createInput, sampleInput, setAimOrigin } from '../src/input/sampler.js';
import { acquireTexture } from '../src/assets/textures.js';
import { createBackdrop } from '../src/scenes/backdrop.js';
import { createBoot } from '../src/scenes/boot.js';
import { INTRO_LOGOS, createIntro } from '../src/scenes/intro.js';
import { createLoading } from '../src/scenes/loading.js';
import { createMainMenu } from '../src/scenes/main-menu.js';
import { createNewGame } from '../src/scenes/new-game.js';
import { POSTER } from '../src/scenes/poster.js';
import { createPlayers, initPlayers } from '../src/scenes/players.js';
import { createSceneA } from '../src/scenes/scene-a.js';
import { createSceneB } from '../src/scenes/scene-b.js';
import { CHECKER } from '../src/scenes/shared.js';
import { settle, STEP } from './fakes.js';

// Collects the GPU-backed objects of every rendered scene graph.
function recordingRenderer() {
  const used = new Set();
  let renderedScene = null;
  return {
    used,
    get scene() {
      return renderedScene;
    },
    clear() {},
    clearDepth() {},
    getPixelRatio: () => 1,
    render(scene) {
      renderedScene = scene;
      scene.traverse((obj) => {
        if (!obj.isMesh && !obj.isLine) return;
        used.add(obj.geometry);
        used.add(obj.material);
        if (obj.material.map) used.add(obj.material.map);
      });
    },
  };
}

// Real input frames from fake devices: player 1 holds jump and fire, player 2 is on a
// standard gamepad, so the players scene draws both markers in every material.
function fakeInput() {
  const devices = createDevices();
  setSurface(devices, 390, 844);
  const input = createInput();
  const pad = {
    index: 0,
    id: 'Pad',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  press(devices, 'key:Space');
  press(devices, 'mouse:0');
  return {
    sample: () => sampleInput(input, devices, [pad]),
    setAimOrigin: (player, x, y) => setAimOrigin(input, player, x, y),
  };
}

function harnessFor(scenes, renderer = recordingRenderer()) {
  const harness = createHarness({ renderer, now: () => 0, input: fakeInput() });
  harness.setSize(390, 844);
  for (const [id, scene] of Object.entries(scenes)) harness.register(id, scene);
  return { harness, renderer };
}

// The menu screens with fakes for what needs a DOM: the poster loader, the label canvases and the music.
// `loads` counts poster loads.
function fakeDeps(loads = { count: 0 }) {
  const stub2d = { font: '', fillStyle: '', textAlign: '', textBaseline: '', fillText() {} };
  return {
    loadTexture: async () => {
      loads.count += 1;
      return new Texture({ width: 1254, height: 1254 });
    },
    createCanvas: () => ({ width: 0, height: 0, getContext: () => stub2d }),
  };
}
const fakeMenu = () => createMainMenu({ music: { play() {}, stop() {} }, screens: fakeScreens(), ...fakeDeps() });
const fakeNewGame = () => createNewGame({ screens: fakeScreens(), ...fakeDeps() });
function fakeScreens() {
  return { openNewGame() {}, closeNewGame() {}, startIntro() {}, showMenu() {} };
}
// Boot with a fake loader whose status the test sets.
function fakeBoot(status = { progress: 0.5, done: false, error: null }) {
  const loader = { load: () => Promise.resolve(), status: () => status };
  return createBoot({ loader, screens: fakeScreens(), createCanvas: fakeDeps().createCanvas });
}
const fakeIntro = (deps = fakeDeps()) =>
  createIntro({ music: { play() {}, stop() {} }, screens: fakeScreens(), loadTexture: deps.loadTexture });

const flush = () => new Promise((resolve) => setImmediate(resolve));

const FACTORIES = {
  backdrop: createBackdrop,
  loading: createLoading,
  sceneA: createSceneA,
  sceneB: createSceneB,
  players: createPlayers,
  mainMenu: fakeMenu,
  newGame: fakeNewGame,
  boot: fakeBoot,
  intro: fakeIntro,
};

for (const [name, create] of Object.entries(FACTORIES)) {
  test(`${name}: everything it draws with is disposed when the harness unloads it`, async () => {
    const { harness, renderer } = harnessFor({ [name]: create() });
    harness.setMain(name);
    await settle(harness, STEP);
    for (let i = 0; i < 10; i++) harness.frame(STEP);
    assert.ok(renderer.used.size > 0);
    const disposed = new Set();
    for (const obj of renderer.used) obj.addEventListener('dispose', () => disposed.add(obj));
    harness.leave(name, 'unload');
    harness.frame(0);
    await flush(); // the shared poster is disposed once its load promise has settled
    assert.equal(harness.records.get(name).life, 'unloaded');
    assert.equal(disposed.size, renderer.used.size);
    assert.deepEqual(harness.assets.keys(), []);
  });
}

test('scene A and B share one checker texture, freed after both unload', async () => {
  const { harness } = harnessFor({ sceneA: createSceneA(), sceneB: createSceneB() });
  harness.setMain('sceneA');
  harness.preload('sceneB');
  await settle(harness, STEP);
  const { assets } = harness;
  assert.equal(assets.count(CHECKER), 2);
  const texture = assets.acquire(CHECKER, () => assert.fail('should exist'));
  assets.release(CHECKER);
  let freed = false;
  texture.addEventListener('dispose', () => {
    freed = true;
  });
  harness.leave('sceneA', 'unload');
  harness.frame(0);
  assert.equal(assets.count(CHECKER), 1);
  assert.equal(freed, false);
  harness.leave('sceneB', 'unload');
  harness.frame(0);
  assert.equal(assets.count(CHECKER), 0);
  assert.equal(freed, true);
});

test('scene meshes follow the state; a restored copy gets new meshes and the old ones are removed', async () => {
  let drawn;
  const renderer = { render: (scene) => (drawn = scene) };
  const view = { renderer, width: 800, height: 600 };
  const b = createSceneB();
  await b.load({ renderer, track: (obj) => obj, acquire: (key, create) => create() });
  let state = b.enter();
  for (let i = 0; i < 5; i++) state = b.tick(state, [], STEP);
  b.draw(state, view);
  const meshes = () => drawn.children[0].children;
  const first = [...meshes()];
  assert.equal(first.length, state.balls.length);
  b.draw(state, view);
  assert.deepEqual(meshes(), first); // same entities, same meshes
  b.draw(structuredClone(state), view);
  assert.equal(meshes().length, state.balls.length);
  assert.ok(meshes().every((m) => !first.includes(m)));
});

test('players: draw reports each connected marker to view.setAimOrigin in CSS px of the canvas', async () => {
  const calls = [];
  const renderer = { render() {} };
  // 800 x 600: the view shows the arena plus margin, x in [-6.5, 6.5] and y in [-4.875, 4.875].
  const view = { renderer, width: 800, height: 600, setAimOrigin: (...args) => calls.push(args) };
  const scene = createPlayers();
  await scene.load({ renderer, track: (obj) => obj, acquire: (key, create) => create() });
  const state = initPlayers();
  scene.draw(state, view);
  assert.deepEqual(calls, [], 'no connected players, no calls');

  Object.assign(state.players[0], { connected: true, x: 0, y: 0 });
  Object.assign(state.players[1], { connected: true, x: 3.25, y: -2.4375 });
  scene.draw(state, view);
  assert.deepEqual(calls, [[0, 400, 300], [1, 600, 450]]);

  calls.length = 0;
  state.players[1].connected = false;
  scene.draw(state, { ...view, width: 600, height: 600 }); // square: y in [-6.5, 6.5]
  assert.deepEqual(calls, [[0, 300, 300]]);
});

test('main menu: after unload and a fresh load, the scene has 3 labels plus poster, panel and bar', async () => {
  const { harness, renderer } = harnessFor({ mainMenu: fakeMenu() });
  const meshCount = () => {
    let n = 0;
    renderer.scene.traverse((obj) => {
      if (obj.isMesh) n += 1;
    });
    return n;
  };
  harness.setMain('mainMenu');
  await settle(harness, STEP);
  harness.frame(STEP);
  assert.equal(meshCount(), 6);
  harness.leave('mainMenu', 'unload');
  harness.frame(0);
  harness.setMain('mainMenu');
  await settle(harness, STEP);
  harness.frame(STEP);
  assert.equal(meshCount(), 6);
});

test('main menu and New Game share one poster, disposed once after both unload; the rest is disposed per scene', async () => {
  const loads = { count: 0 };
  const deps = fakeDeps(loads);
  const { harness, renderer } = harnessFor({
    mainMenu: createMainMenu({ music: { play() {}, stop() {} }, screens: fakeScreens(), ...deps }),
    newGame: createNewGame({ screens: fakeScreens(), ...deps }),
  });
  harness.setMain('mainMenu');
  harness.openOverlay('newGame');
  await settle(harness, STEP);
  for (let i = 0; i < 3; i++) harness.frame(STEP);
  assert.equal(loads.count, 1);
  assert.equal(harness.assets.count(POSTER), 2);
  const poster = (await harness.assets.acquire(POSTER, () => assert.fail('should exist')).ready);
  harness.assets.release(POSTER);
  const disposed = new Set();
  for (const obj of renderer.used) obj.addEventListener('dispose', () => disposed.add(obj));
  let posterDisposed = 0;
  poster.addEventListener('dispose', () => (posterDisposed += 1));

  harness.leave('newGame', 'unload');
  harness.frame(0);
  await flush();
  assert.equal(harness.assets.count(POSTER), 1);
  assert.equal(posterDisposed, 0);
  const afterNewGame = disposed.size;
  assert.ok(afterNewGame > 0, 'New Game own geometry, materials and label textures are disposed');

  harness.leave('mainMenu', 'unload');
  harness.frame(0);
  await flush();
  assert.equal(posterDisposed, 1);
  assert.ok(disposed.size > afterNewGame);
  assert.deepEqual(harness.assets.keys(), []);
});

test('new game: after unload and a fresh load the scene has the same meshes', async () => {
  const { harness, renderer } = harnessFor({ newGame: fakeNewGame() });
  const meshCount = () => {
    let n = 0;
    renderer.scene.traverse((obj) => {
      if (obj.isMesh) n += 1;
    });
    return n;
  };
  harness.openOverlay('newGame');
  await settle(harness, STEP);
  harness.frame(STEP);
  const first = meshCount();
  assert.ok(first > 0);
  harness.leave('newGame', 'unload');
  harness.frame(0);
  harness.openOverlay('newGame');
  await settle(harness, STEP);
  harness.frame(STEP);
  assert.equal(meshCount(), first);
});

// Materials whose texture is a shader uniform (the intro's inverted logo) are not in renderer.used.
const uniformMaps = (used) => [...used].filter((o) => o.uniforms?.map).map((o) => o.uniforms.map.value);

test('boot: the error label is made once when the error shows, and disposed with the rest', async () => {
  const status = { progress: 0.5, done: false, error: null };
  const { harness, renderer } = harnessFor({ boot: fakeBoot(status) });
  harness.setMain('boot');
  await settle(harness, STEP);
  harness.frame(STEP);
  const before = renderer.used.size;
  status.error = 'Could not load content/textures/logos/w8omg.png';
  for (let i = 0; i < 5; i++) harness.frame(STEP);
  assert.equal(renderer.used.size, before + 2, 'one label texture and its material, made once');
  assert.equal(harness.records.get('boot').state.error, status.error);
  const disposed = new Set();
  for (const obj of renderer.used) obj.addEventListener('dispose', () => disposed.add(obj));
  harness.leave('boot', 'unload');
  harness.frame(0);
  assert.equal(disposed.size, renderer.used.size);
});

test('intro: unloading it disposes its own objects but not the preloaded logos, which stay loaded once', async () => {
  const loads = { count: 0 };
  const deps = fakeDeps(loads);
  const { harness, renderer } = harnessFor({ intro: fakeIntro(deps) });
  const { assets } = harness;
  // What the loader does: acquire each logo and never release it.
  const preloaded = await Promise.all(
    INTRO_LOGOS.map((key) => acquireTexture((k, create) => assets.acquire(k, create), key, deps.loadTexture)),
  );
  assert.equal(loads.count, 2);
  harness.setMain('intro');
  await settle(harness, STEP);
  for (let i = 0; i < 10; i++) harness.frame(STEP);
  assert.equal(loads.count, 2, 'the intro loads nothing again');
  for (const key of INTRO_LOGOS) assert.equal(assets.count(key), 2);
  const used = [...renderer.used, ...uniformMaps(renderer.used)];
  for (const texture of preloaded) assert.ok(used.includes(texture), 'drawn with the preloaded texture');
  const disposed = new Set();
  for (const obj of used) obj.addEventListener('dispose', () => disposed.add(obj));
  harness.leave('intro', 'unload');
  harness.frame(0);
  await flush();
  for (const texture of preloaded) assert.ok(!disposed.has(texture), 'a preloaded logo was disposed');
  assert.equal(disposed.size, used.length - preloaded.length, 'everything else is disposed');
  for (const key of INTRO_LOGOS) assert.equal(assets.count(key), 1);
});
