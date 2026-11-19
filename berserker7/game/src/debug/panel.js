// DOM debug panel for the harness test scenes. Buttons send harness requests;
// the text refreshes a few times per second, not every frame.
//
// Stable hooks for browser scripts:
//   #b7-debug, #b7-debug-toggle, #b7-debug-body (hidden at start)
//   button[data-action="..."]           see ACTIONS below (reset-settings: settings.reset())
//   [data-value="..."]                  frame-ms, work-ms, steps, long-frame, play-mode,
//                                       layers, transition, geometries, textures, assets,
//                                       settings (JSON of settings.get()), session (JSON or none)
//   [data-scene="<id>"] [data-field="..."]  layer, life, settings, ticks, left, back, error
//   .b7-sandbox (shown while the Sandbox is the main scene):
//     #b7-zoom (range), [data-value="zoom"]  camera view height in tiles; [ and ] change it by 2
//     button[data-view-mode="2d" | "2.5d"]   view mode (aria-pressed on the active one)
//     #b7-fov (range), [data-value="fov"]    2.5D vertical field of view in degrees
//     #b7-cam-x, #b7-cam-y (range), [data-value="cam-x"], [data-value="cam-y"]
//                                       camera offset from the followed point, tiles

import { CAMERA_TILES_MAX, CAMERA_TILES_MIN } from '../scenes/sandbox.js';
import { FOV_MAX, FOV_MIN, OFFSET_LIMIT, OFFSET_STEP } from '../scenes/sandbox-3d.js';

const ACTIONS = [
  ['main-menu', 'Main menu'],
  ['players', 'Players scene (input test)'],
  ['sandbox', 'Sandbox'],
  ['switch-ab', 'Switch A / B (fade)'],
  ['pause', 'Open pause'],
  ['suspend', 'Suspend main'],
  ['unload', 'Unload main'],
  ['snapshot', 'Snapshot-leave main'],
  ['play-mode', 'Play mode: go online'],
  ['slow-frame', 'Simulate slow frame (1 s)'],
  ['slow-scene', 'Switch to slow scene'],
  ['fail-slow', 'Fail slow scene\'s next load'],
  ['reset-settings', 'Reset settings'],
];

const VALUES = [
  ['frame-ms', 'frame time'],
  ['work-ms', 'harness work'],
  ['steps', 'steps last frame'],
  ['long-frame', 'last long frame'],
  ['play-mode', 'play mode'],
  ['layers', 'layers'],
  ['transition', 'fade'],
  ['geometries', 'GPU geometries'],
  ['textures', 'GPU textures'],
  ['assets', 'shared assets'],
  ['settings', 'settings'],
  ['session', 'session'],
];

const FIELDS = ['layer', 'life', 'settings', 'ticks', 'left', 'back', 'error'];
const SLOW_FRAME_MS = 1000;
const REFRESH_MS = 250;
const FADE = 0.6;
const ZOOM_STEP_KEYS = 2; // tiles per [ or ] press

const STYLE = `
#b7-debug { position: fixed; top: 8px; right: 8px; z-index: 2; width: min(360px, calc(100vw - 16px));
  max-height: 55vh; overflow: auto; box-sizing: border-box; font: 11px/1.35 monospace; color: #ddd;
  background: rgba(10, 12, 18, 0.85); border: 1px solid #444; border-radius: 4px; }
#b7-debug-toggle { position: sticky; top: 0; width: 100%; padding: 4px 6px; font: inherit; color: inherit;
  text-align: left; background: #222838; border: 0; cursor: pointer; }
#b7-debug-body { padding: 6px; }
#b7-debug .b7-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; }
#b7-debug .b7-actions button { padding: 4px; font: inherit; color: #eee; background: #333b50;
  border: 1px solid #556; border-radius: 3px; cursor: pointer; }
#b7-debug .b7-actions button:disabled { opacity: 0.4; cursor: default; }
#b7-debug dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; margin: 0 0 6px; }
#b7-debug dt { color: #999; }
#b7-debug dd { margin: 0; overflow-wrap: anywhere; }
#b7-debug .b7-scenes > div { padding: 3px 0; border-top: 1px solid #333; overflow-wrap: anywhere; }
#b7-debug .b7-dim { color: #999; }
#b7-debug .b7-sandbox[hidden] { display: none; }
#b7-debug .b7-sandbox label, #b7-debug .b7-modes { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
#b7-debug .b7-sandbox input { flex: 1; min-width: 0; }
#b7-debug .b7-sandbox input:disabled { opacity: 0.4; }
#b7-debug .b7-modes button { flex: 1; padding: 4px; font: inherit; color: #eee; background: #333b50;
  border: 1px solid #556; border-radius: 3px; cursor: pointer; }
#b7-debug .b7-modes button[aria-pressed="true"] { background: #4f6290; border-color: #8aa; }
`;

