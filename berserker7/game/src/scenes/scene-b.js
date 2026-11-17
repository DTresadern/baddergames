// Scene B (main layer): balls bouncing. Leaves by snapshot: its state is kept as
// plain data and its three.js objects are freed while it is away.
// Uses the shared checker texture.
//
// The simulation uses whole numbers only (thousandths of a world unit per fixed
// step), so it is exact and repeatable.

import { Group, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, SphereGeometry } from 'three';
import { createResourceList } from '../engine/resources.js';
import { CHECKER, createCheckerTexture, fitOrtho, syncMeshes } from './shared.js';

const COLORS = [0xe8615a, 0xf2c14e, 0x6cc4a1, 0x5aa9e6, 0xb48ee0];
const HALF_WIDTH = 1600;
const FLOOR = -900;
const GRAVITY = 2;
const HALF_HEIGHT = 1.2; // world units shown above and below centre

export function initSceneB() {
  return {
    ticks: 0,
    balls: COLORS.map((_, i) => ({
      color: i,
      x: -1200 + i * 600,
      y: FLOOR + 200 * i,
      vx: [13, -9, 7, -15, 11][i],
      vy: 0,
      launch: 48 + 6 * i, // upward speed after each bounce
    })),
  };
}

export function tickSceneB(state) {
  state.ticks += 1;
  for (const ball of state.balls) {
    ball.vy -= GRAVITY;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.x > HALF_WIDTH || ball.x < -HALF_WIDTH) {
      ball.x = Math.sign(ball.x) * HALF_WIDTH;
      ball.vx = -ball.vx;
    }
    if (ball.y < FLOOR) {
      ball.y = FLOOR;
      ball.vy = ball.launch;
    }
  }
  return state;
}

export function createSceneB({ assets }) {
  let resources, scene, camera, group, geometry, materials, meshOf;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'snapshot' },
    async load() {
      resources = createResourceList();
      const map = assets.acquire(CHECKER, createCheckerTexture);
      geometry = resources.track(new SphereGeometry(0.16, 20, 12));
      materials = COLORS.map((color) => resources.track(new MeshBasicMaterial({ color, map })));
      scene = new Scene();
      group = new Group();
      scene.add(group);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
      meshOf = new WeakMap();
    },
    enter: () => initSceneB(),
    tick: tickSceneB,
    draw(state, view) {
      fitOrtho(camera, view, HALF_HEIGHT);
      const xScale = (camera.right * 0.85) / HALF_WIDTH;
      syncMeshes(group, state.balls, meshOf, (ball) => new Mesh(geometry, materials[ball.color]));
      for (const ball of state.balls) {
        const mesh = meshOf.get(ball);
        mesh.position.set(ball.x * xScale, ball.y / 1000, 0);
        mesh.rotation.z = -ball.x / 300;
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
