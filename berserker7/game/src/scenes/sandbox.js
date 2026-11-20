// Sandbox (main layer): a test scene. A tile map and box players that run and jump.
// One world unit is one tile; x is right, y is up. Slot 0 is player 1 (the host when online);
// slot 1 exists only while a net peer is present (the guest's player). `state.localSlot` is the
// slot this browser controls.
// The tile map and moving platforms are static level data, built in load() and kept outside the
// state; the state is plain data: { ticks, map (manifest key), players, enemies, localSlot, ... }.
// `ticks` is the world tick: platforms are a function of it (world/platform.js).
// Enemies (world/enemy.js) are simulated by the host (or offline) only; a guest draws the host's,
// interpolated.
// Networking reaches the scene only through `net` (the net session's read-only view, see
// net/session.js): the scene never sees the transport, and input still arrives only as `inputs`.

import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { acquireMap, defaultFetchJson } from '../assets/maps.js';
import { loadMap } from '../world/load-map.js';
import { reconcile } from '../net/prediction.js';
import { ENEMY, ENEMY_SIZE, MAX_ENEMIES, createEnemy, stepEnemy } from '../world/enemy.js';
import { platformAt, platformsStep, rideShift } from '../world/platform.js';
import { createPlayer, playerHeight, stepPlayer } from '../world/player.js';
import { fitOrtho } from './shared.js';
import { createGridTexture, createTileTexture } from './tile-texture.js';
import { CITY_FAR, addCityBackdrop } from './city-backdrop.js';
import {
  DEPTH_MARGIN,
  FOLLOW_SETTINGS,
  FOV_DEFAULT,
  OFFSET_LIMIT,
  cameraShift,
  createViewMode,
  depthShade,
  depthCubes,
  perspectiveDistance,
  screenToPlane,
  smerp,
  shadedCubeGeometry,
} from './sandbox-3d.js';

// The maps the Sandbox can load (manifest keys), and the default: the block-markup blockout,
// extended into the test level.
export const SANDBOX_MAPS = Object.freeze(['map.moge3-cyberpunk-blocks', 'map.moge3-cyberpunk', 'map.mvp-upper-1', 'map.walkway']);
export const MAP_KEY = SANDBOX_MAPS[0];
// Below the lowest solid tile by this many tiles, the player goes back to the spawn.
export const FALL_MARGIN = 10;

// The map the Sandbox loads, chosen in the debug panel; the panel reloads the scene after a
// change. Unknown keys are ignored. Not saved.
export function createMapChoice(key = MAP_KEY) {
  let current = SANDBOX_MAPS.includes(key) ? key : MAP_KEY;
  return {
    get: () => current,
    set(k) {
      if (SANDBOX_MAPS.includes(k)) current = k;
      return current;
    },
  };
}

// The level's { minX, maxX, minY } in tiles: solid tiles plus a cells map's other cells.
function levelBounds(tiles, cells = []) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity };
  const add = (x, y) => {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x + 1);
    b.minY = Math.min(b.minY, y);
  };
  const size = tiles.chunkSize;
  for (const chunk of tiles.chunks()) {
    chunk.tiles.forEach((id, index) => {
      if (id !== 0) add(chunk.cx * size + (index % size), chunk.cy * size + Math.floor(index / size));
    });
  }
  for (const c of cells) add(c.x, c.y);
  return Number.isFinite(b.minX) ? b : { minX: 0, maxX: 0, minY: 0 };
}

// Lowest y of any solid tile, or 0 for an empty map.
function lowestTileY(tiles) {
  let lowest = Infinity;
  const size = tiles.chunkSize;
  for (const chunk of tiles.chunks()) {
    chunk.tiles.forEach((id, index) => {
      if (id !== 0) lowest = Math.min(lowest, chunk.cy * size + Math.floor(index / size));
    });
  }
  return Number.isFinite(lowest) ? lowest : 0;
}
// Default view height: tiles shown from the bottom of the view to the top. The game camera is
// expected to vary between 18 and 28 tiles high (adjusted per area later), with 22 as the default.
// The debug range reaches down to 8 to try close views.
export const CAMERA_TILES_HIGH = 22;
export const CAMERA_TILES_MIN = 8; // closest zoom
export const CAMERA_TILES_MAX = 28; // furthest zoom

