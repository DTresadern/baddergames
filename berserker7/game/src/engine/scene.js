// Scene records, lifecycle, settings, and the pure decisions the harness makes
// each frame (which scenes are covered, which tick, which draw).

// unloaded -> loading -> ready -> active <-> suspended; any loaded state -> unloaded.
const NEXT_LIFE = {
  unloaded: ['loading'],
  loading: ['ready'],
  ready: ['active', 'unloaded'],
  active: ['suspended', 'unloaded'],
  suspended: ['active', 'unloaded'],
};

export const LIFE_STATES = Object.keys(NEXT_LIFE);

export function setLife(record, next) {
  if (!NEXT_LIFE[record.life]?.includes(next)) {
    throw new Error(`scene '${record.id}': illegal lifecycle change ${record.life} -> ${next}`);
  }
  record.life = next;
}

const CHOICES = {
  tick: ['always', 'uncovered', 'never'],
  leave: ['suspend', 'unload', 'snapshot'],
};

export const DEFAULT_SETTINGS = Object.freeze({ tick: 'uncovered', drawCovered: true, leave: 'suspend' });

export function readSettings(scene) {
  const settings = { ...DEFAULT_SETTINGS, ...scene.settings };
  for (const [name, allowed] of Object.entries(CHOICES)) {
    if (!allowed.includes(settings[name])) {
      throw new Error(`scene setting ${name}: '${settings[name]}' is not one of ${allowed.join(', ')}`);
    }
  }
  if (typeof settings.drawCovered !== 'boolean') throw new Error('scene setting drawCovered must be true or false');
  return Object.freeze(settings);
}

export function isLeaveMode(mode) {
  return CHOICES.leave.includes(mode);
}

export function createRecord(id, scene) {
  return {
    id,
    scene,
    settings: readSettings(scene),
    life: 'unloaded',
    layer: null, // 'background' | 'main' | 'overlay' | null
    state: null, // the scene's simulation state (plain data)
    params: undefined, // passed to enter(); kept for re-entering after an unload
    saved: null, // state kept by a snapshot leave
    loaded: null, // promise of the running or last load
    error: null, // the error a failed load() threw
    left: null, // how the scene last left its layer: 'suspend' | 'unload' | 'snapshot'
    leftState: null, // debug: JSON of the state when it left by suspend or snapshot
    returnedState: null, // debug: JSON of the state when it came back from suspend or snapshot
  };
}

// Calls a scene hook; a missing hook is a no-op. Errors are not caught.
export function callHook(record, name, ...args) {
  const hook = record.scene[name];
  return typeof hook === 'function' ? hook.call(record.scene, ...args) : undefined;
}

// Scenes in draw order with whether each is covered. `mainId` is the scene in
// the main slot (or the one standing in for it), or null. Background is covered
// by the main scene and overlays; main by overlays; each overlay by those above.
export function drawOrder(layers, mainId) {
  const top = layers.overlays.length;
  const list = layers.background.map((id) => ({ id, layer: 'background', covered: mainId !== null || top > 0 }));
  if (mainId !== null) list.push({ id: mainId, layer: 'main', covered: top > 0 });
  layers.overlays.forEach((id, i) => list.push({ id, layer: 'overlay', covered: i < top - 1 }));
  return list;
}

export function shouldTick(record, layer, covered, playMode) {
  if (record.life !== 'active') return false;
  const { tick } = record.settings;
  if (tick === 'never') return false;
  if (tick === 'always') return true;
  // Online play cannot be paused: overlays never count as covering the main scene.
  if (layer === 'main' && playMode === 'online') return true;
  return !covered;
}

export function shouldDraw(record, covered) {
  return record.life === 'active' && (!covered || record.settings.drawCovered);
}
