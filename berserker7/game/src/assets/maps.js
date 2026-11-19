// Map entries in the asset cache, keyed by manifest key: the first acquire downloads the JSON, the rest share it.

import { assetByKey } from './manifest.js';

export const defaultFetchJson = (path) =>
  fetch(path).then((response) => {
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  });

// Cache entry for one map file: `ready` is a promise of the parsed JSON. It holds no GPU or other
// resource, so there is nothing to dispose.
export function mapEntry(path, fetchJson = defaultFetchJson) {
  return { ready: fetchJson(path), dispose: () => {} };
}

// Promise of the parsed map JSON for a manifest key. Scenes pass `context.acquire`; the loader passes the cache's own.
export function acquireMap(acquire, key, fetchJson = defaultFetchJson) {
  const asset = assetByKey(key);
  if (asset.type !== 'map') throw new Error(`acquireMap: '${key}' is a ${asset.type}, not a map`);
  return acquire(key, () => mapEntry(asset.path, fetchJson)).ready;
}
