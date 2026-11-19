// Sandbox (main layer): a test scene. A tile map (the walkway) and a box player that runs and jumps.
// One world unit is one tile; x is right, y is up. Player 1 only for now.
// The tile map is static level data, built in load() and kept outside the state; the state is
// plain data: { ticks, map (manifest key), player }.

import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three';
import { acquireMap, defaultFetchJson } from '../assets/maps.js';
import { loadGridMap } from '../world/grid-map.js';
import { MOVE, createPlayer, stepPlayer } from '../world/player.js';
import { fitOrtho } from './shared.js';

export const MAP_KEY = 'map.mvp-upper-1';
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
const AIM_Z = 0.2; // in front of the player

// `map` is the result of loadGridMap. The player starts at the first `player` spawn: its x is the
// tile column (the box is centred on that tile) and its y the tile row the feet are at.
export function initSandbox(map, key = MAP_KEY) {
  const spawn = map.spawns.find((s) => s.type === 'player');
  if (!spawn) throw new Error(`sandbox: map '${map.name}' has no player spawn`);
  return { ticks: 0, map: key, player: createPlayer(spawn.x + 0.5, spawn.y) };
}

// `tiles` is the tile map (not part of the state).
export function tickSandbox(state, inputs, dt, tiles) {
  stepPlayer(state.player, inputs[0], tiles, dt);
  state.ticks += 1;
  return state;
}

// One InstancedMesh per chunk and tile type present in it, one instance per tile.
function buildTileMeshes(tiles, geometry, materials, track, scene) {
  const size = tiles.chunkSize;
  const matrix = new Matrix4();
  for (const chunk of tiles.chunks()) {
    const byId = new Map(); // tile id -> list of [x, y]
    chunk.tiles.forEach((id, index) => {
      if (id === 0 || !materials.has(id)) return;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push([chunk.cx * size + (index % size), chunk.cy * size + Math.floor(index / size)]);
    });
    for (const [id, positions] of byId) {
      const mesh = track(new InstancedMesh(geometry, materials.get(id), positions.length));
      positions.forEach(([x, y], i) => mesh.setMatrixAt(i, matrix.makeTranslation(x + 0.5, y + 0.5, 0)));
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
    }
  }
}

// `zoom` is the camera view height holder (createCameraZoom), passed at registration. `fetchJson` is for tests.
export function createSandbox({ zoom = createCameraZoom(), fetchJson = defaultFetchJson } = {}) {
  let scene, camera, playerMesh, aimLine, map, tiles;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend' },
    async load({ track, acquire }) {
      map = loadGridMap(await acquireMap(acquire, MAP_KEY, fetchJson));
      tiles = map.tiles;
      scene = new Scene();
      const tileGeometry = track(new PlaneGeometry(1, 1));
      const materials = new Map(); // tile id -> material
      tiles.types.forEach((type, id) => {
        if (id !== 0 && type.color !== undefined) materials.set(id, track(new MeshBasicMaterial({ color: type.color })));
      });
      buildTileMeshes(tiles, tileGeometry, materials, track, scene);
      playerMesh = new Mesh(
        track(new PlaneGeometry(MOVE.width, MOVE.height)),
        track(new MeshBasicMaterial({ color: PLAYER_COLOR })),
      );
      playerMesh.position.z = PLAYER_Z;
      scene.add(playerMesh);
      // A thin plane from the head along +x, rotated to the aim angle.
      aimLine = new Mesh(
        track(new PlaneGeometry(AIM_LENGTH, AIM_WIDTH).translate(AIM_LENGTH / 2, 0, 0)),
        track(new MeshBasicMaterial({ color: AIM_COLOR })),
      );
      scene.add(aimLine);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter() {
      return initSandbox(map);
    },
    tick: (state, inputs, dt) => tickSandbox(state, inputs, dt, tiles),
    draw(state, view) {
      const { player } = state;
      fitOrtho(camera, view, zoom.get() / 2);
      const centreY = player.y + MOVE.height / 2;
      camera.position.set(player.x, centreY, 0);
      playerMesh.position.set(player.x, centreY, PLAYER_Z);
      // The head: top centre of the box. The aim line starts there, and mouse aim is measured from it.
      const headY = player.y + MOVE.height;
      aimLine.position.set(player.x, headY, AIM_Z);
      aimLine.rotation.z = player.aim;
      // World to CSS px of the canvas (camera space is relative to the camera position).
      const px = ((player.x - camera.position.x - camera.left) / (camera.right - camera.left)) * view.width;
      const py = ((camera.top - (headY - camera.position.y)) / (camera.top - camera.bottom)) * view.height;
      view.setAimOrigin(0, px, py);
      view.renderer.render(scene, camera);
    },
  };
}
