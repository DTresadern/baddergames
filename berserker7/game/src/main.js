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
import { createJoin } from './scenes/join.js';
import { createLoading } from './scenes/loading.js';
import { createMainMenu } from './scenes/main-menu.js';
import { createNewGame } from './scenes/new-game.js';
import { createPause } from './scenes/pause.js';
import { createPlayers } from './scenes/players.js';
import { createSandbox, createCameraZoom, createMapChoice } from './scenes/sandbox.js';
import { createViewMode } from './scenes/sandbox-3d.js';
import { pickPoster, withPoster } from './scenes/poster.js';
import { createSceneA } from './scenes/scene-a.js';
import { createSceneB } from './scenes/scene-b.js';
import { createSlow } from './scenes/slow.js';
import { createSessionHolder } from './session.js';
import { browserStorage, createSettingsStore } from './settings/store.js';
import { createNetSession, parseNetOptions } from './net/session.js';
import { cleanRoomCode, isRoomCode } from './net/room-code.js';
import { createLocalTransport } from './net/transport-local.js';
import { createPeerTransport } from './net/transport-peer.js';
import { JOIN_MESSAGES, createJoinForm, joinMessage } from './ui/join-form.js';
import { createNotice } from './ui/notice.js';

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

// Networking (see net/session.js): read once at start-up. `?net=local` uses a BroadcastChannel
// between tabs of this browser instead of PeerJS; `?lag=ms` (0..2000) delays every send;
// `?room=CODE` is an invite link (see screens.startIntro).
const netOptions = parseNetOptions(window.location.search);
const timers = { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id) };
const randomUint32s = (n) => crypto.getRandomValues(new Uint32Array(n));
const transport = netOptions.local
  ? createLocalTransport({
    BroadcastChannel: window.BroadcastChannel,
    ...timers,
    randomId: () => Array.from(randomUint32s(4), (n) => n.toString(36)).join(''),
  })
  : createPeerTransport(timers);
// The Sandbox map; the debug panel changes it and reloads the scene; a guest takes the host's.
const sandboxMap = createMapChoice();
// The net session, outside the scenes. The harness samples input through it (a guest's input
// becomes the host's player 2 frame); the Sandbox gets its read-only view.
const net = createNetSession({
  now: () => performance.now(),
  ...timers,
  randomUint32s,
  lagMs: netOptions.lagMs,
  mapKey: () => sandboxMap.get(),
  // Read from the harness record (outside any scene) while the Sandbox is the active main scene.
  sandboxState() {
    const record = harness.records.get('sandbox');
    return harness.layers.main === 'sandbox' && record.life === 'active' ? record.state : null;
  },
});

const onInputs = (inputs) => togglePauseOnPress(harness, inputs);
const harness = createHarness({ renderer, drawTransition, loadingScene: 'loading', input: net.wrapInput(input), onInputs });
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
// The Sandbox view mode (2D / 2.5D) and the 2.5D FOV; the debug panel changes them live.
const sandboxViewMode = createViewMode();
harness.register('sandbox', createSandbox({ zoom: sandboxZoom, viewMode: sandboxViewMode, mapChoice: sandboxMap, net: net.netView() }));
// Start-up: boot (loading, then "press any key") -> intro (logos) -> main menu.
// New Game is an overlay over the main menu, so the menu keeps its layer and the title music plays on.
// Starting a game fades to the Sandbox (the main menu leaves the main layer and stops the music).
const GAME_FADE_OUT_SECONDS = 2; // to black
const GAME_FADE_IN_SECONDS = 1; // back in
const NET_FADE_SECONDS = 1.2; // joining a game, and back to the menu when it ends
// An invite link (`?room=CODE`) is used once: after the boot press it skips the intro and opens
// the Join screen with the code filled in, joining at once.
let inviteRoom = netOptions.room;
const screens = {
  startIntro() {
    if (inviteRoom === null) {
      harness.setMain('intro');
      return;
    }
    joinForm.prefill(inviteRoom);
    inviteRoom = null;
    harness.setMain('mainMenu', menuFade({ fromBlack: false }));
    harness.openOverlay('join');
  },
  // From black (the intro ended): the swap is at once and the menu fades in over MENU_FADE_IN_SECONDS.
  // After a skip: the intro fades to black over FADE_SECONDS, then the menu fades in over FADE_SECONDS.
  showMenu: ({ fromBlack }) => harness.setMain('mainMenu', menuFade({ fromBlack })),
  openNewGame: () => harness.openOverlay('newGame'),
  closeNewGame: () => harness.closeOverlay('newGame'),
  openJoin: () => harness.openOverlay('join'),
  // Closing the Join screen cancels a join still connecting (a connected one carries on).
  closeJoin() {
    if (net.role() === 'guest' && net.state() === 'connecting') net.leave();
    harness.closeOverlay('join');
  },
  // True while a fade runs; the main menu waits for its fade-in from black to end before opening its panel.
  fading: () => harness.transition !== null,
  // True while any overlay (New Game, Join) is open; the main menu ignores input meanwhile.
  overlayOpen: () => harness.layers.overlays.length > 0,
  // New Game stays open (its boxes already closed) so the menu's panel is not shown during the fade;
  // the menu's suspend at the fade's midpoint closes it.
  startGame: () => harness.setMain('sandbox', { fadeOut: GAME_FADE_OUT_SECONDS, fadeIn: GAME_FADE_IN_SECONDS }),
};
harness.register('boot', createBoot({ loader, screens }));
harness.register('intro', createIntro({ music, screens }));
harness.register('mainMenu', createMainMenu({ music, screens, poster }));
harness.register('newGame', createNewGame({ screens, settings, session, poster }));
// The Join screen's DOM form; the `join` overlay scene shows and hides it.
const joinForm = createJoinForm({
  document,
  onJoin(code) {
    // An invalid code changes nothing (a host keeps hosting, a connected guest stays), except
    // that a join still connecting is cancelled, as Back does: the screen no longer asks for it.
    if (!isRoomCode(cleanRoomCode(code))) {
      if (net.role() === 'guest' && net.state() === 'connecting') net.leave();
      joinForm.setMessage(joinMessage('invalid'));
      return;
    }
    joinForm.setMessage(JOIN_MESSAGES.connecting);
    net.join(code, { transport });
  },
  onBack: () => screens.closeJoin(),
});
harness.register('join', createJoin({ form: joinForm, screens }));
const notice = createNotice({ document, ...timers });
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

