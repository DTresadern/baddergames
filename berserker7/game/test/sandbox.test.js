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
  snapCamera,
  initSandbox,
  playerHead,
  tickSandbox,
} from '../src/scenes/sandbox.js';
import { TILE_CHECKER, checkerPixels, createTileTexture } from '../src/scenes/tile-texture.js';
import { NearestFilter } from 'three';
import { DEPTH_CUBE_SPACING, OFFSET_DEFAULT, cameraShift, createViewMode, depthCubes, perspectiveDistance } from '../src/scenes/sandbox-3d.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { PLAYER_SIZE, playerHeight } from '../src/world/player.js';
import { frame } from './frames.js';
import { STEP } from './fakes.js';

const json = () => JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
const map = loadGridMap(json());

test('initSandbox: plain state, the player stands at the first player spawn', () => {
  const state = initSandbox(map);
  const spawn = map.spawns.find((s) => s.type === 'player');
  assert.deepEqual(state, { ticks: 0, map: MAP_KEY, player: { x: spawn.x + 0.5, y: spawn.y, vx: 0, vy: 0, onGround: false, aim: 0, crouching: false, size: { ...PLAYER_SIZE } }, pointer: null, aimSource: null, spawn: { x: spawn.x + 0.5, y: spawn.y }, fallY: -10, camera: { x: spawn.x + 0.5, y: spawn.y + PLAYER_SIZE.height } });
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

test('sandbox draw: the camera shows CAMERA_TILES_HIGH tiles and follows the player head', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const scene = createSandbox({ viewMode: createViewMode({ mode: '2d' }), fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  state.player.x = 10;
  state.player.y = 5;
  snapCamera(state);
  const origins = [];
  scene.draw(state, { renderer, width: 800, height: 600, setAimOrigin: (...args) => origins.push(args) });
  assert.equal(rendered.top - rendered.bottom, CAMERA_TILES_HIGH);
  assert.equal(rendered.right - rendered.left, (CAMERA_TILES_HIGH * 800) / 600);
  assert.deepEqual([rendered.position.x, rendered.position.y], [10, 5 + PLAYER_SIZE.height + OFFSET_DEFAULT.y]);
  // Aim origin: the head (top centre of the box), OFFSET_DEFAULT.y tiles below the view centre.
  const tilePx = 600 / CAMERA_TILES_HIGH;
  assert.equal(origins.length, 1);
  const [player, px, py] = origins[0];
  assert.deepEqual([player, px], [0, 400]);
  assert.ok(Math.abs(py - (300 + OFFSET_DEFAULT.y * tilePx)) < 1e-9, `py ${py} (${tilePx} px per tile)`);
});

test('sandbox scene: ticks while uncovered, draws when covered, suspends on leave', () => {
  assert.deepEqual(createSandbox().settings, { tick: 'uncovered', drawCovered: true, leave: 'suspend' });
});

test('createCameraZoom: whole tiles, clamped to the limits, bad values ignored', () => {
  assert.deepEqual([CAMERA_TILES_MIN, CAMERA_TILES_HIGH, CAMERA_TILES_MAX], [8, 22, 28]);
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

test('createViewMode: 2.5D and FOV 50 by default; unknown modes ignored; FOV whole degrees, 1 to 130', () => {
  const v = createViewMode();
  assert.deepEqual([v.mode(), v.fov()], ['2.5d', 50]);
  assert.equal(v.setMode('2d'), '2d');
  assert.equal(v.setMode('3d'), '2d');
  assert.equal(v.setFov(0), 1);
  assert.equal(v.setFov(200), 130);
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
  for (const fov of [1, 15, 60, 130]) {
    viewMode.setFov(fov);
    scene.draw(state, view);
    assert.equal(rendered.isPerspectiveCamera, true);
    const d = rendered.position.z;
    assert.ok(Math.abs(d - perspectiveDistance(zoom.get(), fov)) < 1e-9);
    // Height of the view at z = 0.
    assert.ok(Math.abs(2 * d * Math.tan((rendered.fov * Math.PI) / 360) - zoom.get()) < 1e-9, `fov ${fov}`);
    assert.ok(rendered.near < d - 1.5 && rendered.far > d + 1.5, 'cubes at z ±1.5 not clipped');
  }
  // Same aim origin as in 2D: the head, OFFSET_DEFAULT.y tiles below the view centre.
  assert.deepEqual(origins.at(-1).slice(0, 2), [0, 400]);
  assert.ok(Math.abs(origins.at(-1)[2] - (300 + OFFSET_DEFAULT.y * (600 / zoom.get()))) < 1e-9);
  viewMode.setMode('2d');
  scene.draw(state, view);
  assert.equal(rendered.isOrthographicCamera, true);
});

test('depthCubes: deterministic, every few columns, flush with the ground surface, off the play plane', () => {
  const a = depthCubes(map.tiles);
  assert.deepEqual(depthCubes(map.tiles), a);
  assert.ok(a.length > 10);
  assert.ok(a.some((c) => c.z === 1) && a.some((c) => c.z === -1));
  for (const c of a) {
    assert.equal(c.x % DEPTH_CUBE_SPACING, 0);
    assert.ok(c.z === 1 || c.z === -1);
    assert.equal(map.tiles.isSolid(c.x, c.y), true, `cube at ${c.x},${c.y} is in the top ground row`);
    assert.equal(map.tiles.isSolid(c.x, c.y + 1), false, `nothing solid above the cube at ${c.x},${c.y}`);
  }
});

test('camera offset: ±4 tiles in 0.25 steps; the camera moves with it in both views, no rotation', async () => {
  const v = createViewMode();
  assert.deepEqual(v.offset(), { x: 0, y: 2 });
  assert.deepEqual(v.setOffset('x', 1.3), { x: 1.25, y: 2 });
  assert.deepEqual(v.setOffset('y', -9), { x: 1.25, y: -4 });
  assert.deepEqual(v.setOffset('z', 1), { x: 1.25, y: -4 });
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const scene = createSandbox({ viewMode: v, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  for (const mode of ['2d', '2.5d']) {
    v.setMode(mode);
    scene.draw(state, view);
    assert.equal(rendered.position.x, state.player.x + 1.25, mode);
    assert.equal(rendered.position.y, state.player.y + PLAYER_SIZE.height - 4, mode);
    assert.deepEqual([rendered.rotation.x, rendered.rotation.y, rendered.rotation.z], [0, 0, 0], mode);
  }
});

test('cameraShift: follow fraction, Min radius along the aim, Max after Min, then x / y scale', () => {
  const head = { x: 0, y: 0 };
  const base = { follow: 0.5, min: 0, max: 8, scaleX: 1, scaleY: 1 };
  const xy = ({ x, y }) => [Number(x.toFixed(9)), Number(y.toFixed(9))];
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, base)), [3, 4]);
  // Shorter than Min: lengthened to Min along head -> aim (here 0.5 * 10 = 5 < 6).
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, { ...base, min: 6 })), [3.6, 4.8]);
  // Follow 0 with Min 1: still Min along the aim direction.
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, { ...base, follow: 0, min: 1 })), [0.6, 0.8]);
  // Aim exactly at the head: the last direction; none yet: no shift.
  assert.deepEqual(xy(cameraShift(head, head, { ...base, min: 2 }, { x: 0, y: 1 })), [0, 2]);
  assert.deepEqual(cameraShift(head, head, { ...base, min: 2 }), { x: 0, y: 0, dir: null });
  // Max after Min: Max wins when Max < Min.
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, { ...base, min: 6, max: 5 })), [3, 4]);
  assert.deepEqual(xy(cameraShift(head, { x: 60, y: 80 }, { ...base, max: 5 })), [3, 4]);
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, { ...base, scaleX: 2, scaleY: 0 })), [6, 0]);
});

