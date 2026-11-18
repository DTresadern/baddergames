import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPAIGNS } from '../src/data/campaigns.js';
import {
  LIST,
  createNewGame,
  hitTest,
  initNewGame,
  newGameLayout,
  nextAvailable,
  tickNewGame,
} from '../src/scenes/new-game.js';
import { frame } from './frames.js';

const EPS = 1e-9;
const layout = newGameLayout(1280, 800);
const pointerAt = (rect, moved = true) => ({ x: rect.x + 5, y: rect.y + 5, width: 1280, height: 800, moved });

test('initNewGame: Megacity, "Inmate" (normal) highlighted, nothing selected', () => {
  assert.deepEqual(initNewGame(), { ticks: 0, campaign: 'megacity', highlight: 1, selected: null, selections: 0 });
  assert.equal(LIST[initNewGame().highlight], 'normal');
  assert.deepEqual(LIST, ['easy', 'normal', 'hard', 'extreme', 'back']);
});

test('tickNewGame: moveDown and moveUp wrap over the five entries', () => {
  const state = initNewGame();
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push(tickNewGame(state, [frame(['moveDown'])]).highlight);
  assert.deepEqual(seen, [2, 3, 4, 0, 1]);
  tickNewGame(state, [frame(['moveUp'])]);
  tickNewGame(state, [frame(['moveUp'])]);
  assert.equal(state.highlight, 4);
  assert.equal(state.ticks, 7);
});

test('tickNewGame: moveLeft and moveRight keep Megacity while it is the only available campaign', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['moveLeft'])]);
  tickNewGame(state, [frame(['moveRight'])]);
  assert.equal(state.campaign, 'megacity');
});

test('nextAvailable: skips unavailable, wraps, stays when alone', () => {
  const list = [
    { id: 'a', available: true },
    { id: 'b', available: false },
    { id: 'c', available: true },
    { id: 'd', available: false },
  ];
  assert.equal(nextAvailable(list, 'a', 1), 'c');
  assert.equal(nextAvailable(list, 'c', 1), 'a');
  assert.equal(nextAvailable(list, 'a', -1), 'c');
  assert.equal(nextAvailable(list, 'c', -1), 'a');
  assert.equal(nextAvailable([list[0], list[1]], 'a', 1), 'a');
  assert.equal(nextAvailable(CAMPAIGNS, 'megacity', -1), 'megacity');
});

test('tickNewGame: pause and melee select back; jump and interact select the highlight', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['pause'])]);
  assert.deepEqual([state.selected, state.selections], ['back', 1]);
  tickNewGame(state, [frame(['melee'])]);
  assert.deepEqual([state.selected, state.selections], ['back', 2]);
  tickNewGame(state, [frame(['jump'])]);
  assert.deepEqual([state.selected, state.selections], ['normal', 3]);
  tickNewGame(state, [frame(['moveDown', 'interact'])]);
  assert.deepEqual([state.selected, state.selections], ['hard', 4]);
});

test('tickNewGame: disconnected frames are ignored', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['jump'], null, false)]);
  assert.equal(state.selections, 0);
});

test('tickNewGame: selecting changes nothing else; state stays plain data with exactly its keys', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['jump'])]);
  assert.deepEqual(state, { ticks: 1, campaign: 'megacity', highlight: 1, selected: 'normal', selections: 1 });
  assert.deepStrictEqual(structuredClone(state), state);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(Object.keys(state).sort(), ['campaign', 'highlight', 'selected', 'selections', 'ticks']);
});

test('tickNewGame: a moved pointer over a list item highlights it; an unmoved one does not', () => {
  const state = initNewGame();
  tickNewGame(state, [frame([], pointerAt(layout.list.items[3], false))]);
  assert.equal(state.highlight, 1);
  tickNewGame(state, [frame([], pointerAt(layout.list.items[3]))]);
  assert.equal(state.highlight, 3);
});

test('tickNewGame: a click on a list item highlights and selects it', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['primaryFire'], pointerAt(layout.list.items[4], false))]);
  assert.deepEqual([state.highlight, state.selected, state.selections], [4, 'back', 1]);
});