// The net session's events: a guest's join starts the game on the host's map; a guest's game
// that ends goes back to the main menu with a notice; a join that fails says why on the Join
// screen; the host's map change reloads the guest's Sandbox.
const NOTICES = { 'host-left': 'The host left the game.', dropped: 'Connection to the host was lost.' };
net.subscribe((event) => {
  if (event.type === 'connected') {
    harness.closeOverlay('join');
    sandboxMap.set(event.map);
    harness.setPlayMode('online');
    harness.leave('sandbox', 'unload'); // a fresh Sandbox on the host's map, as player 2
    harness.setMain('sandbox', { fade: NET_FADE_SECONDS });
  } else if (event.type === 'ended') {
    if (event.wasConnected) {
      harness.setPlayMode('local');
      harness.closeOverlay('pause');
      harness.setMain('mainMenu', { fade: NET_FADE_SECONDS });
      if (event.reason !== 'left') notice.show(NOTICES[event.reason] ?? 'Connection to the host was lost.');
    } else {
      // A join that failed: no session is active (a host that started joining stopped hosting).
      harness.setPlayMode('local');
      if (event.reason !== 'left') joinForm.setMessage(joinMessage(event.reason));
    }
  } else if (event.type === 'map') {
    sandboxMap.set(event.map);
    if (harness.layers.main === 'sandbox') {
      harness.leave('sandbox', 'unload');
      harness.setMain('sandbox');
    }
  } else if (event.type === 'host-failed') {
    harness.setPlayMode('local');
  }
  backgroundTimer();
});
// A guest closing or reloading its page says bye first; so does a host.
window.addEventListener('pagehide', () => net.leave());

let last = performance.now();
function runFrame(time) {
  const seconds = Math.max(0, time - last) / 1000;
  last = time;
  harness.frame(seconds);
  net.afterFrame(time);
}
function loop(time) {
  runFrame(time);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Browsers stop requestAnimationFrame in a hidden tab, which would freeze a host (or guest) whose
// tab is in the background. While a session is active and the tab is hidden, a tiny worker's
// 60 Hz timer drives the frames instead (worker timers are not throttled like the page's).
let worker = null;
function backgroundTimer() {
  const want = document.hidden && net.active();
  if (want && worker === null) {
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${1000 / 60});`], { type: 'text/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = () => runFrame(performance.now());
    } catch (error) {
      console.warn('Background timer unavailable:', error);
    }
  } else if (!want && worker !== null) {
    worker.terminate();
    worker = null;
  }
}
document.addEventListener('visibilitychange', backgroundTimer);

mountPanel({ harness, renderer, assets, settings, session, sandboxZoom, sandboxViewMode, sandboxMap, net, transport });
mountInputPanel({ input });

// Debug only: lets browser scripts read the harness, renderer, shared assets, loader, input (raw,
// before the net session), music, settings, session, the picked menu poster key and the net
// session. Not a game API.
window.__b7 = { harness, renderer, assets, loader, input, music, settings, session, poster, net };
