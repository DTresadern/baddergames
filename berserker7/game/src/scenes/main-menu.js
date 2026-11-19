// Main menu placeholder: the poster drawn like CSS `cover`, a mostly-opaque black panel
// holding three menu items (New Game, Multiplayer, Options; Options does nothing yet), and the
// title music.

import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three';
import { STEP_SECONDS } from '../engine/clock.js';
import { labelTexture } from './labels.js';
import { assetByKey } from '../assets/manifest.js';
import { acquireTexture, defaultLoadTexture } from '../assets/textures.js';
import { checkPoster, coverSize } from './poster.js';
import { OPEN_SECONDS, animRect, openingAt } from './panel-anim.js';
import { fitOrtho, inside, place } from './shared.js';

export const PANEL_WIDTH = 480;
export const PANEL_HEIGHT = 560;
export const PANEL_OPACITY = 0.85;
export const MENU_ITEMS = ['New Game', 'Multiplayer', 'Options'];
export const ITEM_WIDTH = 320;
export const ITEM_HEIGHT = 56;
export const ITEM_GAP = 8;
const DIM_OPACITY = 0.6;
const BAR_OPACITY = 0.16;
export const MUSIC = 'music.title'; // manifest key

// Size of the black panel: at most 480 x 560, and at most 90% of the width and 80% of the height.
export function panelSize(viewWidth, viewHeight) {
  return {
    width: Math.min(PANEL_WIDTH, 0.9 * viewWidth),
    height: Math.min(PANEL_HEIGHT, 0.8 * viewHeight),
  };
}

// Item rectangles inside the centred panel, in canvas CSS px (top-left origin, y down).
export function menuLayout(viewWidth, viewHeight) {
  const size = panelSize(viewWidth, viewHeight);
  const panel = { x: (viewWidth - size.width) / 2, y: (viewHeight - size.height) / 2, ...size };
  const n = MENU_ITEMS.length;
  const stack = n * ITEM_HEIGHT + (n - 1) * ITEM_GAP;
  // The whole stack shrinks uniformly to keep 16 px of panel around it.
  const k = Math.min(1, (panel.width - 32) / ITEM_WIDTH, (panel.height - 32) / stack);
  const width = ITEM_WIDTH * k;
  const height = ITEM_HEIGHT * k;
  const x = panel.x + (panel.width - width) / 2;
  const top = panel.y + (panel.height - stack * k) / 2;
  const items = MENU_ITEMS.map((_, i) => ({ x, y: top + i * (height + ITEM_GAP * k), width, height }));
  return { panel, items };
}

// Index of the item containing the point, or -1.
export function itemAt(layout, x, y) {
  return layout.items.findIndex((r) => inside(r, x, y));
}

export function initMainMenu() {
  return { ticks: 0, highlight: 0, selected: null, selections: 0, request: null, open: { phase: 'waiting', t: 0 } };
}

// Menu item -> the request it makes.
const REQUESTS = Object.freeze({ 'New Game': 'newGame', Multiplayer: 'multiplayer' });

// `selected` and `selections` are for debug checks. `request` is what the scene asks the
// screens to do after this tick: 'newGame' (New Game) or 'multiplayer' (Multiplayer: the Join
// screen) for the first such selection in the tick, else null.
function select(state) {
  state.selected = MENU_ITEMS[state.highlight];
  state.selections += 1;
  if (state.request === null) state.request = REQUESTS[state.selected] ?? null;
}

function applyFrame(state, { actions, pointer }) {
  const count = MENU_ITEMS.length;
  const hover = pointer ? itemAt(menuLayout(pointer.width, pointer.height), pointer.x, pointer.y) : -1;
  if (pointer?.moved && hover >= 0) state.highlight = hover;
  if (actions.moveUp.pressed) state.highlight = (state.highlight + count - 1) % count;
  if (actions.moveDown.pressed) state.highlight = (state.highlight + 1) % count;
  if (actions.jump.pressed || actions.interact.pressed) select(state);
  if (actions.primaryFire.pressed) {
    // A mouse click counts only on an item; a gamepad trigger (no pointer) picks the highlight.
    if (!pointer) select(state);
    else if (hover >= 0) {
      state.highlight = hover;
      select(state);
    }
  }
}

// The panel opens in phases (see panel-anim.js): 'waiting' (nothing shown; held while the menu's
// fade-in from black runs, `fading`), 'opening' (t counts up to OPEN_SECONDS), 'open'.
// Input counts only if the menu was already open at the start of the tick, and never while
// `covered` (another screen is open over the menu: the animation still runs, the input is ignored).
export function tickMainMenu(state, inputs = [], dt = STEP_SECONDS, { fading = false, covered = false } = {}) {
  state.ticks += 1;
  state.request = null;
  const wasOpen = state.open.phase === 'open';
  if (state.open.phase === 'waiting') {
    if (!fading) state.open = { phase: 'opening', t: 0 };
  } else if (state.open.phase === 'opening') {
    state.open.t += dt;
    if (state.open.t >= OPEN_SECONDS) state.open = { phase: 'open', t: OPEN_SECONDS };
  }
  if (!wasOpen || covered) return state;
  for (const frame of inputs) if (frame.connected) applyFrame(state, frame);
  return state;
}

