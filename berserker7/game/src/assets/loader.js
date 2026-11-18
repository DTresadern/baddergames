// Preloads the assets of a manifest group (manifest.js) and reports progress.
// Textures go into the harness's asset cache through acquireTexture, and the loader keeps
// its use of each for the life of the page (it never releases), so they stay loaded and a
// scene's later acquire returns the same entry at once. Music is buffered by music.preload.
// Each asset is loaded once, however many groups or load() calls ask for it.
// A failure is loud: the group's promise rejects, status().error names the file, and the
// failure is logged once. A failed group never becomes done; there is no retry.

import { groupAssets } from './manifest.js';
import { acquireTexture, defaultLoadTexture } from './textures.js';

export const LOAD_ERROR_PREFIX = 'Could not load';

// `listGroup` (group -> manifest entries) is the manifest's groupAssets; tests pass their own.
export function createLoader({ assets, music, loadTexture = defaultLoadTexture, log = console, listGroup = groupAssets }) {
  const perAsset = new Map(); // key -> promise
  const groups = new Map(); // group -> { promise, progress, done, error }

  function loadAsset(asset) {
    let promise = perAsset.get(asset.key);
    if (promise) return promise;
    const start =
      asset.type === 'texture'
        ? () => acquireTexture((key, create) => assets.acquire(key, create), asset.key, loadTexture)
        : () => music.preload(asset.path);
    promise = Promise.resolve()
      .then(start)
      .then(
        () => undefined,
        (cause) => {
          const message = `${LOAD_ERROR_PREFIX} ${asset.path}`;
          log.error(message, cause);
          throw new Error(message, { cause });
        },
      );
    perAsset.set(asset.key, promise);
    return promise;
  }

  function load(group) {
    const existing = groups.get(group);
    if (existing) return existing.promise;
    const list = listGroup(group);
    const entry = { promise: null, progress: 0, done: false, error: null };
    groups.set(group, entry);
    let loaded = 0;
    const each = list.map((asset) =>
      loadAsset(asset).then(() => {
        loaded += 1;
        entry.progress = Math.max(entry.progress, loaded / list.length);
      }),
    );
    entry.promise = Promise.all(each).then(
      () => {
        entry.progress = 1;
        entry.done = true;
      },
      (error) => {
        entry.error = error.message;
        throw error;
      },
    );
    return entry.promise;
  }

  // { progress (0..1, only moves forward, 1 when done), done, error (null or a message naming the file) }.
  function status(group) {
    const entry = groups.get(group);
    if (!entry) {
      listGroup(group); // throws on an unknown group
      return { progress: 0, done: false, error: null };
    }
    return { progress: entry.progress, done: entry.done, error: entry.error };
  }

  return { load, status };
}
