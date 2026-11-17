import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, harnessWith, settle, STEP, ticksOf } from './fakes.js';

test('requests made before and during a frame apply at its end, in request order', async () => {
  let harness;
  let armed = false;
  const seen = [];
  const setup = harnessWith([
    ['main', {}, {
      tick: (s) => {
        if (armed) harness.leave('bg1', 'suspend');
        return { ...s, ticks: s.ticks + 1 };
      },
      draw: () => {
        if (!armed) return;
        seen.push([...harness.layers.background]);
        harness.leave('bg2', 'suspend');
        setup.log.push('main.draw');
      },
    }],
    ['bg1', { tick: 'always' }],
    ['bg2', { tick: 'always' }],
    ['bg3', { tick: 'always' }],
  ]);
  harness = setup.harness;
  const { log } = setup;
  for (const id of ['bg1', 'bg2', 'bg3']) harness.addBackground(id);
  await settle(harness);
  harness.setMain('main');
  await settle(harness);
  log.length = 0;
  armed = true;

  harness.leave('bg3', 'suspend');
  harness.frame(STEP);
  // during the frame nothing had changed yet
  assert.deepEqual(seen, [['bg1', 'bg2', 'bg3']]);
  assert.deepEqual(log.filter((e) => e.endsWith('.suspend')), ['bg3.suspend', 'bg1.suspend', 'bg2.suspend']);
  assert.ok(log.indexOf('main.draw') < log.indexOf('bg3.suspend'));
  assert.deepEqual(harness.layers.background, []);
});

test('requests made while changes are applied wait for the next frame', async () => {
  let harness;
  const setup = harnessWith([
    ['main', {}, {
      enter: () => {
        harness.openOverlay('over');
        return { ticks: 0 };
      },
    }],
    ['over'],
  ]);
  harness = setup.harness;
  harness.setMain('main');
  harness.frame(0); // starts the load
  await harness.records.get('main').loaded;
  harness.frame(0); // activates main; enter() requests the overlay
  assert.equal(harness.records.get('main').life, 'active');
  assert.deepEqual(harness.layers.overlays, []);
  harness.frame(0);
  assert.deepEqual(harness.layers.overlays, ['over']);
});

test('scenes that are not active are not ticked or drawn', async () => {
  const gate = deferred();
  const { harness, log } = harnessWith([['main', { tick: 'always' }, { load: () => gate.promise }]]);
  harness.setMain('main');
  harness.frame(STEP);
  harness.frame(STEP);
  assert.equal(harness.records.get('main').life, 'loading');
  assert.equal(log.includes('main.draw'), false);
  assert.equal(ticksOf(harness, 'main'), undefined);
  gate.resolve();
  await harness.records.get('main').loaded;
  assert.equal(harness.records.get('main').life, 'ready');
  harness.frame(STEP); // activated at the end of this frame, not ticked or drawn in it
  assert.equal(harness.records.get('main').life, 'active');
  assert.equal(ticksOf(harness, 'main'), 0);
  assert.equal(log.includes('main.draw'), false);
  harness.frame(STEP);
  assert.equal(ticksOf(harness, 'main'), 1);
  assert.ok(log.includes('main.draw'));
});

test('suspend keeps the state; resume continues with the same state and tick count', async () => {
  const { harness, log } = harnessWith([['a'], ['b']]);
  harness.setMain('a', { params: { level: 1 } });
  await settle(harness);
  for (let i = 0; i < 10; i++) harness.frame(STEP);
  const before = harness.records.get('a').state;
  assert.equal(before.ticks, 10);

  harness.leave('a', 'suspend');
  harness.frame(STEP); // a ticks this frame, then is suspended at its end
  const kept = harness.records.get('a').state;
  assert.equal(harness.records.get('a').life, 'suspended');
  assert.equal(kept.ticks, 11);
  for (let i = 0; i < 10; i++) harness.frame(STEP);
  assert.equal(harness.records.get('a').state, kept);
  assert.equal(kept.ticks, 11);

  harness.setMain('a');
  harness.frame(STEP);
  assert.equal(harness.records.get('a').life, 'active');
  assert.equal(harness.records.get('a').state, kept);
  assert.deepEqual(log.filter((e) => e.startsWith('a.') && e !== 'a.draw'), ['a.load', 'a.enter', 'a.suspend', 'a.resume']);
  assert.equal(harness.records.get('a').leftState, harness.records.get('a').returnedState);
  harness.frame(STEP);
  assert.equal(ticksOf(harness, 'a'), 12);
});