// True for elements that take typed text ([ and ] are left alone there). A range slider is not one.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
function takesText(target) {
  if (!target) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
}

// Short hash of a state's JSON, to compare states at a glance.
function hash(text) {
  if (text === null) return '—';
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// `sandboxZoom` and `sandboxViewMode` (optional) are the Sandbox camera's view height holder
// (createCameraZoom) and its view mode and FOV holder (createViewMode).
export function mountPanel({ harness, renderer, assets, settings, session, sandboxZoom = null, sandboxViewMode = null, parent = document.body }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('section');
  root.id = 'b7-debug';
  const ids = [...harness.records.keys()];
  root.innerHTML = `
    <button id="b7-debug-toggle" type="button" aria-expanded="false">Debug ▸</button>
    <div id="b7-debug-body" hidden>
      <div class="b7-actions">
        ${ACTIONS.map(([action, label]) => `<button type="button" data-action="${action}">${label}</button>`).join('')}
      </div>
      <div class="b7-sandbox" hidden>
        <div class="b7-modes">
          <button type="button" data-view-mode="2d">2D (ortho)</button>
          <button type="button" data-view-mode="2.5d">2.5D (perspective)</button>
        </div>
        <label>Sandbox view
          <input id="b7-zoom" type="range" min="${CAMERA_TILES_MIN}" max="${CAMERA_TILES_MAX}" step="1">
          <span data-value="zoom"></span></label>
        <label>FOV
          <input id="b7-fov" type="range" min="${FOV_MIN}" max="${FOV_MAX}" step="1">
          <span data-value="fov"></span></label>
        ${['x', 'y']
          .map(
            (axis) => `<label>Camera ${axis.toUpperCase()}
          <input id="b7-cam-${axis}" data-axis="${axis}" type="range" min="${-OFFSET_LIMIT}" max="${OFFSET_LIMIT}" step="${OFFSET_STEP}">
          <span data-value="cam-${axis}"></span></label>`,
          )
          .join('')}
      </div>
      <dl>${VALUES.map(([key, label]) => `<dt>${label}</dt><dd data-value="${key}"></dd>`).join('')}</dl>
      <div class="b7-scenes">${ids
        .map(
          (id) => `<div data-scene="${id}">
            <b>${id}</b> <span data-field="layer"></span> · <span data-field="life"></span> · ticks <span data-field="ticks"></span><br>
            <span class="b7-dim">tick/drawCovered/leave</span> <span data-field="settings"></span><br>
            <span class="b7-dim">state left</span> <span data-field="left"></span>
            <span class="b7-dim">back</span> <span data-field="back"></span><br>
            <span class="b7-dim">last load error</span> <span data-field="error"></span>
          </div>`,
        )
        .join('')}</div>
    </div>`;
  parent.append(root);

  const toggle = root.querySelector('#b7-debug-toggle');
  const body = root.querySelector('#b7-debug-body');
  const button = (action) => root.querySelector(`[data-action="${action}"]`);
  const setValue = (key, text) => {
    root.querySelector(`[data-value="${key}"]`).textContent = text;
  };

  // The main scene a leave button removed: { id, mode, frame }.
  let left = null;

  function leaveOrReturn(mode) {
    if (left?.mode === mode) {
      harness.setMain(left.id);
      left = null;
    } else if (!left && harness.layers.main !== null) {
      left = { id: harness.layers.main, mode, frame: harness.frames };
      harness.leave(left.id, mode);
    }
  }

  const handlers = {
    'main-menu'() {
      // The menu has no backdrop.
      if (harness.layers.background.includes('backdrop')) harness.leave('backdrop');
      harness.setMain('mainMenu', { fade: FADE });
    },
    sandbox() {
      // The Sandbox has no backdrop.
      if (harness.layers.background.includes('backdrop')) harness.leave('backdrop');
      harness.setMain('sandbox', { fade: FADE });
    },
    players() {
      harness.addBackground('backdrop');
      harness.setMain('players', { fade: FADE });
    },
    'switch-ab'() {
      harness.addBackground('backdrop');
      const current = harness.transition?.to ?? harness.layers.main;
      harness.setMain(current === 'sceneA' ? 'sceneB' : 'sceneA', { fade: FADE });
    },
    pause() {
      if (harness.layers.overlays.includes('pause')) harness.closeOverlay('pause');
      else harness.openOverlay('pause');
    },
    suspend: () => leaveOrReturn('suspend'),
    unload: () => leaveOrReturn('unload'),
    snapshot: () => leaveOrReturn('snapshot'),
    'play-mode'() {
      harness.setPlayMode(harness.playMode === 'local' ? 'online' : 'local');
    },
    'slow-frame'() {
      // Block the main thread, so the next frame's real frame time is large.
      const end = performance.now() + SLOW_FRAME_MS;
      while (performance.now() < end);
    },
    'slow-scene'() {
      harness.addBackground('backdrop');
      harness.setMain('slow', { fade: FADE });
    },
    'fail-slow'() {
      const { debug } = harness.records.get('slow').scene;
      debug.failNextLoad = !debug.failNextLoad;
    },
    'reset-settings': () => settings.reset(),
  };

  // Each button gives up focus after a click, so Space and other keys go to the game.
  for (const [action] of ACTIONS) button(action).addEventListener('click', (e) => {
    e.currentTarget.blur();
    handlers[action]();
    refresh();
  });

  // Sandbox camera zoom: the slider and the [ / ] keys. Debug tooling, not game input.
  const sandboxRow = root.querySelector('.b7-sandbox');
  const zoomSlider = root.querySelector('#b7-zoom');
  const fovSlider = root.querySelector('#b7-fov');
  const modeButtons = [...root.querySelectorAll('[data-view-mode]')];
  const offsetSliders = [...root.querySelectorAll('[data-axis]')];
  function showZoom() {
    if (sandboxZoom) {
      zoomSlider.value = String(sandboxZoom.get());
      setValue('zoom', `${sandboxZoom.get()} tiles high`);
    }
    if (sandboxViewMode) {
      const mode = sandboxViewMode.mode();
      for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.viewMode === mode));
      fovSlider.value = String(sandboxViewMode.fov());
      fovSlider.disabled = mode !== '2.5d';
      setValue('fov', `${sandboxViewMode.fov()}°`);
      const offset = sandboxViewMode.offset();
      for (const slider of offsetSliders) {
        const value = offset[slider.dataset.axis];
        slider.value = String(value);
        setValue(`cam-${slider.dataset.axis}`, `${value > 0 ? '+' : ''}${value.toFixed(2)} tiles`);
      }
    }
  }
  if (sandboxViewMode) {
    for (const b of modeButtons) {
      b.addEventListener('click', () => {
        b.blur();
        sandboxViewMode.setMode(b.dataset.viewMode);
        showZoom();
      });
    }
    fovSlider.addEventListener('input', () => {
      sandboxViewMode.setFov(Number(fovSlider.value));
      showZoom();
    });
    fovSlider.addEventListener('change', () => fovSlider.blur());
    for (const slider of offsetSliders) {
      slider.addEventListener('input', () => {
        sandboxViewMode.setOffset(slider.dataset.axis, Number(slider.value));
        showZoom();
      });
      slider.addEventListener('change', () => slider.blur());
    }
  }
  if (sandboxZoom) {
    zoomSlider.addEventListener('input', () => {
      sandboxZoom.set(Number(zoomSlider.value));
      showZoom();
    });
    // Give up focus once the drag ends, so arrow keys go to the game.
    zoomSlider.addEventListener('change', () => zoomSlider.blur());
    window.addEventListener('keydown', (e) => {
      if (takesText(e.target)) return;
      const step = { BracketLeft: ZOOM_STEP_KEYS, BracketRight: -ZOOM_STEP_KEYS }[e.code];
      if (step === undefined) return;
      sandboxZoom.set(sandboxZoom.get() + step);
      showZoom();
    });
    showZoom();
  }

  toggle.addEventListener('click', () => {
    toggle.blur();
    const open = body.hidden;
    body.hidden = !open;
    toggle.textContent = open ? 'Debug ▾' : 'Debug ▸';
    toggle.setAttribute('aria-expanded', String(open));
  });

  function refreshButtons() {
    // Forget a left scene that has since been put back by other means (requests apply a frame later).
    if (left && harness.frames > left.frame + 1 && harness.records.get(left.id).layer !== null) left = null;
    for (const mode of ['suspend', 'unload', 'snapshot']) {
      const b = button(mode);
      const verb = { suspend: 'Suspend', unload: 'Unload', snapshot: 'Snapshot-leave' }[mode];
      const back = { suspend: 'Resume', unload: 'Reload', snapshot: 'Return' }[mode];
      b.textContent = left?.mode === mode ? `${back} ${left.id}` : `${verb} main`;
      b.disabled = left ? left.mode !== mode : harness.layers.main === null;
    }
    button('pause').textContent = harness.layers.overlays.includes('pause') ? 'Close pause' : 'Open pause';
    button('fail-slow').textContent = harness.records.get('slow').scene.debug.failNextLoad
      ? 'Slow scene\'s next load fails: on'
      : 'Fail slow scene\'s next load';
    button('play-mode').textContent = harness.playMode === 'local' ? 'Play mode: go online' : 'Play mode: go local';
  }

  function refresh() {
    refreshButtons();
    sandboxRow.hidden = !sandboxZoom || harness.layers.main !== 'sandbox';
    showZoom();
    const { layers, lastLongFrame: long, transition: tr } = harness;
    setValue('frame-ms', `${(harness.lastFrameSeconds * 1000).toFixed(1)} ms`);
    setValue('work-ms', `${harness.lastWorkMs.toFixed(2)} ms`);
    setValue('steps', `${harness.lastSteps} (cap ${harness.clock.maxSteps})`);
    setValue('long-frame', long ? `${(long.frameSeconds * 1000).toFixed(0)} ms → ${long.steps} steps` : '—');
    setValue('play-mode', harness.playMode);
    setValue(
      'layers',
      `bg [${layers.background.join(', ')}] · main ${layers.main ?? '—'}` +
        `${harness.standIn ? ` (showing ${harness.standIn})` : ''} · overlays [${layers.overlays.join(', ')}]`,
    );
    setValue('transition', tr ? `to ${tr.to}, ${(tr.t / tr.duration * 100).toFixed(0)}%` : '—');
    setValue('geometries', String(renderer.info.memory.geometries));
    setValue('textures', String(renderer.info.memory.textures));
    setValue('settings', JSON.stringify(settings.get()));
    setValue('session', session.get() ? JSON.stringify(session.get()) : 'none');
    setValue('assets', assets.keys().map((key) => `${key} ×${assets.count(key)}`).join(', ') || 'none');

    for (const record of harness.records.values()) {
      const row = root.querySelector(`[data-scene="${record.id}"]`);
      const { tick, drawCovered, leave } = record.settings;
      const text = {
        layer: harness.standIn === record.id ? 'main (stand-in)' : record.layer ?? '—',
        life: record.life,
        settings: `${tick} / ${drawCovered ? 'yes' : 'no'} / ${leave}`,
        ticks: record.state?.ticks ?? '—',
        left: hash(record.leftState),
        back: hash(record.returnedState),
        error: record.error?.message ?? '—',
      };
      for (const field of FIELDS) row.querySelector(`[data-field="${field}"]`).textContent = String(text[field]);
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
  return root;
}
