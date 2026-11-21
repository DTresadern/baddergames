import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ENEMY_COLOR,
  HEALTH_BAR_COLOR,
  MARKER_COLOR,
  OFFLINE_NET,
  PLATFORM_COLOR,
  PLAYER_COLORS,
  createSandbox,
  createCameraZoom,
  CAMERA_TILES_HIGH,
  CAMERA_TILES_MAX,
  CAMERA_TILES_MIN,
  MAP_KEY,
  SANDBOX_MAPS,
  createMapChoice,
  snapCamera,
  initSandbox,
  playerHead,
  tickSandbox,
} from '../src/scenes/sandbox.js';
import { TILE_CHECKER, checkerPixels, createTileTexture } from '../src/scenes/tile-texture.js';
import { Color, Matrix4, NearestFilter, ShaderLib, Texture } from 'three';
import { MAX_LIGHTS } from '../src/scenes/level-lights.js';
import { playerDepth } from '../src/world/rows.js';
import { DEPTH_CUBE_SPACING, DEPTH_SHADE, OFFSET_DEFAULT, PALETTE_LUT_MODES, cameraShift, createViewMode, depthCubes, depthShade, litDepthShade, perspectiveDistance } from '../src/scenes/sandbox-3d.js';
import { atlasLayout, atlasPools } from '../src/scenes/block-decor.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { PLAYER_SIZE, createPlayer, playerHeight, stepPlayer } from '../src/world/player.js';
import { frame } from './frames.js';
import { STEP, fakeLoadLut } from './fakes.js';

const json = () => JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8'));
const map = loadGridMap(json());

test('initSandbox: plain state, the player stands at the first player spawn', () => {
  const state = initSandbox(map);
  const spawn = map.spawns.find((s) => s.type === 'player');
  assert.deepEqual(state, {
    ticks: 0,
    map: MAP_KEY,
    players: [{ x: spawn.x + 0.5, y: spawn.y, vx: 0, vy: 0, onGround: false, aim: 0, crouching: false, size: { ...PLAYER_SIZE }, row: 0, hop: null, presses: { down: 255, jump: 255 }, health: 100, inventory: [], meleeTicks: 0, meleeDir: 1, crushed: false }],
    localSlot: 0,
    pointer: null,
    aimSource: null,
    spawn: { x: spawn.x + 0.5, y: spawn.y },
    fallY: -10,
    size: { ...PLAYER_SIZE },
    camera: { x: spawn.x + 0.5, y: spawn.y + PLAYER_SIZE.height },
    enemies: [],
    enemySpawns: [],
  });
  assert.deepEqual(structuredClone(state), state);
  assert.throws(() => initSandbox({ name: 'x', spawns: [] }), /no player spawn/);
});

test('tickSandbox: player 1 input moves the player, ticks count, the state stays cloneable', () => {
  const state = initSandbox(map);
  const start = state.players[0].x;
  for (let i = 0; i < 60; i++) tickSandbox(state, [frame(['moveRight'])], STEP, map.tiles);
  assert.equal(state.ticks, 60);
  assert.ok(state.players[0].x > start + 1);
  assert.equal(state.players[0].onGround, true);
  assert.deepEqual(structuredClone(state), state);
  tickSandbox(state, [], STEP, map.tiles); // no input frames: no throw
  assert.equal(state.ticks, 61);
});

