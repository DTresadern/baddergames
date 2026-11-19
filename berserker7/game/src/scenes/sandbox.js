// Sandbox (main layer): a test scene. A tile map (the walkway) and a box player that runs and jumps.
// One world unit is one tile; x is right, y is up. Player 1 only for now.
// The tile map is static level data, built in load() and kept outside the state; the state is
// plain data: { ticks, map (manifest key), player }.

import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { acquireMap, defaultFetchJson } from '../assets/maps.js';
import { loadMap } from '../world/load-map.js';
import { MOVE, createPlayer, stepPlayer } from '../world/player.js';
import { fitOrtho } from './shared.js';
import { createTileTexture } from './tile-texture.js';
import {
  DEPTH_MARGIN,
  FOV_DEFAULT,
  cameraShift,
  createViewMode,
  depthCubes,
  perspectiveDistance,
  screenToPlane,
  shadedCubeGeometry,
} from './sandbox-3d.js';

// The maps the Sandbox can load (manifest keys), and the default: the MoGe-3 blockout.
export const SANDBOX_MAPS = Object.freeze(['map.moge3-cyberpunk', 'map.mvp-upper-1', 'map.walkway']);
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
export const CAMERA_TILES_HIGH = 22;
export const CAMERA_TILES_MIN = 18; // closest zoom
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
const PLAYER_COLOR = 0xf2c14e;
const PLAYER_Z = 0.1; // in front of the tiles
export const AIM_LENGTH = 2; // aim line length, tiles
const AIM_WIDTH = 0.06; // aim line thickness, tiles
const AIM_COLOR = 0xffffff;
const AIM_Z = 0.2; // in front of the player (2D)
const AIM_Z_DEEP = 0.02; // just in front of the player plane (2.5D)

// `map` is the result of loadMap. The player starts at the first `player` spawn: its x is the
// tile column (the box is centred on that tile) and its y the tile row the feet are at.
export function initSandbox(map, key = MAP_KEY) {
  const spawn = map.spawns.find((s) => s.type === 'player');
  if (!spawn) throw new Error(`sandbox: map '${map.name}' has no player spawn`);
  // `pointer`: player 1's last mouse position ({ x, y }, canvas CSS px) or null. `aimSource`: what
  // last changed player 1's aim, 'mouse' (the pointer moved) or 'stick', or null before either.
  // `spawn` and `fallY`: a player below fallY goes back to the spawn (maps can have open ends).
  return {
    ticks: 0,
    map: key,
    player: createPlayer(spawn.x + 0.5, spawn.y),
    pointer: null,
    aimSource: null,
    spawn: { x: spawn.x + 0.5, y: spawn.y },
    fallY: lowestTileY(map.tiles) - FALL_MARGIN,
  };
}

// `tiles` is the tile map (not part of the state).
export function tickSandbox(state, inputs, dt, tiles) {
  const frame = inputs[0];
  if (frame?.connected) {
    if (frame.pointer) state.pointer = { x: frame.pointer.x, y: frame.pointer.y };
    if (frame.pointer?.moved) state.aimSource = 'mouse';
    else if (Number.isFinite(frame.aim) && frame.aim !== state.player.aim) state.aimSource = 'stick';
  }
  stepPlayer(state.player, frame, tiles, dt);
  if (state.player.y < state.fallY) Object.assign(state.player, { ...state.spawn, vx: 0, vy: 0, onGround: false });
  state.ticks += 1;
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
}

// The player box and the aim line, one pair per view (an object belongs to one three.js scene).
function addPlayer(scene, geometries, materials, z) {
  const body = new Mesh(geometries.player, materials.player);
  const aim = new Mesh(geometries.aim, materials.aim);
  body.position.z = z.player;
  aim.position.z = z.aim;
  scene.add(body, aim);
  return { body, aim, z };
}

