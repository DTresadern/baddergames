// New Game screen: the poster, four campaign cards and a difficulty list for the selected
// campaign, plus a Back item. It opens on the last choice saved in the settings. Selecting a
// difficulty creates the session and saves the last choice, closes its boxes (see panel-anim.js),
// waits START_DELAY_SECONDS, then calls screens.startGame (the fade to the Sandbox); difficulty has
// no effect yet. It is an overlay over the main menu, so the title music is not interrupted while
// it is open. The overlay stays open during the fade; the main menu's suspend closes it.

import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three';
import { CAMPAIGNS, DEFAULT_DIFFICULTY, DIFFICULTIES } from '../data/campaigns.js';
import { labelTexture } from './labels.js';
import { acquireTexture, defaultLoadTexture } from '../assets/textures.js';
import { checkPoster, coverSize } from './poster.js';
import { STEP_SECONDS } from '../engine/clock.js';
import { CLOSE_SECONDS, animRect, closingAt } from './panel-anim.js';
import { createSession } from '../session.js';
import { fitOrtho, inside, place } from './shared.js';

export const LIST = Object.freeze([...DIFFICULTIES, 'back']);
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 110;
export const CARD_GAP = 16;
export const ITEM_WIDTH = 320;
export const ITEM_HEIGHT = 48;
export const ITEM_GAP = 8;
export const PANEL_PADDING = 16;
export const BLOCK_GAP = 24; // between the cards and the list panel
export const WIDE_VIEW = 720; // from this width the cards sit in one row, below it in a 2 x 2 grid
const MARGIN = 16; // minimum space between the block and the view edge
const OUTLINE = 3;
const DIM_OPACITY = 0.6;
const UNAVAILABLE_OPACITY = 0.5;
const BAR_OPACITY = 0.16;
const CARD_FONT = 24;
export const START_DELAY_SECONDS = 0.5; // after the boxes have closed, before startGame

// Rectangles in canvas CSS px (top-left origin, y down). The whole block (cards, then list
// panel) is scaled uniformly to fit the view and centred.
export function newGameLayout(viewWidth, viewHeight) {
  const cols = viewWidth >= WIDE_VIEW ? CAMPAIGNS.length : 2;
  const rows = Math.ceil(CAMPAIGNS.length / cols);
  const cardsW = cols * CARD_WIDTH + (cols - 1) * CARD_GAP;
  const cardsH = rows * CARD_HEIGHT + (rows - 1) * CARD_GAP;
  const listW = ITEM_WIDTH + 2 * PANEL_PADDING;
  const listH = LIST.length * ITEM_HEIGHT + (LIST.length - 1) * ITEM_GAP + 2 * PANEL_PADDING;
  const blockW = Math.max(cardsW, listW);
  const blockH = cardsH + BLOCK_GAP + listH;
  const k = Math.min(1, (viewWidth - 2 * MARGIN) / blockW, (viewHeight - 2 * MARGIN) / blockH);
  const left = (viewWidth - blockW * k) / 2;
  const top = (viewHeight - blockH * k) / 2;
  const cardsX = left + ((blockW - cardsW) * k) / 2;
  const cards = CAMPAIGNS.map((_, i) => ({
    x: cardsX + (i % cols) * (CARD_WIDTH + CARD_GAP) * k,
    y: top + Math.floor(i / cols) * (CARD_HEIGHT + CARD_GAP) * k,
    width: CARD_WIDTH * k,
    height: CARD_HEIGHT * k,
  }));
  const panel = {
    x: left + ((blockW - listW) * k) / 2,
    y: top + (cardsH + BLOCK_GAP) * k,
    width: listW * k,
    height: listH * k,
  };
  const items = LIST.map((_, i) => ({
    x: panel.x + PANEL_PADDING * k,
    y: panel.y + (PANEL_PADDING + i * (ITEM_HEIGHT + ITEM_GAP)) * k,
    width: ITEM_WIDTH * k,
    height: ITEM_HEIGHT * k,
  }));
  return { cards, list: { panel, items } };
}

export function hitTest(layout, x, y) {
  const item = layout.list.items.findIndex((r) => inside(r, x, y));
  if (item >= 0) return { kind: 'item', index: item };
  const card = layout.cards.findIndex((r) => inside(r, x, y));
  return card >= 0 ? { kind: 'card', index: card } : null;
}