test('sandbox draw: the camera shows CAMERA_TILES_HIGH tiles and follows the player head', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode: createViewMode({ mode: '2d' }), fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  state.players[0].x = 10;
  state.players[0].y = 5;
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
  assert.deepEqual([CAMERA_TILES_MIN, CAMERA_TILES_HIGH, CAMERA_TILES_MAX], [8, 12, 28]);
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
  const scene = createSandbox({ loadLut: fakeLoadLut, zoom, viewMode: createViewMode({ mode: '2d' }), fetchJson: async () => json() });
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

test('createViewMode: 2.5D and FOV 60 by default; unknown modes ignored; FOV whole degrees, 1 to 130', () => {
  const v = createViewMode();
  assert.deepEqual([v.mode(), v.fov()], ['2.5d', 60]);
  assert.equal(v.setMode('2d'), '2d');
  assert.equal(v.setMode('3d'), '2d');
  assert.equal(v.setFov(0), 1);
  assert.equal(v.setFov(200), 130);
  assert.equal(v.setFov(29.6), 30);
});

test('createViewMode: the palette LUT setting is 64 by default; setPaletteLut takes off, 32 or 64 and ignores anything else', () => {
  const v = createViewMode();
  assert.deepEqual(PALETTE_LUT_MODES, ['off', '32', '64']);
  assert.equal(v.paletteLut(), '64');
  assert.equal(v.setPaletteLut('off'), 'off');
  assert.equal(v.setPaletteLut('32'), '32');
  assert.equal(v.setPaletteLut(64), '32', 'a number is not a mode');
  assert.equal(v.setPaletteLut(true), '32');
  assert.equal(v.setPaletteLut('64'), '64');
  assert.equal(v.paletteLut(), '64');
});

test('sandbox draw 2.5D: the play plane shows the zoom height at any FOV, live mode switch', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const viewMode = createViewMode();
  const zoom = createCameraZoom();
  const scene = createSandbox({ loadLut: fakeLoadLut, zoom, viewMode, fetchJson: async () => json() });
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
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode: v, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  for (const mode of ['2d', '2.5d']) {
    v.setMode(mode);
    scene.draw(state, view);
    assert.equal(rendered.position.x, state.players[0].x + 1.25, mode);
    assert.equal(rendered.position.y, state.players[0].y + PLAYER_SIZE.height - 4, mode);
    assert.deepEqual([rendered.rotation.x, rendered.rotation.y, rendered.rotation.z], [0, 0, 0], mode);
  }
});

test('cameraShift: follow fraction, Min radius along the aim, Max after Min, then x / y-up / y-down scale', () => {
  const head = { x: 0, y: 0 };
  const base = { follow: 0.5, min: 0, max: 8, scaleX: 1, scaleYUp: 1, scaleYDown: 1 };
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
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, { ...base, scaleX: 2, scaleYUp: 0 })), [6, 0]);
  // Aiming up takes Y scale up, aiming down takes Y scale down (after Min and Max).
  const split = { ...base, scaleYUp: 0.5, scaleYDown: 2 };
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: 8 }, split)), [3, 2]);
  assert.deepEqual(xy(cameraShift(head, { x: 6, y: -8 }, split)), [3, -8]);
  assert.deepEqual(xy(cameraShift(head, { x: 60, y: -80 }, { ...split, max: 5 })), [3, -8]);
});

test('aim follow: the camera is stable frame to frame (rest-camera projection) and the aim line hits the mouse', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = camera) };
  const viewMode = createViewMode();
  viewMode.setFollow('follow', 1);
  viewMode.setFollow('max', 20);
  viewMode.setFollow('scaleYUp', 1);
  viewMode.setFollow('scaleYDown', 1);
  viewMode.setOffset('y', 0);
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode, fetchJson: async () => json() });
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
    const headY = state.players[0].y + PLAYER_SIZE.height;
    assert.ok(Math.abs(first[0] - (state.players[0].x + 300 * tilesPerPx)) < 1e-9, mode);
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
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode, fetchJson: async () => json() });
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
  assert.deepEqual(state.camera, { x: state.players[0].x, y: state.players[0].y + PLAYER_SIZE.height });
  run(10, 0.1, ['moveRight']);
  assert.ok(state.camera.x < state.players[0].x, 'lags behind while moving');
  run(120, 0.1);
  assert.ok(Math.abs(state.camera.x - state.players[0].x) < 1e-3, 'catches up when the player stops');
  state.camera = { x: -100, y: -100 };
  state.players[0].y = state.fallY - 1;
  run(1, 0.1);
  assert.deepEqual(state.camera, { x: state.spawn.x, y: state.spawn.y + PLAYER_SIZE.height });
});

test('initSandbox: the map\'s player size sets the height, crouch height and head; no field gives 2 / 1', () => {
  const sized = loadGridMap({ ...json(), player: { width: 1, height: 1.5, crouchHeight: 0.75 } });
  const state = initSandbox(sized);
  assert.equal(playerHeight(state.players[0]), 1.5);
  state.players[0].crouching = true;
  assert.equal(playerHeight(state.players[0]), 0.75);
  state.players[0].crouching = false;
  assert.equal(playerHead(state.players[0]).y, state.players[0].y + 1.5);
  assert.deepEqual(state.camera, { x: state.players[0].x, y: state.players[0].y + 1.5 });
  const plain = initSandbox(map);
  assert.equal(playerHeight(plain.players[0]), 2);
  plain.players[0].crouching = true;
  assert.equal(playerHeight(plain.players[0]), 1);
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
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode, fetchJson: async () => json() });
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

