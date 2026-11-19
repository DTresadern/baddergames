import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { groupAssets } from './assets/manifest.js';
import { createLoader } from './assets/loader.js';
import { mountInputPanel } from './debug/input-panel.js';
import { mountPanel } from './debug/panel.js';
import { createHarness } from './engine/harness.js';
import { createMusic } from './audio/music.js';
import { attachInput } from './input/dom.js';
import { togglePauseOnPress } from './pause-toggle.js';
import { createBackdrop } from './scenes/backdrop.js';
import { createBoot } from './scenes/boot.js';
import { createIntro, menuFade } from './scenes/intro.js';
import { createLoading } from './scenes/loading.js';
import { createMainMenu } from './scenes/main-menu.js';
import { createNewGame } from './scenes/new-game.js';
import { createPause } from './scenes/pause.js';
import { createPlayers } from './scenes/players.js';
import { createSandbox, createCameraZoom } from './scenes/sandbox.js';
import { pickPoster, withPoster } from './scenes/poster.js';
import { createSceneA } from './scenes/scene-a.js';
import { createSceneB } from './scenes/scene-b.js';
import { createSlow } from './scenes/slow.js';
import { createSessionHolder } from './session.js';
import { browserStorage, createSettingsStore } from './settings/store.js';

const versionLabel = document.getElementById('version');
versionLabel.textContent = __BUILD_LABEL__;

// The only code that reads or writes saved settings; created first so everything below can use them.
const settings = createSettingsStore({ storage: browserStorage(window) });
// The run being set up (plain data); scenes get the holder, like `music` and `screens`.
const session = createSessionHolder();
// The version label follows the showVersionLabel setting, now and on every change.
const showVersionLabel = (s) => {
  versionLabel.hidden = !s.showVersionLabel;
};
showVersionLabel(settings.get());
settings.subscribe(showVersionLabel);

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
// The menu background, picked once per page load and used by the main menu and New Game. The pick
// is not gameplay, so it uses Math.random, not the seeded generator. `?menubg=classic|thrash` forces one.
const poster = pickPoster({ search: window.location.search });
// Preloads manifest groups into the shared asset cache (and the music element); see assets/.
// Only the picked poster is downloaded: it is added to the boot group.
const loader = createLoader({ assets, music, listGroup: withPoster(groupAssets, poster) });
harness.register('backdrop', createBackdrop());
harness.register('players', createPlayers());
harness.register('sceneA', createSceneA());
harness.register('sceneB', createSceneB());
harness.register('pause', createPause());
harness.register('slow', createSlow());
// The Sandbox camera's view height; the debug panel changes it live (slider, [ and ]).
const sandboxZoom = createCameraZoom();
harness.register('sandbox', createSandbox({ zoom: sandboxZoom }));
// Start-up: boot (loading, then "press any key") -> intro (logos) -> main menu.
// New Game is an overlay over the main menu, so the menu keeps its layer and the title music plays on.
// Starting a game closes it and fades to the Sandbox (the main menu leaves the main layer and stops the music).
const GAME_FADE_SECONDS = 2; // total: 1 s to black, 1 s back in
const screens = {
  startIntro: () => harness.setMain('intro'),
  // From black (the intro ended): the swap is at once and the menu fades in over MENU_FADE_IN_SECONDS.
  // After a skip: the intro fades to black over FADE_SECONDS, then the menu fades in over FADE_SECONDS.
  showMenu: ({ fromBlack }) => harness.setMain('mainMenu', menuFade({ fromBlack })),
  openNewGame: () => harness.openOverlay('newGame'),
  closeNewGame: () => harness.closeOverlay('newGame'),
  startGame() {
    harness.closeOverlay('newGame');
    harness.setMain('sandbox', { fade: GAME_FADE_SECONDS });
  },
};
harness.register('boot', createBoot({ loader, screens }));
harness.register('intro', createIntro({ music, screens }));
harness.register('mainMenu', createMainMenu({ music, screens, poster }));
harness.register('newGame', createNewGame({ screens, settings, session, poster }));
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

mountPanel({ harness, renderer, assets, settings, session, sandboxZoom });
mountInputPanel({ input });

// Debug only: lets browser scripts read the harness, renderer, shared assets, loader, input, music,
// settings, session and the picked menu poster key. Not a game API.
window.__b7 = { harness, renderer, assets, loader, input, music, settings, session, poster };
