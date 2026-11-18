// Main menu placeholder: the poster drawn like CSS `cover`, a mostly-opaque black panel
// holding three no-op menu items, and the title music.

import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  TextureLoader,
} from 'three';
import { fitOrtho } from './shared.js';

export const PANEL_WIDTH = 480;
export const PANEL_HEIGHT = 560;
export const PANEL_OPACITY = 0.85;
export const MENU_ITEMS = ['New Game', 'Multiplayer', 'Options'];
export const ITEM_WIDTH = 320;
export const ITEM_HEIGHT = 56;
export const ITEM_GAP = 8;
const FONT_SIZE = 28;
const FONT = (size) => `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const TEXT_SCALE = 2; // label canvases are drawn at 2x so they stay sharp
const DIM_OPACITY = 0.6;
// Relative paths (no leading slash) so they work under any base path.
export const POSTER_URL = 'content/textures/posters/berserkerguy-classic.png';
export const MUSIC_URL = 'content/audio/music/titlescreen-1.mp3';

// Size of the image scaled to cover the view, drawn centred (the crop is equal on both sides).
export function coverSize(viewWidth, viewHeight, imageWidth, imageHeight) {
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

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

// Index of the item containing the point (left and top edges inside, right and bottom outside), or -1.
export function itemAt(layout, x, y) {
  return layout.items.findIndex((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

export function initMainMenu() {
  return { ticks: 0, highlight: 0, selected: null, selections: 0 };
}

// `selected` and `selections` are only for debug checks; selecting does nothing else yet.
function select(state) {
  state.selected = MENU_ITEMS[state.highlight];
  state.selections += 1;
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

export function tickMainMenu(state, inputs = []) {
  state.ticks += 1;
  for (const frame of inputs) if (frame.connected) applyFrame(state, frame);
  return state;
}

// Puts a unit plane on a layout rectangle: centred, y up camera space in CSS px.
function place(mesh, rect, viewWidth, viewHeight) {
  mesh.position.x = rect.x + rect.width / 2 - viewWidth / 2;
  mesh.position.y = viewHeight / 2 - (rect.y + rect.height / 2);
  mesh.scale.set(rect.width, rect.height, 1);
}

export function createMainMenu({
  music,
  loadTexture = (url) => new TextureLoader().loadAsync(url),
  createCanvas = () => document.createElement('canvas'),
}) {
  let scene, camera, poster, panel, bar, imageWidth, imageHeight;
  let labels = []; // { mesh, material } per menu item
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend' },
    async load({ track }) {
      const texture = track(await loadTexture(POSTER_URL));
      texture.colorSpace = SRGBColorSpace;
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
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }),
      );
      bar = new Mesh(geometry, barMaterial);
      bar.position.z = 2;
      scene = new Scene();
      scene.add(poster, panel, bar);
      // The label canvases are never added to the page, so only the tracked textures need freeing.
      labels = MENU_ITEMS.map((label) => {
        const canvas = createCanvas();
        canvas.width = ITEM_WIDTH * TEXT_SCALE;
        canvas.height = ITEM_HEIGHT * TEXT_SCALE;
        const g = canvas.getContext('2d');
        g.font = FONT(FONT_SIZE * TEXT_SCALE);
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, canvas.width / 2, canvas.height / 2);
        const map = track(new CanvasTexture(canvas));
        map.colorSpace = SRGBColorSpace;
        const material = track(new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
        const mesh = new Mesh(geometry, material);
        mesh.position.z = 3;
        scene.add(mesh);
        return { mesh, material };
      });
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter: () => {
      music.play(MUSIC_URL);
      return initMainMenu();
    },
    resume: () => music.play(MUSIC_URL),
    suspend: () => music.stop(),
    exit: () => music.stop(),
    tick: tickMainMenu,
    draw(state, view) {
      const { width, height } = view;
      fitOrtho(camera, view, height / 2); // world units are CSS px
      const cover = coverSize(width, height, imageWidth, imageHeight);
      poster.scale.set(cover.width, cover.height, 1);
      const layout = menuLayout(width, height);
      place(panel, layout.panel, width, height);
      place(bar, layout.items[state.highlight], width, height);
      layout.items.forEach((rect, i) => {
        const { mesh, material } = labels[i];
        place(mesh, rect, width, height);
        material.opacity = i === state.highlight ? 1 : DIM_OPACITY;
      });
      view.renderer.render(scene, camera);
    },
  };
}
