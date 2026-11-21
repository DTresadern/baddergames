import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Color } from 'three';
import { atlasLayout, atlasPools, blockTiles } from '../src/scenes/block-decor.js';
import { LIGHT_FACE_OFFSET, MAX_LIGHTS, createLightPool, levelLights } from '../src/scenes/level-lights.js';
import { loadMap } from '../src/world/load-map.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const layout = atlasLayout(readJson('../public/content/textures/environment/blocks-placeholder.json'));
const pools = atlasPools(layout);
const indexOf = (name) => layout.tiles.find((t) => t.name === name).index;
const LIGHTS = {
  'wall-light': { color: '#ffc144', intensity: 2.5, radius: 1.5 },
  'lit-window': { color: '#ffba35', intensity: 2.6, radius: 3.25 },
};

// solid(x, y, z) over a list of [x, y, z] cells.
const solidOf = (cells) => {
  const set = new Set(cells.map((c) => c.join(',')));
  return (x, y, z) => set.has(`${x},${y},${z}`);
};

// A small hand-made map: a wall x 0..7, y -1..3 at z = -1, and two cells at z = 0 covering the
// fronts of (1, 1, -1) and (5, 1, -1). Pools reduced so the rule's fronts are known: panels, bands
// and features are all the wall light, windows the lit window. The rule then gives (checked below):
// y 3 surface fronts (walkway, edge); y 0..2: x 0..3 one window patch, x 4..7 wall lights; y -1:
// spans (truss) inside, wall lights at x 0 and 7 (patch row -1, no window there).
const WALL = [];
for (let x = 0; x < 8; x++) for (let y = -1; y <= 3; y++) WALL.push([x, y, -1]);
const COVERS = [[1, 1, 0], [5, 1, 0]];
const SMALL = [...WALL, ...COVERS];
const FAKE_POOLS = { ...pools, panel: [indexOf('wall-light')], band: [indexOf('wall-light')], feature: [indexOf('wall-light')], window: [indexOf('lit-window')] };

test('levelLights: the small map\'s fronts are as described (the test layout itself)', () => {
  const solid = solidOf(SMALL);
  const front = (x, y) => layout.tiles[blockTiles(solid, x, y, -1, FAKE_POOLS)[2]].name;
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x < 4; x++) assert.equal(front(x, y), 'lit-window', `${x},${y}`);
    for (let x = 4; x < 8; x++) assert.equal(front(x, y), 'wall-light', `${x},${y}`);
  }
  assert.deepEqual([front(0, -1), front(7, -1)], ['wall-light', 'wall-light']);
  for (let x = 1; x < 7; x++) assert.equal(front(x, -1), 'truss');
  for (let x = 0; x < 8; x++) assert.notEqual(front(x, 3), 'wall-light');
});

test('levelLights: one light per uncovered lamp in front of its face, one per window patch at the mean of its uncovered cells; colour linear x intensity', () => {
  const lights = levelLights(SMALL, solidOf(SMALL), layout, FAKE_POOLS, LIGHTS);
  const z = -1 + 0.5 + LIGHT_FACE_OFFSET;
  assert.equal(LIGHT_FACE_OFFSET, 0.05);
  const lamps = [[0.5, -0.5], [7.5, -0.5]];
  for (let y = 0; y <= 2; y++) for (let x = 4; x < 8; x++) if (!(x === 5 && y === 1)) lamps.push([x + 0.5, y + 0.5]);
  // The window patch x 0..3, y 0..2 without the covered (1, 1): 11 cells.
  const windowLight = [(24 - 1.5) / 11, (18 - 1.5) / 11];
  const expected = [...lamps.map(([x, y]) => [x, y, z, 1.5]), [...windowLight, z, 3.25]].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  assert.deepEqual(lights.map((l) => [l.x, l.y, l.z, l.radius]), expected);
  assert.equal(lights.length, 14);
  const lamp = new Color('#ffc144');
  const win = new Color('#ffba35');
  assert.ok(lamp.r === 1 && lamp.g < 0.6, 'linear, not the sRGB value');
  for (const l of lights) {
    const [c, k] = l.radius === 1.5 ? [lamp, 2.5] : [win, 2.6];
    assert.deepEqual(l.color, [c.r * k, c.g * k, c.b * k]);
    assert.ok(Object.isFrozen(l) && Object.isFrozen(l.color));
  }
  assert.ok(Object.isFrozen(lights));
  // Only tiles named in `lights` give lights; the wall with every front covered gives none.
  assert.equal(levelLights(SMALL, solidOf(SMALL), layout, FAKE_POOLS, { 'lit-window': LIGHTS['lit-window'] }).length, 1);
  assert.equal(levelLights(WALL, solidOf([...WALL, ...WALL.map(([x, y]) => [x, y, 0])]), layout, FAKE_POOLS, LIGHTS).length, 0);
  // Deterministic: the same list whatever the cell order.
  assert.deepEqual(levelLights([...SMALL].reverse(), solidOf(SMALL), layout, FAKE_POOLS, LIGHTS), lights);
});

