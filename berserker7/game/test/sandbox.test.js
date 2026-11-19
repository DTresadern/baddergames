import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createSandbox,
  createCameraZoom,
  CAMERA_TILES_HIGH,
  CAMERA_TILES_MAX,
  CAMERA_TILES_MIN,
  MAP_KEY,
  initSandbox,
  tickSandbox,
} from '../src/scenes/sandbox.js';
import { TILE_CHECKER, checkerPixels, createTileTexture } from '../src/scenes/tile-texture.js';
import { NearestFilter } from 'three';
import { DEPTH_CUBE_SPACING, createViewMode, depthCubes, perspectiveDistance } from '../src/scenes/sandbox-3d.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { MOVE } from '../src/world/player.js';
import { frame } from './frames.js';
import { STEP } from './fakes.js';

const json = () => JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
const map = loadGridMap(json());

test('initSandbox: plain state, the player stands at the first player spawn', () => {
  const state = initSandbox(map);
  const spawn = map.spawns.find((s) => s.type === 'player');
  assert.deepEqual(state, { ticks: 0, map: MAP_KEY, player: { x: spawn.x + 0.5, y: spawn.y, vx: 0, vy: 0, onGround: false, aim: 0 } });
  assert.deepEqual(structuredClone(state), state);
  assert.throws(() => initSandbox({ name: 'x', spawns: [] }), /no player spawn/);
});

test('tickSandbox: player 1 input moves the player, ticks count, the state stays cloneable', () => {
  const state = initSandbox(map);
  const start = state.player.x;
  for (let i = 0; i < 60; i++) tickSandbox(state, [frame(['moveRight'])], STEP, map.tiles);
  assert.equal(state.ticks, 60);
  assert.ok(state.player.x > start + 1);
  assert.equal(state.player.onGround, true);
  assert.deepEqual(structuredClone(state), state);
  tickSandbox(state, [], STEP, map.tiles); // no input frames: no throw
  assert.equal(state.ticks, 61);
});

