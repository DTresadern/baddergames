// Scene A (main layer): boxes orbiting the centre. Leaves by suspending.
// Uses the shared checker texture.

import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { createResourceList } from '../engine/resources.js';
import { CHECKER, createCheckerTexture, fitPerspective, syncMeshes } from './shared.js';

const COLORS = [0xe8615a, 0xf2c14e, 0x6cc4a1, 0x5aa9e6, 0xb48ee0, 0xf29e6d];
const TURN = Math.PI * 2;

export function initSceneA() {
  return {
    ticks: 0,
    boxes: COLORS.map((_, i) => ({
      color: i,
      angle: (i * TURN) / COLORS.length,
      speed: 0.5 + 0.15 * i, // radians per second
      radius: 1.1 + 0.3 * (i % 3),
      y: (i % 2) * 0.6 - 0.3,
    })),
  };
}

export function tickSceneA(state, inputs, dt) {
  state.ticks += 1;
  for (const box of state.boxes) box.angle = (box.angle + box.speed * dt) % TURN;
  return state;
}

export function createSceneA({ assets }) {
  let resources, scene, camera, group, geometry, materials, meshOf;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend' },
    async load() {
      resources = createResourceList();
      const map = assets.acquire(CHECKER, createCheckerTexture);
      geometry = resources.track(new BoxGeometry(0.5, 0.5, 0.5));
      materials = COLORS.map((color) => resources.track(new MeshBasicMaterial({ color, map })));
      scene = new Scene();
      group = new Group();
      scene.add(group);
      camera = new PerspectiveCamera(50, 1, 0.1, 50);
      camera.position.set(0, 2, 5);
      camera.lookAt(0, 0, 0);
      meshOf = new WeakMap();
    },
    enter: () => initSceneA(),
    tick: tickSceneA,
    draw(state, view) {
      fitPerspective(camera, view, 5.4);
      syncMeshes(group, state.boxes, meshOf, (box) => new Mesh(geometry, materials[box.color]));
      for (const box of state.boxes) {
        const mesh = meshOf.get(box);
        mesh.position.set(Math.cos(box.angle) * box.radius, box.y, Math.sin(box.angle) * box.radius);
        mesh.rotation.set(box.angle * 2, box.angle * 3, 0);
      }
      view.renderer.render(scene, camera);
    },
    unload() {
      resources.disposeAll();
      assets.release(CHECKER);
      resources = scene = camera = group = geometry = materials = meshOf = null;
    },
  };
}
