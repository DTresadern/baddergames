// Boot (the first scene): preloads the 'boot' asset group with a progress bar on black, then
// asks "Click or press any key to start". That press is a user activation (frame.activated),
// so the intro's music can start. On a load failure it shows which file failed and stops there.

import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three';
import { LOAD_ERROR_PREFIX } from '../assets/loader.js';
import { labelTexture } from './labels.js';
import { fitOrtho, place } from './shared.js';

export const BOOT_GROUP = 'boot';
export const PROMPT = 'Click or press any key to start';
export const BAR_MAX_WIDTH = 400;
export const BAR_VIEW_FRACTION = 0.7; // of the view width, when that is less than BAR_MAX_WIDTH
export const BAR_HEIGHT = 6;
const BAR_TRACK_OPACITY = 0.25;
const MARGIN = 16; // minimum space between a label and the view edge
// Label canvases in CSS px. The error's second line (the path) is 0.6 of ERROR_FONT, so a path
// of about 50 characters fits in 360 px.
const PROMPT_SIZE = { width: 360, height: 48, font: 20 };
const ERROR_SIZE = { width: 360, height: 72, font: 22 };

// The bar's track, centred, in canvas CSS px (top-left origin, y down).
export function barRect(viewWidth, viewHeight) {
  const width = Math.min(BAR_MAX_WIDTH, BAR_VIEW_FRACTION * viewWidth);
  return { x: (viewWidth - width) / 2, y: (viewHeight - BAR_HEIGHT) / 2, width, height: BAR_HEIGHT };
}

// A label of `width` x `height`, centred, shrunk uniformly to keep MARGIN at each side.
export function labelRect(viewWidth, viewHeight, width, height) {
  const k = Math.min(1, (viewWidth - 2 * MARGIN) / width);
  return { x: (viewWidth - width * k) / 2, y: (viewHeight - height * k) / 2, width: width * k, height: height * k };
}

// "Could not load <path>" as two lines, so the path gets a line of its own.
export function errorLines(message) {
  const prefix = `${LOAD_ERROR_PREFIX} `;
  return message.startsWith(prefix) ? [LOAD_ERROR_PREFIX, message.slice(prefix.length)] : [message];
}

export function initBoot() {
  return { ticks: 0, progress: 0, done: false, error: null, started: false, request: null };
}

// `status` is the loader's status for the boot group. `request` is 'start' on the one tick a
// player activated (a key, click or touch) after the load finished without an error.
export function tickBoot(state, inputs, status) {
  state.ticks += 1;
  state.request = null;
  state.progress = status.progress;
  state.done = status.done;
  state.error = status.error;
  if (state.done && state.error === null && !state.started && inputs.some((f) => f.connected && f.activated)) {
    state.request = 'start';
    state.started = true;
  }
  return state;
}

export function createBoot({ loader, screens, createCanvas = () => document.createElement('canvas') }) {
  let context, scene, camera, geometry, black, barTrack, barFill, prompt, error;
  const mesh = (material, z) => {
    const m = new Mesh(geometry, material);
    m.position.z = z;
    scene.add(m);
    return m;
  };
  const textMaterial = (map) => context.track(new MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false },
    async load(ctx) {
      context = ctx;
      const { track } = ctx;
      scene = new Scene();
      geometry = track(new PlaneGeometry(1, 1));
      black = mesh(track(new MeshBasicMaterial({ color: 0x000000 })), 0);
      const white = (opacity) => track(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }));
      barTrack = mesh(white(BAR_TRACK_OPACITY), 1);
      barFill = mesh(white(1), 2);
      const { width, height, font } = PROMPT_SIZE;
      prompt = mesh(textMaterial(track(labelTexture(createCanvas, PROMPT, width, height, font))), 3);
      error = null;
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter() {
      // The loader logs a failure itself; the status carries it to the screen.
      loader.load(BOOT_GROUP).catch(() => {});
      return initBoot();
    },
    tick(state, inputs) {
      tickBoot(state, inputs, loader.status(BOOT_GROUP));
      if (state.request === 'start') screens.startIntro();
      return state;
    },
    draw(state, view) {
      const { width, height } = view;
      fitOrtho(camera, view, height / 2); // world units are CSS px
      place(black, { x: 0, y: 0, width, height }, width, height);
      // The error label is made once, when the error first shows (the error never changes).
      if (state.error !== null && error === null) {
        const { width: w, height: h, font } = ERROR_SIZE;
        error = mesh(textMaterial(context.track(labelTexture(createCanvas, errorLines(state.error), w, h, font))), 3);
      }
      const loading = state.error === null && !state.done;
      const bar = barRect(width, height);
      barTrack.visible = loading;
      barFill.visible = loading && state.progress > 0;
      place(barTrack, bar, width, height);
      place(barFill, { ...bar, width: bar.width * state.progress }, width, height);
      prompt.visible = state.error === null && state.done;
      place(prompt, labelRect(width, height, PROMPT_SIZE.width, PROMPT_SIZE.height), width, height);
      if (error) place(error, labelRect(width, height, ERROR_SIZE.width, ERROR_SIZE.height), width, height);
      view.renderer.render(scene, camera);
    },
  };
}