// The camera's view height in tiles, changed live by the debug tools (slider, [ and ]) and read by
// the scene in draw. Whole tiles, clamped to CAMERA_TILES_MIN..CAMERA_TILES_MAX. Not saved.
export function createCameraZoom(tilesHigh = CAMERA_TILES_HIGH) {
  const clamp = (v) => Math.min(CAMERA_TILES_MAX, Math.max(CAMERA_TILES_MIN, Math.round(v)));
  let value = clamp(tilesHigh);
  return {
    get: () => value,
    // Ignores a value that is not a finite number. Returns the value now in use.
    set(v) {
      if (Number.isFinite(v)) value = clamp(v);
      return value;
    },
  };
}
// One colour per player slot: player 1, player 2.
export const PLAYER_COLORS = Object.freeze([0xf2c14e, 0x4ec1f2]);
export const MAX_SLOTS = PLAYER_COLORS.length;

// The Sandbox's net view when there is no session: offline, slot 0, no peer.
export const OFFLINE_NET = Object.freeze({
  role: () => null,
  localSlot: () => 0,
  peerPresent: () => false,
  takeSnapshot: () => null,
  inputsAfter: () => [],
  remotePlayer: () => null,
  remoteEnemies: () => null,
  remoteWorldTick: () => null,
});
// Level data with no moving platforms (tickSandbox's default).
const NO_LEVEL = Object.freeze({ platforms: Object.freeze([]) });
export const PLATFORM_COLOR = 0xc9a23a; // hazard yellow
export const ENEMY_COLOR = 0xe03030;
const PLATFORM_Z = 0.05; // in front of the tiles, behind the players (2D)
const ENEMY_Z = 0.08; // in front of the tiles and platforms, behind the players (2D)
const PLAYER_Z = 0.1; // in front of the tiles
export const AIM_LENGTH = 2; // aim line length, tiles
const AIM_WIDTH = 0.06; // aim line thickness, tiles
const AIM_COLOR = 0xffffff;
const AIM_Z = 0.2; // in front of the player (2D)
const AIM_Z_DEEP = 0.02; // just in front of the player plane (2.5D)

// The player's head: the top centre of the current box (crouched or standing).
export function playerHead(player) {
  return { x: player.x, y: player.y + playerHeight(player) };
}

// The player this browser controls.
export function localPlayer(state) {
  return state.players[state.localSlot];
}

// Puts the camera's smoothed source on the local player's head at once (spawn, respawn, map change).
export function snapCamera(state) {
  state.camera = playerHead(localPlayer(state));
  return state;
}

// A new player at the state's spawn, with the map's player size.
function spawnPlayer(state) {
  return createPlayer(state.spawn.x, state.spawn.y, state.size);
}

// Fresh players for `localSlot`: slot 0 alone, or (a guest) slots 0 and 1 at the spawn.
function respawnAll(state, localSlot) {
  state.localSlot = localSlot;
  state.players = Array.from({ length: localSlot + 1 }, () => spawnPlayer(state));
  state.pointer = null;
  state.aimSource = null;
  delete state.remoteTick; // a guest's (see tickSandbox); none once the state starts again
  return snapCamera(state);
}