test('tickNewGame: a click on an unavailable card or elsewhere does nothing; Megacity stays', () => {
  const state = initNewGame();
  const before = { ...state, ticks: 1 };
  tickNewGame(state, [frame(['primaryFire'], pointerAt(layout.cards[1], false))]);
  tickNewGame(state, [frame(['primaryFire'], { x: 2, y: 2, width: 1280, height: 800, moved: false })]);
  assert.deepEqual({ ...state, ticks: 1 }, before);
  tickNewGame(state, [frame(['primaryFire'], pointerAt(layout.cards[0], false))]);
  assert.equal(state.campaign, 'megacity');
  assert.equal(state.selections, 0);
});

test('tickNewGame: a trigger without a pointer selects the highlight', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['primaryFire'])]);
  assert.deepEqual([state.selected, state.selections], ['normal', 1]);
});

const intersects = (a, b) =>
  a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;

test('newGameLayout: everything inside the view, cards and items in order, no overlaps', () => {
  for (const [vw, vh] of [[1280, 800], [800, 1280], [390, 844], [1280, 300]]) {
    const { cards, list } = newGameLayout(vw, vh);
    const label = `${vw}x${vh}`;
    assert.equal(cards.length, CAMPAIGNS.length);
    assert.equal(list.items.length, LIST.length);
    const all = [...cards, list.panel];
    for (const r of all) {
      assert.ok(r.width > 0 && r.height > 0, `${label}: size`);
      assert.ok(r.x >= -EPS && r.y >= -EPS && r.x + r.width <= vw + EPS && r.y + r.height <= vh + EPS, `${label}: inside view`);
    }
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => assert.ok(!intersects(a, b), `${label}: no overlap`)));
    list.items.forEach((r, i) => {
      assert.ok(r.x >= list.panel.x - EPS && r.x + r.width <= list.panel.x + list.panel.width + EPS, `${label}: item ${i} inside panel x`);
      assert.ok(r.y >= list.panel.y - EPS && r.y + r.height <= list.panel.y + list.panel.height + EPS, `${label}: item ${i} inside panel y`);
      if (i > 0) assert.ok(r.y >= list.items[i - 1].y + list.items[i - 1].height - EPS, `${label}: item ${i} below ${i - 1}`);
    });
  }
});

test('newGameLayout: one row of cards when wide, a 2 x 2 grid when narrow', () => {
  const wide = newGameLayout(1280, 800).cards;
  assert.ok(wide.every((r) => r.y === wide[0].y));
  const narrow = newGameLayout(390, 844).cards;
  assert.equal(narrow[0].y, narrow[1].y);
  assert.equal(narrow[2].y, narrow[3].y);
  assert.ok(narrow[2].y > narrow[0].y);
  assert.equal(narrow[0].x, narrow[2].x);
  assert.equal(wide[0].width, 200);
});

test('hitTest: card and item centres, gaps and outside', () => {
  const centre = (r) => [r.x + r.width / 2, r.y + r.height / 2];
  layout.cards.forEach((r, index) => assert.deepEqual(hitTest(layout, ...centre(r)), { kind: 'card', index }));
  layout.list.items.forEach((r, index) => assert.deepEqual(hitTest(layout, ...centre(r)), { kind: 'item', index }));
  const first = layout.list.items[0];
  assert.equal(hitTest(layout, first.x + 10, first.y + first.height + 4), null);
  assert.equal(hitTest(layout, 0, 0), null);
});

// The scene's tick with fakes: closeNewGame is called only when back is selected.
test('new game scene: tick closes the overlay only when back is selected', () => {
  const calls = [];
  const scene = createNewGame({ screens: { closeNewGame: () => calls.push('close') } });
  const state = scene.enter();
  scene.tick(state, [frame(['jump'])]);
  for (let i = 0; i < 3; i++) scene.tick(state, [frame(['moveDown'])]);
  assert.deepEqual(calls, []);
  scene.tick(state, [frame(['primaryFire'])]); // highlight is back (index 4)
  assert.deepEqual(calls, ['close']);
  assert.equal(state.selected, 'back');
});

test('new game scene: closing unloads it, so each open starts fresh', () => {
  assert.equal(createNewGame({ screens: {} }).settings.leave, 'unload');
});

test('new game scene: does not pause', () => {
  assert.equal(createNewGame({ screens: {} }).settings.pausable, false);
});