// A net view for tests: fixed role and slot, a settable peer, and queued snapshots.
function fakeNet({ role = null, slot = 0, peer = false } = {}) {
  const net = {
    peer,
    snapshots: [],
    history: [],
    remote: null,
    role: () => role,
    localSlot: () => slot,
    peerPresent: () => net.peer,
    takeSnapshot: () => net.snapshots.shift() ?? null,
    inputsAfter: (ack) => net.history.filter((e) => e.tick > ack),
    remotePlayer: () => net.remote,
    remoteEnemies: () => null,
    remoteWorldTick: () => null,
  };
  return net;
}

test('tickSandbox: offline and host without a peer have one player; local gamepad player 2 is not played', () => {
  const state = initSandbox(map);
  tickSandbox(state, [frame([]), frame(['moveRight'])], STEP, map.tiles, 0, OFFLINE_NET);
  assert.equal(state.players.length, 1);
  tickSandbox(state, [frame([]), frame(['moveRight'])], STEP, map.tiles, 0, fakeNet({ role: 'host' }));
  assert.equal(state.players.length, 1);
});

test('tickSandbox: a host with a peer steps slot 1 from inputs[1]; slot 1 goes when the peer leaves', () => {
  const state = initSandbox(map);
  const net = fakeNet({ role: 'host', peer: true });
  for (let i = 0; i < 30; i++) tickSandbox(state, [frame([]), { ...frame(['moveRight']), player: 1 }], STEP, map.tiles, 0, net);
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].x, state.spawn.x, 'player 1 did not move');
  assert.ok(state.players[1].x > state.spawn.x + 1, 'player 2 moved right');
  assert.deepEqual(state.players[1].size, state.size);
  assert.equal(state.localSlot, 0);
  assert.deepEqual(state.camera, { x: state.players[0].x, y: state.players[0].y + PLAYER_SIZE.height }, 'the camera follows player 1');
  assert.deepEqual(structuredClone(state), state);
  net.peer = false;
  tickSandbox(state, [frame([]), frame([])], STEP, map.tiles, 0, net);
  assert.equal(state.players.length, 1);
  // A new peer starts at the spawn.
  net.peer = true;
  tickSandbox(state, [frame([]), frame([])], STEP, map.tiles, 0, net);
  assert.equal(state.players[1].x, state.spawn.x);
});

test('tickSandbox: a guest reconciles its player from the snapshot plus replayed inputs; slot 0 is the remote player', () => {
  const net = fakeNet({ role: 'guest', slot: 1 });
  const state = initSandbox(map);
  tickSandbox(state, [frame([])], STEP, map.tiles, 0, net);
  assert.deepEqual([state.localSlot, state.players.length], [1, 2], 'a slot change starts the state again');
  // Without a snapshot the own player is predicted from inputs[0].
  const before = state.players[1].x;
  tickSandbox(state, [frame(['moveRight'])], STEP, map.tiles, 0, net);
  assert.ok(state.players[1].x > before);
  // With one: the snapshot's player plus the inputs after its ack, the current tick's included.
  const confirmed = { x: 20.5, y: 2, vx: 0, vy: 0, onGround: true, crouching: false, aim: 0, row: 0, hop: null, presses: { down: 255, jump: 255 }, health: 100, inventory: [], meleeTicks: 0, meleeDir: 1 };
  net.history = [5, 6, 7, 8].map((tick) => ({ tick, frame: frame(['moveRight']) }));
  net.snapshots.push({ tick: 100, ack: 6, wt: 90, players: [{ ...confirmed, x: 3.5 }, confirmed], enemies: [] });
  net.remote = { ...confirmed, x: 3.5, aim: 1 };
  tickSandbox(state, [frame(['moveRight'])], STEP, map.tiles, 0, net);
  const expected = createPlayer(20.5, 2, state.size);
  Object.assign(expected, { onGround: true });
  stepPlayer(expected, frame(['moveRight']), map.tiles, STEP);
  stepPlayer(expected, frame(['moveRight']), map.tiles, STEP);
  assert.deepEqual(state.players[1], expected);
  assert.deepEqual(state.players[0], { ...net.remote, size: state.size });
  assert.deepEqual(state.camera, { x: expected.x, y: expected.y + PLAYER_SIZE.height }, 'the camera follows the local slot');
  // No remote player this tick: the previous one stays.
  net.remote = null;
  tickSandbox(state, [frame([])], STEP, map.tiles, 0, net);
  assert.equal(state.players[0].x, 3.5);
  // Back offline: one fresh player in slot 0.
  tickSandbox(state, [frame([])], STEP, map.tiles, 0, OFFLINE_NET);
  assert.deepEqual([state.localSlot, state.players.length, state.players[0].x], [0, 1, state.spawn.x]);
});

