import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { CAMERA_TILES_MAX, CAMERA_TILES_MIN, createCameraZoom, createSandbox, snapCamera } from '../src/scenes/sandbox.js';
import { FRONT_FACE, PIXEL_SCALE_MODES, bufferSize, pixelScaleFor, scaleTiles, snapAxis } from '../src/scenes/pixel-snap.js';
import { createViewMode } from '../src/scenes/sandbox-3d.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { fakeLoadLut } from './fakes.js';

const json = () => JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
const TEXELS = loadGridMap(json()).tileSize;

test('pixel snap helpers: buffer size, scale tiles, auto scale, snapAxis', () => {
  assert.deepEqual(PIXEL_SCALE_MODES, ['off', 'auto', '1', '2', '3', '4']);
  assert.deepEqual(bufferSize({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.deepEqual(bufferSize({ width: 1281, height: 721, renderer: { getPixelRatio: () => 1.5 } }), { width: 1921, height: 1081 });
  assert.equal(scaleTiles(720, 64, 1), 11.25);
  assert.equal(scaleTiles(2160, 64, 3), 11.25);
  assert.equal(pixelScaleFor('off', 720, 64, 12, 8, 28), 0);
  assert.equal(pixelScaleFor('bogus', 720, 64, 12, 8, 28), 0);
  assert.equal(pixelScaleFor('3', 720, 64, 12, 8, 28), 3); // fixed k ignores the range
  // 720 px: k 1 = 11.25 tiles (k 2 = 5.6 is under 8). 2160 px: 33.75, 16.9, 11.25, 8.4 tiles.
  assert.equal(pixelScaleFor('auto', 720, 64, 28, 8, 28), 1);
  assert.equal(pixelScaleFor('auto', 2160, 64, 12, 8, 28), 3);
  assert.equal(pixelScaleFor('auto', 2160, 64, 8, 8, 28), 4);
  assert.equal(pixelScaleFor('auto', 2160, 64, 28, 8, 28), 2); // 33.75 is over 28
  assert.equal(pixelScaleFor('auto', 400, 64, 12, 8, 28), 1); // nothing fits: 1
  // World 0 lands on a pixel edge: camera x pxPerTile - size / 2 is whole.
  for (const [cam, px, size] of [[10.37, 60, 1280], [-3.2, 56.25, 721], [101.999, 0.94 * 64, 1081]]) {
    const snapped = snapAxis(cam, px, size);
    const edge = snapped * px - size / 2;
    assert.ok(Math.abs(edge - Math.round(edge)) < 1e-9, `${cam} ${px} ${size}`);
    assert.ok(Math.abs(snapped - cam) <= 0.5 / px + 1e-12);
  }
});

test('viewMode: pixel snap and pixel scale, off by default, unknown modes ignored', () => {
  const viewMode = createViewMode();
  assert.equal(viewMode.pixelSnap(), false);
  assert.equal(viewMode.pixelScale(), 'off');
  assert.equal(viewMode.setPixelSnap(1), true);
  assert.equal(viewMode.setPixelScale('2'), '2');
  assert.equal(viewMode.setPixelScale('5'), '2');
  assert.deepEqual(viewMode.pixelDrawn(), { scale: 0, tilesHigh: 0 });
});

// Draws once and returns the screen position (buffer pixels, x right, y down) of world points.
async function setup({ mode, width = 1280, height = 720, ratio = 1 }) {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera), getPixelRatio: () => ratio };
  const viewMode = createViewMode({ mode });
  const zoom = createCameraZoom();
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode, zoom, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width, height, setAimOrigin() {} };
  const buffer = { width: Math.floor(width * ratio), height: Math.floor(height * ratio) };
  const draw = (x, y) => {
    state.players[0].x = x;
    state.players[0].y = y;
    snapCamera(state);
    scene.draw(state, view);
    rendered.updateMatrixWorld();
    return (wx, wy, wz) => {
      const p = new Vector3(wx, wy, wz).project(rendered);
      return { x: ((p.x + 1) / 2) * buffer.width, y: ((1 - p.y) / 2) * buffer.height };
    };
  };
  return { viewMode, zoom, draw, camera: () => rendered };
}

