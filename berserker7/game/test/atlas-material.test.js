import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color, MeshBasicMaterial, ShaderLib, Texture, Vector3 } from 'three';
import { LIT_UNIFORMS, addFog, createAtlasMaterial } from '../src/scenes/atlas-material.js';
import { MAX_LIGHTS, createLightPool } from '../src/scenes/level-lights.js';

const LAYOUT = { columns: 7, rows: 4, tileSize: 64 };

// What three hands onBeforeCompile for a MeshBasicMaterial (a fresh copy each time).
const basicShader = () => ({ vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} });
const compiled = (material) => {
  const shader = basicShader();
  material.onBeforeCompile(shader);
  return shader;
};

// The shared level uniforms, as the Sandbox makes them.
const litUniforms = () => ({
  ...createLightPool([]).uniforms,
  litAmbient: { value: new Vector3(0.2, 0.2, 0.2) },
  litFogColor: { value: new Color('#324f5c') },
  litFogDensity: { value: 0.035 },
  litFogOrigin: { value: 4.48 },
});

test('createAtlasMaterial without lit: the same shader and cache key as before lighting', () => {
  const map = new Texture();
  const material = createAtlasMaterial({ map, layout: LAYOUT, vertexColors: true, color: new Color(0.5, 0.5, 0.5) });
  assert.ok(material.isMeshBasicMaterial);
  assert.equal(material.map, map);
  assert.equal(material.vertexColors, true);
  assert.equal(material.customProgramCacheKey(), 'block-atlas 7x4 64px');
  const shader = compiled(material);
  // The atlas UV lines only: the vertex shader gets the two attributes and the UV chunk; the
  // fragment shader and uniforms are three's own.
  const base = basicShader();
  assert.equal(shader.fragmentShader, base.fragmentShader);
  assert.deepEqual(shader.uniforms, {});
  const expectedVertex = base.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 atlasTile;\nattribute float atlasFace;')
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_MAP
{
  float atlasT = atlasFace < 0.5 ? atlasTile.x : (atlasFace < 1.5 ? atlasTile.y : atlasTile.z);
  float atlasRow = floor((atlasT + 0.5) / 7.0);
  float atlasCol = atlasT - atlasRow * 7.0;
  vec2 atlasLocal = 0.0078125 + uv * (1.0 - 2.0 * 0.0078125);
  vMapUv = vec2((atlasCol + atlasLocal.x) / 7.0, (4.0 - 1.0 - atlasRow + atlasLocal.y) / 4.0);
}
#endif`,
    );
  assert.equal(shader.vertexShader, expectedVertex);
  assert.ok(!shader.vertexShader.includes('lit'));
});

test('createAtlasMaterial with lit: shared uniform objects, the light loop, emissive tiles and fog; its own cache key', () => {
  const uniforms = litUniforms();
  const a = createAtlasMaterial({ map: new Texture(), layout: LAYOUT, vertexColors: true, lit: { uniforms, emissive: [22, 23, 24, 25, 26] } });
  const b = createAtlasMaterial({ map: new Texture(), layout: LAYOUT, lit: { uniforms, emissive: [22, 23, 24, 25, 26] } });
  assert.equal(a.customProgramCacheKey(), 'block-atlas 7x4 64px lit 22,23,24,25,26');
  const [sa, sb] = [compiled(a), compiled(b)];
  for (const name of LIT_UNIFORMS) {
    assert.ok(uniforms[name], name);
    assert.equal(sa.uniforms[name], uniforms[name], `${name}: the shared object`);
    assert.equal(sb.uniforms[name], uniforms[name], name);
  }
  assert.equal(Object.keys(sa.uniforms).length, LIT_UNIFORMS.length);
  // Every insertion point was found (a missed replace would leave the shader unlit).
  const base = basicShader();
  for (const anchor of ['#include <common>', '#include <uv_vertex>', '#include <worldpos_vertex>']) assert.ok(base.vertexShader.includes(anchor), anchor);
  for (const anchor of ['#include <common>', '#include <opaque_fragment>']) assert.ok(base.fragmentShader.includes(anchor), anchor);
  const v = sa.vertexShader;
  const f = sa.fragmentShader;
  assert.ok(v.includes('attribute vec3 atlasTile;') && v.includes('vMapUv = vec2('), 'the atlas UV chunk is kept');
  assert.ok(v.includes('litWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;'));
  assert.ok(v.includes('litWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);'));
  assert.ok(v.includes('litEmissive = (abs(litT - 22.0) < 0.5 || abs(litT - 23.0) < 0.5 || abs(litT - 24.0) < 0.5 || abs(litT - 25.0) < 0.5 || abs(litT - 26.0) < 0.5) ? 1.0 : 0.0;'));
  assert.ok(v.indexOf('litWorldPos =') > v.indexOf('#include <worldpos_vertex>'), 'after transformed is final');
  assert.ok(f.includes(`uniform vec3 litLightPos[${MAX_LIGHTS}];`) && f.includes(`for (int i = 0; i < ${MAX_LIGHTS}; i++)`));
  assert.ok(f.includes('step(0.0, dot(litWorldNormal, litL))'), 'facing test');
  assert.ok(f.includes('litLight = mix(litLight, vec3(1.0), litEmissive);'));
  assert.ok(f.includes('1.0 - exp(-litFogDensity * max(litFogOrigin - litWorldPos.z, 0.0))'));
  assert.ok(f.indexOf('outgoingLight *= litLight;') < f.indexOf('#include <opaque_fragment>'));
  assert.ok(f.indexOf('mix(outgoingLight, litFogColor, litFog)') < f.indexOf('#include <opaque_fragment>'));
  // Another emissive list is another program; no emissive tiles: never emissive.
  const none = createAtlasMaterial({ map: new Texture(), layout: LAYOUT, lit: { uniforms, emissive: [] } });
  assert.equal(none.customProgramCacheKey(), 'block-atlas 7x4 64px lit ');
  assert.ok(compiled(none).vertexShader.includes('litEmissive = (false) ? 1.0 : 0.0;'));
});

test('addFog: any MeshBasicMaterial gets the fog only, with the shared fog uniforms and its own cache key', () => {
  const uniforms = litUniforms();
  const material = new MeshBasicMaterial({ color: '#ffffff', vertexColors: true });
  assert.equal(addFog(material, uniforms), material);
  assert.equal(material.customProgramCacheKey(), 'level-fog');
  const shader = compiled(material);
  assert.deepEqual(Object.keys(shader.uniforms).sort(), ['litFogColor', 'litFogDensity', 'litFogOrigin']);
  for (const name of Object.keys(shader.uniforms)) assert.equal(shader.uniforms[name], uniforms[name], name);
  assert.ok(shader.vertexShader.includes('litWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;'));
  assert.ok(shader.fragmentShader.includes('mix(outgoingLight, litFogColor, litFog)'));
  assert.ok(!shader.fragmentShader.includes('litLightPos'), 'no lights');
});