test('sandbox draw: one body per player in its colour; absent slots hidden; aim origin is the local head', async () => {
  let rendered;
  const renderer = { render: (scene, camera) => (rendered = { scene, camera }) };
  const net = fakeNet({ role: 'host' });
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode: createViewMode({ mode: '2d' }), net, fetchJson: async () => json() });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const origins = [];
  const view = { renderer, width: 800, height: 600, setAimOrigin: (...a) => origins.push(a) };
  const bodies = () => rendered.scene.children.filter((o) => o.isMesh && !o.isInstancedMesh && PLAYER_COLORS.includes(o.material.color?.getHex()));
  scene.draw(state, view);
  assert.deepEqual(bodies().map((b) => [b.material.color.getHex(), b.visible]), [[PLAYER_COLORS[0], true], [PLAYER_COLORS[1], false]]);
  net.peer = true;
  tickSandbox(state, [frame([]), frame([])], STEP, map.tiles, 0, net);
  state.players[1].x = 30;
  scene.draw(state, view);
  assert.deepEqual(bodies().map((b) => [b.visible, b.position.x]), [[true, state.players[0].x], [true, 30]]);
  assert.equal(origins.at(-1)[0], 0);
  assert.equal(origins.at(-1)[1], 400, 'the local player is at the view centre');
  assert.notEqual(PLAYER_COLORS[0], PLAYER_COLORS[1]);
});

// Block atlas (map.atlas): the Sandbox loaded with a cells map, the real atlas index and a blank
// texture. `fetchJson` gets the manifest path: the map's for the map, the index's for the index.
const ATLAS_INDEX_PATH = 'content/textures/environment/blocks-placeholder.json';
const atlasIndex = () => JSON.parse(readFileSync(new URL(`../public/${ATLAS_INDEX_PATH}`, import.meta.url), 'utf8'));
const smallCells = (extra = {}) => ({
  format: 1,
  kind: 'cells',
  name: 'atlas-test',
  tileSize: 64,
  tile: { type: 'solid', color: '#6b7a8f' },
  spawns: [{ type: 'player', x: 2, y: 0 }],
  // A floor 8 wide on the play plane, a crate on it, a back wall at z = -1 and a near cell at z = 1.
  cells: [...Array.from({ length: 8 }, (_, x) => [x, -1, 0]), [5, 0, 0], ...Array.from({ length: 8 }, (_, x) => [x, 2, -1]), [0, -2, 1]],
  ...extra,
});

