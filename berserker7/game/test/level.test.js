import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildLevel, mapText } from '../tools/build-level.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('level: the committed moge3-cyberpunk-blocks map is exactly the build output (npm run build:level)', () => {
  assert.equal(read('../public/content/maps/moge3-cyberpunk-blocks.json'), mapText(buildLevel()));
  const base = JSON.parse(read('../tools/moge3-cyberpunk-blocks.base.json'));
  const cells = new Set(JSON.parse(read('../public/content/maps/moge3-cyberpunk-blocks.json')).cells.map((c) => c.join(',')));
  assert.ok(base.cells.every((c) => cells.has(c.join(','))), 'every base cell is kept');
});
