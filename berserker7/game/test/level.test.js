import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildLevel, mapText } from '../tools/build-level.mjs';
import { depthRowsTransfers } from '../tools/levels/depth-rows-test.mjs';
import { loadMap } from '../src/world/load-map.js';
import { createPlayer } from '../src/world/player.js';
import { fallPathClear, findLanding, floorBelow } from '../src/world/rows.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('level: the committed moge3-cyberpunk-blocks map is exactly the build output (npm run build:level)', () => {
  assert.equal(read('../public/content/maps/moge3-cyberpunk-blocks.json'), mapText(buildLevel()));
  const base = JSON.parse(read('../tools/moge3-cyberpunk-blocks.base.json'));
  const cells = new Set(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')).cells.map((c) => c.join(',')));
  assert.ok(base.cells.every((c) => cells.has(c.join(','))), 'every base cell is kept');
  // The sections' ATLAS is written as `atlas`, directly after `tile`.
  const keys = Object.keys(buildLevel());
  assert.equal(keys.indexOf('atlas'), keys.indexOf('tile') + 1);
  assert.equal(buildLevel().atlas, 'blocks-placeholder');
});

test('level: the depth rows part (x 151-297) is joined at the open end of G; its nine zones find their landings', () => {
  const map = loadMap(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')));
  // The old end wall at x 150 is gone; the roof at top 9 runs through it.
  for (let y = 9; y <= 15; y++) assert.equal(map.tiles.isSolid(150, y), false, `x 150 y ${y} is open`);
  assert.equal(map.tiles.isSolid(150, 8), true, 'x 150: roof, top 9');
  for (const row of [-1, 0, 1]) assert.ok(map.rows.has(row), `row ${row}`);
  assert.deepEqual(map.transfers, depthRowsTransfers(151));
  // Per zone: [floor top on the high row, floor top on the low row] (depth-rows-test tops + 9).
  const tops = [[9, 7], [9, 7], [11, 9], [11, 9], [9, 6], [9, 6], [12, 9], [14, 9], [12, 9]];
  const JUMP_TOP_REACH = 3.628; // jump top 2.428 + height 1.2
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
      // H (i 7) is out of reach even at the top of a jump.
      assert.equal(findLanding(map.rows.get(zone.high), low, lowTop, 'ascend', lowTop + JUMP_TOP_REACH), i === 7 ? null : highTop, `zone ${i} x ${x}: ascend`);
    }
  });
});
