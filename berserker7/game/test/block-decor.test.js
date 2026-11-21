import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DECOR, atlasLayout, atlasPools, blockTiles, decorTiles, hash3, pick } from '../src/scenes/block-decor.js';
import { loadMap } from '../src/world/load-map.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const INDEX = readJson('../public/content/textures/environment/blocks-placeholder.json');
const layout = atlasLayout(INDEX);
const pools = atlasPools(layout);
const nameOf = (index) => layout.tiles.find((t) => t.index === index).name;
const names = (pool) => pool.map(nameOf);

// solid(x, y, z) over a list of [x, y, z] cells.
const solidOf = (cells) => {
  const set = new Set(cells.map((c) => c.join(',')));
  return (x, y, z) => set.has(`${x},${y},${z}`);
};
const row = (x0, x1, y, z = 0) => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y, z]);

test('atlasLayout: 7 x 4 tiles of 64 px; index = row * columns + column, row 0 at the top', () => {
  assert.deepEqual([layout.columns, layout.rows, layout.tileSize, layout.tiles.length], [7, 4, 64, 28]);
  const at = (name) => layout.tiles.find((t) => t.name === name);
  assert.deepEqual(at('panel-plain'), { name: 'panel-plain', index: 0, kind: 'panel', tiles: 'xy' });
  assert.equal(at('grille-panel').index, 6);
  assert.equal(at('grating').index, 7);
  assert.equal(at('walkway-top').index, 16);
  assert.equal(at('control-box').index, 27);
  assert.deepEqual(layout.tiles.map((t) => t.index), [...Array(28).keys()]);
  const bad = { ...INDEX, tiles: { odd: { ...INDEX.tiles['panel-plain'], x: 10 } } };
  assert.throws(() => atlasLayout(bad), /tile 'odd'.*not on the 7 x 4 grid/);
  assert.throws(() => atlasLayout({ ...INDEX, tiles: { far: { ...INDEX.tiles['panel-plain'], y: 256 } } }), /not on the/);
});

test('atlasPools: tiles by kind and repeat axes, sorted by index; a missing pool throws', () => {
  assert.deepEqual(names(pools.panel), ['panel-plain', 'panel-riveted', 'panel-quad', 'tile-wall']);
  assert.deepEqual(names(pools.floorTop), ['grating']);
  assert.deepEqual(names(pools.walkway), ['walkway-top']);
  assert.deepEqual(names(pools.edge), ['hazard-edge']);
  assert.deepEqual(names(pools.stripe), ['hazard-stripe']);
  assert.deepEqual(names(pools.band), ['pipe-h', 'pipe-teal-h', 'pipe-rail', 'truss']);
  assert.deepEqual(names(pools.span), ['truss']);
  assert.deepEqual(names(pools.window), ['lit-window']);
  assert.deepEqual(names(pools.crate), ['crate', 'crate-green', 'barrel']);
  assert.deepEqual(names(pools.feature), ['vent-louvre', 'vent-grille', 'grille-panel', 'fan', 'cross-brace', 'lit-sign', 'lit-screen', 'wall-light', 'warning-lamp', 'control-box']);
  const noWindow = { ...layout, tiles: layout.tiles.filter((t) => t.kind !== 'window') };
  assert.throws(() => atlasPools(noWindow), /no tile for pool 'window'/);
});

test('hash3 and pick: deterministic unsigned 32-bit, salt and order matter', () => {
  assert.equal(hash3(1, 2, 3, 4), hash3(1, 2, 3, 4));
  assert.notEqual(hash3(1, 2, 3, 4), hash3(1, 2, 3, 5));
  assert.notEqual(hash3(1, 2, 3, 4), hash3(2, 1, 3, 4));
  for (const h of [hash3(-7, -1, -3, 2), hash3(0, 0, 0, 0), hash3(297, 15, 1, 7)]) assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32, String(h));
  assert.equal(pick([10, 20, 30], 7), 20);
});

