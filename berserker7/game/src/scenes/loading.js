// Loading (shown in the main slot while the main scene's load() runs): a spinning arc.
// Loaded once at startup and kept.

import { Mesh, MeshBasicMaterial, OrthographicCamera, RingGeometry, Scene } from 'three';
import { createResourceList } from '../engine/resources.js';
import { fitOrtho } from './shared.js';

export function initLoading() {
  return { ticks: 0 };
}

export function tickLoading(state) {
  state.ticks += 1;
  return state;
}

export function createLoading() {
  let resources, scene, camera, arc;
  return {
    settings: { tick: 'always', drawCovered: true, leave: 'suspend' },
    async load() {
      resources = createResourceList();
      const geometry = resources.track(new RingGeometry(0.2, 0.26, 40, 1, 0, Math.PI * 1.5));
      const material = resources.track(new MeshBasicMaterial({ color: 0xdddddd }));
      arc = new Mesh(geometry, material);
      scene = new Scene();
      scene.add(arc);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter: () => initLoading(),
    tick: tickLoading,
    draw(state, view) {
      fitOrtho(camera, view, 1);
      arc.rotation.z = -state.ticks * 0.12;
      view.renderer.render(scene, camera);
    },
    unload() {
      resources.disposeAll();
      resources = scene = camera = arc = null;
    },
  };
}
