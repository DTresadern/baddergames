// The LUT strip conversion (pure), the LUT texture settings and acquireLut. No browser.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ClampToEdgeWrapping, Data3DTexture, NearestFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { stripToLutData } from '../src/assets/lut-strip.js';
import { acquireLut, lutTexture } from '../src/assets/luts.js';
import { assetByKey } from '../src/assets/manifest.js';
import { createAssetCache } from '../src/engine/asset-cache.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// A synthetic N*N x N strip, top row first: the pixel for (r, g, b) holds [r, g, b] * 10 + [1, 2, 3]
// (unique per entry) and alpha 7. `greenUp`: green 0 on the bottom row.
function strip(n, greenUp) {
  const width = n * n;
  const pixels = new Uint8Array(width * n * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const row = greenUp ? n - 1 - g : g;
        pixels.set([r * 10 + 1, g * 10 + 2, b * 10 + 3, 7], (row * width + b * n + r) * 4);
      }
    }
  }
  return { pixels, width, height: n };
}

const entry = (data, n, r, g, b) => [...data.slice(((b * n + g) * n + r) * 4, ((b * n + g) * n + r) * 4 + 4)];

test('stripToLutData: tile = blue, x in the tile = red, y = green; index ((b*n+g)*n+r)*4, alpha 255; both green orientations', () => {
  for (const n of [2, 4]) {
    for (const greenUp of [true, false]) {
      const { pixels, width, height } = strip(n, greenUp);
      const data = stripToLutData(pixels, width, height, { greenUp });
      assert.ok(data instanceof Uint8Array);
      assert.equal(data.length, n * n * n * 4);
      for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) assert.deepEqual(entry(data, n, r, g, b), [r * 10 + 1, g * 10 + 2, b * 10 + 3, 255], `n ${n} greenUp ${greenUp} (${r}, ${g}, ${b})`);
    }
  }
  // greenUp is the default: green 0 is the strip's bottom row.
  const { pixels, width, height } = strip(2, true);
  assert.deepEqual(stripToLutData(pixels, width, height), stripToLutData(pixels, width, height, { greenUp: true }));
  // Read the other way, the green axis is mirrored.
  assert.deepEqual(entry(stripToLutData(pixels, width, height, { greenUp: false }), 2, 0, 0, 0), [1, 12, 3, 255]);
});

test('stripToLutData: a strip that is not N*N x N RGBA throws', () => {
  assert.throws(() => stripToLutData(new Uint8Array(8 * 2 * 4), 8, 2), /N\*N x N, got 8x2/);
  assert.throws(() => stripToLutData(new Uint8Array(0), 0, 0), /N\*N x N/);
  assert.throws(() => stripToLutData(new Uint8Array(4 * 2 * 3), 4, 2), /RGBA, 32 bytes, got 24/);
});

test('lutTexture: a nearest-filtered RGBA byte 3D texture, raw values, clamped, no mipmaps', () => {
  const { pixels, width, height } = strip(4, true);
  const data = stripToLutData(pixels, width, height);
  const texture = lutTexture(data, 4);
  assert.ok(texture.isData3DTexture);
  assert.equal(texture.image.data, data);
  assert.deepEqual([texture.image.width, texture.image.height, texture.image.depth], [4, 4, 4]);
  assert.deepEqual([texture.format, texture.type, texture.colorSpace], [RGBAFormat, UnsignedByteType, NoColorSpace]);
  assert.deepEqual([texture.minFilter, texture.magFilter], [NearestFilter, NearestFilter]);
  assert.deepEqual([texture.wrapS, texture.wrapT, texture.wrapR], [ClampToEdgeWrapping, ClampToEdgeWrapping, ClampToEdgeWrapping]);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.unpackAlignment, 1);
  assert.ok(texture.version > 0, 'needsUpdate');
});

test('acquireLut: one load per key, shared; the last release disposes the texture; other types throw', async () => {
  const assets = createAssetCache();
  const loads = [];
  let disposed = 0;
  const loadLut = async (path) => {
    loads.push(path);
    const texture = new Data3DTexture();
    texture.addEventListener('dispose', () => (disposed += 1));
    return texture;
  };
  const a = await acquireLut(assets.acquire, 'lut.shared32', loadLut);
  const b = await acquireLut(assets.acquire, 'lut.shared32', loadLut);
  assert.equal(a, b);
  assert.ok(a.isData3DTexture);
  assert.deepEqual(loads, ['content/textures/lut/shared.lut32.png']);
  assert.equal(assets.count('lut.shared32'), 2);
  assets.release('lut.shared32');
  await flush();
  assert.equal(disposed, 0);
  assets.release('lut.shared32');
  await flush();
  assert.equal(disposed, 1);
  assert.throws(() => acquireLut(assets.acquire, 'atlas.blocks-placeholder', loadLut), /'atlas.blocks-placeholder' is a texture, not a lut/);
  assert.throws(() => acquireLut(assets.acquire, 'map.walkway', loadLut), /is a map, not a lut/);
  assert.throws(() => acquireLut(assets.acquire, 'lut.nope', loadLut), /unknown asset key/);
});

test('lut.shared32 and lut.shared64: the committed strips are 1024 x 32 and 4096 x 64 8-bit RGB PNGs', () => {
  for (const [key, n] of [['lut.shared32', 32], ['lut.shared64', 64]]) {
    const png = readFileSync(new URL(`../public/${assetByKey(key).path}`, import.meta.url));
    assert.deepEqual([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG', key);
    assert.equal(png.toString('latin1', 12, 16), 'IHDR', key);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [n * n, n, 8, 2], key); // width, height, bit depth, colour type RGB
  }
});