async function loadAtlasScene(mapJson, viewMode) {
  const fetched = [];
  const fetchJson = async (path) => {
    fetched.push(path);
    return path === ATLAS_INDEX_PATH ? atlasIndex() : mapJson;
  };
  const textures = [];
  const loadTexture = async (path) => {
    const { Texture } = await import('three');
    const texture = new Texture();
    texture.name = path;
    textures.push(texture);
    return texture;
  };
  let rendered;
  const renderer = { render: (scene) => (rendered = scene) };
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode, fetchJson, loadTexture });
  await scene.load({ track: (obj) => obj, acquire: (key, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  // The level's instanced meshes in the scene drawn last (the city backdrop's have no texture).
  const levelMeshes = (mode) => {
    viewMode.setMode(mode);
    scene.draw(state, view);
    return rendered.children.filter((o) => o.isInstancedMesh && o.material.map);
  };
  return { fetched, textures, levelMeshes, state, scene, view };
}

test('block atlas: a map naming one draws every level mesh with the atlas, per-instance tiles, same mesh count; grid still toggles', async () => {
  const viewMode = createViewMode();
  const { fetched, textures, levelMeshes } = await loadAtlasScene(smallCells({ atlas: 'blocks-placeholder' }), viewMode);
  assert.ok(fetched.includes(ATLAS_INDEX_PATH));
  assert.equal(textures.length, 1);
  const [atlas] = textures;
  assert.equal(atlas.name, 'content/textures/environment/blocks-placeholder.png');
  assert.deepEqual([atlas.magFilter, atlas.minFilter, atlas.generateMipmaps], [NearestFilter, NearestFilter, false]);
  const plain = await loadAtlasScene(smallCells(), createViewMode());
  assert.equal(plain.textures.length, 0, 'no atlas field: no atlas load');
  for (const mode of ['2d', '2.5d']) {
    const meshes = levelMeshes(mode);
    assert.ok(meshes.length > 0, mode);
    assert.equal(meshes.length, plain.levelMeshes(mode).length, `${mode}: the same number of level meshes (draw calls)`);
    for (const mesh of meshes) {
      assert.equal(mesh.material.map, atlas, mode);
      const tiles = mesh.geometry.attributes.atlasTile;
      assert.ok(tiles?.isInstancedBufferAttribute, mode);
      assert.equal(tiles.count, mesh.count, mode);
      assert.ok(tiles.array.every((t) => Number.isInteger(t) && t >= 0 && t < 28), mode);
      const faces = mesh.geometry.attributes.atlasFace;
      assert.equal(faces.count, mesh.geometry.attributes.position.count, mode);
    }
    // Groups share the base geometry's buffers but each has its own tiles.
    if (meshes.length > 1) {
      assert.equal(meshes[0].geometry.attributes.position, meshes[1].geometry.attributes.position, mode);
      assert.notEqual(meshes[0].geometry.attributes.atlasTile, meshes[1].geometry.attributes.atlasTile, mode);
    }
    // 2D planes show the front tile on every vertex; cubes: +x, -x, +y, -y, +z, -z -> side, side, top, side, front, front.
    const faces = [...meshes[0].geometry.attributes.atlasFace.array];
    if (mode === '2d') assert.deepEqual(faces, [2, 2, 2, 2]);
    else assert.deepEqual(faces, [0, 0, 1, 0, 2, 2].flatMap((f) => [f, f, f, f]));
    viewMode.setGrid(true);
    assert.deepEqual(new Set(levelMeshes(mode).map((m) => m.material.map.name)), new Set(['grid']), `${mode}: grid on`);
    viewMode.setGrid(false);
    assert.ok(levelMeshes(mode).every((m) => m.material.map === atlas), `${mode}: grid off again`);
  }
  // Without the atlas field the same map keeps the checkerboard.
  assert.deepEqual(new Set(plain.levelMeshes('2.5d').map((m) => m.material.map.name)), new Set(['checker']));
});

test('block atlas: the play plane floor shows walkway fronts with hazard edges at the ends; depth shading still recolours', async () => {
  const viewMode = createViewMode({ mode: '2d' });
  const { levelMeshes, state, scene, view } = await loadAtlasScene(smallCells({ atlas: 'blocks-placeholder' }), viewMode);
  // 2D draws the play plane: the floor (x 0..7, y -1) and the crate on it (5, 0).
  const fronts = new Map();
  for (const mesh of levelMeshes('2d')) {
    const tiles = mesh.geometry.attributes.atlasTile.array;
    const m = new Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      fronts.set(`${m.elements[12] - 0.5},${m.elements[13] - 0.5}`, tiles[i * 3 + 2]);
    }
  }
  const pools = atlasPools(atlasLayout(atlasIndex()));
  assert.deepEqual([pools.walkway[0], pools.edge[0]], [16, 15]); // walkway-top, hazard-edge (row 2)
  assert.equal(fronts.get('0,-1'), pools.edge[0]);
  assert.equal(fronts.get('7,-1'), pools.edge[0]);
  for (const x of [1, 2, 3, 4, 6]) assert.equal(fronts.get(`${x},-1`), pools.walkway[0], `x ${x}`);
  assert.ok(pools.crate.includes(fronts.get('5,0')), `crate ${fronts.get('5,0')}`);
  // 2.5D: the shaded atlas materials still take the depth colour.
  viewMode.setMode('2.5d');
  const behind = levelMeshes('2.5d').find((m) => m.material.color.r < 1);
  assert.ok(behind, 'an off-plane group is shaded');
  state.players[0].row = -1;
  scene.draw(state, view);
  assert.ok(levelMeshes('2.5d').some((m) => m.material.color.r === 1 && m.material.color.g === 1), 'the player row is unshaded');
});

test('block atlas: the real test level loads with the real index; the same level mesh count as without the atlas', async () => {
  const level = JSON.parse(readFileSync(new URL('../public/content/maps/moge3-cyberpunk-blocks.json', import.meta.url), 'utf8'));
  assert.equal(level.atlas, 'blocks-placeholder');
  const withAtlas = await loadAtlasScene(level, createViewMode());
  const { atlas: _, ...noAtlas } = level;
  const without = await loadAtlasScene(noAtlas, createViewMode());
  for (const mode of ['2d', '2.5d']) {
    const meshes = withAtlas.levelMeshes(mode);
    assert.equal(meshes.length, without.levelMeshes(mode).length, mode);
    assert.equal(meshes.reduce((n, m) => n + m.count, 0), without.levelMeshes(mode).reduce((n, m) => n + m.count, 0), mode);
    assert.ok(meshes.every((m) => m.geometry.attributes.atlasTile.count === m.count), mode);
  }
});

test('depthShade: DEPTH_SHADE by default; a table as the second argument; litDepthShade(nearShade)', () => {
  const close = (a, b, msg) => a.forEach((c, i) => assert.ok(Math.abs(c - b[i]) < 1e-12, `${msg}: ${a} vs ${b}`));
  assert.deepEqual(depthShade(0), [1, 1, 1]);
  close(depthShade(-1), [0.82 * 0.62, 0.9 * 0.62, 0.62], 'z -1');
  close(depthShade(-5), [0.82 * 0.38, 0.9 * 0.38, 0.38], 'z -5');
  close(depthShade(2), [0.34, 0.88 * 0.34, 0.8 * 0.34], 'z 2');
  for (const z of [-3, -1.5, -0.25, 0, 0.5, 1, 4]) assert.deepEqual(depthShade(z, DEPTH_SHADE), depthShade(z), `z ${z}`);
  const lit = litDepthShade(0.21);
  assert.ok(Object.isFrozen(lit) && Object.isFrozen(lit.behind) && Object.isFrozen(lit.behindTint) && Object.isFrozen(lit.frontTint));
  for (const z of [-1, -2, -7]) assert.deepEqual(depthShade(z, lit), [1, 1, 1], `behind: no darkening (the fog does it), z ${z}`);
  assert.deepEqual(depthShade(0, lit), [1, 1, 1]);
  for (const z of [1, 3]) assert.deepEqual(depthShade(z, lit), [0.21, 0.21, 0.21], `front, z ${z}`);
  close(depthShade(0.5, lit), [0.605, 0.605, 0.605], 'a hop interpolates');
  close(depthShade(-0.5, lit), [1, 1, 1], 'behind, half way');
});

// Every Sandbox map loaded through the scene as the game loads it (manifest paths, the real atlas
// index, a blank atlas texture). `strip` drops the map's lighting field.
const readPublic = (path) => JSON.parse(readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8'));
async function loadSandboxMap(key, { strip = false } = {}) {
  const fetchJson = async (path) => {
    const value = readPublic(path);
    if (strip) delete value.lighting;
    return value;
  };
  const loadTexture = async (path) => Object.assign(new Texture(), { name: path });
  let rendered;
  const initialised = [];
  const renderer = { render: (scene) => (rendered = scene), initTexture: (texture) => initialised.push(texture) };
  const viewMode = createViewMode();
  const scene = createSandbox({ loadLut: fakeLoadLut, viewMode, mapChoice: createMapChoice(key), fetchJson, loadTexture });
  const tracked = new Set();
  await scene.load({ track: (obj) => (tracked.add(obj), obj), acquire: (_, create) => create(), renderer });
  const state = scene.enter();
  const view = { renderer, width: 800, height: 600, setAimOrigin() {} };
  const draw = (mode) => {
    viewMode.setMode(mode);
    scene.draw(state, view);
    return rendered;
  };
  return { tracked, draw, state, viewMode, initialised };
}
const meshesOf = (graph) => {
  const out = [];
  graph.traverse((o) => o.isMesh && out.push(o));
  return out;
};
const litKey = (material) => {
  const key = material.customProgramCacheKey();
  return key.includes(' lit ') || key.startsWith('level-fog');
};
// The shared lit uniforms a material's program would get.
const compiledUniforms = (material) => {
  const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  return shader.uniforms;
};

test('sandbox maps: every SANDBOX_MAPS map loads and draws in both views; only the test level is lit; nothing is made in draw', async () => {
  for (const key of SANDBOX_MAPS) {
    const { tracked, draw } = await loadSandboxMap(key);
    const lit = key === 'map.moge3-cyberpunk-blocks';
    for (const mode of ['2d', '2.5d']) {
      const graph = draw(mode);
      draw(mode);
      const meshes = meshesOf(graph);
      assert.ok(meshes.length > 0, `${key} ${mode}`);
      for (const mesh of meshes) assert.ok(tracked.has(mesh.material), `${key} ${mode}: every material was made in load()`);
      if (!lit) {
        assert.equal(graph.background, null, `${key} ${mode}: renderer clear colour`);
        assert.ok(meshes.every((m) => !litKey(m.material)), `${key} ${mode}: no lit material`);
      } else {
        assert.ok(graph.background?.equals(new Color('#344a4c')), `${key} ${mode}: background`);
      }
    }
  }
});

test('sandbox lighting: the test level\'s atlas meshes are lit, its backdrop fogged, everything else unlit; same meshes as without lighting', async () => {
  const { draw, state, viewMode } = await loadSandboxMap('map.moge3-cyberpunk-blocks');
  const plain = await loadSandboxMap('map.moge3-cyberpunk-blocks', { strip: true });
  for (const mode of ['2d', '2.5d']) {
    const meshes = meshesOf(draw(mode));
    const plainMeshes = meshesOf(plain.draw(mode));
    assert.equal(meshes.length, plainMeshes.length, `${mode}: the same meshes (draw calls)`);
    assert.equal(plain.draw(mode).background, null, `${mode}: no lighting field, no background`);
    assert.ok(plainMeshes.every((m) => !litKey(m.material)), `${mode}: no lighting field, nothing lit`);
    const level = meshes.filter((m) => m.isInstancedMesh && m.material.map);
    const city = meshes.filter((m) => m.isInstancedMesh && !m.material.map);
    assert.ok(level.length > 0);
    for (const m of level) assert.ok(m.material.customProgramCacheKey().endsWith(' lit 22,23,24,25,26 palette-lut'), `${mode}: ${m.material.customProgramCacheKey()}`);
    if (mode === '2.5d') {
      assert.ok(city.length > 0);
      for (const m of city) assert.equal(m.material.customProgramCacheKey(), 'level-fog palette-lut');
    }
    for (const m of meshes.filter((x) => !x.isInstancedMesh)) assert.ok(!litKey(m.material), `${mode}: players, aim, swings, enemies, bars, platforms, markers unlit`);
    viewMode.setGrid(true);
    assert.ok(meshesOf(draw(mode)).filter((m) => m.isInstancedMesh && m.material.map).every((m) => !litKey(m.material)), `${mode}: grid unlit`);
    viewMode.setGrid(false);
  }
  // One shared set of uniforms; draw sets the fog eye from the local player's depth and fills the
  // light slots (83 lights: every slot used).
  const levelMaterials = meshesOf(draw('2.5d')).filter((m) => m.isInstancedMesh && m.material.map).map((m) => m.material);
  const uniforms = compiledUniforms(levelMaterials[0]);
  for (const material of levelMaterials) for (const [name, u] of Object.entries(compiledUniforms(material))) assert.equal(u, uniforms[name], name);
  assert.ok(uniforms.litAmbient.value.equals({ x: 0.205, y: 0.218, z: 0.232 }));
  assert.ok(uniforms.litFogColor.value.equals(new Color('#324f5c')));
  assert.equal(uniforms.litFogDensity.value, 0.035);
  assert.equal(uniforms.litFogOrigin.value, 4.48 + playerDepth(state.players[0]));
  assert.equal(uniforms.litLightRadius.value.length, MAX_LIGHTS);
  assert.ok(uniforms.litLightRadius.value.every((r) => r === 1.5 || r === 3.25), 'every slot holds a light');
  assert.ok(uniforms.litLightColor.value.every((c) => c.x + c.y + c.z > 0));
  state.players[0].row = -1;
  draw('2.5d');
  assert.equal(uniforms.litFogOrigin.value, 4.48 - 1, 'the eye follows the row');
  draw('2d');
  assert.equal(uniforms.litFogOrigin.value, 4.48, '2D: depth 0');
  // Lit depth shading: the player's row and behind it at 1, in front nearShade.
  draw('2.5d');
  const shades = new Set(levelMaterials.map((m) => m.color.r));
  assert.ok([...shades].every((r) => r === 1 || Math.abs(r - 0.21) < 1e-12), [...shades].join(','));
});

// The palette LUT uniforms a material's program would get, or null for a material without the LUT
// (no own onBeforeCompile, or one that adds no LUT uniforms).
const lutUniformsOf = (material) => {
  if (!Object.hasOwn(material, 'onBeforeCompile')) return null;
  return compiledUniforms(material).paletteLutMix ? compiledUniforms(material) : null;
};

test('palette LUT: every opaque world material has it (level, backdrop, platforms, players, enemies, aim, bars), with one shared set of uniforms; grid, swings and markers do not', async () => {
  for (const key of ['map.moge3-cyberpunk-blocks', 'map.walkway']) {
    const { draw, viewMode } = await loadSandboxMap(key);
    let shared = null;
    const colours = new Set();
    for (const mode of ['2d', '2.5d']) {
      const meshes = meshesOf(draw(mode));
      for (const m of meshes) {
        const u = lutUniformsOf(m.material);
        if (m.material.transparent) {
          assert.equal(u, null, `${key} ${mode}: transparent (swing or marker) has no LUT`);
          assert.ok(!m.material.customProgramCacheKey().includes('palette-lut'));
          continue;
        }
        assert.ok(u, `${key} ${mode}: ${m.material.customProgramCacheKey()}`);
        assert.ok(m.material.customProgramCacheKey().endsWith('palette-lut'));
        shared ??= u;
        for (const name of ['paletteLut', 'paletteLutSize', 'paletteLutMix']) assert.equal(u[name], shared[name], `${key} ${mode}: ${name} is the shared object`);
        if (!m.isInstancedMesh) colours.add(m.material.color.getHex());
      }
      // The transparent ones are the swings (both views) and, on the test level in 2.5D, the markers.
      const transparent = meshes.filter((m) => m.material.transparent);
      assert.ok(transparent.some((m) => m.material.opacity === 0.45), `${key} ${mode}: swings`);
      if (key === 'map.moge3-cyberpunk-blocks' && mode === '2.5d') assert.ok(transparent.some((m) => m.material.color.getHex() === MARKER_COLOR), 'markers');
      // Grid on: the level meshes' grid materials are exactly as before (no patch at all).
      viewMode.setGrid(true);
      const grid = meshesOf(draw(mode)).filter((m) => m.isInstancedMesh && m.material.map?.name === 'grid');
      assert.ok(grid.length > 0, `${key} ${mode}`);
      for (const m of grid) {
        assert.ok(!Object.hasOwn(m.material, 'onBeforeCompile') && !Object.hasOwn(m.material, 'customProgramCacheKey'), `${key} ${mode}: grid unpatched`);
      }
      viewMode.setGrid(false);
    }
    // Players (slot colours), aim lines (white), enemies, health bars and platforms are among them.
    for (const colour of [...PLAYER_COLORS, 0xffffff, ENEMY_COLOR, HEALTH_BAR_COLOR]) assert.ok(colours.has(colour), `${key}: ${colour.toString(16)}`);
    if (key === 'map.moge3-cyberpunk-blocks') assert.ok(colours.has(PLATFORM_COLOR), 'platforms');
    assert.equal(shared.paletteLut.value.isData3DTexture, true);
    assert.equal(shared.paletteLut.value.name, 'content/textures/lut/shared.lut64.png', 'the default is the 64-step LUT');
    assert.equal(shared.paletteLutSize.value, 64);
  }
});

test('palette LUT: load acquires both LUTs and uploads both (renderer.initTexture), so the first switch uploads nothing', async () => {
  const { initialised } = await loadSandboxMap('map.walkway');
  assert.deepEqual(initialised.map((t) => t.name), ['content/textures/lut/shared.lut32.png', 'content/textures/lut/shared.lut64.png']);
});

test('palette LUT: the setting (off / 32 / 64) only writes the shared uniforms in draw; same materials, programs, versions and meshes', async () => {
  const { draw, viewMode } = await loadSandboxMap('map.moge3-cyberpunk-blocks');
  for (const mode of ['2d', '2.5d']) {
    const snapshot = () => meshesOf(draw(mode)).map((m) => [m, m.material, m.material.version, m.material.customProgramCacheKey(), m.material.defines]);
    viewMode.setPaletteLut('64');
    const at64 = snapshot();
    const u = lutUniformsOf(at64.find(([m]) => m.isInstancedMesh)[1]);
    const lut64 = u.paletteLut.value;
    assert.deepEqual([u.paletteLutMix.value, u.paletteLutSize.value, lut64.name], [1, 64, 'content/textures/lut/shared.lut64.png'], `${mode}: 64 by default`);
    // The same objects (identity, not just equal) and values.
    const same = (a, b) => a.length === b.length && a.every((row, i) => row.every((v, j) => v === b[i][j]));
    viewMode.setPaletteLut('32');
    assert.ok(same(snapshot(), at64), `${mode}: 32: nothing but the uniforms changed`);
    assert.deepEqual([u.paletteLutMix.value, u.paletteLutSize.value, u.paletteLut.value.name], [1, 32, 'content/textures/lut/shared.lut32.png'], `${mode}: 32`);
    viewMode.setPaletteLut('off');
    assert.ok(same(snapshot(), at64), `${mode}: off: nothing but the uniforms changed`);
    assert.equal(u.paletteLutMix.value, 0, `${mode}: off`);
    viewMode.setPaletteLut('64');
    assert.ok(same(snapshot(), at64));
    assert.deepEqual([u.paletteLutMix.value, u.paletteLutSize.value, u.paletteLut.value], [1, 64, lut64]);
  }
});
