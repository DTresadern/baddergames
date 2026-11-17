// Runs the three.js test scenes against a fake renderer (no WebGL) and checks
// that every geometry, material and texture they draw with is disposed on unload.
// The pause scene (needs a DOM canvas) and the slow scene (2 s load) are left out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetCache } from '../src/engine/asset-cache.js';
import { createBackdrop } from '../src/scenes/backdrop.js';
import { createLoading } from '../src/scenes/loading.js';
import { createSceneA } from '../src/scenes/scene-a.js';
import { createSceneB } from '../src/scenes/scene-b.js';
import { CHECKER } from '../src/scenes/shared.js';

// Collects the GPU-backed objects of every rendered scene graph.
function recordingRenderer() {
  const used = new Set();
  return {
    used,
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

async function runScene(scene, view, frames = 30) {
  await scene.load();
  let state = scene.enter();
  for (let i = 0; i < frames; i++) {
    state = scene.tick(state, {}, 1 / 60) ?? state;
    scene.draw(state, view);
  }
  return state;
}

const FACTORIES = { backdrop: createBackdrop, loading: createLoading, sceneA: createSceneA, sceneB: createSceneB };

for (const [name, create] of Object.entries(FACTORIES)) {
  test(`${name}: everything it draws with is disposed on unload`, async () => {
    const assets = createAssetCache();
    const renderer = recordingRenderer();
    const scene = create({ assets });
    await runScene(scene, { renderer, width: 390, height: 844 });
    assert.ok(renderer.used.size > 0);
    const disposed = new Set();
    for (const obj of renderer.used) obj.addEventListener('dispose', () => disposed.add(obj));
    scene.exit?.();
    scene.unload();
    assert.equal(disposed.size, renderer.used.size);
    assert.deepEqual(assets.keys(), []);
  });
}

test('scene A and B share one checker texture, freed after both unload', async () => {
  const assets = createAssetCache();
  const view = { renderer: recordingRenderer(), width: 1280, height: 720 };
  const a = createSceneA({ assets });
  const b = createSceneB({ assets });
  await runScene(a, view, 2);
  await runScene(b, view, 2);
  assert.equal(assets.count(CHECKER), 2);
  const texture = assets.acquire(CHECKER, () => assert.fail('should exist'));
  assets.release(CHECKER);
  let freed = false;
  texture.addEventListener('dispose', () => {
    freed = true;
  });
  a.unload();
  assert.equal(assets.count(CHECKER), 1);
  assert.equal(freed, false);
  b.unload();
  assert.equal(assets.count(CHECKER), 0);
  assert.equal(freed, true);
});

test('scene meshes follow the state; a restored copy gets new meshes and the old ones are removed', async () => {
  const assets = createAssetCache();
  const renderer = recordingRenderer();
  let drawn;
  renderer.render = (scene) => {
    drawn = scene;
  };
  const view = { renderer, width: 800, height: 600 };
  const b = createSceneB({ assets });
  const state = await runScene(b, view, 5);
  const meshes = () => drawn.children[0].children;
  const first = [...meshes()];
  assert.equal(first.length, state.balls.length);
  b.draw(state, view);
  assert.deepEqual(meshes(), first); // same entities, same meshes
  b.draw(structuredClone(state), view);
  assert.equal(meshes().length, state.balls.length);
  assert.ok(meshes().every((m) => !first.includes(m)));
  b.unload();
});