export function createMainMenu({
  music,
  screens,
  poster: posterKey,
  loadTexture = defaultLoadTexture,
  createCanvas = () => document.createElement('canvas'),
}) {
  checkPoster(posterKey);
  let scene, camera, poster, panel, bar, imageWidth, imageHeight;
  let labels = []; // { mesh, material } per menu item
  // Set by resume(); the next tick restarts the opening animation (see resume).
  let replay = false;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend', pausable: false },
    async load({ track, acquire }) {
      const texture = await acquireTexture(acquire, posterKey, loadTexture);
      imageWidth = texture.image.width;
      imageHeight = texture.image.height;
      const geometry = track(new PlaneGeometry(1, 1));
      const posterMaterial = track(new MeshBasicMaterial({ map: texture }));
      const panelMaterial = track(
        new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: PANEL_OPACITY, depthWrite: false }),
      );
      poster = new Mesh(geometry, posterMaterial);
      panel = new Mesh(geometry, panelMaterial);
      panel.position.z = 1; // in front of the poster
      const barMaterial = track(
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: BAR_OPACITY, depthWrite: false }),
      );
      bar = new Mesh(geometry, barMaterial);
      bar.position.z = 2;
      scene = new Scene();
      scene.add(poster, panel, bar);
      // The label canvases are never added to the page, so only the tracked textures need freeing.
      labels = MENU_ITEMS.map((label) => {
        const map = track(labelTexture(createCanvas, label, ITEM_WIDTH, ITEM_HEIGHT));
        const material = track(new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
        const mesh = new Mesh(geometry, material);
        mesh.position.z = 3;
        scene.add(mesh);
        return { mesh, material };
      });
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter: () => {
      music.play(assetByKey(MUSIC).path);
      screens.checkVersion();
      return initMainMenu();
    },
    // Coming back after the game started (for example the debug panel's "Main menu" button) keeps
    // the old state, which is already 'open'. The panel should animate in again, as on every
    // entry, so the next tick resets the animation (state is not available here).
    resume() {
      music.play(assetByKey(MUSIC).path);
      screens.checkVersion();
      replay = true;
    },
    // The New Game and Join overlays and the outdated-version notice never outlive the menu (for
    // example when the debug panel switches scene, or a join starts the game).
    suspend() {
      music.stop();
      screens.closeNewGame();
      screens.closeJoin();
      screens.hideVersionNotice();
    },
    exit() {
      music.stop();
      screens.closeNewGame();
      screens.closeJoin();
      screens.hideVersionNotice();
    },
    tick(state, inputs, dt) {
      if (replay) {
        replay = false;
        state.open = { phase: 'waiting', t: 0 };
      }
      tickMainMenu(state, inputs, dt, { fading: screens.fading(), covered: screens.overlayOpen() });
      if (state.request === 'newGame') screens.openNewGame();
      if (state.request === 'multiplayer') screens.openJoin();
      return state;
    },
    draw(state, view) {
      const { width, height } = view;
      fitOrtho(camera, view, height / 2); // world units are CSS px
      const cover = coverSize(width, height, imageWidth, imageHeight);
      poster.scale.set(cover.width, cover.height, 1);
      const layout = menuLayout(width, height);
      const { phase, t } = state.open;
      const anim = phase === 'open' ? { width: 1, height: 1, items: 1 } : phase === 'opening' ? openingAt(t) : null;
      const shown = (rect) => rect.width > 0 && rect.height > 0;
      const panelRect = anim ? animRect(layout.panel, anim) : null;
      panel.visible = panelRect !== null && shown(panelRect);
      if (panel.visible) place(panel, panelRect, width, height);
      const itemsAlpha = anim ? anim.items : 0;
      const itemsVisible = panel.visible && itemsAlpha > 0;
      bar.visible = itemsVisible;
      if (itemsVisible) {
        place(bar, layout.items[state.highlight], width, height);
        bar.material.opacity = BAR_OPACITY * itemsAlpha;
      }
      layout.items.forEach((rect, i) => {
        const { mesh, material } = labels[i];
        mesh.visible = itemsVisible;
        if (!itemsVisible) return;
        place(mesh, rect, width, height);
        material.opacity = (i === state.highlight ? 1 : DIM_OPACITY) * itemsAlpha;
      });
      view.renderer.render(scene, camera);
    },
  };
}
