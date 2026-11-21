// Colour lookup table (LUT) entries in the asset cache, keyed by manifest key: a LUT strip image
// becomes a three.js Data3DTexture; the first acquire downloads it, the rest share it.
// Ported from the scene palette work (its three.js strip LUT module); the pure strip conversion is
// in lut-strip.js. three's LUTImageLoader is not used: it reads this strip layout wrong.
// The game uses LUTs for palette mapping only, so the texture is always nearest-filtered (every
// lookup returns exactly one LUT entry; the original's linear option is left out).

import { ClampToEdgeWrapping, Data3DTexture, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { assetByKey } from './manifest.js';
import { stripToLutData } from './lut-strip.js';

// The 3D texture for stripToLutData's data (`size` entries per channel).
export function lutTexture(data, size) {
  const texture = new Data3DTexture(data, size, size, size);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = NoColorSpace; // LUT values are data: no sRGB decode on upload or sampling
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.wrapR = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// Browser: loads a strip PNG with no colour management or premultiplication (the stored bytes
// exactly) and returns its 3D texture. Throws on a non-OK response or a strip of the wrong size.
export async function loadStripLut(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return lutTexture(stripToLutData(context.getImageData(0, 0, width, height).data, width, height), height);
}

export const defaultLoadLut = (path) => loadStripLut(path);

// Cache entry for one LUT: `ready` is a promise of the texture; dispose() waits for it.
export function lutEntry(path, loadLut = defaultLoadLut) {
  const ready = loadLut(path);
  return { ready, dispose: () => ready.then((texture) => texture.dispose(), () => {}) };
}

// Promise of the LUT texture for a manifest key of type `lut` (throws on any other type). A scene
// must not `track` it: the harness releases the cache entry when the scene unloads, and the last
// release disposes the texture.
export function acquireLut(acquire, key, loadLut = defaultLoadLut) {
  const asset = assetByKey(key);
  if (asset.type !== 'lut') throw new Error(`acquireLut: '${key}' is a ${asset.type}, not a lut`);
  return acquire(key, () => lutEntry(asset.path, loadLut)).ready;
}