const frac = (v) => v - Math.floor(v);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

for (const mode of ['2d', '2.5d']) {
  const z = mode === '2d' ? 0 : FRONT_FACE; // the snap plane on row 0
  test(`pixel snap (${mode}): world 0 on the snap plane is on a pixel edge, other texels keep their phase`, async () => {
    const { viewMode, draw } = await setup({ mode, width: 1281, height: 721, ratio: 1.5 });
    viewMode.setPixelSnap(true);
    let phase;
    for (const x of [10, 10.013, 10.4567, 11.9]) {
      const project = draw(x, 3.0071);
      const a = project(0, 0, z);
      const b = project(5 + 7 / 64, 2 + 33 / 64, z);
      assert.ok(near(frac(a.x + 1e-7), 1e-7, 1e-5) && near(frac(a.y + 1e-7), 1e-7, 1e-5), `x ${x}: ${a.x}, ${a.y}`);
      // Another texel keeps the same sub-pixel phase in every frame (its value depends only on the scale).
      if (!phase) phase = [frac(b.x), frac(b.y)];
      else assert.ok(near(frac(b.x), phase[0], 1e-5) && near(frac(b.y), phase[1], 1e-5), `x ${x}`);
    }
  });

  test(`pixel scale (${mode}): one texture pixel on the snap plane is k buffer pixels`, async () => {
    for (const [width, height, ratio] of [[1280, 720, 1], [1920, 1080, 1], [1280, 720, 2], [1920, 1080, 2]]) {
      const { viewMode, draw } = await setup({ mode, width, height, ratio });
      for (const k of ['1', '2', '3', 'auto']) {
        viewMode.setPixelScale(k);
        const project = draw(10.3, 3.2);
        const drawn = viewMode.pixelDrawn();
        const a = project(4, 1, z);
        const b = project(4 + 1 / TEXELS, 1 + 1 / TEXELS, z);
        assert.ok(near(b.x - a.x, drawn.scale, 1e-6) && near(a.y - b.y, drawn.scale, 1e-6), `${width}x${height}@${ratio} ${k}: ${b.x - a.x}, ${a.y - b.y}`);
        if (k !== 'auto') assert.equal(drawn.scale, Number(k));
        else assert.ok(drawn.tilesHigh >= CAMERA_TILES_MIN && drawn.tilesHigh <= CAMERA_TILES_MAX);
      }
    }
  });

  test(`pixel snap and scale off (${mode}): the camera is the same as without them`, async () => {
    const { viewMode, draw, camera } = await setup({ mode });
    draw(10.37, 3.21);
    const before = camera().projectionMatrix.clone();
    const position = camera().position.clone();
    viewMode.setPixelSnap(true);
    draw(10.37, 3.21);
    assert.notDeepEqual(camera().position.toArray(), position.toArray());
    viewMode.setPixelSnap(false);
    draw(10.37, 3.21);
    assert.deepEqual(camera().position.toArray(), position.toArray());
    assert.deepEqual(camera().projectionMatrix.toArray(), before.toArray());
    assert.deepEqual(viewMode.pixelDrawn(), { scale: 0, tilesHigh: 0 });
  });
}

test('pixel snap (2.5D, row camera off): the snap plane is the player row front face', async () => {
  const { viewMode, draw } = await setup({ mode: '2.5d' });
  viewMode.setRowCamera(false);
  viewMode.setPixelScale('2');
  viewMode.setPixelSnap(true);
  const project = draw(10.37, 3.21); // row 0
  const a = project(4, 1, FRONT_FACE);
  const b = project(4 + 1 / TEXELS, 1, FRONT_FACE);
  assert.ok(near(b.x - a.x, 2) && near(frac(a.x + 1e-7), 1e-7, 1e-5), `${a.x} ${b.x}`);
});
