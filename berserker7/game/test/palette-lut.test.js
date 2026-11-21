// The palette LUT shader patch (scenes/palette-lut.js): composition with the atlas and fog patches,
// insertion points, shared uniforms, cache keys. No browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color, Data3DTexture, MeshBasicMaterial, ShaderLib, Texture, Vector3 } from 'three';
import { FOG_FRAGMENT, LIT_UNIFORMS, addFog, createAtlasMaterial } from '../src/scenes/atlas-material.js';
import { createLightPool } from '../src/scenes/level-lights.js';
import { PALETTE_LUT_FRAGMENT, PALETTE_LUT_PARS, PALETTE_LUT_UNIFORMS, addPaletteLut, bayer8, createPaletteLutUniforms, selectPaletteLut } from '../src/scenes/palette-lut.js';

const LAYOUT = { columns: 7, rows: 4, tileSize: 64 };
const OPAQUE = '#include <opaque_fragment>';
const basicShader = () => ({ vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} });
const compiled = (material) => {
  const shader = basicShader();
  material.onBeforeCompile(shader);
  return shader;
};
const litUniforms = () => ({
  ...createLightPool([]).uniforms,
  litAmbient: { value: new Vector3(0.2, 0.2, 0.2) },
  litFogColor: { value: new Color('#324f5c') },
  litFogDensity: { value: 0.035 },
  litFogOrigin: { value: 4.48 },
});
const lutTexture = () => new Data3DTexture(new Uint8Array(32 * 32 * 32 * 4), 32, 32, 32);

// Index of each part in `text`, asserting each is found once and in this order.
function assertOrder(text, parts) {
  let last = -1;
  for (const part of parts) {
    const at = text.indexOf(part);
    assert.ok(at >= 0, `missing: ${part.slice(0, 40)}`);
    assert.equal(text.indexOf(part, at + 1), -1, `twice: ${part.slice(0, 40)}`);
    assert.ok(at > last, `out of order: ${part.slice(0, 40)}`);
    last = at;
  }
}

test('createPaletteLutUniforms: the texture, its size, mix 1 (on) or 0', () => {
  const texture = lutTexture();
  const u = createPaletteLutUniforms(texture);
  assert.deepEqual(Object.keys(u), [...PALETTE_LUT_UNIFORMS]);
  assert.equal(u.paletteLut.value, texture);
  assert.equal(u.paletteLutSize.value, 32);
  assert.equal(u.paletteLutMix.value, 1);
  assert.equal(createPaletteLutUniforms(texture, false).paletteLutMix.value, 0);
});

test('selectPaletteLut: off sets the mix to 0 and keeps the texture; 32 or 64 sets that texture, its size and mix 1; unknown is off', () => {
  const lut32 = new Data3DTexture(new Uint8Array(32 * 32 * 32 * 4), 32, 32, 32);
  const lut64 = new Data3DTexture(new Uint8Array(64 * 64 * 64 * 4), 64, 64, 64);
  const luts = { 32: lut32, 64: lut64 };
  const u = createPaletteLutUniforms(lut64);
  const objects = PALETTE_LUT_UNIFORMS.map((name) => u[name]);
  const values = () => [u.paletteLut.value, u.paletteLutSize.value, u.paletteLutMix.value];
  assert.equal(selectPaletteLut(u, luts, '32'), u);
  assert.deepEqual(values(), [lut32, 32, 1]);
  selectPaletteLut(u, luts, 'off');
  assert.deepEqual(values(), [lut32, 32, 0]);
  selectPaletteLut(u, luts, '64');
  assert.deepEqual(values(), [lut64, 64, 1]);
  selectPaletteLut(u, luts, 'nope');
  assert.deepEqual(values(), [lut64, 64, 0]);
  assert.deepEqual(PALETTE_LUT_UNIFORMS.map((name) => u[name]), objects, 'the same uniform objects throughout');
});

