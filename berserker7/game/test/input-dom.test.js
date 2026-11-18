// attachInput with fake window and canvas (Node's EventTarget), no browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachInput } from '../src/input/dom.js';

function fakePage({ pads = [], bindings, userActivation } = {}) {
  const win = new EventTarget();
  win.document = new EventTarget();
  win.document.visibilityState = 'visible';
  win.navigator = { getGamepads: () => pads, ...(userActivation && { userActivation }) };
  const canvas = new EventTarget();
  canvas.rect = { left: 10, top: 20, width: 800, height: 600 };
  canvas.getBoundingClientRect = () => canvas.rect;
  const attached = attachInput({ window: win, canvas, bindings });
  return { win, canvas, attached };
}

// Dispatches an event with extra fields; `target` overrides event.target for the listeners.
function send(on, type, fields = {}, target) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  if (target) Object.defineProperty(event, 'target', { value: target });
  on.dispatchEvent(event);
  return event;
}

test('dom: keys press and release actions; Space and arrows do not scroll; text fields are left alone', () => {
  const { win, attached } = fakePage();
  const down = send(win, 'keydown', { code: 'Space' });
  assert.equal(down.defaultPrevented, true);
  assert.equal(send(win, 'keydown', { code: 'KeyD' }).defaultPrevented, false);
  let [p1] = attached.sample();
  assert.equal(p1.actions.jump.pressed, true);
  assert.equal(p1.actions.moveRight.held, true);

  send(win, 'keydown', { code: 'KeyE' }, { tagName: 'INPUT' });
  const typed = send(win, 'keydown', { code: 'Space' }, { tagName: 'DIV', isContentEditable: true });
  assert.equal(typed.defaultPrevented, false);
  // keyup in a text field still releases a key held in the game
  send(win, 'keyup', { code: 'KeyD' }, { tagName: 'TEXTAREA' });
  [p1] = attached.sample();
  assert.equal(p1.actions.interact.held, false);
  assert.equal(p1.actions.moveRight.released, true);
  assert.equal(send(win, 'keyup', { code: 'Space' }).defaultPrevented, true);
});

test('dom: blur and a hidden tab release everything', () => {
  const { win, attached } = fakePage();
  send(win, 'keydown', { code: 'KeyA' });
  attached.sample();
  send(win, 'blur');
  assert.equal(attached.sample()[0].actions.moveLeft.released, true);
  send(win, 'keydown', { code: 'KeyA' });
  attached.sample();
  win.document.visibilityState = 'hidden';
  send(win.document, 'visibilitychange');
  assert.equal(attached.sample()[0].actions.moveLeft.released, true);
});

test('dom: mouse buttons, side buttons, context menu, position and wheel', () => {
  const { win, canvas, attached } = fakePage();
  assert.equal(send(canvas, 'mousedown', { button: 2 }).defaultPrevented, true);
  assert.equal(send(canvas, 'contextmenu').defaultPrevented, true);
  send(win, 'mousemove', { clientX: 410, clientY: 120 }); // (400, 100) on the canvas: straight up from its centre
  assert.equal(send(canvas, 'wheel', { deltaY: 120, deltaMode: 0 }).defaultPrevented, true);
  let [p1] = attached.sample();
  assert.equal(p1.actions.secondaryFire.pressed, true);
  assert.equal(p1.aim, Math.PI / 2);
  assert.equal(p1.wheel, 1);
  assert.equal(p1.actions.nextWeapon.pressed, true);

  send(win, 'mouseup', { button: 2 });
  assert.equal(send(win, 'mouseup', { button: 3 }).defaultPrevented, true);
  assert.equal(send(win, 'auxclick', { button: 4 }).defaultPrevented, true);
  assert.equal(send(win, 'auxclick', { button: 1 }).defaultPrevented, false);
  [p1] = attached.sample();
  assert.equal(p1.actions.secondaryFire.released, true);

  attached.setAimOrigin(0, 400, 300);
  send(win, 'mousemove', { clientX: 10, clientY: 320 }); // (0, 300): left of the origin
  assert.equal(attached.sample()[0].aim, Math.PI);
});

test('dom: each sample reads the canvas size, so a resize needs no mouse move or event order', () => {
  const { win, canvas, attached } = fakePage();
  send(win, 'mousemove', { clientX: 410, clientY: 120 });
  let { pointer } = attached.sample()[0];
  assert.deepEqual([pointer.width, pointer.height], [800, 600]);
  canvas.rect = { left: 10, top: 20, width: 500, height: 400 }; // the renderer resized the canvas
  ({ pointer } = attached.sample()[0]);
  assert.deepEqual([pointer.width, pointer.height], [500, 400]);
});

