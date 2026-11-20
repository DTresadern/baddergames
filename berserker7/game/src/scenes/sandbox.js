// Sandbox (main layer): a test scene. A tile map and box players that run and jump.
// One world unit is one tile; x is right, y is up. Slot 0 is player 1 (the host when online);
// slot 1 exists only while a net peer is present (the guest's player). `state.localSlot` is the
// slot this browser controls.
// The tile map and moving platforms are static level data, built in load() and kept outside the
// state; the state is plain data: { ticks, map (manifest key), players, enemies, localSlot, ... }.
// `ticks` is the world tick: platforms are a function of it (world/platform.js).
// Enemies (world/enemy.js) are simulated by the host (or offline) only; a guest draws the host's,
// interpolated. Combat (world/combat.js): every player steps its melee timer (a guest predicts its
// own swing); only the host (or offline) decides hits.
// Networking reaches the scene only through `net` (the net session's read-only view, see
// net/session.js): the scene never sees the transport, and input still arrives only as `inputs`.

import { BoxGeometry, Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { acquireMap, defaultFetchJson } from '../assets/maps.js';
import { loadMap } from '../world/load-map.js';
import { reconcile } from '../net/prediction.js';
import { ENEMY, MAX_ENEMIES, createEnemy, stepEnemy } from '../world/enemy.js';
import { ENEMY_HEALTH, PLAYER_HEALTH, meleeBox, resolveCombat, stepMelee, swinging } from '../world/combat.js';
import { platformAt, platformsStep, rideShift } from '../world/platform.js';
import { createPlayer, playerHeight, pushByPlatforms } from '../world/player.js';
import { PRESS_NONE, playerDepth, stepRowPlayer } from '../world/rows.js';
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
// extended into the test level. map.depth-rows-test tries depth rows (world/rows.js).
export const SANDBOX_MAPS = Object.freeze(['map.moge3-cyberpunk-blocks', 'map.moge3-cyberpunk', 'map.mvp-upper-1', 'map.walkway', 'map.depth-rows-test']);
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

// Lowest y of any solid tile over all the given tile maps (a map's rows), or 0 when all are empty.
function lowestTileY(tileMaps) {
  let lowest = Infinity;
  for (const tiles of tileMaps) {
    const size = tiles.chunkSize;
    for (const chunk of tiles.chunks()) {
      chunk.tiles.forEach((id, index) => {
        if (id !== 0) lowest = Math.min(lowest, chunk.cy * size + Math.floor(index / size));
      });
    }
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
// Level data with no moving platforms, one row and no transfer zones (tickSandbox's default; with
// `rows` null the tiles are row 0).
const NO_LEVEL = Object.freeze({ platforms: Object.freeze([]), rows: null, transfers: Object.freeze([]) });
export const PLATFORM_COLOR = 0xc9a23a; // hazard yellow
export const ENEMY_COLOR = 0xe03030;
export const MARKER_COLOR = 0x3ee8ff; // transfer zone markers (2.5D)
const MARKER_THICKNESS = 0.06; // tiles
const PLATFORM_Z = 0.05; // in front of the tiles, behind the players (2D)
const ENEMY_Z = 0.08; // in front of the tiles and platforms, behind the players (2D)
const PLAYER_Z = 0.1; // in front of the tiles
export const AIM_LENGTH = 2; // aim line length, tiles
const AIM_WIDTH = 0.06; // aim line thickness, tiles
const AIM_COLOR = 0xffffff;
const AIM_Z = 0.2; // in front of the player (2D)
const AIM_Z_DEEP = 0.02; // just in front of the player plane (2.5D)
const SWING_COLOR = 0xffffff;
const SWING_OPACITY = 0.45;
const SWING_Z = 0.15; // in front of the player, behind the aim line (2D)
const SWING_Z_DEEP = 0.01; // just in front of the player plane (2.5D)
export const HEALTH_BAR_COLOR = 0x40e070;
const HEALTH_BAR_HEIGHT = 0.08; // tiles
const HEALTH_BAR_GAP = 0.1; // tiles from the enemy's top to the bar's centre
const HEALTH_BAR_Z = 0.09; // in front of the enemies (2D)
const HEALTH_BAR_Z_DEEP = 0.01; // just in front of the enemy plane (2.5D)

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

// The tile maps of the rows a player can be on: row 0 plus every row a transfer zone names (a map
// without transfers: row 0 only, so decorative depth slices do not move the fall line).
function reachableRows(map) {
  const zs = new Set([0, ...(map.transfers ?? []).flatMap((t) => [t.low, t.high])]);
  return [...zs].map((z) => (z === 0 ? map.tiles : map.rows?.get(z))).filter(Boolean);
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
    fallY: lowestTileY(reachableRows(map)) - FALL_MARGIN,
    size: { ...map.player },
    camera: null,
    // An enemy's id is its index among the map's enemy spawns: the same on host and guest.
    enemies: enemySpawns.map(({ x, y }, id) => createEnemy(x, y, id)),
    enemySpawns,
  };
  return respawnAll(state, localSlot);
}

// Puts a player back at the spawn on row 0: no velocity, no hop, no recent presses. Health,
// inventory and melee fields are kept (a death respawn sets them itself).
function toSpawn(state, player) {
  Object.assign(player, { ...state.spawn, vx: 0, vy: 0, onGround: false, crouching: false, row: 0, hop: null, presses: { down: PRESS_NONE, jump: PRESS_NONE } });
}

// One player step (with depth rows, world/rows.js), its melee timer (world/combat.js; after the
// move, so the swing takes this tick's aim) and the fall respawn, on the spawn's row 0.
// `level` is { rows, transfers }. Returns true when the player respawned.
function stepWithFall(state, player, frame, level, dt, world) {
  // Moving platforms push players on row 0 (platforms are on row 0 only), not during a hop; a
  // player with no room left is marked crushed (the host kills it, world/combat.js).
  if (player.row === 0 && player.hop === null) pushByPlatforms(player, world.platforms, level.rows.get(0));
  else player.crushed = false;
  stepRowPlayer(player, frame, level.rows, level.transfers, dt, world);
  stepMelee(player, frame);
  if (player.y >= state.fallY) return false;
  toSpawn(state, player);
  return true;
}

// `tiles` is the play plane's tile map and `level` the map's other level data ({ platforms, rows,
// transfers }: rows a Map z -> tile map, null for `tiles` as row 0); neither is part of the state.
// Players step through stepRowPlayer (depth rows); enemies stay on row 0. `halfLife` (seconds) smooths the camera's
// source towards the local head (smerp); 0 snaps. A local respawn snaps it too.
// `net` is the net view (OFFLINE_NET when there is no session):
//   - its localSlot differs from the state's: the state starts again for that slot
//   - offline or host: slot i steps with inputs[i]; slot 1 exists only while a peer is present
//   - guest: the own player (slot 1) is the newest snapshot's copy with the inputs the host has
//     not applied replayed on it (the current tick's frame is among them), or without a snapshot
//     one step with inputs[0]; slot 0 is the interpolated host player (kept when there is none)
// World tick: a step from world tick k to k + 1 sees the platforms at k and k + 1, then
// state.ticks = k + 1. Offline or host: k = state.ticks; enemies step after the players, then
// resolveCombat decides hits (a player at 0 health goes back to the spawn with full health). Guest:
// a snapshot's replay starts at the host's world tick `wt` (replayed entry j steps wt + j to
// wt + j + 1, then state.ticks = wt + entries), so the guest predicts at the ticks the host will
// use; without a snapshot k = state.ticks. Guest enemies come from net.remoteEnemies().
// inputs[0] is always this browser's own keyboard + mouse (+ pad) frame: pointer and aim source
// come from it and belong to the local player.
export function tickSandbox(state, inputs, dt, tiles, halfLife = 0, net = OFFLINE_NET, level = NO_LEVEL) {
  const slot = net.localSlot();
  if (slot !== state.localSlot) respawnAll(state, slot);
  const rowLevel = { rows: level.rows ?? new Map([[0, tiles]]), transfers: level.transfers ?? [] };
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
      if (stepWithFall(state, player, f, rowLevel, dt, { platforms: platformsStep(level.platforms, k) })) respawned = true;
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
    // `remote` carries `depth` (its drawn depth, interpolated; see net/session.js), kept here.
    if (remote) state.players[0] = { ...remote, size: { ...state.size } };
    // Enemies: the host's list (by id), interpolated; the map's own until the first snapshot.
    const enemies = net.remoteEnemies();
    if (enemies) state.enemies = enemies.map((e) => ({ ...createEnemy(e.x, e.y, e.id, e.type), awake: e.awake, health: e.health }));
  } else {
    const count = net.peerPresent() ? MAX_SLOTS : 1;
    while (state.players.length < count) state.players.push(spawnPlayer(state));
    state.players.length = count;
    const world = { platforms: platformsStep(level.platforms, state.ticks) };
    state.players.forEach((player, i) => {
      if (stepWithFall(state, player, inputs[i], rowLevel, dt, world) && i === state.localSlot) respawned = true;
    });
    // A fallen enemy goes back to its spawn, idle; one with no spawn of this map (an id that came
    // from elsewhere, e.g. a host's list kept after leaving a game) is removed instead.
    state.enemies = state.enemies.filter((enemy) => {
      stepEnemy(enemy, state.players, tiles, dt, world);
      if (enemy.y >= state.fallY) return true;
      const spawn = state.enemySpawns[enemy.id];
      if (!spawn) return false;
      Object.assign(enemy, createEnemy(spawn.x, spawn.y, enemy.id, enemy.type));
      return true;
    });
    // Hits (host and offline only). A player at 0 health goes back to the spawn with full health.
    for (const i of resolveCombat(state)) {
      const player = state.players[i];
      toSpawn(state, player);
      Object.assign(player, { health: PLAYER_HEALTH, meleeTicks: 0 });
      if (i === state.localSlot) respawned = true;
    }
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

// A player box, its aim line and its melee swing, one set per slot and view (an object belongs to
// one three.js scene). Hidden while the slot is empty; the swing only while it is drawn.
function addPlayer(scene, geometries, materials, slot, z) {
  const body = new Mesh(geometries.player, materials.players[slot]);
  const aim = new Mesh(geometries.aim, materials.aim);
  const swing = new Mesh(geometries.tile, materials.swing);
  body.position.z = z.player;
  aim.position.z = z.aim;
  swing.visible = false;
  scene.add(body, aim, swing);
  return { body, aim, swing, z };
}

// The highest solid top over columns x0..x1 of `tiles` (each column scanned from y 64 down to
// -64), or null when there is none.
function floorTop(tiles, x0, x1) {
  let top = null;
  for (let x = x0; x <= x1; x++) {
    for (let y = 64; y >= -64; y--) {
      if (!tiles.isSolid(x, y)) continue;
      if (top === null || y + 1 > top) top = y + 1;
      break;
    }
  }
  return top;
}

// Transfer zone markers (2.5D): per zone and each of its two rows, a thin box the zone's width
// and one tile deep, lying on that row's floor top in the zone (skipped when the row has none).
function addTransferMarkers(scene, track, map) {
  const geometry = track(new BoxGeometry(1, MARKER_THICKNESS, 1));
  const material = track(new MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: 0.85 }));
  for (const { x0, x1, low, high } of map.transfers ?? []) {
    for (const z of [low, high]) {
      const tiles = map.rows?.get(z);
      const top = tiles ? floorTop(tiles, x0, x1) : null;
      if (top === null) continue;
      const mesh = new Mesh(geometry, material);
      mesh.scale.x = x1 - x0 + 1;
      mesh.position.set((x0 + x1 + 1) / 2, top + MARKER_THICKNESS / 2, z);
      scene.add(mesh);
    }
  }
}

// Moving platform meshes (one per platform) and a pool of MAX_ENEMIES enemy meshes and health bars
// (a guest's enemy list follows the host's snapshots, so its length can change), made in load, of
// one view; draw positions them from the state and hides unused enemy meshes.
function addMovers(scene, geometries, materials, map, { platformGeometry, platformMaterial, enemyZ, platformZ, barZ }) {
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
  const bars = Array.from({ length: MAX_ENEMIES }, () => {
    const mesh = new Mesh(geometries.healthBar, materials.healthBar);
    mesh.position.z = barZ;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });
  return { platforms, enemies, bars };
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
  // A cells map's shaded material pairs ({ checker, grid, z }), recoloured by depth relative to the
  // local player's row whenever its drawn depth changes (shadeDepth: the depth they show now).
  let shaded = [];
  let shadeDepth = 0;
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
      // The colours are relative to the local player's row; draw updates them (see shaded).
      const shadedMaterials = new Map(); // "id,z" -> { checker, grid, z }
      shaded = [];
      shadeDepth = 0;
      const shadedFor = (id, z) => {
        const key = `${id},${z}`;
        if (!shadedMaterials.has(key)) {
          const color = new Color(...depthShade(z));
          const { checker, grid } = textures.get(id);
          const make = (map) => track(new MeshBasicMaterial({ map, vertexColors: true, color }));
          const pair = { checker: make(checker), grid: make(grid), z };
          shadedMaterials.set(key, pair);
          shaded.push(pair);
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
        // Anchored at its left end, so scale.x shrinks it towards the left.
        healthBar: track(new PlaneGeometry(ENEMY.width, HEALTH_BAR_HEIGHT).translate(ENEMY.width / 2, 0, 0)),
      };
      const materials = {
        players: PLAYER_COLORS.map((color) => track(new MeshBasicMaterial({ color }))),
        aim: track(new MeshBasicMaterial({ color: AIM_COLOR })),
        enemy: track(new MeshBasicMaterial({ color: ENEMY_COLOR })),
        swing: track(new MeshBasicMaterial({ color: SWING_COLOR, transparent: true, opacity: SWING_OPACITY })),
        healthBar: track(new MeshBasicMaterial({ color: HEALTH_BAR_COLOR })),
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
        players: PLAYER_COLORS.map((_, slot) => addPlayer(flatScene, geometries, materials, slot, { player: PLAYER_Z, aim: AIM_Z, swing: SWING_Z })),
        ...addMovers(flatScene, geometries, materials, map, { platformGeometry: geometries.tile, platformMaterial: materials.platform, platformZ: PLATFORM_Z, enemyZ: ENEMY_Z, barZ: HEALTH_BAR_Z }),
      };

      // 2.5D: cubes centred on the play plane, depth cubes off it, perspective camera. A cells map's
      // play plane cubes are shaded too (by depth relative to the local player's row).
      const deepScene = new Scene();
      const deepLevel = [];
      for (const [id, positions] of groups) addLevelGroup(deepScene, track, deepLevel, geometries.cube, map.cells ? shadedFor(id, 0) : cubeMaterials.get(id), positions);
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
      addTransferMarkers(deepScene, track, map);
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
        players: PLAYER_COLORS.map((_, slot) => addPlayer(deepScene, geometries, materials, slot, { player: 0, aim: AIM_Z_DEEP, swing: SWING_Z_DEEP })),
        // Platforms: boxes width x height x 1 centred on the play plane; enemies: planes at z = 0.
        ...addMovers(deepScene, geometries, materials, map, { platformGeometry: geometries.cube, platformMaterial: materials.platformCube, platformZ: 0, enemyZ: 0, barZ: HEALTH_BAR_Z_DEEP }),
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
      // 2.5D depth: each player is drawn at its row's depth (eased during a hop; a guest's remote
      // player carries an interpolated `depth`). The 2D view draws z = 0 only.
      const depthOf = (p) => (active === deep ? p.depth ?? playerDepth(p) : 0);
      const viewDepth = depthOf(player);
      // With the row camera on, the camera moves in depth with the local player, so its plane
      // shows tilesHigh tiles. Off (2.5D), the camera stays on the play plane's distance and the
      // player's plane shows planeTiles. Used for the mouse and the aim origin.
      const distance = active === deep ? perspectiveDistance(tilesHigh, viewMode.fov()) : 0;
      const rowCamera = viewMode.rowCamera();
      const planeTiles = active === deep && !rowCamera ? (tilesHigh * (distance - viewDepth)) / distance : tilesHigh;
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
        shift = cameraShift(head, screenToPlane(rest, mouse, view.width, view.height, planeTiles), viewMode.follow(), lastAimDir);
        lastAimDir = shift.dir;
      }
      const camX = rest.x + shift.x;
      const camY = rest.y + shift.y;
      if (active === flat) {
        fitOrtho(camera, view, tilesHigh / 2);
        camera.position.set(camX, camY, 0);
      } else {
        // The play plane (z = 0; the player's row with the row camera) shows exactly `tilesHigh`
        // tiles, as in 2D, at any FOV. Near and far are relative to the camera, so they follow it.
        const fov = viewMode.fov();
        const aspect = view.width / view.height;
        const near = Math.max(0.1, distance - DEPTH_MARGIN);
        // While the city backdrop shows, the far plane reaches behind its farthest layer.
        const far = distance + (viewMode.backdrop() ? CITY_FAR : DEPTH_MARGIN);
        if (camera.fov !== fov || camera.aspect !== aspect || camera.near !== near || camera.far !== far) {
          Object.assign(camera, { fov, aspect, near, far });
          camera.updateProjectionMatrix();
        }
        camera.position.set(camX, camY, distance + (rowCamera ? viewDepth : 0));
        // Depth shading relative to the local player's row (eased during a hop).
        if (viewDepth !== shadeDepth) {
          shadeDepth = viewDepth;
          for (const pair of shaded) {
            const [r, g, b] = depthShade(pair.z - viewDepth);
            pair.checker.color.setRGB(r, g, b);
            pair.grid.color.setRGB(r, g, b);
          }
        }
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
        const bar = active.bars[i];
        mesh.visible = Boolean(e);
        // The health bar shows only while the enemy is hurt and alive.
        bar.visible = Boolean(e) && e.health > 0 && e.health < ENEMY_HEALTH;
        if (!e) return;
        const { dx, dy } = rideOffset(e);
        mesh.position.set(e.x + dx, e.y + dy + ENEMY.height / 2, mesh.position.z);
        if (!bar.visible) return;
        bar.position.set(e.x + dx - ENEMY.width / 2, e.y + dy + ENEMY.height + HEALTH_BAR_GAP, bar.position.z);
        bar.scale.x = e.health / ENEMY_HEALTH;
      });
      // One body, aim line and melee swing per player; empty slots are hidden.
      active.players.forEach(({ body, aim, swing, z }, slot) => {
        const p = state.players[slot];
        body.visible = aim.visible = Boolean(p);
        swing.visible = Boolean(p) && swinging(p);
        if (!p) return;
        const h = playerHeight(p);
        const { dx, dy } = slot === state.localSlot ? { dx: 0, dy: 0 } : rideOffset(p);
        const depth = depthOf(p);
        body.position.set(p.x + dx, p.y + dy + h / 2, z.player + depth);
        body.scale.y = h / map.player.height; // the body geometry is the standing height tall
        aim.position.set(p.x + dx, p.y + dy + h, z.aim + depth);
        aim.rotation.z = p.aim;
        if (swing.visible) {
          const box = meleeBox(p);
          swing.scale.set(box.x1 - box.x0, box.y1 - box.y0, 1);
          swing.position.set((box.x0 + box.x1) / 2 + dx, (box.y0 + box.y1) / 2 + dy, z.swing + depth);
        }
      });
      // The local aim line points at the mouse's true world position: the pointer projected
      // through the actual camera. With a stick (or before the mouse moves) it uses the aim angle.
      if (mouse) {
        const target = screenToPlane({ x: camX, y: camY }, mouse, view.width, view.height, planeTiles);
        active.players[state.localSlot].aim.rotation.z = Math.atan2(target.y - headY, target.x - player.x);
      }
      // The input system measures frame.aim from the head's position on screen under the actual
      // camera, so the camera shift does not offset it. The view centre is the camera position and
      // the player's plane shows `planeTiles` tiles, so this mapping holds for both views.
      const pxPerTile = view.height / planeTiles;
      view.setAimOrigin(0, view.width / 2 + (player.x - camera.position.x) * pxPerTile, view.height / 2 - (headY - camera.position.y) * pxPerTile);
      view.renderer.render(active.scene, camera);
    },
  };
}