// Id of the next available campaign from `currentId` in direction `step` (+1 or -1), wrapping.
export function nextAvailable(campaigns, currentId, step) {
  const available = campaigns.filter((c) => c.available);
  const at = available.findIndex((c) => c.id === currentId);
  if (at < 0) return available[0]?.id ?? currentId;
  return available[(at + step + available.length) % available.length].id;
}

// `lastChoice` is the saved { campaign, difficulty }. A campaign that is not available (or not
// known) gives the first available one; a difficulty that is not known gives the default.
export function initNewGame(lastChoice) {
  const saved = CAMPAIGNS.find((c) => c.available && c.id === lastChoice?.campaign);
  const campaign = saved ?? CAMPAIGNS.find((c) => c.available) ?? CAMPAIGNS[0];
  const difficulty = DIFFICULTIES.includes(lastChoice?.difficulty) ? lastChoice.difficulty : DEFAULT_DIFFICULTY;
  return {
    ticks: 0,
    campaign: campaign.id,
    highlight: LIST.indexOf(difficulty),
    selected: null,
    selections: 0,
    request: null,
    start: null,
    closing: null, // after a difficulty was selected: { t, started }
  };
}

// `selected` and `selections` are for debug checks. `request` is 'back' when Back was selected
// at any point in this tick (so a later selection in the same tick cannot cancel it), else null.
// `start` is { campaign, difficulty } when a difficulty was selected in this tick (the last one
// wins), else null; the scene's tick turns it into the session and the saved last choice.
// `closing` is null until a difficulty is selected; from then on input is ignored, `closing.t` counts
// up, and `request` becomes 'startGame' once, when t reaches CLOSE_SECONDS + START_DELAY_SECONDS.
function select(state, id) {
  state.selected = id;
  state.selections += 1;
  if (id === 'back') state.request = 'back';
  else state.start = { campaign: state.campaign, difficulty: id };
}

function applyFrame(state, { actions, pointer }) {
  const count = LIST.length;
  const hit = pointer ? hitTest(newGameLayout(pointer.width, pointer.height), pointer.x, pointer.y) : null;
  const item = hit?.kind === 'item' ? hit.index : -1;
  if (pointer?.moved && item >= 0) state.highlight = item;
  if (actions.moveUp.pressed) state.highlight = (state.highlight + count - 1) % count;
  if (actions.moveDown.pressed) state.highlight = (state.highlight + 1) % count;
  if (actions.moveLeft.pressed) state.campaign = nextAvailable(CAMPAIGNS, state.campaign, -1);
  if (actions.moveRight.pressed) state.campaign = nextAvailable(CAMPAIGNS, state.campaign, 1);
  if (actions.pause.pressed || actions.melee.pressed) select(state, 'back');
  if (actions.jump.pressed || actions.interact.pressed) select(state, LIST[state.highlight]);
  if (actions.primaryFire.pressed) {
    // A click counts only on an item or an available card; a trigger without a pointer picks the highlight.
    if (!pointer) select(state, LIST[state.highlight]);
    else if (item >= 0) {
      state.highlight = item;
      select(state, LIST[item]);
    } else if (hit?.kind === 'card' && CAMPAIGNS[hit.index].available) state.campaign = CAMPAIGNS[hit.index].id;
  }
}

export function tickNewGame(state, inputs = [], dt = STEP_SECONDS) {
  state.ticks += 1;
  state.request = null;
  state.start = null;
  if (state.closing) {
    state.closing.t += dt;
    if (!state.closing.started && state.closing.t >= CLOSE_SECONDS + START_DELAY_SECONDS) {
      state.closing.started = true;
      state.request = 'startGame';
    }
    return state;
  }
  for (const frame of inputs) if (frame.connected) applyFrame(state, frame);
  if (state.start) {
    // A selection wins over a Back in the same tick.
    state.request = null;
    state.closing = { t: 0, started: false };
  }
  return state;
}

