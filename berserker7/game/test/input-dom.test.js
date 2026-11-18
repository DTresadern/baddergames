// attachInput with fake window and canvas (Node's EventTarget), no browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORAGE_KEY } from '../src/input/bindings.js';
import { attachInput } from '../src/input/dom.js';

function fakePage({ pads = [], storage } = {}) {
  const win = new EventTarget();
  win.document = new EventTarget();
  win.document.visibilityState = 'visible';
  win.navigator = { getGamepads: () => pads };
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
  const attached = attachInput({ window: win, canvas, storage });
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

test('dom: bindings come from storage; detach removes the listeners', () => {
  const storage = { getItem: (key) => (key === STORAGE_KEY ? '{"keyboardMouse":{"jump":["key:KeyJ"]}}' : null) };
  const { win, attached } = fakePage({ storage });
  send(win, 'keydown', { code: 'KeyJ' });
  assert.equal(attached.sample()[0].actions.jump.pressed, true);
  attached.detach();
  send(win, 'keydown', { code: 'KeyD' });
  assert.equal(attached.sample()[0].actions.moveRight.held, false);
});