test('levelLights: on the real test level, 83 lights (54 window patches, 29 lamps, signs and screens); deterministic', () => {
  const json = readJson('../public/content/maps/moge3-cyberpunk-blocks.json');
  const map = loadMap(json);
  const solid = (x, y, z) => (map.rows.get(z)?.tileAt(x, y) ?? 0) !== 0;
  const lights = levelLights(json.cells, solid, layout, pools, map.lighting.lights);
  assert.equal(lights.length, 83);
  assert.equal(lights.filter((l) => l.radius === 3.25).length, 54);
  assert.deepEqual(levelLights(json.cells, solid, layout, pools, map.lighting.lights), lights);
  // Same result whatever the cell order.
  assert.deepEqual(levelLights([...json.cells].reverse(), solid, layout, pools, map.lighting.lights), lights);
  for (let i = 1; i < lights.length; i++) {
    const [a, b] = [lights[i - 1], lights[i]];
    assert.ok(a.z < b.z || (a.z === b.z && (a.y < b.y || (a.y === b.y && a.x <= b.x))), `sorted at ${i}`);
  }
  const pool = createLightPool(lights);
  pool.select(20, 3, 0);
  assert.ok(pool.uniforms.litLightRadius.value.every((r) => r > 0));
});

const light = (x, y, z, r = 1) => Object.freeze({ x, y, z, color: Object.freeze([r, r / 2, r / 4]), radius: 2 });

test('createLightPool: MAX_LIGHTS slots of three uniform objects; unused slots colour 0, radius 1', () => {
  assert.equal(MAX_LIGHTS, 24);
  const { uniforms, select } = createLightPool([light(0, 0, 0), light(5, 0, 0)]);
  assert.deepEqual(Object.keys(uniforms).sort(), ['litLightColor', 'litLightPos', 'litLightRadius']);
  for (const u of Object.values(uniforms)) assert.equal(u.value.length, MAX_LIGHTS);
  assert.ok(uniforms.litLightPos.value[0].isVector3 && uniforms.litLightColor.value[0].isVector3);
  assert.equal(select(4, 0, 0), true);
  assert.deepEqual(uniforms.litLightPos.value[0].toArray(), [5, 0, 0], 'nearest first');
  assert.deepEqual(uniforms.litLightPos.value[1].toArray(), [0, 0, 0]);
  assert.deepEqual(uniforms.litLightColor.value[0].toArray(), [1, 0.5, 0.25]);
  assert.deepEqual(uniforms.litLightRadius.value.slice(0, 2), [2, 2]);
  for (let s = 2; s < MAX_LIGHTS; s++) {
    assert.deepEqual(uniforms.litLightColor.value[s].toArray(), [0, 0, 0], `slot ${s}`);
    assert.equal(uniforms.litLightRadius.value[s], 1, `slot ${s}`);
  }
  assert.equal(select(4, 0, 0), false, 'no change');
  assert.equal(select(1, 0, 0), false, 'same set, other order');
  assert.deepEqual(uniforms.litLightPos.value[0].toArray(), [0, 0, 0]);
});

