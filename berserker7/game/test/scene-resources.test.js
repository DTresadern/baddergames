// Runs the three.js test scenes in a harness with a fake renderer (no WebGL) and
// checks that every geometry, material and texture they draw with is disposed
// when the harness unloads them. The pause scene (needs a DOM canvas), the
// slow scene (2 s load) and the main menu (TextureLoader needs a DOM image) are
// left out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from '../src/engine/harness.js';
import { createDevices, press, setSurface } from '../src/input/devices.js';
import { createInput, sampleInput, setAimOrigin } from '../src/input/sampler.js';
import { createBackdrop } from '../src/scenes/backdrop.js';
import { createLoading } from '../src/scenes/loading.js';
import { createPlayers, initPlayers } from '../src/scenes/players.js';
import { createSceneA } from '../src/scenes/scene-a.js';
import { createSceneB } from '../src/scenes/scene-b.js';
import { CHECKER } from '../src/scenes/shared.js';
import { settle, STEP } from './fakes.js';

// Collects the GPU-backed objects of every rendered scene graph.
function recordingRenderer() {
  const used = new Set();
  return {
    used,
    clear() {},
    clearDepth() {},
    render(scene) {
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

const FACTORIES = {
  backdrop: createBackdrop,
  loading: createLoading,
  sceneA: createSceneA,
  sceneB: createSceneB,
  players: createPlayers,
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