test('sandbox draw: the camera shows CAMERA_TILES_HIGH tiles and follows the player centre', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const scene = createSandbox({ viewMode: createViewMode({ mode: '2d' }), fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  state.player.x = 10;
  state.player.y = 5;
  const origins = [];
  scene.draw(state, { renderer, width: 800, height: 600, setAimOrigin: (...args) => origins.push(args) });
  assert.equal(rendered.top - rendered.bottom, CAMERA_TILES_HIGH);
  assert.equal(rendered.right - rendered.left, (CAMERA_TILES_HIGH * 800) / 600);
  assert.deepEqual([rendered.position.x, rendered.position.y], [10, 5 + MOVE.height / 2]);
  // Aim origin: the head (top centre of the box), MOVE.height / 2 tiles above the view centre.
  const tilePx = 600 / CAMERA_TILES_HIGH;
  assert.equal(origins.length, 1);
  const [player, px, py] = origins[0];
  assert.deepEqual([player, px], [0, 400]);
  assert.ok(Math.abs(py - (300 - (MOVE.height / 2) * tilePx)) < 1e-9, `py ${py}`);
});

test('sandbox scene: ticks while uncovered, draws when covered, suspends on leave', () => {
  assert.deepEqual(createSandbox().settings, { tick: 'uncovered', drawCovered: true, leave: 'suspend' });
});

test('createCameraZoom: whole tiles, clamped to the limits, bad values ignored', () => {
  assert.deepEqual([CAMERA_TILES_MIN, CAMERA_TILES_HIGH, CAMERA_TILES_MAX], [18, 22, 28]);
  const zoom = createCameraZoom();
  assert.equal(zoom.get(), CAMERA_TILES_HIGH);
  assert.equal(zoom.set(25.4), 25);
  assert.equal(zoom.set(5), CAMERA_TILES_MIN);
  assert.equal(zoom.set(500), CAMERA_TILES_MAX);
  assert.equal(zoom.set(NaN), CAMERA_TILES_MAX);
});

test('sandbox draw: the camera follows the zoom holder live', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const zoom = createCameraZoom();
  const scene = createSandbox({ zoom, viewMode: createViewMode({ mode: '2d' }), fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  scene.draw(state, view);
  assert.equal(rendered.top - rendered.bottom, CAMERA_TILES_HIGH);
  zoom.set(26);
  scene.draw(state, view);
  assert.equal(rendered.top - rendered.bottom, 26);
});

test('tile texture: 8 px checker of the legend colour and a slightly lighter shade, nearest filtering, no mipmaps', () => {
  const data = checkerPixels(64, '#6b7a8f');
  const at = (x, y) => [...data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
  assert.equal(TILE_CHECKER.square, 8);
  assert.deepEqual(at(0, 0), [0x6b, 0x7a, 0x8f, 255]);
  assert.deepEqual(at(7, 7), at(0, 0));
  assert.deepEqual(at(8, 0), at(0, 8));
  assert.deepEqual(at(8, 8), at(0, 0));
  const lighter = at(8, 0);
  for (let i = 0; i < 3; i++) assert.ok(lighter[i] > at(0, 0)[i] && lighter[i] - at(0, 0)[i] < 20, `channel ${i}`);
  const texture = createTileTexture(64, '#6b7a8f');
  assert.equal(texture.magFilter, NearestFilter);
  assert.equal(texture.minFilter, NearestFilter);
  assert.equal(texture.generateMipmaps, false);
});

test('createViewMode: 2.5D and FOV 15 by default; unknown modes ignored; FOV whole degrees, 1 to 60', () => {
  const v = createViewMode();
  assert.deepEqual([v.mode(), v.fov()], ['2.5d', 15]);
  assert.equal(v.setMode('2d'), '2d');
  assert.equal(v.setMode('3d'), '2d');
  assert.equal(v.setFov(0), 1);
  assert.equal(v.setFov(90), 60);
  assert.equal(v.setFov(29.6), 30);
});

test('sandbox draw 2.5D: the play plane shows the zoom height at any FOV, live mode switch', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const viewMode = createViewMode();
  const zoom = createCameraZoom();
  const scene = createSandbox({ zoom, viewMode, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const origins = [];
  const view = { renderer, width: 800, height: 600, setAimOrigin: (...a) => origins.push(a) };
  for (const fov of [1, 15, 60]) {
    viewMode.setFov(fov);
    scene.draw(state, view);
    assert.equal(rendered.isPerspectiveCamera, true);
    const d = rendered.position.z;
    assert.ok(Math.abs(d - perspectiveDistance(zoom.get(), fov)) < 1e-9);
    // Height of the view at z = 0.
    assert.ok(Math.abs(2 * d * Math.tan((rendered.fov * Math.PI) / 360) - zoom.get()) < 1e-9, `fov ${fov}`);
    assert.ok(rendered.near < d - 1.5 && rendered.far > d + 1.5, 'cubes at z ±1.5 not clipped');
  }
  // Same aim origin as in 2D: head MOVE.height / 2 above the view centre.
  assert.deepEqual(origins.at(-1).slice(0, 2), [0, 400]);
  assert.ok(Math.abs(origins.at(-1)[2] - (300 - (MOVE.height / 2) * (600 / zoom.get()))) < 1e-9);
  viewMode.setMode('2d');
  scene.draw(state, view);
  assert.equal(rendered.isOrthographicCamera, true);
});

test('depthCubes: deterministic, every few columns, on the ground surface, off the play plane', () => {
  const a = depthCubes(map.tiles);
  assert.deepEqual(depthCubes(map.tiles), a);
  assert.ok(a.length > 10);
  assert.ok(a.some((c) => c.z === 1) && a.some((c) => c.z === -1));
  for (const c of a) {
    assert.equal(c.x % DEPTH_CUBE_SPACING, 0);
    assert.ok(c.z === 1 || c.z === -1);
    assert.equal(map.tiles.isSolid(c.x, c.y), false, `cube at ${c.x},${c.y} is in empty space`);
    assert.equal(map.tiles.isSolid(c.x, c.y - 1), true, `cube at ${c.x},${c.y} sits on ground`);
  }
});
