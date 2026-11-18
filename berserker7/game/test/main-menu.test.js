import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ITEM_GAP,
  ITEM_HEIGHT,
  ITEM_WIDTH,
  MENU_ITEMS,
  createMainMenu,
  initMainMenu,
  itemAt,
  menuLayout,
  panelSize,
  tickMainMenu,
} from '../src/scenes/main-menu.js';
import { coverSize } from '../src/scenes/poster.js';
import { assetByKey } from '../src/assets/manifest.js';
import { frame } from './frames.js';

const VIEWS = [[1000, 1000], [1280, 800], [800, 1280], [390, 844]];
const IMAGES = [[1254, 1254], [1920, 1080], [1000, 2000]];

function check(vw, vh, iw, ih) {
  const { width, height } = coverSize(vw, vh, iw, ih);
  const label = `${vw}x${vh} view, ${iw}x${ih} image`;
  assert.ok(Math.abs(width / height - iw / ih) < 1e-9, `${label}: not stretched`);
  assert.ok(width >= vw - 1e-9 && height >= vh - 1e-9, `${label}: covers`);
  assert.ok(Math.abs(width - vw) < 1e-9 || Math.abs(height - vh) < 1e-9, `${label}: one side fits exactly`);
}

test('coverSize: square image in a square window fits exactly', () => {
  assert.deepStrictEqual(coverSize(600, 600, 1254, 1254), { width: 600, height: 600 });
});

test('coverSize: covers without stretching or needless scaling', () => {
  for (const [vw, vh] of VIEWS) for (const [iw, ih] of IMAGES) check(vw, vh, iw, ih);
  check(1920 / 2, 1080 * 2, 1920, 1080); // 1920x1080 image in a portrait window
  check(1000, 500, 1000, 2000); // 1000x2000 image in a landscape window
});

test('panelSize: capped at 480 x 560, else 90% width and 80% height', () => {
  assert.deepStrictEqual(panelSize(1280, 800), { width: 480, height: 560 });
  const narrow = panelSize(390, 844);
  assert.ok(Math.abs(narrow.width - 351) < 1e-9);
  assert.equal(narrow.height, 560);
  assert.deepStrictEqual(panelSize(1280, 500), { width: 480, height: 400 });
});

function fakeScreens(calls) {
  return { openNewGame: () => calls.push(['open']), closeNewGame: () => calls.push(['close']) };
}

test('main menu: music plays on enter and resume, stops on suspend and exit; suspend and exit close New Game', () => {
  const MUSIC_URL = assetByKey('music.title').path;
  const calls = [];
  const music = { play: (url) => calls.push(['play', url]), stop: () => calls.push(['stop']) };
  const menu = createMainMenu({ music, screens: fakeScreens(calls), poster: 'poster.classic' });
  menu.enter();
  menu.suspend();
  menu.resume();
  menu.exit();
  assert.deepStrictEqual(calls, [
    ['play', MUSIC_URL], ['stop'], ['close'], ['play', MUSIC_URL], ['stop'], ['close'],
  ]);
});

test('main menu: selecting New Game opens the screen once; other items do not; it does not pause', () => {
  const calls = [];
  const menu = createMainMenu({ music: { play() {}, stop() {} }, screens: fakeScreens(calls), poster: 'poster.classic' });
  assert.equal(menu.settings.pausable, false);
  const state = menu.enter();
  menu.tick(state, [frame(['jump'])]);
  assert.deepStrictEqual(calls, [['open']]);
  menu.tick(state, [frame([])]);
  assert.equal(calls.length, 1, 'only on the tick that selects');
  menu.tick(state, [frame(['moveDown', 'jump'])]);
  menu.tick(state, [frame(['moveDown', 'jump'])]);
  assert.deepStrictEqual(state.selected, 'Options');
  assert.equal(calls.length, 1);
});

test('main menu: a later selection by another player in the same tick does not cancel New Game', () => {
  const calls = [];
  const menu = createMainMenu({ music: { play() {}, stop() {} }, screens: fakeScreens(calls), poster: 'poster.classic' });
  const state = menu.enter();
  menu.tick(state, [frame(['jump']), frame(['moveDown', 'jump'])]);
  assert.equal(state.selected, 'Multiplayer');
  assert.deepStrictEqual(calls, [['open']]);
});

const EPS = 1e-9;

test('menuLayout: items sit inside the panel and view, in order, without overlap, centred in the panel', () => {
  for (const [vw, vh] of [[1280, 800], [800, 1280], [390, 844]]) {
    const { panel, items } = menuLayout(vw, vh);
    const label = `${vw}x${vh}`;
    assert.equal(items.length, MENU_ITEMS.length);
    items.forEach((r, i) => {
      assert.ok(r.x >= panel.x - EPS && r.x + r.width <= panel.x + panel.width + EPS, `${label}: item ${i} inside panel x`);
      assert.ok(r.y >= panel.y - EPS && r.y + r.height <= panel.y + panel.height + EPS, `${label}: item ${i} inside panel y`);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= vw && r.y + r.height <= vh, `${label}: item ${i} inside view`);
      assert.ok(Math.abs(r.width / r.height - ITEM_WIDTH / ITEM_HEIGHT) < EPS, `${label}: item ${i} aspect`);
      if (i > 0) assert.ok(r.y >= items[i - 1].y + items[i - 1].height + ITEM_GAP * (r.height / ITEM_HEIGHT) - EPS, `${label}: item ${i} below item ${i - 1}`);
    });
    const last = items[items.length - 1];
    const above = items[0].y - panel.y;
    const below = panel.y + panel.height - (last.y + last.height);
    assert.ok(Math.abs(above - below) < EPS, `${label}: vertically centred`);
    for (const r of items) assert.ok(Math.abs(r.x - panel.x - (panel.x + panel.width - r.x - r.width)) < EPS, `${label}: horizontally centred`);
  }
});

