// Assets shared between scenes, counted by user. The first acquire creates the
// asset; the last release disposes it. Any object with dispose() works, so tests
// can use fake assets.

export function createAssetCache() {
  const entries = new Map(); // key -> { asset, count }
  return {
    acquire(key, create) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { asset: create(), count: 0 };
        entries.set(key, entry);
      }
      entry.count += 1;
      return entry.asset;
    },
    release(key) {
      const entry = entries.get(key);
      if (!entry) throw new Error(`asset cache: release of unknown key '${key}'`);
      entry.count -= 1;
      if (entry.count === 0) {
        entries.delete(key);
        entry.asset.dispose();
      }
    },
    count(key) {
      return entries.get(key)?.count ?? 0;
    },
    keys() {
      return [...entries.keys()];
    },
  };
}