test('addPaletteLut on a lit atlas material: lighting, LUT step, level fog, opaque_fragment in that order; the atlas patch still applies', () => {
  const lit = litUniforms();
  const lut = createPaletteLutUniforms(lutTexture());
  const material = createAtlasMaterial({ map: new Texture(), layout: LAYOUT, vertexColors: true, lit: { uniforms: lit, emissive: [22, 23] } });
  const before = compiled(material);
  assert.equal(addPaletteLut(material, lut), material);
  assert.equal(material.customProgramCacheKey(), 'block-atlas 7x4 64px lit 22,23 palette-lut');
  const shader = compiled(material);
  // The atlas patch ran unchanged: same vertex shader, and the fragment shader is the lit one with
  // only the LUT declarations and step added.
  assert.equal(shader.vertexShader, before.vertexShader);
  assert.equal(shader.fragmentShader, before.fragmentShader.replace('#include <common>', `#include <common>${PALETTE_LUT_PARS}`).replace(FOG_FRAGMENT, `${PALETTE_LUT_FRAGMENT}${FOG_FRAGMENT}`));
  assertOrder(shader.fragmentShader, ['uniform highp sampler3D paletteLut;', 'outgoingLight *= litLight;', PALETTE_LUT_FRAGMENT, FOG_FRAGMENT, OPAQUE, '#include <colorspace_fragment>']);
  // Uniforms: the lit ones and the three LUT ones, all the shared objects.
  for (const name of LIT_UNIFORMS) assert.equal(shader.uniforms[name], lit[name], name);
  for (const name of PALETTE_LUT_UNIFORMS) assert.equal(shader.uniforms[name], lut[name], name);
  assert.equal(Object.keys(shader.uniforms).length, LIT_UNIFORMS.length + PALETTE_LUT_UNIFORMS.length);
  // The step: encode to sRGB, nearest lookup, decode, mix by the switch.
  for (const line of ['sRGBTransferOETF(vec4(outgoingLight, 1.0)).rgb', 'texture(paletteLut, paletteLutUvw(lutIn, paletteLutSize))', 'mix(outgoingLight, sRGBTransferEOTF(vec4(lutOut, 1.0)).rgb, paletteLutMix)']) assert.ok(shader.fragmentShader.includes(line), line);
});

test('addPaletteLut on addFog (the lit backdrop): the step goes just before the fog; on an unlit atlas material and a plain one, just before opaque_fragment', () => {
  const lut = createPaletteLutUniforms(lutTexture());
  const fogged = addPaletteLut(addFog(new MeshBasicMaterial({ color: '#ffffff', vertexColors: true }), litUniforms()), lut);
  assert.equal(fogged.customProgramCacheKey(), 'level-fog palette-lut');
  const f = compiled(fogged).fragmentShader;
  assert.ok(f.includes(`${PALETTE_LUT_FRAGMENT}${FOG_FRAGMENT}\n${OPAQUE}`));
  assert.deepEqual(Object.keys(compiled(fogged).uniforms).sort(), ['litFogColor', 'litFogDensity', 'litFogOrigin', ...PALETTE_LUT_UNIFORMS].sort());

  const atlas = addPaletteLut(createAtlasMaterial({ map: new Texture(), layout: LAYOUT }), lut);
  assert.equal(atlas.customProgramCacheKey(), 'block-atlas 7x4 64px palette-lut');
  const atlasShader = compiled(atlas);
  assert.ok(atlasShader.vertexShader.includes('attribute vec3 atlasTile;'), 'the atlas UV patch still applies');
  assert.ok(atlasShader.fragmentShader.includes(`${PALETTE_LUT_FRAGMENT}${OPAQUE}`));

  const plain = addPaletteLut(new MeshBasicMaterial({ color: 0xf2c14e }), lut);
  assert.equal(plain.customProgramCacheKey(), 'palette-lut');
  const plainShader = compiled(plain);
  assert.equal(plainShader.vertexShader, basicShader().vertexShader);
  assert.equal(plainShader.fragmentShader, basicShader().fragmentShader.replace('#include <common>', `#include <common>${PALETTE_LUT_PARS}`).replace(OPAQUE, `${PALETTE_LUT_FRAGMENT}${OPAQUE}`));
  for (const name of PALETTE_LUT_UNIFORMS) assert.equal(plainShader.uniforms[name], lut[name], name);
});

test('addPaletteLut: one shared set of uniform objects across materials; a plain material keeps its own cache key apart', () => {
  const lut = createPaletteLutUniforms(lutTexture());
  const a = compiled(addPaletteLut(new MeshBasicMaterial(), lut)).uniforms;
  const b = compiled(addPaletteLut(new MeshBasicMaterial({ vertexColors: true }), lut)).uniforms;
  for (const name of PALETTE_LUT_UNIFORMS) assert.equal(a[name], b[name], name);
  // Not patched: three's default key (the onBeforeCompile source), never 'palette-lut'.
  assert.notEqual(new MeshBasicMaterial().customProgramCacheKey(), 'palette-lut');
});