test('blockTiles: a flat floor 10 wide: walkway fronts with hazard edges at both ends, grating tops with stripes at the ends', () => {
  const cells = [...row(0, 9, 0), ...row(0, 9, -1)];
  const solid = solidOf(cells);
  for (let x = 0; x <= 9; x++) {
    const [side, top, front] = blockTiles(solid, x, 0, 0, pools);
    const end = x === 0 || x === 9;
    assert.equal(nameOf(front), end ? 'hazard-edge' : 'walkway-top', `x ${x} front`);
    assert.equal(nameOf(top), end ? 'hazard-stripe' : 'grating', `x ${x} top`);
    assert.equal(side, front, `x ${x}: the surface runs round the corner`);
  }
  // The covered row below: sides show the patch panel; the hidden top repeats the front.
  for (let x = 0; x <= 9; x++) {
    const [side, top, front] = blockTiles(solid, x, -1, 0, pools);
    assert.ok(pools.panel.includes(side), `x ${x} side`);
    assert.equal(top, front);
  }
});

test('blockTiles: a lone block on a floor is a crate; a bridge cell open below between two blocks is a span', () => {
  const floor = [...row(0, 9, 0), [4, 1, 0]];
  const [, , crate] = blockTiles(solidOf(floor), 4, 1, 0, pools);
  assert.ok(pools.crate.includes(crate), nameOf(crate));
  // Bridge: three cells at y 3, covered above, the middle one open below.
  const bridge = [...row(0, 2, 3), ...row(0, 2, 4), [0, 2, 0], [2, 2, 0]];
  const [side, , span] = blockTiles(solidOf(bridge), 1, 3, 0, pools);
  assert.equal(nameOf(span), 'truss');
  assert.ok(pools.panel.includes(side));
});

test('blockTiles: covered wall cells show a panel, band, window or feature; patches and bands share a tile', () => {
  // A solid wall 24 x 12 at z = -1 and z = 0; inner cells are covered on all sides.
  const cells = [];
  for (const z of [-1, 0]) for (let y = 0; y < 12; y++) cells.push(...row(-12, 11, y, z));
  const solid = solidOf(cells);
  const wall = new Set([...pools.panel, ...pools.band, ...pools.window, ...pools.feature]);
  const seen = new Set();
  for (const z of [-1, 0]) {
    for (let y = 1; y < 11; y++) {
      for (let x = -11; x < 11; x++) {
        const [side, top, front] = blockTiles(solid, x, y, z, pools);
        assert.ok(wall.has(front), `${x},${y},${z}: ${nameOf(front)}`);
        assert.ok(pools.panel.includes(side));
        assert.equal(top, front);
        // Same patch -> same side panel; same band run (one row) -> same band tile.
        assert.equal(side, blockTiles(solid, Math.floor(x / DECOR.patchWidth) * DECOR.patchWidth, Math.floor(y / DECOR.patchHeight) * DECOR.patchHeight, z, pools)[0]);
        if (pools.band.includes(front)) {
          const b0 = Math.floor(x / DECOR.bandLength) * DECOR.bandLength;
          for (let bx = b0; bx < b0 + DECOR.bandLength; bx++) if (bx > -12 && bx < 11) assert.equal(blockTiles(solid, bx, y, z, pools)[2], front);
        }
        seen.add(front);
      }
    }
  }
  assert.ok(seen.size > 4, 'more than one kind of tile on a large wall');
});

test('decor on the real map: deterministic, every tile from the atlas; panels are most fronts, features few', () => {
  const map = loadMap(readJson('../public/content/maps/moge3-cyberpunk-blocks.json'));
  assert.equal(map.atlas, 'blocks-placeholder');
  const solid = (x, y, z) => (map.rows.get(z)?.tileAt(x, y) ?? 0) !== 0;
  const cells = readJson('../public/content/maps/moge3-cyberpunk-blocks.json').cells;
  const first = decorTiles(cells, solid, pools);
  const again = decorTiles(cells, solid, atlasPools(atlasLayout(readJson('../public/content/textures/environment/blocks-placeholder.json'))));
  assert.deepEqual(again, first);
  assert.equal(first.length, cells.length * 3);
  assert.ok(first.every((t) => Number.isInteger(t) && t >= 0 && t < 28));
  // Fronts of cells that are covered above (not a walkable surface).
  let covered = 0;
  let panels = 0;
  let features = 0;
  cells.forEach(([x, y, z], i) => {
    if (!solid(x, y + 1, z)) return;
    covered += 1;
    const front = first[i * 3 + 2];
    if (pools.panel.includes(front)) panels += 1;
    else if (pools.feature.includes(front)) features += 1;
  });
  assert.ok(covered > 1000, `${covered} covered cells`);
  assert.ok(panels / covered > 0.5, `panels ${panels} / ${covered}`);
  assert.ok(features / covered < 0.15, `features ${features} / ${covered}`);
});
