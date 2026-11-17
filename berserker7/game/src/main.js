import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { mountPanel } from './debug/panel.js';
import { createAssetCache } from './engine/asset-cache.js';
import { createHarness } from './engine/harness.js';
import { createBackdrop } from './scenes/backdrop.js';
import { createLoading } from './scenes/loading.js';
import { createPause } from './scenes/pause.js';
import { createSceneA } from './scenes/scene-a.js';
import { createSceneB } from './scenes/scene-b.js';
import { createSlow } from './scenes/slow.js';

document.getElementById('version').textContent = __BUILD_LABEL__;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x1b1f2a);
renderer.autoClear = false; // the harness clears once per frame, then draws each scene
document.body.appendChild(renderer.domElement);

// Fade: a full-screen black quad drawn over everything during a transition.
// Created once and kept for the life of the page.
const fadeScene = new Scene();
const fadeCamera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
const fadeMaterial = new MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false });
fadeScene.add(new Mesh(new PlaneGeometry(2, 2), fadeMaterial));

function drawTransition(alpha) {
  fadeMaterial.opacity = alpha;
  renderer.render(fadeScene, fadeCamera);
}

const assets = createAssetCache();
const harness = createHarness({ renderer, drawTransition, loadingScene: 'loading' });
harness.register('backdrop', createBackdrop());
harness.register('sceneA', createSceneA({ assets }));
harness.register('sceneB', createSceneB({ assets }));
harness.register('pause', createPause());
harness.register('slow', createSlow());
harness.register('loading', createLoading());
harness.preload('loading');
harness.addBackground('backdrop');
harness.setMain('sceneA');

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  harness.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// Upload the fade quad now, so the GPU memory counts do not change at the first fade.
drawTransition(0);

let last = performance.now();
function loop(time) {
  const seconds = Math.max(0, time - last) / 1000;
  last = time;
  harness.frame(seconds);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

mountPanel({ harness, renderer, assets });

// Debug only: lets browser scripts read the harness, renderer and shared assets. Not a game API.
window.__b7 = { harness, renderer, assets };