// Every preprocessor line (#include, #ifdef, ...) of a patched shader starts its own line: GLSL
// rejects a directive after other text on the same line, and Node cannot compile GLSL to see it.
test('addPaletteLut: every preprocessor directive in the patched fragment shaders starts its own line', () => {
  const lut = createPaletteLutUniforms(lutTexture());
  const materials = {
    plain: addPaletteLut(new MeshBasicMaterial({ color: 0xf2c14e }), lut),
    unlitAtlas: addPaletteLut(createAtlasMaterial({ map: new Texture(), layout: LAYOUT }), lut),
    litAtlas: addPaletteLut(createAtlasMaterial({ map: new Texture(), layout: LAYOUT, vertexColors: true, lit: { uniforms: litUniforms(), emissive: [3] } }), lut),
    fogged: addPaletteLut(addFog(new MeshBasicMaterial({ color: '#ffffff', vertexColors: true }), litUniforms()), lut),
  };
  for (const [name, material] of Object.entries(materials)) {
    const { vertexShader, fragmentShader } = compiled(material);
    for (const [stage, text] of [['vertex', vertexShader], ['fragment', fragmentShader]]) {
      for (const line of text.split('\n')) {
        const at = line.indexOf('#');
        if (at > 0) assert.equal(line.slice(0, at).trim(), '', `${name} ${stage}: directive after other text: ${line.trim()}`);
      }
    }
  }
});

test('addPaletteLut: a fragment shader with neither the fog nor opaque_fragment throws', () => {
  const material = addPaletteLut(new MeshBasicMaterial(), createPaletteLutUniforms(lutTexture()));
  const shader = { vertexShader: 'void main() {}', fragmentShader: '#include <common>\nvoid main() { gl_FragColor = vec4(1.0); }', uniforms: {} };
  assert.throws(() => material.onBeforeCompile(shader), /no insertion point/);
});

// Bayer dithering trial (#127).

test('bayer8: the 8 x 8 Bayer matrix (recursive definition), every index 0..63 once', () => {
  let m = [[0]];
  for (let k = 0; k < 3; k++) {
    const n = m.length;
    m = Array.from({ length: 2 * n }, (_, y) => Array.from({ length: 2 * n }, (_, x) => 4 * m[y % n][x % n] + [[0, 2], [3, 1]][y >= n ? 1 : 0][x >= n ? 1 : 0]));
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) assert.equal(bayer8(x, y), m[y][x], `${x}, ${y}`);
  assert.deepEqual(Array.from({ length: 8 }, (_, x) => bayer8(x, 0)), [0, 32, 8, 40, 2, 34, 10, 42]);
  assert.equal(bayer8(9, 17), bayer8(1, 1), 'repeats every 8 px');
  // The GLSL copy uses the same expression.
  assert.ok(PALETTE_LUT_PARS.includes('((e & 1) << 5) | ((q.y & 1) << 4) | ((e & 2) << 2) | ((q.y & 2) << 1) | ((e & 4) >> 1) | ((q.y & 4) >> 2)'));
});

test('selectPaletteLut: the dither strength is written while the LUT is on, 0 while it is off or not a number', () => {
  const lut64 = new Data3DTexture(new Uint8Array(64 * 64 * 64 * 4), 64, 64, 64);
  const u = createPaletteLutUniforms(lut64);
  assert.equal(u.paletteDither.value, 0, 'off at start');
  selectPaletteLut(u, { 64: lut64 }, '64', 0.08);
  assert.equal(u.paletteDither.value, 0.08);
  selectPaletteLut(u, { 64: lut64 }, 'off', 0.08);
  assert.equal(u.paletteDither.value, 0, 'LUT off: no dither');
  selectPaletteLut(u, { 64: lut64 }, '64', Number.NaN);
  assert.equal(u.paletteDither.value, 0);
  selectPaletteLut(u, { 64: lut64 }, '64');
  assert.equal(u.paletteDither.value, 0, 'default 0');
});

test('dither: only the block atlas materials (lit and unlit) define the texel, at vMapUv x the atlas size; the nudge comes just before the LUT read', () => {
  const lut = createPaletteLutUniforms(lutTexture());
  const define = '#define PALETTE_DITHER_TEXEL (vMapUv * vec2(448.0, 256.0))';
  const atlases = [createAtlasMaterial({ map: new Texture(), layout: LAYOUT }), createAtlasMaterial({ map: new Texture(), layout: LAYOUT, vertexColors: true, lit: { uniforms: litUniforms(), emissive: [3] } })];
  for (const material of atlases) {
    const f = compiled(addPaletteLut(material, lut)).fragmentShader;
    assertOrder(f, ['uniform float paletteDither;', define, 'void main()', 'lutIn += (paletteBayer8(PALETTE_DITHER_TEXEL) - 0.5) * paletteDither;', 'texture(paletteLut, paletteLutUvw(lutIn, paletteLutSize))']);
  }
  for (const material of [new MeshBasicMaterial({ color: 0xf2c14e }), addFog(new MeshBasicMaterial({ color: '#ffffff' }), litUniforms())]) {
    assert.ok(!compiled(addPaletteLut(material, lut)).fragmentShader.includes('#define PALETTE_DITHER_TEXEL'));
  }
  assertOrder(PALETTE_LUT_FRAGMENT, ['sRGBTransferOETF', '#ifdef PALETTE_DITHER_TEXEL', 'paletteDither', '#endif', 'texture(paletteLut']);
});