test('aim follow: the camera is stable frame to frame (rest-camera projection) and the aim line hits the mouse', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const viewMode = createViewMode();
  viewMode.setFollow('follow', 1);
  viewMode.setFollow('max', 20);
  viewMode.setFollow('scaleY', 1);
  viewMode.setOffset('y', 0);
  const scene = createSandbox({ viewMode, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  state.pointer = { x: 700, y: 150 };
  state.aimSource = 'mouse';
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  for (const mode of ['2d', '2.5d']) {
    viewMode.setMode(mode);
    scene.draw(state, view);
    const first = [rendered.position.x, rendered.position.y];
    for (let i = 0; i < 5; i++) scene.draw(state, view);
    assert.deepEqual([rendered.position.x, rendered.position.y], first, `${mode}: no feedback`);
    // follow 1: the camera centres on the mouse's rest-camera aim point: 300 px right, 150 px up.
    const tilesPerPx = CAMERA_TILES_HIGH / 600;
    const headY = state.player.y + PLAYER_SIZE.height;
    assert.ok(Math.abs(first[0] - (state.player.x + 300 * tilesPerPx)) < 1e-9, mode);
    assert.ok(Math.abs(first[1] - (headY + 150 * tilesPerPx)) < 1e-9, mode);
  }
});

test('city backdrop: deterministic, denser and darker with distance, inside the far plane', async () => {
  const { CITY_LAYERS, CITY_FAR, layerBuildings } = await import('../src/scenes/city-backdrop.js');
  assert.deepEqual(layerBuildings(CITY_LAYERS[0], -50, 50), layerBuildings(CITY_LAYERS[0], -50, 50));
  const coverage = CITY_LAYERS.map((layer) => {
    const b = layerBuildings(layer, -200, 200);
    return b.reduce((sum, { width }) => sum + width, 0) / (b.at(-1).x + b.at(-1).width - b[0].x);
  });
  assert.ok(coverage[0] < coverage[1] && coverage[1] < coverage[2], `coverage ${coverage}`);
  const brightness = CITY_LAYERS.map((l) => parseInt(l.color.slice(1), 16) >> 16);
  assert.ok(brightness[0] > brightness[1] && brightness[1] > brightness[2]);
  const deepest = Math.max(...CITY_LAYERS.map((l) => -l.z + l.depth / 2));
  assert.ok(CITY_FAR > deepest);
  // The 2.5D camera's far plane reaches the backdrop while it is on, and not when it is off.
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const viewMode = createViewMode();
  const scene = createSandbox({ viewMode, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  scene.draw(state, view);
  assert.ok(rendered.far > rendered.position.z + deepest);
  viewMode.setBackdrop(false);
  scene.draw(state, view);
  assert.ok(rendered.far < rendered.position.z + 5);
});

test('camera smoothing: half-life 0 snaps to the head; above 0 it converges, independent of the step', async () => {
  const { smerp } = await import('../src/scenes/sandbox-3d.js');
  const head = { x: 10, y: 4 };
  assert.deepEqual(smerp({ x: 0, y: 0 }, head, 1 / 60, 0), head);
  // Half the distance per half-life.
  const half = smerp({ x: 0, y: 0 }, head, 0.1, 0.1);
  assert.ok(Math.abs(half.x - 5) < 1e-9 && Math.abs(half.y - 2) < 1e-9);
  // Frame-step independent: 60 steps of 1/60 s = 1 step of 1 s.
  let a = { x: 0, y: 0 };
  for (let i = 0; i < 60; i++) a = smerp(a, head, 1 / 60, 0.1);
  const b = smerp({ x: 0, y: 0 }, head, 1, 0.1);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
  assert.ok(Math.abs(a.x - 10) < 0.01, 'converges to the head');
  // In the scene: at 0 the source stays on the head as the player moves; above 0 it lags, then
  // catches up; a fall respawn snaps it.
  const state = initSandbox(map);
  const run = (ticks, halfLife, held = []) => {
    for (let i = 0; i < ticks; i++) tickSandbox(state, [frame(held)], STEP, map.tiles, halfLife);
  };
  run(60, 0, ['moveRight']);
  assert.deepEqual(state.camera, { x: state.player.x, y: state.player.y + PLAYER_SIZE.height });
  run(10, 0.1, ['moveRight']);
  assert.ok(state.camera.x < state.player.x, 'lags behind while moving');
  run(120, 0.1);
  assert.ok(Math.abs(state.camera.x - state.player.x) < 1e-3, 'catches up when the player stops');
  state.camera = { x: -100, y: -100 };
  state.player.y = state.fallY - 1;
  run(1, 0.1);
  assert.deepEqual(state.camera, { x: state.spawn.x, y: state.spawn.y + PLAYER_SIZE.height });
});

test('initSandbox: the map\'s player size sets the height, crouch height and head; no field gives 2 / 1', () => {
  const sized = loadGridMap({ ...json(), player: { width: 1, height: 1.5, crouchHeight: 0.75 } });
  const state = initSandbox(sized);
  assert.equal(playerHeight(state.player), 1.5);
  state.player.crouching = true;
  assert.equal(playerHeight(state.player), 0.75);
  state.player.crouching = false;
  assert.equal(playerHead(state.player).y, state.player.y + 1.5);
  assert.deepEqual(state.camera, { x: state.player.x, y: state.player.y + 1.5 });
  const plain = initSandbox(map);
  assert.equal(playerHeight(plain.player), 2);
  plain.player.crouching = true;
  assert.equal(playerHeight(plain.player), 1);
});

test('grid: the toggle swaps the level textures from checkerboard to grid, in both views; grid pixels', async () => {
  const { TILE_GRID, gridPixels } = await import('../src/scenes/tile-texture.js');
  // 64 px: a 2 px light border on every edge, dark fill inside.
  const px = gridPixels(64);
  const at = (x, y) => [...px.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
  const hex = (css) => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
  assert.deepEqual([at(0, 30), at(1, 30), at(63, 30), at(30, 62)], Array(4).fill(hex(TILE_GRID.line)));
  assert.deepEqual([at(2, 30), at(30, 30), at(61, 61)], Array(3).fill(hex(TILE_GRID.fill)));
  let rendered;
  const renderer = { render: (scene) => (rendered = scene) };
  const viewMode = createViewMode();
  const scene = createSandbox({ viewMode, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  const textures = () => new Set(rendered.children.filter((o) => o.isInstancedMesh && o.material.map).map((o) => o.material.map.name));
  assert.equal(viewMode.grid(), false);
  for (const mode of ['2d', '2.5d']) {
    viewMode.setMode(mode);
    viewMode.setGrid(false);
    scene.draw(state, view);
    assert.deepEqual(textures(), new Set(['checker']), mode);
    viewMode.setGrid(true);
    scene.draw(state, view);
    assert.deepEqual(textures(), new Set(['grid']), mode);
  }
});
