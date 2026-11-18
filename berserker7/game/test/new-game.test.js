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
import { createSession } from '../src/session.js';
import { fakeSession, fakeSettings } from './fakes.js';
import { frame } from './frames.js';

const EPS = 1e-9;
const layout = newGameLayout(1280, 800);
const pointerAt = (rect, moved = true) => ({ x: rect.x + 5, y: rect.y + 5, width: 1280, height: 800, moved });

test('initNewGame: Megacity, "Inmate" (normal) highlighted, nothing selected', () => {
  assert.deepEqual(initNewGame(), { ticks: 0, campaign: 'megacity', highlight: 1, selected: null, selections: 0, request: null, start: null });
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
  assert.deepEqual(state, { ticks: 1, campaign: 'megacity', highlight: 1, selected: 'normal', selections: 1, request: null, start: { campaign: 'megacity', difficulty: 'normal' } });
  assert.deepStrictEqual(structuredClone(state), state);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(Object.keys(state).sort(), ['campaign', 'highlight', 'request', 'selected', 'selections', 'start', 'ticks']);
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
  const scene = createNewGame({ screens: { closeNewGame: () => calls.push('close') }, settings: fakeSettings(), session: fakeSession() });
  const state = scene.enter();
  scene.tick(state, [frame(['jump'])]);
  for (let i = 0; i < 3; i++) scene.tick(state, [frame(['moveDown'])]);
  assert.deepEqual(calls, []);
  scene.tick(state, [frame(['primaryFire'])]); // highlight is back (index 4)
  assert.deepEqual(calls, ['close']);
  assert.equal(state.selected, 'back');
});

test('new game scene: closing unloads it, so each open starts fresh', () => {
  assert.equal(createNewGame({ screens: {}, settings: fakeSettings(), session: fakeSession() }).settings.leave, 'unload');
});

test('new game scene: does not pause', () => {
  assert.equal(createNewGame({ screens: {}, settings: fakeSettings(), session: fakeSession() }).settings.pausable, false);
});

test('new game: back in a tick wins over a later selection in the same tick', () => {
  const calls = [];
  const scene = createNewGame({ screens: { closeNewGame: () => calls.push('close') }, settings: fakeSettings(), session: fakeSession() });
  const state = scene.enter();
  scene.tick(state, [frame(['pause', 'jump'])]);
  assert.equal(state.request, 'back');
  assert.deepEqual(calls, ['close']);
  scene.tick(state, []);
  assert.equal(state.request, null);
});

test('initNewGame: the saved choice sets the campaign and the highlighted difficulty', () => {
  for (const difficulty of ['easy', 'normal', 'hard', 'extreme']) {
    const state = initNewGame({ campaign: 'megacity', difficulty });
    assert.equal(state.campaign, 'megacity');
    assert.equal(LIST[state.highlight], difficulty);
  }
});

test('initNewGame: an unavailable or unknown campaign gives the first available one', () => {
  for (const campaign of ['caverns', 'underbelly', 'nowhere', '', 3, null, undefined]) {
    const state = initNewGame({ campaign, difficulty: 'hard' });
    assert.equal(state.campaign, 'megacity', String(campaign));
    assert.equal(LIST[state.highlight], 'hard');
  }
});

test('initNewGame: an unknown difficulty gives the default; back is not a difficulty', () => {
  for (const difficulty of ['impossible', 'back', '', 2, null, undefined]) {
    const state = initNewGame({ campaign: 'megacity', difficulty });
    assert.equal(LIST[state.highlight], 'normal', String(difficulty));
  }
  for (const bad of [null, undefined, 'megacity', 7, {}]) assert.deepEqual(initNewGame(bad), initNewGame());
});

test('tickNewGame: selecting a difficulty sets start; it is reset each tick; the last selection in a tick wins', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['moveDown'])]);
  assert.equal(state.start, null);
  tickNewGame(state, [frame(['jump'])]); // highlight is hard (index 2)
  assert.deepEqual(state.start, { campaign: 'megacity', difficulty: 'hard' });
  tickNewGame(state, [frame(['moveUp'])]);
  assert.equal(state.start, null);
  tickNewGame(state, [frame(['jump'])]);
  assert.deepEqual(state.start, { campaign: 'megacity', difficulty: 'normal' });
  const both = initNewGame();
  tickNewGame(both, [frame(['jump']), { ...frame(['moveDown', 'interact']), player: 1 }]);
  assert.equal(both.start.difficulty, 'hard', 'the last selection in the tick wins');
});

test('tickNewGame: selecting Back does not set start', () => {
  const state = initNewGame();
  tickNewGame(state, [frame(['pause'])]);
  assert.equal(state.start, null);
  assert.equal(state.request, 'back');
});

test('new game scene: enter uses the saved last choice from the settings', () => {
  const scene = createNewGame({
    screens: {},
    settings: fakeSettings({ campaign: 'caverns', difficulty: 'extreme' }),
    session: fakeSession(),
  });
  const state = scene.enter();
  assert.equal(state.campaign, 'megacity');
  assert.equal(LIST[state.highlight], 'extreme');
});

test('new game scene: selecting a difficulty creates the session and saves the last choice; nothing else happens', () => {
  const calls = [];
  const settings = fakeSettings();
  const session = fakeSession();
  const scene = createNewGame({ screens: { closeNewGame: () => calls.push('close') }, settings, session });
  const state = scene.enter();
  scene.tick(state, [frame(['moveDown'])]);
  assert.deepEqual(session.sessions, []);
  assert.deepEqual(settings.sets, []);
  scene.tick(state, [frame(['jump'])]); // hard
  assert.deepEqual(session.sessions, [createSession({ campaign: 'megacity', difficulty: 'hard' })]);
  assert.deepEqual(settings.sets, [{ lastChoice: { campaign: 'megacity', difficulty: 'hard' } }]);
  assert.deepEqual(calls, [], 'the overlay stays open');
  scene.tick(state, []);
  assert.equal(session.sessions.length, 1, 'once per selection, not per tick');
  assert.equal(settings.sets.length, 1);
});

test('new game scene: selecting Back creates no session and saves nothing', () => {
  const calls = [];
  const settings = fakeSettings();
  const session = fakeSession();
  const scene = createNewGame({ screens: { closeNewGame: () => calls.push('close') }, settings, session });
  const state = scene.enter();
  scene.tick(state, [frame(['pause'])]);
  assert.deepEqual(calls, ['close']);
  assert.deepEqual(session.sessions, []);
  assert.deepEqual(settings.sets, []);
});

test('new game scene: a selection and Back in the same tick creates the session and closes', () => {
  const calls = [];
  const settings = fakeSettings();
  const session = fakeSession();
  const scene = createNewGame({ screens: { closeNewGame: () => calls.push('close') }, settings, session });
  const state = scene.enter();
  scene.tick(state, [frame(['jump', 'pause'])]);
  assert.equal(session.sessions.length, 1);
  assert.deepEqual(calls, ['close']);
});
