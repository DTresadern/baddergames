import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HISTORY_CAP, createInputHistory, reconcile } from '../src/net/prediction.js';
import { loadGridMap } from '../src/world/grid-map.js';
import { createPlayer, stepPlayer } from '../src/world/player.js';
import { frame } from './frames.js';
import { STEP } from './fakes.js';

const map = loadGridMap(JSON.parse(readFileSync(new URL('../public/content/maps/walkway.json', import.meta.url), 'utf8')));
const spawn = map.spawns.find((s) => s.type === 'player');
const step = (p, f) => stepPlayer(p, f, map.tiles, STEP);
const inputs = (n) => Array.from({ length: n }, (_, i) => frame(i % 20 === 5 ? ['moveRight', 'jump'] : i < 40 ? ['moveRight'] : []));

test('reconcile: equals the straight simulation when the host agrees', () => {
  const frames = inputs(60);
  const history = createInputHistory();
  const straight = createPlayer(spawn.x + 0.5, spawn.y);
  const host = createPlayer(spawn.x + 0.5, spawn.y);
  frames.forEach((f, i) => {
    history.record(i + 1, f);
    step(straight, f);
    if (i < 30) step(host, f); // the host has applied ticks 1..30
  });
  const result = reconcile(host, history.after(30), step);
  assert.deepEqual(result, straight);
  assert.notEqual(result, host);
  assert.equal(host.x < straight.x, true, 'the confirmed player is not changed');
});

test('reconcile: corrects to the host position and replays the later inputs', () => {
  const frames = inputs(30);
  const history = createInputHistory();
  frames.forEach((f, i) => history.record(i + 1, f));
  // The host says: at tick 20 the player was 3 tiles further right than we thought.
  const host = createPlayer(spawn.x + 0.5, spawn.y);
  for (const f of frames.slice(0, 20)) step(host, f);
  host.x += 3;
  const expected = structuredClone(host);
  for (const f of frames.slice(20)) step(expected, f);
  assert.deepEqual(reconcile(host, history.after(20), step), expected);
});

test('input history: oldest first, capped, drop by ack', () => {
  const history = createInputHistory();
  for (let t = 1; t <= HISTORY_CAP + 10; t++) history.record(t, frame());
  assert.equal(HISTORY_CAP, 120);
  assert.equal(history.size(), 120);
  assert.equal(history.after(0)[0].tick, 11);
  assert.deepEqual(history.after(127).map((e) => e.tick), [128, 129, 130]);
  history.drop(125);
  assert.equal(history.size(), 5);
  assert.equal(history.after(-1)[0].tick, 126);
});