export function createNewGame({
  screens,
  settings,
  session,
  poster: posterKey,
  loadTexture = defaultLoadTexture,
  createCanvas = () => document.createElement('canvas'),
}) {
  checkPoster(posterKey);
  let scene, camera, poster, outline, panel, bar, imageWidth, imageHeight;
  let cards = []; // { fill, text, material } per campaign
  let lists = {}; // campaign id -> meshes with materials, one per difficulty
  let back;
  return {
    // Closing unloads it, so each open starts fresh; the main menu keeps the shared poster loaded.
    settings: { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false },
    async load({ track, acquire }) {
      const texture = await acquireTexture(acquire, posterKey, loadTexture);
      imageWidth = texture.image.width;
      imageHeight = texture.image.height;
      const geometry = track(new PlaneGeometry(1, 1));
      const flat = (color, opacity) =>
        track(new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      const at = (material, z) => {
        const mesh = new Mesh(geometry, material);
        mesh.position.z = z;
        scene.add(mesh);
        return mesh;
      };
      const text = (lines, width, height, fontSize, z) => {
        const map = track(labelTexture(createCanvas, lines, width, height, fontSize));
        const material = track(new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
        return { mesh: at(material, z), material };
      };
      const fillAvailable = flat(0x000000, 0.9); // dark enough that the outline behind it does not show through
      const fillUnavailable = flat(0x000000, 0.7);
      scene = new Scene();
      poster = at(track(new MeshBasicMaterial({ map: texture })), 0);
      outline = at(flat(0xffffff, 0.9), 1);
      cards = CAMPAIGNS.map((c) => ({
        fill: at(c.available ? fillAvailable : fillUnavailable, 2),
        ...text(c.available ? c.name : [c.name, 'Coming later'], CARD_WIDTH, CARD_HEIGHT, CARD_FONT, 4),
      }));
      cards.forEach(({ material }, i) => {
        material.opacity = CAMPAIGNS[i].available ? 1 : UNAVAILABLE_OPACITY;
      });
      panel = at(flat(0x000000, 0.85), 2);
      bar = at(flat(0xffffff, BAR_OPACITY), 3);
      lists = {};
      for (const c of CAMPAIGNS) {
        if (c.available) lists[c.id] = DIFFICULTIES.map((d) => text(c.difficultyNames[d], ITEM_WIDTH, ITEM_HEIGHT, 28, 4));
      }
      back = text('Back', ITEM_WIDTH, ITEM_HEIGHT, 28, 4);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter: () => initNewGame(settings.get().lastChoice),
    tick(state, inputs, dt) {
      tickNewGame(state, inputs, dt);
      if (state.start) {
        session.set(createSession(state.start));
        settings.set({ lastChoice: { ...state.start } });
      }
      if (state.request === 'startGame') screens.startGame();
      if (state.request === 'back') screens.closeNewGame();
      return state;
    },
    draw(state, view) {
      const { width, height } = view;
      fitOrtho(camera, view, height / 2); // world units are CSS px
      const cover = coverSize(width, height, imageWidth, imageHeight);
      poster.scale.set(cover.width, cover.height, 1);
      const layout = newGameLayout(width, height);
      const chosen = CAMPAIGNS.findIndex((c) => c.id === state.campaign);
      // While closing, every box shrinks the same way and the items fade; width 0 hides a mesh.
      const anim = state.closing ? closingAt(state.closing.t) : { width: 1, height: 1, items: 1 };
      const fit = (mesh, rect) => {
        mesh.visible = rect.width > 0 && rect.height > 0;
        if (mesh.visible) place(mesh, rect, width, height);
      };
      const itemsVisible = anim.items > 0;
      layout.cards.forEach((rect, i) => {
        const { fill, mesh, material } = cards[i];
        fit(fill, animRect(rect, anim));
        mesh.visible = itemsVisible;
        if (itemsVisible) place(mesh, rect, width, height);
        material.opacity = (CAMPAIGNS[i].available ? 1 : UNAVAILABLE_OPACITY) * anim.items;
      });
      const r = animRect(layout.cards[chosen], anim);
      fit(outline, { x: r.x - OUTLINE, y: r.y - OUTLINE, width: r.width + 2 * OUTLINE, height: r.height + 2 * OUTLINE });
      if (r.width === 0) outline.visible = false;
      fit(panel, animRect(layout.list.panel, anim));
      bar.visible = itemsVisible;
      if (itemsVisible) {
        place(bar, layout.list.items[state.highlight], width, height);
        bar.material.opacity = BAR_OPACITY * anim.items;
      }
      const shown = lists[state.campaign] ?? [];
      for (const group of Object.values(lists)) for (const l of group) l.mesh.visible = itemsVisible && shown.includes(l);
      const slots = [...shown.map((l, i) => [l, i]), [back, LIST.length - 1]];
      for (const [l, i] of slots) {
        l.mesh.visible = itemsVisible;
        if (!itemsVisible) continue;
        place(l.mesh, layout.list.items[i], width, height);
        l.material.opacity = (i === state.highlight ? 1 : DIM_OPACITY) * anim.items;
      }
      view.renderer.render(scene, camera);
    },
  };
}