test('createLightPool: with more lights than slots and no view size, the nearest MAX_LIGHTS (equal radii); the same objects every select', () => {
  const lights = Array.from({ length: 83 }, (_, i) => light(i, (i * 7) % 5, (i % 3) - 1, i + 1));
  const pool = createLightPool(lights);
  const { litLightPos, litLightColor, litLightRadius } = pool.uniforms;
  const [pos, colors, radius] = [litLightPos.value, litLightColor.value, litLightRadius.value];
  const nearest = (x, y, z) =>
    lights
      .map((l, i) => [(l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2, i])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, MAX_LIGHTS)
      .map(([, i]) => i);
  assert.equal(pool.select(10, 2, 0), true);
  const at = (s) => lights.findIndex((l) => l.x === pos[s].x && l.y === pos[s].y && l.z === pos[s].z);
  assert.deepEqual(Array.from({ length: MAX_LIGHTS }, (_, s) => at(s)), nearest(10, 2, 0));
  assert.equal(pool.select(10, 2, 0), false);
  assert.equal(pool.select(60, 2, 1), true, 'far away: another set');
  assert.deepEqual(Array.from({ length: MAX_LIGHTS }, (_, s) => at(s)), nearest(60, 2, 1));
  assert.equal(colors[0].x, lights[at(0)].color[0]);
  // Uniform objects and their values are never replaced (materials hold them).
  assert.equal(pool.uniforms.litLightPos.value, pos);
  assert.equal(pool.uniforms.litLightColor.value, colors);
  assert.equal(pool.uniforms.litLightRadius.value, radius);
  assert.equal(createLightPool([]).select(0, 0, 0), false, 'no lights: nothing changes');
});

test('createLightPool: lights rank by distance to the view rectangle minus their radius', () => {
  const at = (x, y, z, radius) => Object.freeze({ x, y, z, color: Object.freeze([1, 1, 1]), radius });
  // 24 fillers just above a 20 x 10 view centred at (0, 0), each 1 tile out of it with radius 0.5:
  // they do not reach it. A light 9 tiles right (inside the view's half width 10) and one 6 tiles
  // outside the view's right edge with radius 8 both reach it.
  const fillers = Array.from({ length: MAX_LIGHTS }, (_, i) => at(i - 12, 6, 0, 0.5));
  const lights = [...fillers, at(9, 0, 0, 1), at(16, 0, 0, 8)];
  const pool = createLightPool(lights);
  pool.select(0, 0, 0, 10, 5);
  const chosen = pool.uniforms.litLightPos.value.map((v) => v.toArray().join(','));
  assert.equal(chosen[0], '16,0,0', 'reaches furthest into the view (6 - 8 = -2)');
  assert.equal(chosen[1], '9,0,0', 'inside the view (0 - 1 = -1)');
  assert.equal(chosen.filter((c) => c.endsWith(',6,0')).length, MAX_LIGHTS - 2, 'two fillers left out');
  // Without a view size the same pool ranks by distance to the point minus the radius.
  pool.select(-12, 6, 0);
  assert.equal(pool.uniforms.litLightPos.value[0].toArray().join(','), '-12,6,0');
});

test('createLightPool: with a perspective camera the view rectangle is the view at the light\'s depth', () => {
  const at = (x, y, z) => Object.freeze({ x, y, z, color: Object.freeze([1, 1, 1]), radius: 0.5 });
  // Camera at z 10, row at 0, half width 5 on the row: at z -3 the half width is 6.5, so the light
  // at x 6.2, z -3 is inside the view (rank -0.5, no depth term in perspective) and ranks before
  // the one at x 5.6, z 0, just outside it (0.6 - 0.5 = 0.1). Orthographic, the first is 1.2 out
  // and 3 deep (rank sqrt(1.44 + 9) - 0.5 = 2.73) and ranks after.
  const pool = createLightPool([at(5.6, 0, 0), at(6.2, 0, -3)]);
  const first = () => pool.uniforms.litLightPos.value[0].toArray().join(',');
  pool.select(0, 0, 0, 5, 3, 10);
  assert.equal(first(), '6.2,0,-3', 'perspective: inside the wider view at its depth');
  pool.select(0, 0, 0, 5, 3);
  assert.equal(first(), '5.6,0,0', 'orthographic: nearer the plane wins');
});