// `map` is the result of loadMap. Players start at the first `player` spawn: its x is the
// tile column (the box is centred on that tile) and its y the tile row the feet are at.
export function initSandbox(map, key = MAP_KEY, localSlot = 0) {
  const spawn = map.spawns.find((s) => s.type === 'player');
  if (!spawn) throw new Error(`sandbox: map '${map.name}' has no player spawn`);
  // `players`: index = player slot. `localSlot`: the slot this browser controls (0 offline or
  // host, 1 guest). `pointer`: the local player's last mouse position ({ x, y }, canvas CSS px)
  // or null. `aimSource`: what last changed the local aim, 'mouse' (the pointer moved) or
  // 'stick', or null before either. `spawn` and `fallY`: a player below fallY goes back to the
  // spawn (maps can have open ends). `size`: the map's player size. `camera`: the camera's
  // smoothed source point ({ x, y }, tiles), following the local player's head. `enemies`: one
  // per `enemy` spawn (same coordinates as the player spawn), idle; `enemySpawns` their spawn
  // points, for the fall respawn.
  const enemySpawns = map.spawns.filter((s) => s.type === 'enemy').map((s) => ({ x: s.x + 0.5, y: s.y }));
  if (enemySpawns.length > MAX_ENEMIES) throw new Error(`sandbox: map '${map.name}' has ${enemySpawns.length} enemies (at most ${MAX_ENEMIES})`);
  const state = {
    ticks: 0,
    map: key,
    players: [],
    localSlot,
    pointer: null,
    aimSource: null,
    spawn: { x: spawn.x + 0.5, y: spawn.y },
    fallY: lowestTileY(map.tiles) - FALL_MARGIN,
    size: { ...map.player },
    camera: null,
    // An enemy's id is its index among the map's enemy spawns: the same on host and guest.
    enemies: enemySpawns.map(({ x, y }, id) => createEnemy(x, y, id)),
    enemySpawns,
  };
  return respawnAll(state, localSlot);
}

// One player step plus the fall respawn. Returns true when the player respawned.
function stepWithFall(state, player, frame, tiles, dt, world) {
  stepPlayer(player, frame, tiles, dt, world);
  if (player.y >= state.fallY) return false;
  Object.assign(player, { ...state.spawn, vx: 0, vy: 0, onGround: false, crouching: false });
  return true;
}

// `tiles` is the tile map and `level` the map's other level data ({ platforms }); neither is part of
// the state. `halfLife` (seconds) smooths the camera's
// source towards the local head (smerp); 0 snaps. A local respawn snaps it too.
// `net` is the net view (OFFLINE_NET when there is no session):
//   - its localSlot differs from the state's: the state starts again for that slot
//   - offline or host: slot i steps with inputs[i]; slot 1 exists only while a peer is present
//   - guest: the own player (slot 1) is the newest snapshot's copy with the inputs the host has
//     not applied replayed on it (the current tick's frame is among them), or without a snapshot
//     one step with inputs[0]; slot 0 is the interpolated host player (kept when there is none)
// World tick: a step from world tick k to k + 1 sees the platforms at k and k + 1, then
// state.ticks = k + 1. Offline or host: k = state.ticks; enemies step after the players. Guest:
// a snapshot's replay starts at the host's world tick `wt` (replayed entry j steps wt + j to
// wt + j + 1, then state.ticks = wt + entries), so the guest predicts at the ticks the host will
// use; without a snapshot k = state.ticks. Guest enemies come from net.remoteEnemies().
// inputs[0] is always this browser's own keyboard + mouse (+ pad) frame: pointer and aim source
// come from it and belong to the local player.
export function tickSandbox(state, inputs, dt, tiles, halfLife = 0, net = OFFLINE_NET, level = NO_LEVEL) {
  const slot = net.localSlot();
  if (slot !== state.localSlot) respawnAll(state, slot);
  const frame = inputs[0];
  if (frame?.connected) {
    if (frame.pointer) state.pointer = { x: frame.pointer.x, y: frame.pointer.y };
    if (frame.pointer?.moved) state.aimSource = 'mouse';
    else if (Number.isFinite(frame.aim) && frame.aim !== localPlayer(state).aim) state.aimSource = 'stick';
  }
  let respawned = false;
  if (net.role() === 'guest' && slot > 0) {
    let own = state.players[slot];
    let k = state.ticks; // the world tick the next step starts from
    const step = (player, f) => {
      if (stepWithFall(state, player, f, tiles, dt, { platforms: platformsStep(level.platforms, k) })) respawned = true;
      k += 1;
    };
    const snapshot = net.takeSnapshot();
    const confirmed = snapshot?.players[slot];
    if (confirmed) {
      k = snapshot.wt;
      own = reconcile({ ...confirmed, size: { ...state.size } }, net.inputsAfter(snapshot.ack), step);
    } else step(own, frame);
    state.players[slot] = own;
    state.ticks = k;
    const remote = net.remotePlayer();
    // The host world tick the remote player and enemies below are sampled at, read in the same
    // tick so draw pairs them correctly (a snapshot can arrive between this tick and the draw).
    state.remoteTick = net.remoteWorldTick();
    if (remote) state.players[0] = { ...remote, size: { ...state.size } };
    // Enemies: the host's list (by id), interpolated; the map's own until the first snapshot.
    const enemies = net.remoteEnemies();
    if (enemies) state.enemies = enemies.map((e) => ({ ...createEnemy(e.x, e.y, e.id, e.type), awake: e.awake }));
  } else {
    const count = net.peerPresent() ? MAX_SLOTS : 1;
    while (state.players.length < count) state.players.push(spawnPlayer(state));
    state.players.length = count;
    const world = { platforms: platformsStep(level.platforms, state.ticks) };
    state.players.forEach((player, i) => {
      if (stepWithFall(state, player, inputs[i], tiles, dt, world) && i === state.localSlot) respawned = true;
    });
    state.enemies.forEach((enemy, i) => {
      stepEnemy(enemy, state.players, tiles, dt, world);
      if (enemy.y < state.fallY) Object.assign(enemy, createEnemy(state.enemySpawns[enemy.id].x, state.enemySpawns[enemy.id].y, enemy.id, enemy.type));
    });
    state.ticks += 1;
  }
  if (respawned) snapCamera(state);
  else state.camera = smerp(state.camera, playerHead(localPlayer(state)), dt, halfLife);
  return state;
}

