import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetByKey } from '../src/assets/manifest.js';
import {
  FADE_SECONDS,
  HOLD_SECONDS,
  INTRO_LOGOS,
  INTRO_TICKS,
  LOGO_MAX_HEIGHT,
  LOGO_MAX_WIDTH,
  SKIP_DELAY_SECONDS,
  TICKS_PER_SECOND,
  createIntro,
  initIntro,
  introAt,
  logoRect,
  tickIntro,
} from '../src/scenes/intro.js';
import { frame } from './frames.js';

const S = TICKS_PER_SECOND;
const LOGO = (2 * FADE_SECONDS + HOLD_SECONDS) * S; // ticks per logo
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('intro constants', () => {
  assert.deepEqual([FADE_SECONDS, HOLD_SECONDS, TICKS_PER_SECOND], [1, 2, 60]);
  assert.deepEqual(INTRO_LOGOS, ['logo.baddergames', 'logo.w8omg']);
  assert.equal(INTRO_TICKS, 2 * LOGO);
});

test('introAt: logo 0 fades in, holds, fades out; logo 1 follows with no gap; then end', () => {
  assert.deepEqual(introAt(0), { logo: 0, alpha: 0, phase: 'fadeIn' });
  assert.deepEqual(introAt(S / 2), { logo: 0, alpha: 0.5, phase: 'fadeIn' });
  assert.ok(near(introAt(S - 1).alpha, (S - 1) / S));
  assert.deepEqual(introAt(S), { logo: 0, alpha: 1, phase: 'hold' });
  assert.deepEqual(introAt(3 * S - 1), { logo: 0, alpha: 1, phase: 'hold' });
  assert.deepEqual(introAt(3 * S), { logo: 0, alpha: 1, phase: 'fadeOut' });
  assert.deepEqual(introAt(3.5 * S), { logo: 0, alpha: 0.5, phase: 'fadeOut' });
  assert.ok(near(introAt(LOGO - 1).alpha, 1 / S));
  assert.deepEqual(introAt(LOGO), { logo: 1, alpha: 0, phase: 'fadeIn' });
  assert.deepEqual(introAt(LOGO + S), { logo: 1, alpha: 1, phase: 'hold' });
  assert.deepEqual(introAt(LOGO + 3.5 * S), { logo: 1, alpha: 0.5, phase: 'fadeOut' });
  assert.deepEqual(introAt(2 * LOGO), { logo: null, alpha: 0, phase: 'end' });
  assert.deepEqual(introAt(2 * LOGO + 100), { logo: null, alpha: 0, phase: 'end' });
});

test('introAt: alpha changes by at most one fade step per tick (no jumps)', () => {
  for (let t = 1; t <= INTRO_TICKS; t++) {
    assert.ok(Math.abs(introAt(t).alpha - introAt(t - 1).alpha) <= 1 / S + 1e-9, `tick ${t}`);
  }
});

const run = (state, ticks, inputs = []) => {
  const requests = [];
  for (let i = 0; i < ticks; i++) {
    tickIntro(state, inputs);
    if (state.request) requests.push([state.ticks, state.request]);
  }
  return requests;
};
const DELAY = SKIP_DELAY_SECONDS * S;
const pastDelay = () => {
  const state = initIntro();
  run(state, DELAY);
  return state;
};

test('tickIntro: menu request once when the timeline ends, nothing after', () => {
  const state = initIntro();
  assert.deepEqual(run(state, INTRO_TICKS + 100), [[INTRO_TICKS, 'menu']]);
  assert.equal(state.leaving, true);
});

test('tickIntro: skip by an activating press, a key action (Escape too) or a gamepad button', () => {
  const presses = {
    click: frame(['primaryFire'], null, true, true),
    touch: frame([], null, true, true),
    escape: frame(['pause']),
    gamepad: { ...frame(['jump']), player: 1 },
  };
  for (const [name, f] of Object.entries(presses)) {
    const state = pastDelay();
    assert.deepEqual(run(state, 1, [frame([]), f]), [[DELAY + 1, 'skip']], name);
    assert.deepEqual(run(state, INTRO_TICKS, [f]), [], `${name}: no request after leaving`);
  }
});

test('tickIntro: no skip from idle frames, a mouse move, a disconnected frame, or a press in the first quarter second', () => {
  const state = initIntro();
  const press = frame(['jump'], null, true, true);
  assert.deepEqual(run(state, DELAY, [press]), [], 'presses within the skip delay');
  const moved = frame([], { x: 10, y: 10, width: 800, height: 600, moved: true });
  assert.deepEqual(run(state, 50, [frame([]), moved, frame(['jump'], null, false, true)]), []);
  assert.equal(state.leaving, false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
});

test('intro scene: enter starts the title music; menu and skip ask for the menu from black or with a fade', () => {
  const calls = [];
  const music = { play: (url) => calls.push(['play', url]), stop: () => calls.push(['stop']) };
  const screens = { showMenu: (options) => calls.push(['showMenu', options]) };
  const intro = createIntro({ music, screens });
  assert.deepEqual(intro.settings, { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false });
  let state = intro.enter();
  assert.deepEqual(calls, [['play', assetByKey('music.title').path]]);
  for (let i = 0; i < INTRO_TICKS; i++) state = intro.tick(state, []);
  assert.deepEqual(calls.at(-1), ['showMenu', { fromBlack: true }]);

  calls.length = 0;
  state = intro.enter();
  for (let i = 0; i < DELAY; i++) state = intro.tick(state, []);
  intro.tick(state, [frame(['pause'])]);
  assert.deepEqual(calls.slice(1), [['showMenu', { fromBlack: false }]]);
  assert.ok(!calls.some(([name]) => name === 'stop'), 'the music is never stopped by the intro');
});

const fits = (r, vw, vh, iw, ih, ratio) => {
  const label = `${vw}x${vh} @${ratio}, ${iw}x${ih}`;
  assert.ok(near(r.width / r.height, iw / ih), `${label}: aspect`);
  assert.ok(r.width <= LOGO_MAX_WIDTH * vw + 1e-9 && r.height <= LOGO_MAX_HEIGHT * vh + 1e-9, `${label}: fits`);
  assert.ok(r.width * ratio <= iw + 1e-9, `${label}: not upscaled`);
  assert.ok(near(r.x, (vw - r.width) / 2) && near(r.y, (vh - r.height) / 2), `${label}: centred`);
};

test('logoRect: phone, desktop and high-density desktop', () => {
  const logos = [[1378, 323], [654, 180]];
  for (const [iw, ih] of logos) {
    for (const [vw, vh, ratio] of [[360, 640, 1], [360, 640, 3], [1920, 1080, 1], [1920, 1080, 2], [800, 200, 1]]) {
      fits(logoRect(vw, vh, iw, ih, ratio), vw, vh, iw, ih, ratio);
    }
  }
  // Phone: 80% of the width.
  const phone = logoRect(360, 640, 1378, 323);
  assert.ok(near(phone.width, 288));
  // Desktop: the image's own size; at ratio 2 half of it in CSS px (same device pixels).
  assert.deepEqual(logoRect(1920, 1080, 1378, 323), { x: 271, y: 378.5, width: 1378, height: 323 });
  assert.deepEqual(logoRect(1920, 1080, 1378, 323, 2), { x: 615.5, y: 459.25, width: 689, height: 161.5 });
  // A wide, short view: 60% of the height.
  assert.ok(near(logoRect(800, 200, 654, 180).height, 120));
  assert.equal(logoRect(1920, 1080, 654, 180).width, 654, 'default pixel ratio 1');
});
