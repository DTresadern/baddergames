import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDevices, moveMouse, press, release, setSurface } from '../src/input/devices.js';
import { createInput, sampleInput, setAimOrigin } from '../src/input/sampler.js';
import { initBackdrop, tickBackdrop } from '../src/scenes/backdrop.js';
import { initLoading, tickLoading } from '../src/scenes/loading.js';
import { initPause, tickPause } from '../src/scenes/pause.js';
import { ARENA, RADIUS, SPEED, initPlayers, tickPlayers } from '../src/scenes/players.js';
import { initSceneA, tickSceneA } from '../src/scenes/scene-a.js';
import { initSceneB, tickSceneB } from '../src/scenes/scene-b.js';
import { initSlow, tickSlow } from '../src/scenes/slow.js';

const SIMS = {
  backdrop: [initBackdrop, tickBackdrop],
  sceneA: [initSceneA, tickSceneA],
  sceneB: [initSceneB, tickSceneB],
  pause: [initPause, tickPause],
  slow: [initSlow, tickSlow],
  loading: [initLoading, tickLoading],
  players: [initPlayers, tickPlayers],
};

const NO_INPUTS = Object.freeze([]);

function run(init, tick, n) {
  let state = init();
  for (let i = 0; i < n; i++) state = tick(state, NO_INPUTS, 1 / 60);
  return state;
}

for (const [name, [init, tick]] of Object.entries(SIMS)) {
  test(`${name}: state is plain data after ticking`, () => {
    for (const n of [0, 1, 600, 3600]) {
      const state = run(init, tick, n);
      assert.equal(state.ticks, n);
      assert.deepStrictEqual(structuredClone(state), state);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
    }
  });

  test(`${name}: simulation is repeatable`, () => {
    assert.deepStrictEqual(run(init, tick, 1000), run(init, tick, 1000));
  });

  test(`${name}: ticking a snapshot continues identically`, () => {
    const state = run(init, tick, 300);
    let copy = structuredClone(state);
    let original = state;
    for (let i = 0; i < 300; i++) {
      original = tick(original, NO_INPUTS, 1 / 60);
      copy = tick(copy, NO_INPUTS, 1 / 60);
    }
    assert.deepStrictEqual(copy, original);
  });
}

test('sceneB: balls stay inside the box', () => {
  let state = initSceneB();
  for (let i = 0; i < 5000; i++) {
    state = tickSceneB(state);
    for (const ball of state.balls) {
      assert.ok(Number.isInteger(ball.x) && Number.isInteger(ball.y));
      assert.ok(Math.abs(ball.x) <= 1600 && ball.y >= -900 && ball.y < 1200);
    }
  }
});

// Players scene with real input frames from the sampler and fake devices.
function playersRig() {
  const devices = createDevices();
  setSurface(devices, 800, 600);
  const input = createInput();
  let state = initPlayers();
  return {
    devices,
    input,
    get state() {
      return state;
    },
    tick(pads = [], n = 1) {
      for (let i = 0; i < n; i++) state = tickPlayers(state, sampleInput(input, devices, pads), 1 / 60);
      return state;
    },
  };
}

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);

test('players: move actions move the marker at 3 units/s, diagonals normalised', () => {
  const rig = playersRig();
  const start = { ...rig.state.players[0] };
  press(rig.devices, 'key:KeyD');
  rig.tick([], 60);
  const p1 = rig.state.players[0];
  assert.equal(p1.connected, true);
  close(p1.x, start.x + SPEED, 'right for 1 s');
  close(p1.y, 0, 'no vertical move');
  press(rig.devices, 'key:KeyW');
  rig.tick([], 60);
  close(p1.x, start.x + SPEED + SPEED * Math.SQRT1_2, 'diagonal x');
  close(p1.y, SPEED * Math.SQRT1_2, 'diagonal y');
  release(rig.devices, 'key:KeyD');
  release(rig.devices, 'key:KeyW');
  press(rig.devices, 'key:ArrowLeft');
  press(rig.devices, 'key:KeyD'); // left and right cancel
  const x = p1.x;
  rig.tick([], 10);
  close(p1.x, x, 'opposite keys');
});

test('players: markers stay inside the arena', () => {
  const rig = playersRig();
  press(rig.devices, 'key:KeyA');
  press(rig.devices, 'key:KeyS');
  rig.tick([], 600);
  const p1 = rig.state.players[0];
  assert.equal(p1.x, -(ARENA.halfWidth - RADIUS));
  assert.equal(p1.y, -(ARENA.halfHeight - RADIUS));
});

test('players: aim is copied from the frame; jump and fire presses are counted', () => {
  const rig = playersRig();
  setAimOrigin(rig.input, 0, 100, 100);
  moveMouse(rig.devices, 100, 0); // straight up from the origin
  press(rig.devices, 'key:Space');
  release(rig.devices, 'key:Space');
  press(rig.devices, 'mouse:0');
  rig.tick();
  const p1 = rig.state.players[0];
  assert.equal(p1.aim, Math.PI / 2);
  assert.equal(p1.jumps, 1);
  assert.equal(p1.fires, 1);
  assert.equal(p1.firing, true);
  rig.tick([], 5);
  assert.equal(p1.jumps, 1);
  assert.equal(p1.fires, 1);
  assert.equal(p1.jumping, false);
});

test('players: player 2 is connected and moves only while a gamepad is there', () => {
  const rig = playersRig();
  rig.tick();
  assert.equal(rig.state.players[1].connected, false);
  const pad = {
    index: 0,
    id: 'Pad',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [-1, 0, 0, 1], // left stick left, right stick down
  };
  rig.tick([pad], 30);
  const p2 = rig.state.players[1];
  assert.equal(p2.connected, true);
  close(p2.x, 2 - SPEED / 2, 'left for 0.5 s');
  assert.equal(p2.aim, -Math.PI / 2);
  rig.tick([]);
  assert.equal(p2.connected, false);
});