// `zoom` is the camera view height holder (createCameraZoom) and `viewMode` the 2D / 2.5D and FOV
// holder (createViewMode), both passed at registration. `fetchJson` is for tests.
// `mapChoice` (createMapChoice) picks the map at load.
export function createSandbox({ zoom = createCameraZoom(), viewMode = createViewMode(), mapChoice = createMapChoice(), fetchJson = defaultFetchJson } = {}) {
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
      // One checkerboard texture per tile type (see tile-texture.js), mapped once per tile (2D) or
      // per cube face (2.5D) by the 0..1 UVs, so the squares line up across neighbouring tiles.
      const flatMaterials = new Map(); // tile id -> material
      const cubeMaterials = new Map();
      tiles.types.forEach((type, id) => {
        if (id === 0 || type.color === undefined) return;
        const texture = track(createTileTexture(map.tileSize, type.color));
        flatMaterials.set(id, track(new MeshBasicMaterial({ map: texture })));
        cubeMaterials.set(id, track(new MeshBasicMaterial({ map: texture, vertexColors: true })));
      });
      const geometries = {
        tile: track(new PlaneGeometry(1, 1)),
        cube: track(shadedCubeGeometry()),
        player: track(new PlaneGeometry(MOVE.width, MOVE.height)),
        // A thin plane from the head along +x, rotated to the aim angle.
        aim: track(new PlaneGeometry(AIM_LENGTH, AIM_WIDTH).translate(AIM_LENGTH / 2, 0, 0)),
      };
      const materials = {
        player: track(new MeshBasicMaterial({ color: PLAYER_COLOR })),
        aim: track(new MeshBasicMaterial({ color: AIM_COLOR })),
      };
      const groups = tileGroups(tiles, flatMaterials);

      // 2D: flat tiles, orthographic camera.
      const flatScene = new Scene();
      for (const [id, positions] of groups) addInstanced(flatScene, track, geometries.tile, flatMaterials.get(id), positions);
      flat = {
        scene: flatScene,
        camera: new OrthographicCamera(-1, 1, 1, -1, -10, 10),
        player: addPlayer(flatScene, geometries, materials, { player: PLAYER_Z, aim: AIM_Z }),
      };

      // 2.5D: cubes centred on the play plane, depth cubes off it, perspective camera.
      const deepScene = new Scene();
      for (const [id, positions] of groups) addInstanced(deepScene, track, geometries.cube, cubeMaterials.get(id), positions);
      const decor = new Map(); // tile id -> [[x, y, z], ...]
      // Off-plane cubes: a cells map's own cells, or decorative depth cubes for a flat map.
      for (const cube of map.cells ?? depthCubes(tiles)) {
        if (!cubeMaterials.has(cube.id)) continue;
        if (!decor.has(cube.id)) decor.set(cube.id, []);
        decor.get(cube.id).push([cube.x, cube.y, cube.z]);
      }
      for (const [id, positions] of decor) addInstanced(deepScene, track, geometries.cube, cubeMaterials.get(id), positions);
      deep = {
        scene: deepScene,
        camera: new PerspectiveCamera(FOV_DEFAULT, 1, 0.1, 100),
        // The player is a flat plane on the play plane, facing the camera; the aim line just in front.
        player: addPlayer(deepScene, geometries, materials, { player: 0, aim: AIM_Z_DEEP }),
      };
    },
    enter() {
      return initSandbox(map, mapKey);
    },
    tick: (state, inputs, dt) => tickSandbox(state, inputs, dt, tiles),
    draw(state, view) {
      const { player } = state;
      const tilesHigh = zoom.get();
      const centreY = player.y + MOVE.height / 2;
      const headY = player.y + MOVE.height; // top centre of the box
      const active = viewMode.mode() === '2d' ? flat : deep;
      const { camera } = active;
      // Camera: rest = head + offset; with a mouse aim, plus the aim-follow shift. The aim point is
      // the mouse projected through a camera at the rest position, never the actual camera (that
      // would chase itself). No smoothing: the camera snaps there every frame and always looks
      // straight along -z (no rotation), so its look target moves with it.
      const offset = viewMode.offset();
      const head = { x: player.x, y: headY };
      const rest = { x: head.x + offset.x, y: head.y + offset.y };
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
        const far = distance + DEPTH_MARGIN;
        if (camera.fov !== fov || camera.aspect !== aspect || camera.near !== near || camera.far !== far) {
          Object.assign(camera, { fov, aspect, near, far });
          camera.updateProjectionMatrix();
        }
        camera.position.set(camX, camY, distance);
      }
      const { body, aim } = active.player;
      body.position.set(player.x, centreY, body.position.z);
      aim.position.set(player.x, headY, aim.position.z);
      // The aim line points at the mouse's true world position: the pointer projected through the
      // actual camera. With a stick (or before the mouse moves) it uses the input's aim angle.
      if (mouse) {
        const target = screenToPlane({ x: camX, y: camY }, mouse, view.width, view.height, tilesHigh);
        aim.rotation.z = Math.atan2(target.y - headY, target.x - player.x);
      } else {
        aim.rotation.z = player.aim;
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
