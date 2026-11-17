// Pause (overlay): dims the screen and shows "PAUSED". Ticks always (the text pulses).

import { CanvasTexture, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three';
import { createResourceList } from '../engine/resources.js';
import { fitOrtho } from './shared.js';

const TEXT_ASPECT = 4; // text texture is 512 x 128

export function initPause() {
  return { ticks: 0 };
}

export function tickPause(state) {
  state.ticks += 1;
  return state;
}

function makeTextTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 96px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PAUSED', 256, 64);
  return new CanvasTexture(canvas);
}

export function createPause() {
  let resources, scene, camera, dim, text, textMaterial;
  return {
    settings: { tick: 'always', drawCovered: true, leave: 'suspend' },
    async load() {
      resources = createResourceList();
      const plane = resources.track(new PlaneGeometry(1, 1));
      const flat = { transparent: true, depthTest: false, depthWrite: false };
      const dimMaterial = resources.track(new MeshBasicMaterial({ color: 0x000000, opacity: 0.55, ...flat }));
      const texture = resources.track(makeTextTexture());
      textMaterial = resources.track(new MeshBasicMaterial({ map: texture, ...flat }));
      dim = new Mesh(plane, dimMaterial);
      text = new Mesh(plane, textMaterial);
      text.renderOrder = 1;
      scene = new Scene();
      scene.add(dim, text);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter: () => initPause(),
    tick: tickPause,
    draw(state, view) {
      fitOrtho(camera, view, 1);
      dim.scale.set(camera.right * 2, 2, 1);
      const width = Math.min(1.2, camera.right * 1.6);
      text.scale.set(width, width / TEXT_ASPECT, 1);
      textMaterial.opacity = 0.75 + 0.25 * Math.sin(state.ticks * 0.08);
      view.renderer.render(scene, camera);
    },
    unload() {
      resources.disposeAll();
      resources = scene = camera = dim = text = textMaterial = null;
    },
  };
}
