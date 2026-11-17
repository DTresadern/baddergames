// Slow (main layer): load() takes about 2 s, so switching to it shows the
// loading scene first. Leaves by unloading. Uses the shared checker texture.
//
// Debug: set `debug.failNextLoad` and its next load() throws after acquiring the
// shared texture and tracking resources, one of them already uploaded to the GPU,
// so the panel can show the harness freeing a failed load.

import { MeshBasicMaterial, Mesh, PerspectiveCamera, Scene, TorusGeometry } from 'three';
import { CHECKER, createCheckerTexture, fitPerspective, wait } from './shared.js';

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
  let scene, camera, torus;
  const debug = { failNextLoad: false, texturesAtFailure: null };
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'unload' },
    debug,
    async load({ track, acquire, renderer }) {
      await wait(SLOW_LOAD_MS);
      const map = acquire(CHECKER, createCheckerTexture);
      const geometry = track(new TorusGeometry(0.8, 0.28, 20, 64));
      const material = track(new MeshBasicMaterial({ color: 0xd8c0ff, map }));
      if (debug.failNextLoad) {
        debug.failNextLoad = false;
        renderer.initTexture(track(createCheckerTexture()));
        debug.texturesAtFailure = renderer.info.memory.textures;
        throw new Error('slow: simulated load failure');
      }
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
  };
}
