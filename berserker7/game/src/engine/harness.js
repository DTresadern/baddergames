// Game harness: fixed-step loop, scene layers, and a queue of scene changes.
//
// Each frame(frameSeconds):
//   1. tick: run the clock's steps; each step ticks every scene allowed to tick, in layer order.
//   2. draw: clear, draw every scene allowed to draw in layer order, then the fade.
//   3. apply the queued scene changes in request order; activate scenes whose load finished.
//   4. advance the fade; swap the main scene when it reaches its midpoint.
// Requests made at any time (including from scene hooks) only take effect in step 3
// (or 4 for the fade swap), never mid-frame.
//
// No three.js import here: tests pass a fake renderer ({ clear(), clearDepth() }) and fake scenes.

import { advanceClock, clampFrame, createClock } from './clock.js';
import { callHook, createRecord, drawOrder, isLeaveMode, setLife, shouldDraw, shouldTick } from './scene.js';
import { advanceTransition, createTransition, markSwapped, swapDue, transitionAlpha, transitionDone } from './transition.js';

const NO_INPUTS = Object.freeze({});
const PLAY_MODES = ['local', 'online'];

export function createHarness({
  renderer,
  playMode = 'local',
  clock = createClock(),
  drawTransition = () => {},
  now = () => performance.now(),
  loadingScene = null, // id of the scene shown in the main slot while the main scene loads
} = {}) {
  const records = new Map();
  const layers = { background: [], main: null, overlays: [] };
  const queue = [];
  const view = { renderer, width: 1, height: 1 };

  const harness = {
    clock,
    records,
    layers,
    view,
    playMode,
    loadingScene,
    transition: null,
    standIn: null, // id drawn in the main slot this frame in place of a loading main scene
    frames: 0,
    lastFrameSeconds: 0,
    lastSteps: 0,
    lastWorkMs: 0, // time spent inside frame()
    lastLongFrame: null, // { frameSeconds, steps } of the last frame longer than clock.maxFrame
    register,
    setSize,
    frame,
    // Requests (queued, applied at the end of a frame):
    setMain,
    bring,
    openOverlay,
    closeOverlay,
    addBackground,
    leave,
    preload,
    setPlayMode,
  };

  function get(id) {
    const record = records.get(id);
    if (!record) throw new Error(`harness: unknown scene '${id}'`);
    return record;
  }

  function register(id, scene) {
    if (records.has(id)) throw new Error(`harness: scene '${id}' is already registered`);
    records.set(id, createRecord(id, scene));
  }

  function setSize(width, height) {
    view.width = width;
    view.height = height;
  }

  function request(type, args) {
    if (args.id !== undefined) get(args.id);
    queue.push({ type, ...args });
  }

  // `params` go to enter() when the scene starts fresh; when omitted, the
  // params it was last entered with are used. `fade` is the fade duration in seconds.
  function setMain(id, { params, fade = 0 } = {}) {
    request('setMain', { id, params, fade });
  }

  // Returns a left scene to the main slot; the current main scene leaves per its own setting.
  function bring(id, { fade = 0 } = {}) {
    request('setMain', { id, params: undefined, fade });
  }

  function openOverlay(id) {
    request('openOverlay', { id });
  }

  function closeOverlay(id) {
    request('closeOverlay', { id });
  }

  function addBackground(id) {
    request('addBackground', { id });
  }

  // Removes a scene from its layer, by `mode` or the scene's own leave setting.
  function leave(id, mode) {
    if (mode !== undefined && !isLeaveMode(mode)) throw new Error(`harness: unknown leave mode '${mode}'`);
    request('leave', { id, mode });
  }

  // Starts loading a scene without placing it in a layer.
  function preload(id) {
    request('preload', { id });
  }

  function setPlayMode(mode) {
    if (!PLAY_MODES.includes(mode)) throw new Error(`harness: unknown play mode '${mode}'`);
    request('setPlayMode', { mode });
  }

  // --- applying changes (only called at the end of a frame) ---

  function apply(req) {
    const record = req.id === undefined ? null : get(req.id);
    switch (req.type) {
      case 'setMain':
        if (req.fade > 0) {
          const fromAlpha = harness.transition ? transitionAlpha(harness.transition) : 0;
          harness.transition = createTransition({ duration: req.fade, to: req.id, params: req.params, fromAlpha });
        } else {
          harness.transition = null;
          showMain(record, req.params);
        }
        break;
      case 'openOverlay':
        if (record.layer !== 'overlay') {
          place(record, 'overlay');
          layers.overlays.push(record.id);
        }
        break;
      case 'addBackground':
        if (record.layer !== 'background') {
          place(record, 'background');
          layers.background.push(record.id);
        }
        break;
      case 'closeOverlay':
        if (record.layer === 'overlay') leaveLayer(record);
        break;
      case 'leave':
        leaveLayer(record, req.mode);
        break;
      case 'preload':
        if (record.life === 'unloaded') startLoad(record);
        break;
      case 'setPlayMode':
        harness.playMode = req.mode;
        break;
      default:
        throw new Error(`harness: unknown request '${req.type}'`);
    }
  }

  function showMain(record, params) {
    if (layers.main === record.id) return;
    if (layers.main !== null) leaveLayer(get(layers.main));
    place(record, 'main', params);
    layers.main = record.id;
  }

  // Sets the record's layer and makes it active, or starts its load; a scene
  // still loading is activated at the end of the frame in which its load finished.
  function place(record, layer, params) {
    if (record.layer !== null) throw new Error(`harness: scene '${record.id}' is already in the ${record.layer} layer`);
    record.layer = layer;
    if (params !== undefined) record.params = params;
    if (record.life === 'unloaded') startLoad(record);
    else if (record.life === 'ready' || record.life === 'suspended') activate(record);
  }

  function startLoad(record) {
    setLife(record, 'loading');
    record.loaded = Promise.resolve()
      .then(() => callHook(record, 'load'))
      .then(
        () => setLife(record, 'ready'),
        (error) => {
          record.error = error;
          throw error; // stays unhandled, so it shows in the console
        },
      );
  }

  function activate(record) {
    if (record.life === 'suspended') {
      callHook(record, 'resume');
      record.returnedState = JSON.stringify(record.state);
    } else if (record.saved !== null) {
      // Returning from a snapshot leave: load() has rebuilt the three.js objects.
      record.state = record.saved;
      record.saved = null;
      callHook(record, 'resume');
      record.returnedState = JSON.stringify(record.state);
    } else {
      record.state = callHook(record, 'enter', record.params) ?? null;
      record.returnedState = null;
    }
    setLife(record, 'active');
  }

  // A scene left while still loading finishes loading and waits in 'ready'.
  function leaveLayer(record, mode = record.settings.leave) {
    if (record.layer === 'main') layers.main = null;
    if (record.layer === 'background') layers.background.splice(layers.background.indexOf(record.id), 1);
    if (record.layer === 'overlay') layers.overlays.splice(layers.overlays.indexOf(record.id), 1);
    record.layer = null;
    record.left = mode;
    const { life } = record;
    if (mode === 'suspend') {
      if (life === 'active') {
        record.leftState = JSON.stringify(record.state);
        callHook(record, 'suspend');
        setLife(record, 'suspended');
      }
      return;
    }
    if (life === 'unloaded' || life === 'loading') return;
    if (mode === 'snapshot' && record.state !== null) {
      record.saved = structuredClone(record.state);
      record.leftState = JSON.stringify(record.state);
    }
    if (mode === 'unload') record.saved = null;
    if (life === 'active' || life === 'suspended') callHook(record, 'exit');
    callHook(record, 'unload');
    record.state = null;
    setLife(record, 'unloaded');
  }

  function activateLoaded() {
    for (const record of records.values()) {
      if (record.life === 'ready' && (record.layer !== null || record.id === harness.loadingScene)) activate(record);
    }
  }

  // The scene drawn in the main slot: the main scene when active, otherwise the
  // loading scene while the main scene loads, otherwise null.
  function shownMain() {
    if (layers.main === null) return null;
    if (get(layers.main).life === 'active') return layers.main;
    const loading = harness.loadingScene === null ? null : get(harness.loadingScene);
    return loading?.life === 'active' ? loading.id : null;
  }

  function frame(frameSeconds) {
    const started = now();
    harness.frames += 1;

    // 1. tick
    const steps = advanceClock(clock, frameSeconds);
    harness.lastFrameSeconds = frameSeconds;
    harness.lastSteps = steps;
    if (frameSeconds > clock.maxFrame) harness.lastLongFrame = { frameSeconds, steps };
    const mainId = shownMain();
    harness.standIn = mainId !== layers.main ? mainId : null;
    const order = drawOrder(layers, mainId).map((entry) => ({ ...entry, record: get(entry.id) }));
    const ticking = order.filter((e) => shouldTick(e.record, e.layer, e.covered, harness.playMode));
    for (let i = 0; i < steps; i++) {
      for (const { record } of ticking) {
        record.state = callHook(record, 'tick', record.state, NO_INPUTS, clock.step) ?? record.state;
      }
    }

    // 2. draw
    renderer.clear();
    let drawn = 0;
    for (const { record, covered } of order) {
      if (!shouldDraw(record, covered)) continue;
      if (drawn > 0) renderer.clearDepth();
      callHook(record, 'draw', record.state, view);
      drawn += 1;
    }
    if (harness.transition) drawTransition(transitionAlpha(harness.transition));

    // 3. queued changes, in request order; requests made while applying wait for the next frame
    for (const req of queue.splice(0)) apply(req);
    activateLoaded();

    // 4. fade
    if (harness.transition) {
      const mainWaiting = () => layers.main !== null && shownMain() === null;
      let tr = harness.transition;
      tr = advanceTransition(tr, clampFrame(clock, frameSeconds), tr.swapped && mainWaiting());
      if (swapDue(tr)) {
        showMain(get(tr.to), tr.params);
        tr = markSwapped(tr);
        if (mainWaiting()) tr = advanceTransition(tr, 0, true);
      }
      harness.transition = transitionDone(tr) ? null : tr;
    }

    harness.lastWorkMs = now() - started;
  }

  return harness;
}
