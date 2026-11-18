// createMusic with fake window, document and audio element (Node's EventTarget), no browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MUSIC_VOLUME, createMusic } from '../src/audio/music.js';

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];

// A fake element. play() returns a promise the test settles with `settle(true|false)`.
function fakeAudio() {
  const audio = {
    paused: true,
    currentTime: 0,
    srcSets: 0,
    playCalls: 0,
    pauseCalls: 0,
    pending: [],
    set src(value) {
      audio.srcSets += 1;
      audio.srcValue = value;
    },
    get src() {
      return audio.srcValue;
    },
    play() {
      audio.playCalls += 1;
      audio.paused = false;
      return new Promise((resolve, reject) => audio.pending.push({ resolve, reject }));
    },
    pause() {
      audio.pauseCalls += 1;
      audio.paused = true;
    },
    settle(ok) {
      for (const p of audio.pending.splice(0)) (ok ? p.resolve() : p.reject(new Error('blocked')));
    },
  };
  return audio;
}

function setup() {
  const win = new EventTarget();
  win.document = new EventTarget();
  win.document.visibilityState = 'visible';
  const audios = [];
  const music = createMusic({ window: win, createAudio: () => { const a = fakeAudio(); audios.push(a); return a; } });
  return { win, music, audios };
}

const send = (win, type) => win.dispatchEvent(new Event(type));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('music: nothing plays before a gesture', () => {
  const { music, audios } = setup();
  music.play('a.mp3');
  assert.equal(audios[0].playCalls, 0);
  assert.equal(audios[0].volume, MUSIC_VOLUME);
  assert.equal(audios[0].loop, true);
  assert.equal(audios[0].preload, 'auto');
});

test('music: plays after a keydown', () => {
  const { win, music, audios } = setup();
  music.play('a.mp3');
  send(win, 'keydown');
  assert.equal(audios[0].playCalls, 1);
});

test('music: every listed gesture unlocks playback', () => {
  for (const type of GESTURES) {
    const { win, music, audios } = setup();
    music.play('a.mp3');
    send(win, type);
    assert.equal(audios[0].playCalls, 1, type);
  }
});

test('music: a gesture before play(url) lets play start at once', () => {
  const { win, music, audios } = setup();
  send(win, 'click');
  assert.equal(audios.length, 0);
  music.play('a.mp3');
  assert.equal(audios[0].playCalls, 1);
});

test('music: stop pauses and resets the time', () => {
  const { win, music, audios } = setup();
  send(win, 'click');
  music.play('a.mp3');
  audios[0].currentTime = 12;
  music.stop();
  assert.equal(audios[0].paused, true);
  assert.equal(audios[0].currentTime, 0);
  assert.equal(music.debug.wanted, null);
});

test('music: play, stop, play uses one element and keeps src', () => {
  const { win, music, audios } = setup();
  send(win, 'click');
  music.play('a.mp3');
  music.stop();
  music.play('a.mp3');
  assert.equal(music.debug.created, 1);
  assert.equal(audios.length, 1);
  assert.equal(audios[0].srcSets, 1);
  assert.equal(audios[0].paused, false);
  music.play('b.mp3');
  assert.equal(audios[0].srcSets, 2);
});

test('music: hidden pauses, visible resumes, hidden while stopped stays stopped', () => {
  const { win, music, audios } = setup();
  send(win, 'click');
  music.play('a.mp3');
  audios[0].currentTime = 5;
  win.document.visibilityState = 'hidden';
  win.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audios[0].paused, true);
  assert.equal(audios[0].currentTime, 5);
  win.document.visibilityState = 'visible';
  win.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audios[0].paused, false);

  music.stop();
  const plays = audios[0].playCalls;
  win.document.visibilityState = 'hidden';
  win.document.dispatchEvent(new Event('visibilitychange'));
  win.document.visibilityState = 'visible';
  win.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(audios[0].paused, true);
  assert.equal(audios[0].playCalls, plays);
});

test('music: a rejected play() is not an unhandled rejection; a later gesture retries', async () => {
  const { win, music, audios } = setup();
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  try {
    music.play('a.mp3');
    send(win, 'keydown');
    audios[0].settle(false);
    await tick();
    assert.equal(unhandled, 0);
    send(win, 'keydown');
    assert.equal(audios[0].playCalls, 2);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('music: listeners are removed after a resolved play', async () => {
  const { win, music, audios } = setup();
  music.play('a.mp3');
  send(win, 'keydown');
  audios[0].settle(true);
  await tick();
  music.stop();
  send(win, 'keydown'); // no listener: nothing is wanted anyway, so also check a click after play(url)
  music.play('a.mp3');
  const plays = audios[0].playCalls;
  send(win, 'click');
  assert.equal(audios[0].playCalls, plays);
});
