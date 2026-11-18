import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverSize, panelSize } from '../src/scenes/main-menu.js';

const VIEWS = [[1000, 1000], [1280, 800], [800, 1280], [390, 844]];
const IMAGES = [[1254, 1254], [1920, 1080], [1000, 2000]];

function check(vw, vh, iw, ih) {
  const { width, height } = coverSize(vw, vh, iw, ih);
  const label = `${vw}x${vh} view, ${iw}x${ih} image`;
  assert.ok(Math.abs(width / height - iw / ih) < 1e-9, `${label}: not stretched`);
  assert.ok(width >= vw - 1e-9 && height >= vh - 1e-9, `${label}: covers`);
  assert.ok(Math.abs(width - vw) < 1e-9 || Math.abs(height - vh) < 1e-9, `${label}: one side fits exactly`);
}

test('coverSize: square image in a square window fits exactly', () => {
  assert.deepStrictEqual(coverSize(600, 600, 1254, 1254), { width: 600, height: 600 });
});

test('coverSize: covers without stretching or needless scaling', () => {
  for (const [vw, vh] of VIEWS) for (const [iw, ih] of IMAGES) check(vw, vh, iw, ih);
  check(1920 / 2, 1080 * 2, 1920, 1080); // 1920x1080 image in a portrait window
  check(1000, 500, 1000, 2000); // 1000x2000 image in a landscape window
});

test('panelSize: capped at 480 x 560, else 90% width and 80% height', () => {
  assert.deepStrictEqual(panelSize(1280, 800), { width: 480, height: 560 });
  const narrow = panelSize(390, 844);
  assert.ok(Math.abs(narrow.width - 351) < 1e-9);
  assert.equal(narrow.height, 560);
  assert.deepStrictEqual(panelSize(1280, 500), { width: 480, height: 400 });
});
