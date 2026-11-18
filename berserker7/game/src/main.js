import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { mountInputPanel } from './debug/input-panel.js';
import { mountPanel } from './debug/panel.js';
import { createHarness } from './engine/harness.js';
import { createMusic } from './audio/music.js';
import { attachInput } from './input/dom.js';
import { togglePauseOnPress } from './pause-toggle.js';
import { createBackdrop } from './scenes/backdrop.js';
import { createLoading } from './scenes/loading.js';
import { createMainMenu } from './scenes/main-menu.js';
import { createPause } from './scenes/pause.js';
import { createPlayers } from './scenes/players.js';
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

// The only input reader (music.js listens only for the gesture that unlocks sound). Bindings overrides come from localStorage.
const input = attachInput({ window, canvas: renderer.domElement });

const music = createMusic({ window });

const onInputs = (inputs) => togglePauseOnPress(harness, inputs);
const harness = createHarness({ renderer, drawTransition, loadingScene: 'loading', input, onInputs });
const { assets } = harness;
harness.register('backdrop', createBackdrop());
harness.register('players', createPlayers());
harness.register('sceneA', createSceneA());
harness.register('sceneB', createSceneB());
harness.register('pause', createPause());
harness.register('slow', createSlow());
harness.register('mainMenu', createMainMenu({ music }));
harness.register('loading', createLoading());
harness.preload('loading');
// The menu has no backdrop; the debug panel's test scene buttons add it.
harness.setMain('mainMenu');

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
mountInputPanel({ input });

// Debug only: lets browser scripts read the harness, renderer, shared assets, input and music. Not a game API.
window.__b7 = { harness, renderer, assets, input, music };