// Tile positions grouped per chunk and tile type: [[id, [[x, y], ...]], ...], one group per InstancedMesh.
function tileGroups(tiles, ids) {
  const size = tiles.chunkSize;
  const groups = [];
  for (const chunk of tiles.chunks()) {
    const byId = new Map(); // tile id -> list of [x, y]
    chunk.tiles.forEach((id, index) => {
      if (id === 0 || !ids.has(id)) return;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push([chunk.cx * size + (index % size), chunk.cy * size + Math.floor(index / size)]);
    });
    groups.push(...byId);
  }
  return groups;
}

// One InstancedMesh per group, each instance a translation to the tile centre (x + 0.5, y + 0.5, z).
function addInstanced(scene, track, geometry, material, positions) {
  const matrix = new Matrix4();
  const mesh = track(new InstancedMesh(geometry, material, positions.length));
  positions.forEach(([x, y, z = 0], i) => mesh.setMatrixAt(i, matrix.makeTranslation(x + 0.5, y + 0.5, z)));
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// One level group: the instanced mesh plus its checkerboard and grid materials; draw picks the
// material by the Grid setting (nothing is created per frame).
function addLevelGroup(scene, track, level, geometry, materials, positions) {
  const mesh = addInstanced(scene, track, geometry, materials.checker, positions);
  level.push({ mesh, ...materials });
}

// A player box and its aim line, one pair per slot and view (an object belongs to one three.js
// scene). Hidden while the slot is empty.
function addPlayer(scene, geometries, materials, slot, z) {
  const body = new Mesh(geometries.player, materials.players[slot]);
  const aim = new Mesh(geometries.aim, materials.aim);
  body.position.z = z.player;
  aim.position.z = z.aim;
  scene.add(body, aim);
  return { body, aim, z };
}

// Moving platform meshes (one per platform) and a pool of MAX_ENEMIES enemy meshes (a guest's
// enemy list follows the host's snapshots, so its length can change), made in load, of one view;
// draw positions them from the state and hides unused enemy meshes.
function addMovers(scene, geometries, materials, map, { platformGeometry, platformMaterial, enemyZ, platformZ }) {
  const platforms = map.platforms.map((p) => {
    const mesh = new Mesh(platformGeometry, platformMaterial);
    mesh.scale.set(p.width, p.height, 1);
    mesh.position.z = platformZ;
    scene.add(mesh);
    return mesh;
  });
  const enemies = Array.from({ length: MAX_ENEMIES }, () => {
    const mesh = new Mesh(geometries.enemy, materials.enemy);
    mesh.position.z = enemyZ;
    scene.add(mesh);
    return mesh;
  });
  return { platforms, enemies };
}

// `zoom` is the camera view height holder (createCameraZoom) and `viewMode` the 2D / 2.5D and FOV
// holder (createViewMode), both passed at registration. `fetchJson` is for tests.
// `mapChoice` (createMapChoice) picks the map at load. `net` is the net session's view
// (OFFLINE_NET by default).
export function createSandbox({
  zoom = createCameraZoom(),
  viewMode = createViewMode(),
  mapChoice = createMapChoice(),
  fetchJson = defaultFetchJson,
  net = OFFLINE_NET,
} = {}) {
  let mapKey;
  let map, tiles;
  let flat, deep; // { scene, camera, player } for the 2D and the 2.5D view
  // Last non-zero aim direction for the camera's Min radius when the mouse is exactly at the head.
  // Presentation only (draw-side, like the camera itself), so it is not in the state.
  let lastAimDir = null;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend' },
    async load({ track, acquire }) {
      mapKey = mapChoice.get();
      map = loadMap(await acquireMap(acquire, mapKey, fetchJson));
      tiles = map.tiles;
      // One checkerboard and one grid texture per tile type (see tile-texture.js), mapped once per
      // tile (2D) or per cube face (2.5D) by the 0..1 UVs, so the squares line up across
      // neighbouring tiles. Each view gets both materials; draw picks one by the Grid setting.
      const flatMaterials = new Map(); // tile id -> { checker, grid }
      const cubeMaterials = new Map();
      const textures = new Map(); // tile id -> { checker, grid }
      tiles.types.forEach((type, id) => {
        if (id === 0 || type.color === undefined) return;
        const checker = track(createTileTexture(map.tileSize, type.color));
        const grid = track(createGridTexture(map.tileSize));
        const material = (map, vertexColors) => track(new MeshBasicMaterial({ map, vertexColors }));
        flatMaterials.set(id, { checker: material(checker, false), grid: material(grid, false) });
        cubeMaterials.set(id, { checker: material(checker, true), grid: material(grid, true) });
        textures.set(id, { checker, grid });
      });
      // A cells map's off-plane cubes: one material pair per tile type and z, coloured by
      // depthShade(z) (behind darker and cooler, in front darkest), made here, never per frame.
      const shadedMaterials = new Map(); // "id,z" -> { checker, grid }
      const shadedFor = (id, z) => {
        const key = `${id},${z}`;
        if (!shadedMaterials.has(key)) {
          const color = new Color(...depthShade(z));
          const { checker, grid } = textures.get(id);
          const make = (map) => track(new MeshBasicMaterial({ map, vertexColors: true, color }));
          shadedMaterials.set(key, { checker: make(checker), grid: make(grid) });
        }
        return shadedMaterials.get(key);
      };
      const geometries = {
        tile: track(new PlaneGeometry(1, 1)),
        cube: track(shadedCubeGeometry()),
        player: track(new PlaneGeometry(map.player.width, map.player.height)),
        // A thin plane from the head along +x, rotated to the aim angle.
        aim: track(new PlaneGeometry(AIM_LENGTH, AIM_WIDTH).translate(AIM_LENGTH / 2, 0, 0)),
        enemy: track(new PlaneGeometry(ENEMY.width, ENEMY.height)),
      };
      const materials = {
        players: PLAYER_COLORS.map((color) => track(new MeshBasicMaterial({ color }))),
        aim: track(new MeshBasicMaterial({ color: AIM_COLOR })),
        enemy: track(new MeshBasicMaterial({ color: ENEMY_COLOR })),
        platform: track(new MeshBasicMaterial({ color: PLATFORM_COLOR })),
        // 2.5D: the shaded cube's vertex colours times the platform colour.
        platformCube: track(new MeshBasicMaterial({ color: new Color(PLATFORM_COLOR), vertexColors: true })),
      };
      const groups = tileGroups(tiles, flatMaterials);

      // 2D: flat tiles, orthographic camera.
      const flatScene = new Scene();
      const flatLevel = []; // { mesh, checker, grid } per group
      for (const [id, positions] of groups) addLevelGroup(flatScene, track, flatLevel, geometries.tile, flatMaterials.get(id), positions);
      flat = {
        level: flatLevel,
        scene: flatScene,
        camera: new OrthographicCamera(-1, 1, 1, -1, -10, 10),
        players: PLAYER_COLORS.map((_, slot) => addPlayer(flatScene, geometries, materials, slot, { player: PLAYER_Z, aim: AIM_Z })),
        ...addMovers(flatScene, geometries, materials, map, { platformGeometry: geometries.tile, platformMaterial: materials.platform, platformZ: PLATFORM_Z, enemyZ: ENEMY_Z }),
      };

      // 2.5D: cubes centred on the play plane, depth cubes off it, perspective camera.
      const deepScene = new Scene();
      const deepLevel = [];
      for (const [id, positions] of groups) addLevelGroup(deepScene, track, deepLevel, geometries.cube, cubeMaterials.get(id), positions);
      const decor = new Map(); // "id,z" (cells map) or id -> { materials, positions: [[x, y, z], ...] }
      // Off-plane cubes: a cells map's own cells, shaded by depth, or a flat map's decorative depth
      // cubes, unshaded.
      for (const cube of map.cells ?? depthCubes(tiles)) {
        if (!cubeMaterials.has(cube.id)) continue;
        const key = map.cells ? `${cube.id},${cube.z}` : cube.id;
        if (!decor.has(key)) decor.set(key, { materials: map.cells ? shadedFor(cube.id, cube.z) : cubeMaterials.get(cube.id), positions: [] });
        decor.get(key).positions.push([cube.x, cube.y, cube.z]);
      }
      for (const { materials: m, positions } of decor.values()) addLevelGroup(deepScene, track, deepLevel, geometries.cube, m, positions);
      // Background city blocks: wide enough for the widest normal view (FOV 50, the furthest
      // zoom, a 21:9 window) anywhere the camera can go (the level plus the largest offset and
      // aim-follow Max).
      const followMax = FOLLOW_SETTINGS.find(([key]) => key === 'max')[3];
      const city = addCityBackdrop(deepScene, {
        track,
        geometry: geometries.cube,
        makeMaterial: (color) => new MeshBasicMaterial({ color, vertexColors: true }),
        bounds: levelBounds(tiles, map.cells),
        reach: OFFSET_LIMIT + followMax,
        view: { fovDegrees: FOV_DEFAULT, tilesHigh: CAMERA_TILES_MAX, aspect: 21 / 9 },
      });
      deep = {
        level: deepLevel,
        city,
        scene: deepScene,
        camera: new PerspectiveCamera(FOV_DEFAULT, 1, 0.1, 100),
        // The player is a flat plane on the play plane, facing the camera; the aim line just in front.
        players: PLAYER_COLORS.map((_, slot) => addPlayer(deepScene, geometries, materials, slot, { player: 0, aim: AIM_Z_DEEP })),
        // Platforms: boxes width x height x 1 centred on the play plane; enemies: planes at z = 0.
        ...addMovers(deepScene, geometries, materials, map, { platformGeometry: geometries.cube, platformMaterial: materials.platformCube, platformZ: 0, enemyZ: 0 }),
      };
    },
    enter() {
      return initSandbox(map, mapKey, net.localSlot());
    },
    tick: (state, inputs, dt) => tickSandbox(state, inputs, dt, tiles, viewMode.follow().smoothing, net, map),
    draw(state, view) {
      const player = localPlayer(state);
      const tilesHigh = zoom.get();
      const height = playerHeight(player); // crouchHeight while crouched, else height
      const headY = player.y + height; // top centre of the box
      const active = viewMode.mode() === '2d' ? flat : deep;
      const { camera } = active;
      // Camera: rest = head + offset; with a mouse aim, plus the aim-follow shift. The aim point is
      // the mouse projected through a camera at the rest position, never the actual camera (that
      // would chase itself). No smoothing: the camera snaps there every frame and always looks
      // straight along -z (no rotation), so its look target moves with it.
      const offset = viewMode.offset();
      // The camera rests on its smoothed source (state.camera); the aim shift is still measured
      // from the actual head.
      const head = { x: player.x, y: headY };
      const rest = { x: state.camera.x + offset.x, y: state.camera.y + offset.y };
      const mouse = state.aimSource === 'mouse' && state.pointer ? state.pointer : null;
      let shift = { x: 0, y: 0 };
      if (mouse) {
        shift = cameraShift(head, screenToPlane(rest, mouse, view.width, view.height, tilesHigh), viewMode.follow(), lastAimDir);
        lastAimDir = shift.dir;
      }
      const camX = rest.x + shift.x;
      const camY = rest.y + shift.y;
      if (active === flat) {
        fitOrtho(camera, view, tilesHigh / 2);
        camera.position.set(camX, camY, 0);
      } else {
        // The play plane (z = 0) shows exactly `tilesHigh` tiles, as in 2D, at any FOV.
        const fov = viewMode.fov();
        const distance = perspectiveDistance(tilesHigh, fov);
        const aspect = view.width / view.height;
        const near = Math.max(0.1, distance - DEPTH_MARGIN);
        // While the city backdrop shows, the far plane reaches behind its farthest layer.
        const far = distance + (viewMode.backdrop() ? CITY_FAR : DEPTH_MARGIN);
        if (camera.fov !== fov || camera.aspect !== aspect || camera.near !== near || camera.far !== far) {
          Object.assign(camera, { fov, aspect, near, far });
          camera.updateProjectionMatrix();
        }
        camera.position.set(camX, camY, distance);
      }
      if (active === deep) for (const mesh of deep.city) mesh.visible = viewMode.backdrop();
      const grid = viewMode.grid();
      for (const group of active.level) group.mesh.material = grid ? group.grid : group.checker;
      // Platforms at the state's world tick (the same tick as the local player, also on a guest).
      active.platforms.forEach((mesh, i) => {
        const box = platformAt(map.platforms[i], state.ticks);
        mesh.position.set(box.x + box.width / 2, box.y + box.height / 2, mesh.position.z);
      });
      // A guest draws the host's player and the enemies at an older host world tick than the
      // platforms (interpolated vs predicted): a remote body standing on a platform is moved with
      // that platform to the draw tick, so it is drawn on it.
      const remoteTick = state.remoteTick ?? null;
      const rideOffset = (body) => (remoteTick === null ? { dx: 0, dy: 0 } : rideShift(map.platforms, body, remoteTick, state.ticks));
      active.enemies.forEach((mesh, i) => {
        const e = state.enemies[i];
        mesh.visible = Boolean(e);
        if (!e) return;
        const { dx, dy } = rideOffset(e);
        mesh.position.set(e.x + dx, e.y + dy + ENEMY.height / 2, mesh.position.z);
      });
      // One body and aim line per player; empty slots are hidden.
      active.players.forEach(({ body, aim }, slot) => {
        const p = state.players[slot];
        body.visible = aim.visible = Boolean(p);
        if (!p) return;
        const h = playerHeight(p);
        const { dx, dy } = slot === state.localSlot ? { dx: 0, dy: 0 } : rideOffset(p);
        body.position.set(p.x + dx, p.y + dy + h / 2, body.position.z);
        body.scale.y = h / map.player.height; // the body geometry is the standing height tall
        aim.position.set(p.x + dx, p.y + dy + h, aim.position.z);
        aim.rotation.z = p.aim;
      });
      // The local aim line points at the mouse's true world position: the pointer projected
      // through the actual camera. With a stick (or before the mouse moves) it uses the aim angle.
      if (mouse) {
        const target = screenToPlane({ x: camX, y: camY }, mouse, view.width, view.height, tilesHigh);
        active.players[state.localSlot].aim.rotation.z = Math.atan2(target.y - headY, target.x - player.x);
      }
      // The input system measures frame.aim from the head's position on screen under the actual
      // camera, so the camera shift does not offset it. The view centre is the camera position and
      // the play plane shows `tilesHigh` tiles in both views, so this mapping holds for both.
      const pxPerTile = view.height / tilesHigh;
      view.setAimOrigin(0, view.width / 2 + (player.x - camera.position.x) * pxPerTile, view.height / 2 - (headY - camera.position.y) * pxPerTile);
      view.renderer.render(active.scene, camera);
    },
  };
}
