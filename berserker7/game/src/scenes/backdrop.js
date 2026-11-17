// Backdrop (background layer): large faint circles drifting sideways. Ticks
// always, so it keeps moving through pause and scene switches.

import { CircleGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from 'three';
import { fitOrtho, syncMeshes } from './shared.js';

const COLORS = [0x2f6f9f, 0x7a3f8f, 0x2f8f6f];
const WRAP = 2.4; // shapes wrap from x = WRAP to -WRAP (in units of the view's half width)

export function initBackdrop() {
  return {
    ticks: 0,
    shapes: [
      { color: 0, x: -1.2, y: 0.4, r: 0.9, vx: 0.05 },
      { color: 1, x: 0.3, y: -0.5, r: 1.2, vx: 0.03 },
      { color: 2, x: 1.4, y: 0.6, r: 0.7, vx: 0.07 },
      { color: 0, x: 2.2, y: -0.2, r: 0.5, vx: 0.04 },
    ],
  };
}

export function tickBackdrop(state, inputs, dt) {
  state.ticks += 1;
  for (const shape of state.shapes) {
    shape.x += shape.vx * dt;
    if (shape.x > WRAP) shape.x -= 2 * WRAP;
  }
  return state;
}

export function createBackdrop() {
  let scene, camera, group, geometry, materials, meshOf;
  return {
    settings: { tick: 'always', drawCovered: true, leave: 'suspend' },
    async load({ track }) {
      geometry = track(new CircleGeometry(1, 48));
      materials = COLORS.map((color) =>
        track(new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false })),
      );
      scene = new Scene();
      group = new Group();
      scene.add(group);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
      meshOf = new WeakMap();
    },
    enter: () => initBackdrop(),
    tick: tickBackdrop,
    draw(state, view) {
      fitOrtho(camera, view, 1);
      syncMeshes(group, state.shapes, meshOf, (shape) => new Mesh(geometry, materials[shape.color]));
      for (const shape of state.shapes) {
        const mesh = meshOf.get(shape);
        mesh.position.set(shape.x * camera.right, shape.y, -1);
        mesh.scale.setScalar(shape.r);
      }
      view.renderer.render(scene, camera);
    },
  };
}