test('unload drops the state; coming back loads and enters fresh with the same params', async () => {
  const { harness, log } = harnessWith([['a']]);
  harness.setMain('a', { params: { level: 3 } });
  await settle(harness);
  for (let i = 0; i < 5; i++) harness.frame(STEP);
  harness.leave('a', 'unload');
  harness.frame(0);
  const record = harness.records.get('a');
  assert.equal(record.life, 'unloaded');
  assert.equal(record.state, null);
  assert.equal(record.saved, null);
  assert.deepEqual(log.slice(-2), ['a.exit', 'a.unload']);

  harness.setMain('a');
  await settle(harness);
  assert.equal(record.life, 'active');
  assert.deepEqual(record.state, { ticks: 0, params: { level: 3 } });
  assert.deepEqual(log.filter((e) => e === 'a.load' || e === 'a.enter'), ['a.load', 'a.enter', 'a.load', 'a.enter']);
});

test('snapshot keeps a copy of the state, unloads, and restores the identical state', async () => {
  let enters = 0;
  const { harness, log } = harnessWith([['b', {}, {
    enter: () => {
      enters += 1;
      return { ticks: 0, balls: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
    },
    tick: (s) => ({ ticks: s.ticks + 1, balls: s.balls.map((b) => ({ x: b.x + 1, y: b.y - 1 })) }),
  }]]);
  harness.setMain('b');
  await settle(harness);
  for (let i = 0; i < 7; i++) harness.frame(STEP);
  harness.leave('b', 'snapshot');
  harness.frame(0);
  const record = harness.records.get('b');
  const live = JSON.parse(record.leftState);
  assert.equal(record.life, 'unloaded');
  assert.equal(record.state, null);
  assert.deepStrictEqual(record.saved, live);
  assert.deepEqual(log.slice(-2), ['b.exit', 'b.unload']);

  harness.setMain('b');
  await settle(harness);
  assert.equal(record.life, 'active');
  assert.equal(record.saved, null);
  assert.deepStrictEqual(record.state, live);
  assert.equal(record.returnedState, record.leftState);
  assert.equal(enters, 1); // restored, not entered again
  assert.equal(log.filter((e) => e === 'b.load').length, 2);
  assert.deepEqual(log.filter((e) => e !== 'b.draw').slice(-2), ['b.load', 'b.resume']);
});

test('a scene leaves by its own setting when none is given', async () => {
  const { harness } = harnessWith([['a', { leave: 'suspend' }], ['b', { leave: 'snapshot' }], ['c', { leave: 'unload' }]]);
  harness.setMain('a');
  await settle(harness);
  harness.setMain('b');
  await settle(harness);
  assert.equal(harness.records.get('a').life, 'suspended');
  harness.setMain('c');
  await settle(harness);
  assert.equal(harness.records.get('b').life, 'unloaded');
  assert.notEqual(harness.records.get('b').saved, null);
  harness.leave('c');
  harness.frame(0);
  assert.equal(harness.records.get('c').life, 'unloaded');
  assert.equal(harness.layers.main, null);
});

test('local pause stops the main scene; online pause does not; background ticks under pause', async () => {
  const { harness } = harnessWith([
    ['bg', { tick: 'always' }],
    ['main', { tick: 'uncovered' }],
    ['pause', { tick: 'always' }],
  ]);
  harness.addBackground('bg');
  harness.setMain('main');
  await settle(harness);
  harness.frame(STEP);
  assert.equal(ticksOf(harness, 'main'), 1);
  assert.equal(ticksOf(harness, 'bg'), 1);

  harness.openOverlay('pause');
  await settle(harness, STEP); // main and bg tick while the pause loads
  const mainAtPause = ticksOf(harness, 'main');
  const bgAtPause = ticksOf(harness, 'bg');
  const pauseAtStart = ticksOf(harness, 'pause');
  for (let i = 0; i < 5; i++) harness.frame(STEP);
  assert.equal(ticksOf(harness, 'main'), mainAtPause, 'local pause stops main');
  assert.equal(ticksOf(harness, 'bg'), bgAtPause + 5, 'background keeps ticking');
  assert.equal(ticksOf(harness, 'pause'), pauseAtStart + 5);

  harness.setPlayMode('online');
  harness.frame(STEP); // mode changes at the end of this frame
  for (let i = 0; i < 5; i++) harness.frame(STEP);
  assert.equal(ticksOf(harness, 'main'), mainAtPause + 5, 'online pause does not stop main');

  harness.setPlayMode('local');
  harness.closeOverlay('pause');
  harness.frame(STEP);
  assert.equal(harness.records.get('pause').life, 'suspended');
  harness.frame(STEP);
  assert.equal(ticksOf(harness, 'main'), mainAtPause + 7);
});

test('tick never, and drawCovered false', async () => {
  const { harness, log } = harnessWith([
    ['bg', { tick: 'never', drawCovered: false }],
    ['main', { drawCovered: true }],
  ]);
  harness.addBackground('bg');
  await settle(harness);
  log.length = 0;
  harness.frame(STEP);
  assert.equal(ticksOf(harness, 'bg'), 0);
  assert.deepEqual(log, ['bg.draw']);
  harness.setMain('main');
  await settle(harness);
  log.length = 0;
  harness.frame(STEP);
  assert.deepEqual(log, ['main.draw']); // bg is covered and does not draw when covered
});

test('the background keeps ticking through a main scene switch', async () => {
  const { harness } = harnessWith([['bg', { tick: 'always' }], ['a'], ['b']]);
  harness.addBackground('bg');
  harness.setMain('a');
  await settle(harness, STEP);
  const before = ticksOf(harness, 'bg');
  harness.setMain('b', { fade: 0.5 });
  for (let i = 0; i < 40; i++) harness.frame(STEP);
  assert.equal(harness.layers.main, 'b');
  assert.equal(ticksOf(harness, 'bg'), before + 40);
});

test('scenes draw in layer order with depth cleared between them', async () => {
  const log = [];
  const { harness } = harnessWith([['bg'], ['main'], ['o1'], ['o2']], {});
  harness.view.renderer.clear = () => log.push('clear');
  harness.view.renderer.clearDepth = () => log.push('clearDepth');
  for (const id of ['o1', 'o2']) {
    harness.records.get(id).scene.draw = () => log.push(id);
  }
  harness.records.get('bg').scene.draw = () => log.push('bg');
  harness.records.get('main').scene.draw = () => log.push('main');
  harness.openOverlay('o2');
  harness.addBackground('bg');
  harness.setMain('main');
  harness.openOverlay('o1');
  await settle(harness);
  log.length = 0;
  harness.frame(0);
  assert.deepEqual(log, ['clear', 'bg', 'clearDepth', 'main', 'clearDepth', 'o2', 'clearDepth', 'o1']);
});

test('a hook error is not swallowed', async () => {
  const { harness } = harnessWith([['a', {}, { tick: () => { throw new Error('boom'); } }]]);
  harness.setMain('a');
  await settle(harness);
  assert.throws(() => harness.frame(STEP), /boom/);
});

test('unknown scenes, modes and double placement are rejected', async () => {
  const { harness } = harnessWith([['a'], ['b']]);
  assert.throws(() => harness.setMain('zzz'), /unknown scene/);
  assert.throws(() => harness.leave('a', 'vanish'), /leave mode/);
  assert.throws(() => harness.setPlayMode('lan'), /play mode/);
  assert.throws(() => harness.register('a', {}), /already registered/);
  harness.addBackground('a');
  await settle(harness);
  harness.setMain('a');
  assert.throws(() => harness.frame(0), /already in the background layer/);
});

test('a frame records its steps; a long frame is capped at 8 steps', async () => {
  const { harness } = harnessWith([['a']]);
  harness.setMain('a');
  await settle(harness);
  harness.frame(STEP);
  assert.equal(harness.lastSteps, 1);
  const before = ticksOf(harness, 'a');
  harness.frame(1.2);
  assert.equal(harness.lastSteps, 8);
  assert.deepEqual(harness.lastLongFrame, { frameSeconds: 1.2, steps: 8 });
  assert.equal(ticksOf(harness, 'a'), before + 8);
});

test('a failed load leaves its layer, returns to unloaded, and a later request retries it', async () => {
  let fail = true;
  const load = () => {
    if (fail) throw new Error('load failed');
  };
  const { harness } = harnessWith([['a', {}, { load }]]);
  harness.setMain('a');
  harness.frame(0);
  const record = harness.records.get('a');
  await assert.rejects(record.loaded, /load failed/);
  harness.frame(0);
  assert.equal(record.life, 'unloaded');
  assert.equal(harness.layers.main, null);
  fail = false;
  harness.setMain('a');
  await settle(harness);
  assert.equal(record.life, 'active');
  assert.equal(record.error, null);
});

test('a scene left by unload while loading is unloaded when its load ends', async () => {
  const pending = deferred();
  const { harness, log } = harnessWith([
    ['a', {}],
    ['slow', { leave: 'unload' }, { load: () => pending.promise }],
  ]);
  harness.setMain('a');
  await settle(harness);
  harness.setMain('slow');
  harness.frame(0);
  harness.setMain('a');
  harness.frame(0);
  const record = harness.records.get('slow');
  assert.equal(record.life, 'loading');
  pending.resolve();
  await record.loaded;
  harness.frame(0);
  assert.equal(record.life, 'unloaded');
  assert.ok(log.includes('slow.unload'));
});

test('leaving by unload discards a saved snapshot', async () => {
  const { harness } = harnessWith([['b', { leave: 'snapshot' }]]);
  harness.setMain('b', { params: 'old' });
  await settle(harness);
  harness.leave('b');
  harness.frame(0);
  assert.notEqual(harness.records.get('b').saved, null);
  harness.leave('b', 'unload');
  harness.frame(0);
  assert.equal(harness.records.get('b').saved, null);
  harness.setMain('b', { params: 'new' });
  await settle(harness);
  assert.equal(harness.records.get('b').state.params, 'new');
});
