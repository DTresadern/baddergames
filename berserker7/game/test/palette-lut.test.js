// The palette LUT shader patch (scenes/palette-lut.js): composition with the atlas and fog patches,
// insertion points, shared uniforms, cache keys. No browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color, Data3DTexture, MeshBasicMaterial, ShaderLib, Texture, Vector3 } from 'three';
import { FOG_FRAGMENT, LIT_UNIFORMS, addFog, createAtlasMaterial } from '../src/scenes/atlas-material.js';
import { createLightPool } from '../src/scenes/level-lights.js';
import { PALETTE_LUT_FRAGMENT, PALETTE_LUT_PARS, PALETTE_LUT_UNIFORMS, addPaletteLut, createPaletteLutUniforms } from '../src/scenes/palette-lut.js';

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

test('addPaletteLut: a fragment shader with neither the fog nor opaque_fragment throws', () => {
  const material = addPaletteLut(new MeshBasicMaterial(), createPaletteLutUniforms(lutTexture()));
  const shader = { vertexShader: 'void main() {}', fragmentShader: '#include <common>\nvoid main() { gl_FragColor = vec4(1.0); }', uniforms: {} };
  assert.throws(() => material.onBeforeCompile(shader), /no insertion point/);
});
