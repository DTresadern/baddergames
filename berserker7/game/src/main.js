import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { createLoader } from './assets/loader.js';
import { mountInputPanel } from './debug/input-panel.js';
import { mountPanel } from './debug/panel.js';
import { createHarness } from './engine/harness.js';
import { createMusic } from './audio/music.js';
import { attachInput } from './input/dom.js';
import { togglePauseOnPress } from './pause-toggle.js';
import { createBackdrop } from './scenes/backdrop.js';
import { createBoot } from './scenes/boot.js';
import { FADE_SECONDS, createIntro } from './scenes/intro.js';
import { createLoading } from './scenes/loading.js';
import { createMainMenu } from './scenes/main-menu.js';
import { createNewGame } from './scenes/new-game.js';
import { createPause } from './scenes/pause.js';
import { createPlayers } from './scenes/players.js';
import { createSceneA } from './scenes/scene-a.js';
import { createSceneB } from './scenes/scene-b.js';
import { createSlow } from './scenes/slow.js';
import { createSessionHolder } from './session.js';
import { browserStorage, createSettingsStore } from './settings/store.js';

document.getElementById('version').textContent = __BUILD_LABEL__;

// The only code that reads or writes saved settings; created first so everything below can use them.
const settings = createSettingsStore({ storage: browserStorage(window) });
// The run being set up (plain data); scenes get the holder, like `music` and `screens`.
const session = createSessionHolder();

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

// The only input reader (music.js listens only for the gesture that unlocks sound). The saved
// bindings overrides are read once, here; there is no live rebinding yet.
const input = attachInput({ window, canvas: renderer.domElement, bindings: settings.get().bindings });

const music = createMusic({ window, volume: settings.get().musicVolume });
settings.subscribe((s) => music.setVolume(s.musicVolume));

const onInputs = (inputs) => togglePauseOnPress(harness, inputs);
const harness = createHarness({ renderer, drawTransition, loadingScene: 'loading', input, onInputs });
const { assets } = harness;
// Preloads manifest groups into the shared asset cache (and the music element); see assets/.
const loader = createLoader({ assets, music });
harness.register('backdrop', createBackdrop());
harness.register('players', createPlayers());
harness.register('sceneA', createSceneA());
harness.register('sceneB', createSceneB());
harness.register('pause', createPause());
harness.register('slow', createSlow());
// Start-up: boot (loading, then "press any key") -> intro (logos) -> main menu.
// New Game is an overlay over the main menu, so the menu keeps its layer and the title music plays on.
const screens = {
  startIntro: () => harness.setMain('intro'),
  // The menu fades in over FADE_SECONDS. From black (the intro ended): the swap is at once. After a
  // skip: the intro first fades to black over FADE_SECONDS.
  showMenu: ({ fromBlack }) =>
    harness.setMain('mainMenu', { fade: 2 * FADE_SECONDS, fromAlpha: fromBlack ? 1 : undefined }),
  openNewGame: () => harness.openOverlay('newGame'),
  closeNewGame: () => harness.closeOverlay('newGame'),
};
harness.register('boot', createBoot({ loader, screens }));
harness.register('intro', createIntro({ music, screens }));
harness.register('mainMenu', createMainMenu({ music, screens }));
harness.register('newGame', createNewGame({ screens, settings, session }));
harness.register('loading', createLoading());
harness.preload('loading');
// The boot scene starts the same load on enter; starting it here saves a frame.
// The intro and the menu are preloaded only once the boot group is in, so neither shows the
// loading spinner later, and after a boot failure nothing else loads (the boot scene shows
// the error; the loader has logged it once).
loader.load('boot').then(
  () => {
    harness.preload('intro');
    harness.preload('mainMenu');
  },
  () => {},
);
// The menu has no backdrop; the debug panel's test scene buttons add it.
harness.setMain('boot');

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

// Debug only: lets browser scripts read the harness, renderer, shared assets, loader, input and music. Not a game API.
window.__b7 = { harness, renderer, assets, loader, input, music };