test('dom: gamepads are polled each sample; null entries and a missing API are fine', () => {
  const pad = {
    index: 0,
    id: 'Pad',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 9, value: i === 9 ? 1 : 0 })),
    axes: [0, 0, 0, 0],
  };
  const pads = [null, null];
  const { win, attached } = fakePage({ pads });
  assert.equal(attached.sample()[1].connected, false);
  pads[1] = { ...pad, index: 1 };
  const p2 = attached.sample()[1];
  assert.equal(p2.connected, true);
  assert.equal(p2.actions.pause.pressed, true);
  send(win, 'gamepadconnected', { gamepad: pads[1] });
  assert.deepEqual(attached.debug.lastPadEvent, { type: 'gamepadconnected', index: 1, id: 'Pad' });

  const bare = new EventTarget();
  bare.document = null;
  bare.navigator = {};
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  const noPads = attachInput({ window: bare, canvas });
  assert.equal(noPads.sample()[1].connected, false);
});

test('dom: bindings overrides are applied over the defaults; detach removes the listeners', () => {
  const { win, attached } = fakePage({ bindings: { keyboardMouse: { jump: ['key:KeyJ'] } } });
  send(win, 'keydown', { code: 'KeyJ' });
  assert.equal(attached.sample()[0].actions.jump.pressed, true);
  attached.detach();
  send(win, 'keydown', { code: 'KeyD' });
  assert.equal(attached.sample()[0].actions.moveRight.held, false);
});

const activated = (attached) => attached.sample()[0].activated;

test('dom activation: a keydown sets it for exactly one tick; Escape, key repeat and text fields do not', () => {
  const { win, attached } = fakePage();
  assert.equal(activated(attached), false);
  send(win, 'keydown', { code: 'KeyA', key: 'a' });
  assert.equal(activated(attached), true);
  assert.equal(activated(attached), false, 'one tick only, though the key is still down');
  send(win, 'keydown', { code: 'KeyA', key: 'a', repeat: true });
  assert.equal(activated(attached), false, 'key repeat');
  send(win, 'keydown', { code: 'Escape', key: 'Escape' });
  const [p1] = attached.sample();
  assert.equal(p1.activated, false, 'Escape');
  assert.equal(p1.actions.pause.pressed, true, 'Escape still presses pause');
  send(win, 'keydown', { code: 'KeyB', key: 'b' }, { tagName: 'INPUT' });
  assert.equal(activated(attached), false, 'typed into a text field');
  send(win, 'keydown', { code: 'KeyC', key: 'c' });
  send(win, 'keydown', { code: 'KeyD', key: 'd' });
  assert.equal(activated(attached), true, 'two presses in one tick');
  assert.equal(activated(attached), false);
});

test('dom activation: mousedown and touch lifts on the canvas set it; a mouse pointerup and a mouse move do not', () => {
  const { win, canvas, attached } = fakePage();
  send(canvas, 'mousedown', { button: 0 });
  assert.equal(activated(attached), true, 'mousedown');
  send(win, 'mouseup', { button: 0 });
  send(canvas, 'pointerup', { pointerType: 'mouse' });
  assert.equal(activated(attached), false, 'pointerup from a mouse');
  send(win, 'mousemove', { clientX: 50, clientY: 60 });
  assert.equal(activated(attached), false, 'mouse move');
  for (const pointerType of ['touch', 'pen']) {
    const lift = send(canvas, 'pointerup', { pointerType });
    assert.equal(lift.defaultPrevented, false);
    assert.equal(activated(attached), true, `pointerup from ${pointerType}`);
  }
  send(canvas, 'touchend');
  assert.equal(activated(attached), true, 'touchend');
  send(canvas, 'pointerdown', { pointerType: 'touch' });
  send(canvas, 'touchstart');
  assert.equal(activated(attached), false, 'a touch only counts on lift');
});

test('dom activation: navigator.userActivation.isActive must be true inside the listener', () => {
  const userActivation = { isActive: false };
  const { win, canvas, attached } = fakePage({ userActivation });
  send(win, 'keydown', { code: 'KeyA', key: 'a' });
  send(canvas, 'mousedown', { button: 0 });
  send(canvas, 'touchend');
  const [p1] = attached.sample();
  assert.equal(p1.activated, false);
  assert.equal(p1.actions.primaryFire.pressed, true, 'the press itself still counts');
  userActivation.isActive = true;
  send(win, 'keydown', { code: 'KeyS', key: 's' });
  assert.equal(activated(attached), true);
});

test('dom activation: gamepad presses never set it; a gamepad-only player is always false', () => {
  const pads = [{
    index: 0,
    id: 'Pad',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: true, value: 1 })),
    axes: [0, 0, 0, 0],
  }];
  const { win, attached } = fakePage({ pads });
  let [p1, p2] = attached.sample();
  assert.equal(p2.actions.jump.pressed, true);
  assert.equal(p2.activated, false);
  assert.equal(p1.activated, false);
  send(win, 'keydown', { code: 'KeyA', key: 'a' });
  [p1, p2] = attached.sample();
  assert.equal(p1.activated, true);
  assert.equal(p2.activated, false, 'player 2 is on the gamepad only');
});
