// Slow (main layer): load() takes about 2 s, so switching to it shows the
// loading scene first. Leaves by unloading.

import { Mesh, MeshNormalMaterial, PerspectiveCamera, Scene, TorusGeometry } from 'three';
import { createResourceList } from '../engine/resources.js';
import { fitPerspective, wait } from './shared.js';

export const SLOW_LOAD_MS = 2000;

export function initSlow() {
  return { ticks: 0, angle: 0 };
}

export function tickSlow(state, inputs, dt) {
  state.ticks += 1;
  state.angle = (state.angle + 1.2 * dt) % (Math.PI * 2);
  return state;
}

export function createSlow() {
  let resources, scene, camera, torus;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'unload' },
    async load() {
      await wait(SLOW_LOAD_MS);
      resources = createResourceList();
      const geometry = resources.track(new TorusGeometry(0.8, 0.28, 20, 64));
      const material = resources.track(new MeshNormalMaterial());
      torus = new Mesh(geometry, material);
      scene = new Scene();
      scene.add(torus);
      camera = new PerspectiveCamera(50, 1, 0.1, 50);
      camera.position.set(0, 0, 4);
    },
    enter: () => initSlow(),
    tick: tickSlow,
    draw(state, view) {
      fitPerspective(camera, view, 4);
      torus.rotation.set(state.angle, state.angle * 1.5, 0);
      view.renderer.render(scene, camera);
    },
    unload() {
      resources.disposeAll();
      resources = scene = camera = torus = null;
    },
  };
}
