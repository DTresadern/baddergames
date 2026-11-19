import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOSE_SECONDS, OPEN_SECONDS, PANEL_ANIM, animRect, closingAt, easeOut, openingAt } from '../src/scenes/panel-anim.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('constants are frozen and total 0.8 s', () => {
  assert.ok(Object.isFrozen(PANEL_ANIM));
  assert.deepEqual({ ...PANEL_ANIM }, { widthSeconds: 0.3, heightSeconds: 0.3, itemsSeconds: 0.2, lineHeight: 4 });
  near(OPEN_SECONDS, 0.8);
  near(CLOSE_SECONDS, 0.8);
});

test('easeOut: clamped cubic', () => {
  assert.equal(easeOut(-1), 0);
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.equal(easeOut(2), 1);
  near(easeOut(0.5), 0.875);
});

test('openingAt: width, then height, then items', () => {
  assert.deepEqual(openingAt(0), { width: 0, height: 0, items: 0 });
  const w = openingAt(0.15);
  assert.ok(w.width > 0 && w.width < 1 && w.height === 0 && w.items === 0);
  const h = openingAt(0.45);
  assert.deepEqual([h.width, h.items], [1, 0]);
  assert.ok(h.height > 0 && h.height < 1);
  const i = openingAt(0.7);
  assert.deepEqual([i.width, i.height], [1, 1]);
  assert.ok(i.items > 0 && i.items < 1);
  assert.deepEqual(openingAt(0.8), { width: 1, height: 1, items: 1 });
  assert.deepEqual(openingAt(5), { width: 1, height: 1, items: 1 });
});

test('closingAt: items, then height, then width', () => {
  assert.deepEqual(closingAt(0), { width: 1, height: 1, items: 1 });
  const a = closingAt(0.1);
  assert.ok(a.items > 0 && a.items < 1 && a.width === 1 && a.height === 1);
  const b = closingAt(0.35);
  assert.deepEqual([b.width, b.items], [1, 0]);
  assert.ok(b.height > 0 && b.height < 1);
  const c = closingAt(0.65);
  assert.deepEqual([c.height, c.items], [0, 0]);
  assert.ok(c.width > 0 && c.width < 1);
  assert.deepEqual(closingAt(0.8), { width: 0, height: 0, items: 0 });
  assert.deepEqual(closingAt(9), { width: 0, height: 0, items: 0 });
});

test('animRect: same centre; width scaled; height from the line to full, never above', () => {
  const rect = { x: 100, y: 50, width: 200, height: 100 };
  assert.deepEqual(animRect(rect, { width: 1, height: 1 }), rect);
  const line = animRect(rect, { width: 1, height: 0 });
  assert.deepEqual(line, { x: 100, y: 98, width: 200, height: 4 });
  const half = animRect(rect, { width: 0.5, height: 0.5 });
  near(half.x + half.width / 2, 200);
  near(half.y + half.height / 2, 100);
  near(half.width, 100);
  near(half.height, 52);
  assert.equal(animRect(rect, { width: 0, height: 1 }).width, 0);
  assert.equal(animRect({ x: 0, y: 0, width: 10, height: 2 }, { width: 1, height: 0 }).height, 2, 'capped at rect height');
});