test('menuLayout: the stack shrinks uniformly to fit tiny and extreme panels', () => {
  for (const [vw, vh] of [[1280, 200], [300, 240], [200, 900]]) {
    const { panel, items } = menuLayout(vw, vh);
    const label = `${vw}x${vh}`;
    items.forEach((r, i) => {
      assert.ok(r.width > 0 && r.height > 0, `${label}: item ${i} has size`);
      assert.ok(r.x >= panel.x - EPS && r.x + r.width <= panel.x + panel.width + EPS, `${label}: item ${i} inside panel x`);
      assert.ok(r.y >= panel.y - EPS && r.y + r.height <= panel.y + panel.height + EPS, `${label}: item ${i} inside panel y`);
      assert.ok(Math.abs(r.width / r.height - ITEM_WIDTH / ITEM_HEIGHT) < EPS, `${label}: item ${i} aspect`);
      if (i > 0) assert.ok(r.y >= items[i - 1].y + items[i - 1].height - EPS, `${label}: item ${i} does not overlap item ${i - 1}`);
    });
  }
});

test('itemAt: item centres give their index; the gap and outside the panel give -1', () => {
  const layout = menuLayout(1280, 800);
  layout.items.forEach((r, i) => assert.equal(itemAt(layout, r.x + r.width / 2, r.y + r.height / 2), i));
  const first = layout.items[0];
  assert.equal(itemAt(layout, first.x + 10, first.y + first.height + ITEM_GAP / 2), -1);
  assert.equal(itemAt(layout, first.x, first.y), 0, 'left and top edges are inside');
  assert.equal(itemAt(layout, first.x + first.width, first.y + 1), -1, 'right edge is outside');
  assert.equal(itemAt(layout, layout.panel.x - 5, first.y + 10), -1);
  assert.equal(itemAt(layout, 0, 0), -1);
});

const layout = menuLayout(1280, 800);
const centre = (i) => ({ x: layout.items[i].x + 50, y: layout.items[i].y + 10 });
const pointerAt = (p, moved = true) => ({ ...p, width: 1280, height: 800, moved });
const gap = { x: layout.items[0].x + 50, y: layout.items[0].y + ITEM_HEIGHT + ITEM_GAP / 2 };

test('tickMainMenu: moveDown and moveUp wrap', () => {
  const state = initMainMenu();
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(tickMainMenu(state, [frame(['moveDown'])]).highlight);
  assert.deepEqual(seen, [1, 2, 0]);
  assert.equal(tickMainMenu(state, [frame(['moveUp'])]).highlight, 2);
  assert.equal(state.ticks, 4);
});

test('tickMainMenu: disconnected frames are ignored; every connected player counts', () => {
  const state = initMainMenu();
  tickMainMenu(state, [frame(['moveDown'], null, false)]);
  assert.equal(state.highlight, 0);
  tickMainMenu(state, [frame(['moveDown']), frame(['moveDown'])]);
  assert.equal(state.highlight, 2);
});

test('tickMainMenu: a moved pointer over an item highlights it; unmoved or over a gap does nothing', () => {
  const state = initMainMenu();
  tickMainMenu(state, [frame([], pointerAt(centre(2), false))]);
  assert.equal(state.highlight, 0);
  tickMainMenu(state, [frame([], pointerAt(centre(2)))]);
  assert.equal(state.highlight, 2);
  tickMainMenu(state, [frame([], pointerAt(gap))]);
  assert.equal(state.highlight, 2);
});

test('tickMainMenu: jump and interact select the highlighted item', () => {
  const state = initMainMenu();
  tickMainMenu(state, [frame(['moveDown', 'jump'])]);
  assert.deepEqual([state.selected, state.selections], ['Multiplayer', 1]);
  tickMainMenu(state, [frame(['moveDown', 'interact'])]);
  assert.deepEqual([state.selected, state.selections], ['Options', 2]);
});

test('tickMainMenu: a click selects only on an item; a trigger without a pointer selects the highlight', () => {
  const state = initMainMenu();
  tickMainMenu(state, [frame(['primaryFire'], pointerAt(centre(1), false))]);
  assert.deepEqual([state.highlight, state.selected, state.selections], [1, 'Multiplayer', 1]);
  tickMainMenu(state, [frame(['primaryFire'], pointerAt(gap, false))]);
  assert.equal(state.selections, 1);
  tickMainMenu(state, [frame(['primaryFire'], null)]);
  assert.deepEqual([state.selected, state.selections], ['Multiplayer', 2]);
});

test('tickMainMenu: state stays plain data with exactly its keys', () => {
  const state = initMainMenu();
  tickMainMenu(state, [frame(['moveDown', 'jump'])]);
  assert.deepStrictEqual(structuredClone(state), state);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(Object.keys(state).sort(), ['highlight', 'request', 'selected', 'selections', 'ticks']);
});
