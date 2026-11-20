import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { depthRowsText } from '../tools/levels/depth-rows-test.mjs';
import { loadMap } from '../src/world/load-map.js';
import { createPlayer } from '../src/world/player.js';
import { fallPathClear, findLanding, floorBelow } from '../src/world/rows.js';

const JUMP_TOP_REACH = 3.628; // jump top 2.428 + height 1.2
const STAND_REACH = 1.2;

const text = readFileSync(new URL('../public/content/maps/depth-rows-test.json', import.meta.url), 'utf8');

test('depth-rows-test.json: the committed map equals the generator output', () => {
  assert.equal(text, depthRowsText());
});

test('depth-rows-test.json: loads with rows -1, 0, +1 and nine transfer zones; every listed switch finds a landing', () => {
  const map = loadMap(JSON.parse(text));
  assert.deepEqual([...map.rows.keys()].sort((a, b) => a - b), [-1, 0, 1]);
  assert.equal(map.transfers.length, 9);
  // Per zone: [floor top on the high row, floor top on the low row] (the layout in the generator).
  const tops = [[0, -2], [0, -2], [2, 0], [2, 0], [0, -3], [0, -3], [3, 0], [5, 0], [3, 0]];
  map.transfers.forEach((zone, i) => {
    const [highTop, lowTop] = tops[i];
    for (let x = zone.x0; x <= zone.x1; x++) {
      const at = (row, y) => Object.assign(createPlayer(x + 0.5, y, map.player), { row });
      const high = at(zone.high, highTop);
      assert.equal(floorBelow(map.rows.get(zone.high), high), highTop, `zone ${i} x ${x}: high floor`);
      assert.equal(findLanding(map.rows.get(zone.low), high, highTop, 'descend'), lowTop, `zone ${i} x ${x}: descend`);
      assert.equal(fallPathClear(map.rows.get(zone.low), high, lowTop), true, `zone ${i} x ${x}: fall path`);
      const low = at(zone.low, lowTop);
      assert.equal(floorBelow(map.rows.get(zone.low), low), lowTop, `zone ${i} x ${x}: low floor`);
      // Ascend with the reach at the top of a jump (3.628 above the feet); H's top 5 is out of reach.
      const expected = i === 7 ? null : highTop;
      assert.equal(findLanding(map.rows.get(zone.high), low, lowTop, 'ascend', lowTop + JUMP_TOP_REACH), expected, `zone ${i} x ${x}: ascend`);
      if (i >= 6) assert.equal(findLanding(map.rows.get(zone.high), low, lowTop, 'ascend', lowTop + STAND_REACH), null, `zone ${i} x ${x}: standing reach`);
    }
  });
});

test('depth-rows-test.json: the way out of the end: row -1 runs at top 5 from x 129 to 135 (wall 129, bridge, wall 135)', () => {
  const map = loadMap(JSON.parse(text));
  for (let x = 129; x <= 135; x++) {
    assert.equal(floorBelow(map.rows.get(-1), createPlayer(x + 0.5, 5, map.player)), 5, `x ${x}`);
    assert.equal(map.rows.get(-1).isSolid(x, 5) || map.rows.get(-1).isSolid(x, 6), false, `x ${x}: room above`);
  }
});
