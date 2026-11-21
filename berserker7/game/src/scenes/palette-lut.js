// Palette LUT for the Sandbox: solid surfaces snap to the shared 256-colour palette through a 3D
// colour lookup table (assets/luts.js, manifest key `lut.shared`), read in their own shaders; the
// level fog stays smooth. `addPaletteLut` patches a MeshBasicMaterial; one set of uniform objects
// (createPaletteLutUniforms) is shared by every patched material, so one write of
// paletteLutMix.value (1 on, 0 off) switches them all: no define, no recompile, no new programs or
// draw calls.
//
// Where the step goes: the LUT maps final screen colours (sRGB-encoded, after tone mapping) to
// palette colours. The game's renderer (main.js: `new WebGLRenderer({ antialias: true })`, three
// r187) keeps three's defaults, NoToneMapping and SRGBColorSpace output, and renders straight to
// the canvas, so a MeshBasicMaterial's screen colour is sRGBTransferOETF(outgoingLight)
// (colorspace_fragment, after opaque_fragment and tonemapping_fragment). The level fog
// (atlas-material.js FOG_FRAGMENT, lit atlas materials and addFog) mixes into outgoingLight in
// linear space before opaque_fragment; three's own fog is unused (no scene.fog). So the step runs
// on outgoingLight just before the level fog, or just before opaque_fragment in a material
// without it: encode to sRGB, look up (nearest: exactly one palette entry), decode back to linear,
// mix by paletteLutMix. colorspace_fragment re-encodes; with fog 0 and mix 1 the written 8-bit
// value is the palette entry (the encode / decode round trip error is far below half a code
// value); with mix 0 mix() returns the original colour. sRGBTransferOETF / EOTF come from
// colorspace_pars_fragment, which three puts in every fragment shader's prefix; three's WebGL2
// programs are GLSL 3 (#version 300 es), so texture() on a sampler3D works.

import { FOG_FRAGMENT } from './atlas-material.js';

// The shared uniform names (three.js uniform objects { value }): paletteLut (the Data3DTexture),
// paletteLutSize (entries per channel) and paletteLutMix (1 on, 0 off).
export const PALETTE_LUT_UNIFORMS = Object.freeze(['paletteLut', 'paletteLutSize', 'paletteLutMix']);

// One set for a whole scene; draw writes paletteLutMix.value.
export function createPaletteLutUniforms(texture, on = true) {
  return { paletteLut: { value: texture }, paletteLutSize: { value: texture.image.width }, paletteLutMix: { value: on ? 1 : 0 } };
}

const OPAQUE_FRAGMENT = '#include <opaque_fragment>';

// Fragment declarations (after #include <common>). lutUvw maps a 0..1 colour onto texel centres,
// so 0 and 1 hit the first and last entries exactly.
export const PALETTE_LUT_PARS = `
uniform highp sampler3D paletteLut;
uniform float paletteLutSize;
uniform float paletteLutMix;
vec3 paletteLutUvw(vec3 c, float size) {
  return (clamp(c, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
}`;

// The step on outgoingLight (linear), see the header. It ends with a newline: the text after it
// can be a preprocessor line (#include <opaque_fragment>), which must start its own line.
export const PALETTE_LUT_FRAGMENT = `
{
  vec3 lutIn = sRGBTransferOETF(vec4(outgoingLight, 1.0)).rgb;
  vec3 lutOut = texture(paletteLut, paletteLutUvw(lutIn, paletteLutSize)).rgb;
  outgoingLight = mix(outgoingLight, sRGBTransferEOTF(vec4(lutOut, 1.0)).rgb, paletteLutMix);
}
`;

// Patches a MeshBasicMaterial with the palette LUT step, composed with any patch it already has
// (atlas-material.js sets onBeforeCompile and customProgramCacheKey): the previous onBeforeCompile
// runs first, then the step goes in just before FOG_FRAGMENT if the fragment shader has it, else
// just before opaque_fragment; neither found throws. `uniforms`: createPaletteLutUniforms's shared
// objects. The cache key is the previous own key (or none) plus ' palette-lut', so LUT and non-LUT
// programs are never shared. Returns the material.
export function addPaletteLut(material, uniforms) {
  const previous = material.onBeforeCompile;
  const previousKey = Object.hasOwn(material, 'customProgramCacheKey') ? material.customProgramCacheKey : null;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    const f = shader.fragmentShader;
    const anchor = f.includes(FOG_FRAGMENT) ? FOG_FRAGMENT : f.includes(OPAQUE_FRAGMENT) ? OPAQUE_FRAGMENT : null;
    if (anchor === null || !f.includes('#include <common>')) throw new Error('addPaletteLut: no insertion point in the fragment shader');
    shader.fragmentShader = f.replace('#include <common>', `#include <common>${PALETTE_LUT_PARS}`).replace(anchor, () => `${PALETTE_LUT_FRAGMENT}${anchor}`);
    for (const name of PALETTE_LUT_UNIFORMS) shader.uniforms[name] = uniforms[name];
  };
  const key = previousKey ? `${previousKey.call(material)} palette-lut` : 'palette-lut';
  material.customProgramCacheKey = () => key;
  return material;
}
