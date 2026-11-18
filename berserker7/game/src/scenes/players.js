// Players (main layer): an input test. Each connected player is a coloured disc that
// moves with the move actions inside a fixed arena, with a pointer showing its aim.
// The disc lights up while jump is held and the pointer turns red while primary fire is
// held. draw() tells the input system where each player is on screen (view.setAimOrigin),
// so mouse aim is measured from player 1's disc.

import {
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import { fitOrtho, syncMeshes } from './shared.js';

export const SPEED = 3; // world units per second
export const ARENA = { halfWidth: 6, halfHeight: 3.5 }; // world units; the view always shows all of it
export const RADIUS = 0.35;
const MARGIN = 0.5; // world units shown around the arena
const AIM_LENGTH = 0.9;
const COLORS = [0xf2c14e, 0x5aa9e6]; // player 1, player 2
const LIT_COLORS = [0xfff1c4, 0xd2e9ff]; // while jump is held
const START_X = [-2, 2];

export function initPlayers() {
  return {
    ticks: 0,
    players: START_X.map((x, index) => ({
      index,
      connected: false,
      x,
      y: 0,
      aim: 0,
      jumps: 0,
      fires: 0,
      jumping: false, // jump held this tick
      firing: false, // primary fire held this tick
    })),
  };
}

const clamp = (value, limit) => Math.min(limit, Math.max(-limit, value));

export function tickPlayers(state, inputs, dt) {
  state.ticks += 1;
  for (const frame of inputs) {
    const player = state.players[frame.player];
    if (!player) continue;
    const { actions } = frame;
    player.connected = frame.connected;
    let dx = Number(actions.moveRight.held) - Number(actions.moveLeft.held);
    let dy = Number(actions.moveUp.held) - Number(actions.moveDown.held);
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    player.x = clamp(player.x + dx * SPEED * dt, ARENA.halfWidth - RADIUS);
    player.y = clamp(player.y + dy * SPEED * dt, ARENA.halfHeight - RADIUS);
    player.aim = frame.aim;
    if (actions.jump.pressed) player.jumps += 1;
    if (actions.primaryFire.pressed) player.fires += 1;
    player.jumping = actions.jump.held;
    player.firing = actions.primaryFire.held;
  }
  return state;
}

function arenaOutline() {
  const { halfWidth: w, halfHeight: h } = ARENA;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0], 3));
  return geometry;
}

export function createPlayers() {
  let scene, camera, group, discGeometry, aimGeometry, tipGeometry;
  let discMaterials, litMaterials, aimMaterial, fireMaterial, meshOf;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend' },
    async load({ track }) {
      discGeometry = track(new CircleGeometry(RADIUS, 40));
      aimGeometry = track(new PlaneGeometry(AIM_LENGTH, 0.07).translate(AIM_LENGTH / 2, 0, 0));
      tipGeometry = track(new CircleGeometry(0.14, 3)); // a triangle with one corner on +x
      discMaterials = COLORS.map((color) => track(new MeshBasicMaterial({ color })));
      litMaterials = LIT_COLORS.map((color) => track(new MeshBasicMaterial({ color })));
      aimMaterial = track(new MeshBasicMaterial({ color: 0xffffff }));
      fireMaterial = track(new MeshBasicMaterial({ color: 0xe8615a }));
      const outline = new LineLoop(track(arenaOutline()), track(new LineBasicMaterial({ color: 0x55607a })));
      scene = new Scene();
      group = new Group();
      scene.add(outline, group);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
      meshOf = new WeakMap();
    },
    enter: () => initPlayers(),
    tick: tickPlayers,
    draw(state, view) {
      const aspect = view.width / view.height;
      fitOrtho(camera, view, Math.max(ARENA.halfHeight + MARGIN, (ARENA.halfWidth + MARGIN) / aspect));
      const shown = state.players.filter((player) => player.connected);
      syncMeshes(group, shown, meshOf, (player) => {
        // Meshes only share the tracked geometry and materials; a Mesh made without a
        // material would create an untracked default one.
        const marker = new Group();
        const disc = new Mesh(discGeometry, discMaterials[player.index % COLORS.length]);
        const pointer = new Group();
        const line = new Mesh(aimGeometry, aimMaterial);
        const tip = new Mesh(tipGeometry, aimMaterial);
        tip.position.x = AIM_LENGTH;
        pointer.add(line, tip);
        pointer.position.z = 0.1;
        marker.add(disc, pointer);
        marker.userData = { disc, pointer, line, tip };
        return marker;
      });
      for (const player of shown) {
        const marker = meshOf.get(player);
        const { disc, pointer, line, tip } = marker.userData;
        const colour = player.index % COLORS.length;
        marker.position.set(player.x, player.y, 0);
        pointer.rotation.z = player.aim;
        disc.material = (player.jumping ? litMaterials : discMaterials)[colour];
        line.material = tip.material = player.firing ? fireMaterial : aimMaterial;
        // World position to CSS px of the canvas, for mouse aim.
        const px = ((player.x - camera.left) / (camera.right - camera.left)) * view.width;
        const py = ((camera.top - player.y) / (camera.top - camera.bottom)) * view.height;
        view.setAimOrigin?.(player.index, px, py);
      }
      view.renderer.render(scene, camera);
    },
  };
}
