import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { depthRowsText } from '../tools/levels/depth-rows-test.mjs';
import { loadMap } from '../src/world/load-map.js';
import { createPlayer } from '../src/world/player.js';
import { findLanding, floorBelow } from '../src/world/rows.js';

const text = readFileSync(new URL('../public/content/maps/depth-rows-test.json', import.meta.url), 'utf8');

test('depth-rows-test.json: the committed map equals the generator output', () => {
  assert.equal(text, depthRowsText());
});

test('depth-rows-test.json: loads with rows -1, 0, +1 and six transfer zones; every listed switch finds a landing', () => {
  const map = loadMap(JSON.parse(text));
  assert.deepEqual([...map.rows.keys()].sort((a, b) => a - b), [-1, 0, 1]);
  assert.equal(map.transfers.length, 6);
  // Per zone: [floor top on the high row, floor top on the low row] (the layout in the generator).
  const tops = [[0, -2], [0, -2], [2, 0], [2, 0], [0, -3], [0, -3]];
  map.transfers.forEach((zone, i) => {
    const [highTop, lowTop] = tops[i];
    for (let x = zone.x0; x <= zone.x1; x++) {
      const at = (row, y) => Object.assign(createPlayer(x + 0.5, y, map.player), { row });
      const high = at(zone.high, highTop);
      assert.equal(floorBelow(map.rows.get(zone.high), high), highTop, `zone ${i} x ${x}: high floor`);
      assert.equal(findLanding(map.rows.get(zone.low), high, highTop, 'descend'), lowTop, `zone ${i} x ${x}: descend`);
      const low = at(zone.low, lowTop);
      assert.equal(floorBelow(map.rows.get(zone.low), low), lowTop, `zone ${i} x ${x}: low floor`);
      assert.equal(findLanding(map.rows.get(zone.high), low, lowTop, 'ascend'), highTop, `zone ${i} x ${x}: ascend`);
    }
  });
});
