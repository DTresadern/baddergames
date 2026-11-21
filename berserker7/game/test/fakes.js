// Fake renderer and scenes for harness tests (no WebGL).

import { Data3DTexture } from 'three';
import { createHarness } from '../src/engine/harness.js';

export const STEP = 1 / 60;

// The Sandbox's palette LUT without a download: a 32-entry blank 3D texture (createSandbox's loadLut).
export const fakeLoadLut = async () => new Data3DTexture(new Uint8Array(32 * 32 * 32 * 4), 32, 32, 32);

export function fakeRenderer(log = []) {
  return { clear: () => log.push('clear'), clearDepth: () => log.push('clearDepth') };
}

// A promise with its resolve function, for loads the test finishes by hand.
export function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// A scene that logs its hooks. State: { ticks, params }.
// `hooks` replaces or adds hooks; `settings` are the scene's settings.
export function fakeScene(log, name, settings = {}, hooks = {}) {
  return {
    settings,
    load: () => log.push(`${name}.load`),
    enter: (params) => {
      log.push(`${name}.enter`);
      return { ticks: 0, params: params ?? null };
    },
    tick: (state) => ({ ...state, ticks: state.ticks + 1 }),
    draw: () => log.push(`${name}.draw`),
    suspend: () => log.push(`${name}.suspend`),
    resume: () => log.push(`${name}.resume`),
    exit: () => log.push(`${name}.exit`),
    unload: () => log.push(`${name}.unload`),
    ...hooks,
  };
}

export function harnessWith(scenes, options = {}) {
  const log = [];
  const harness = createHarness({ renderer: fakeRenderer(), now: () => 0, ...options });
  for (const [id, settings, hooks] of scenes) harness.register(id, fakeScene(log, id, settings, hooks));
  return { harness, log };
}

// Runs frames until no scene is loading, letting load promises settle in between.
export async function settle(harness, frameSeconds = 0) {
  for (let i = 0; i < 20; i++) {
    harness.frame(frameSeconds);
    const loading = [...harness.records.values()].filter((r) => r.life === 'loading');
    if (loading.length === 0) {
      harness.frame(frameSeconds);
      return;
    }
    await Promise.all(loading.map((r) => r.loaded));
  }
  throw new Error('settle: scenes still loading');
}

export function ticksOf(harness, id) {
  return harness.records.get(id).state?.ticks;
}

// A settings object for scenes: get() gives `{ lastChoice }`; set(patch) is recorded in `sets`.
export function fakeSettings(lastChoice = { campaign: 'megacity', difficulty: 'normal' }) {
  const sets = [];
  return { sets, get: () => ({ lastChoice }), set: (patch) => sets.push(patch) };
}

// A session holder for scenes: set(session) is recorded in `sessions`.
export function fakeSession() {
  const sessions = [];
  return { sessions, get: () => sessions.at(-1) ?? null, set: (session) => sessions.push(session), clear() {} };
}
