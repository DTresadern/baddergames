// Runs the three.js test scenes in a harness with a fake renderer (no WebGL) and
// checks that every geometry, material and texture they draw with is disposed
// when the harness unloads them. The pause scene (needs a DOM canvas) and the
// slow scene (2 s load) are left out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness } from '../src/engine/harness.js';
import { createBackdrop } from '../src/scenes/backdrop.js';
import { createLoading } from '../src/scenes/loading.js';
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
        if (!obj.isMesh) return;
        used.add(obj.geometry);
        used.add(obj.material);
        if (obj.material.map) used.add(obj.material.map);
      });
    },
  };
}

function harnessFor(scenes, renderer = recordingRenderer()) {
  const harness = createHarness({ renderer, now: () => 0 });
  harness.setSize(390, 844);
  for (const [id, scene] of Object.entries(scenes)) harness.register(id, scene);
  return { harness, renderer };
}

const FACTORIES = { backdrop: createBackdrop, loading: createLoading, sceneA: createSceneA, sceneB: createSceneB };

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
  for (let i = 0; i < 5; i++) state = b.tick(state, {}, STEP);
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
