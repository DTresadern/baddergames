// Texture entries in the asset cache, keyed by manifest key: the first acquire downloads, the rest share it.

import { NoColorSpace, SRGBColorSpace, TextureLoader } from 'three';
import { assetByKey } from './manifest.js';

export const defaultLoadTexture = (url) => new TextureLoader().loadAsync(url);

const COLOR_SPACE = { srgb: SRGBColorSpace, raw: NoColorSpace };

// Cache entry for one texture: `ready` is a promise of the texture; dispose() waits for it.
export function textureEntry(path, loadTexture = defaultLoadTexture, colorSpace = SRGBColorSpace) {
  const ready = loadTexture(path).then((texture) => {
    texture.colorSpace = colorSpace;
    return texture;
  });
  return { ready, dispose: () => ready.then((texture) => texture.dispose(), () => {}) };
}

// Promise of the texture for a manifest key. A scene must not `track` it: the harness releases
// the cache entry when the scene unloads, and the last release disposes the texture.
export function acquireTexture(acquire, key, loadTexture = defaultLoadTexture) {
  const asset = assetByKey(key);
  if (asset.type !== 'texture') throw new Error(`acquireTexture: '${key}' is a ${asset.type}, not a texture`);
  const colorSpace = COLOR_SPACE[asset.colorSpace ?? 'srgb'];
  return acquire(key, () => textureEntry(asset.path, loadTexture, colorSpace)).ready;
}
