// Map and other JSON entries in the asset cache, keyed by manifest key: the first acquire downloads
// the JSON, the rest share it.

import { assetByKey } from './manifest.js';

export const defaultFetchJson = (path) =>
  fetch(path).then((response) => {
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  });

// Cache entry for one JSON file (a map or a `json` asset): `ready` is a promise of the parsed JSON.
// It holds no GPU or other resource, so there is nothing to dispose.
export function mapEntry(path, fetchJson = defaultFetchJson) {
  return { ready: fetchJson(path), dispose: () => {} };
}

// Promise of the parsed JSON of a manifest key of type `type` (throws on any other type).
function acquireParsed(acquire, key, fetchJson, type, caller) {
  const asset = assetByKey(key);
  if (asset.type !== type) throw new Error(`${caller}: '${key}' is a ${asset.type}, not a ${type}`);
  return acquire(key, () => mapEntry(asset.path, fetchJson)).ready;
}

// Promise of the parsed map JSON for a manifest key. Scenes pass `context.acquire`; the loader passes the cache's own.
export function acquireMap(acquire, key, fetchJson = defaultFetchJson) {
  return acquireParsed(acquire, key, fetchJson, 'map', 'acquireMap');
}

// Promise of the parsed JSON of a `json` asset (for example a block atlas index), like acquireMap.
export function acquireJson(acquire, key, fetchJson = defaultFetchJson) {
  return acquireParsed(acquire, key, fetchJson, 'json', 'acquireJson');
}
