// @ts-check
// Framework-neutral description of the Technophage "surface megacity" scene.
//
// This file is the CONTRACT between the four builds (three.js 2D/3D, PixiJS 2D/3D).
// It imports no framework. `buildScene()` returns plain data; the `animate`-style
// helpers further down are pure functions of time t (seconds), so every build
// animates identically and a screenshot at a fixed t shows the same state.
//
// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------
// World:   x 0..1200 left -> right, y 0..400 top -> bottom (image-like, y DOWN). 3:1.
// depth:   0 = the foreground plane (the bridge deck, hunters, platforms, rock).
//          Larger = further away, up to about 10 (the far city).
//
// 2D builds: depth gives a parallax factor and a haze amount.
//   screenX = x + parallaxOffset(depth, t)            (see parallaxFactor below)
//   colour  = mix(colour, haze(depth).color, haze(depth).opacity)
//
// 3D builds: map  X = x - 600,  Y = 200 - y  (flip y so up is +Y),  Z = -depth * D
//   where D is the camera's distance to the depth-0 plane. Scale an element's
//   X and Y about the camera axis by (1 + depth) so it fills the same part of the
//   frame as in 2D; a camera that moves sideways by cameraX(t) then produces
//   exactly the 2D parallax factor 1 / (1 + depth).
//
// Foreground elements at the frame edges extend 40 units past 0..1200 so the camera
// drift (+/- 30 units at depth 0) never reveals an edge.
//
// Rough layout (follows the reference image):
//   bridge deck top y=196 spanning x 0..760; pillars below; left tower x 0..250;
//   stairs x 720..840 rising to the right; stepped platforms x 810..1200;
//   rock + red growth lower right x 850..1200, y 230..400; drone near (740, 52);
//   billboards near (393, 66) and (993, 80); train on a far track at y=122;
//   smoke stacks upper right (~820..900, y 36..60) and lower left (~280, y 330).

import { makeRng, subSeed } from './rng.js';
import { PALETTE } from './palette.js';
import { STRESS } from './stress.js';

export const WORLD = Object.freeze({ width: 1200, height: 400 });

/** Height of the bridge deck walking surface (feet of the hunters). */
const DECK_TOP = 196;

// ---------------------------------------------------------------------------
// Types (JSDoc only; used by the type-check)
// ---------------------------------------------------------------------------
/** @typedef {import('./stress.js').Stress} Stress */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/**
 * One stacked block of a building. Rect plus an optional window grid.
 * lit[i] is 1 when window i is lit; window i is at column i % cols, row floor(i / cols),
 * top-left (x0 + col*dx, y0 + row*dy), size (ww, wh).
 * @typedef {Rect & { dome: boolean, windows: { x0: number, y0: number, cols: number, rows: number, dx: number, dy: number, ww: number, wh: number, lit: number[] } }} Tier
 */
/** @typedef {{ x: number, w: number, tiers: Tier[], antennas: { x: number, top: number }[], depth: number }} Building */
/** @typedef {{ depth: number, color: number, buildings: Building[] }} CityLayer */
/** @typedef {{ x: number, y: number, color: number, radius: number, intensity: number, depth: number, kind: 'wall'|'post'|'under'|'extra' }} Lamp */

// ---------------------------------------------------------------------------
// Scene builder
// ---------------------------------------------------------------------------

/**
 * Build the whole scene as plain data.
 * @param {number} [seed]
 * @param {Stress} [stress]
 */
export function buildScene(seed = 1, stress = STRESS.base) {
  const s = { ...STRESS.base, ...stress };
  const scene = {
    seed,
    stress: s,
    world: WORLD,
    palette: PALETTE,
    camera: { driftAmplitude: 30, driftPeriod: 20 },
    sky: {
      stops: [
        { y: 0, color: PALETTE.skyTop },
        { y: 170, color: PALETTE.skyMid },
        { y: 330, color: PALETTE.skyHorizon },
        { y: 400, color: PALETTE.skyMid },
      ],
    },
    haze: buildHaze(),
    city: buildCity(seed, s.objects),
    train: buildTrain(),
    billboards: buildBillboards(),
    smokeStacks: buildSmokeStacks(),
    bridge: buildBridge(),
    railings: buildRailings(),
    structures: buildStructures(),
    clutter: buildClutter(seed, s.objects),
    lamps: buildLamps(seed, s.lights),
    drone: buildDrone(),
    growth: buildGrowth(seed),
    hunters: buildHunters(),
    rain: buildRain(seed, s.rain),
    drips: buildDrips(seed),
  };
  return scene;
}

/** @typedef {ReturnType<typeof buildScene>} Scene */

// ---------------------------------------------------------------------------
// Haze: increases with distance
// ---------------------------------------------------------------------------

function buildHaze() {
  return {
    near: PALETTE.hazeNear,
    far: PALETTE.hazeFar,
    /** opacity(depth) = maxOpacity * (1 - exp(-falloff * depth)) */
    maxOpacity: 0.95,
    falloff: 0.15,
    /** extra uniform rain mist drawn over the whole frame */
    mistOpacity: 0.08,
  };
}

/**
 * Haze colour and opacity for a depth. Mix the element's colour toward `color` by `opacity`.
 * @param {Scene} scene
 * @param {number} depth
 */
export function hazeAt(scene, depth) {
  const h = scene.haze;
  const opacity = h.maxOpacity * (1 - Math.exp(-h.falloff * Math.max(0, depth)));
  const f = Math.min(1, depth / 10);
  return { color: lerpColor(h.near, h.far, f), opacity };
}

// ---------------------------------------------------------------------------
// Background city: tiered buildings in several depth layers
// ---------------------------------------------------------------------------

/** Layer definitions, far to near. baseCount is multiplied by stress.objects. */
const CITY_LAYERS = [
  { depth: 9, baseCount: 14, minH: 220, maxH: 380, minW: 50, maxW: 120, groundY: 340, color: PALETTE.navy, litChance: 0.18 },
  { depth: 6, baseCount: 12, minH: 160, maxH: 330, minW: 50, maxW: 110, groundY: 360, color: PALETTE.navyDark, litChance: 0.22 },
  { depth: 3.5, baseCount: 9, minH: 110, maxH: 260, minW: 60, maxW: 120, groundY: 400, color: PALETTE.gunmetalDark, litChance: 0.26 },
  // low industrial blocks seen below the bridge, between the pillars
  { depth: 1.5, baseCount: 7, minH: 50, maxH: 110, minW: 70, maxW: 150, groundY: 410, color: PALETTE.gunmetalDark, litChance: 0.35 },
];

/**
 * @param {number} seed
 * @param {number} objects multiplier
 * @returns {CityLayer[]}
 */
function buildCity(seed, objects) {
  return CITY_LAYERS.map((def, li) => {
    const rng = makeRng(subSeed(seed, `city-${li}`));
    const count = def.baseCount * objects;
    // spread buildings over the world plus a parallax margin on both sides
    const span = WORLD.width + 160;
    /** @type {Building[]} */
    const buildings = [];
    for (let i = 0; i < count; i++) {
      const slot = span / count;
      const w = rng.range(def.minW, def.maxW) / Math.sqrt(objects);
      const cx = -80 + slot * (i + 0.5) + rng.range(-slot * 0.4, slot * 0.4);
      const x = cx - w / 2;
      const height = rng.range(def.minH, def.maxH);
      const top = def.groundY - height;
      const tierCount = rng.int(1, 3);
      /** @type {Tier[]} */
      const tiers = [];
      let tierBottom = def.groundY;
      let tierW = w;
      for (let k = 0; k < tierCount; k++) {
        const remaining = tierBottom - top;
        const h = k === tierCount - 1 ? remaining : remaining * rng.range(0.45, 0.7);
        const tx = cx - tierW / 2;
        const ty = tierBottom - h;
        tiers.push({
          x: tx, y: ty, w: tierW, h,
          dome: k === tierCount - 1 && rng.chance(0.15),
          windows: windowGrid(rng, tx, ty, tierW, h, def.litChance, def.depth),
        });
        tierBottom = ty;
        tierW *= rng.range(0.55, 0.8);
      }
      const antennas = [];
      const nAnt = rng.int(0, 2);
      const topTier = tiers[tiers.length - 1];
      for (let a = 0; a < nAnt; a++) {
        antennas.push({ x: topTier.x + rng.range(0.15, 0.85) * topTier.w, top: topTier.y - rng.range(10, 40) });
      }
      buildings.push({ x, w, tiers, antennas, depth: def.depth });
    }
    return { depth: def.depth, color: def.color, buildings };
  });
}

/**
 * @param {ReturnType<typeof makeRng>} rng
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} litChance @param {number} depth
 */
function windowGrid(rng, x, y, w, h, litChance, depth) {
  // windows get smaller with distance
  const ww = depth > 5 ? 2 : 3;
  const wh = depth > 5 ? 2 : 3;
  const dx = ww + (depth > 5 ? 3 : 4);
  const dy = wh + (depth > 5 ? 4 : 5);
  const pad = 5;
  const cols = Math.max(0, Math.floor((w - pad * 2) / dx));
  const rows = Math.max(0, Math.floor((h - pad * 2) / dy));
  const lit = [];
  // windows lit in horizontal runs (floors) rather than pure noise
  for (let r = 0; r < rows; r++) {
    const floorLit = rng.chance(litChance * 1.6);
    for (let c = 0; c < cols; c++) {
      lit.push(floorLit && rng.chance(0.7) ? 1 : rng.chance(litChance * 0.15) ? 1 : 0);
    }
  }
  return { x0: x + pad, y0: y + pad, cols, rows, dx, dy, ww, wh, lit };
}

// ---------------------------------------------------------------------------
// Train on a distant elevated track
// ---------------------------------------------------------------------------

function buildTrain() {
  return {
    depth: 5,
    trackY: 122, // top of the track deck; the train sits on it
    trackThickness: 7,
    trackSupports: Array.from({ length: 16 }, (_, i) => -60 + i * 90), // x of support columns
    supportBottom: 240,
    carCount: 4,
    carLength: 44,
    carGap: 3,
    carHeight: 15,
    speed: 70, // world units per second, left -> right
    /** the train re-enters from the left after this many seconds */
    loopPeriod: (WORLD.width + 400 + 4 * 47) / 70,
    color: PALETTE.trainBody,
    windowColor: PALETTE.trainWindow,
  };
}

/**
 * x of the train's rear (left) end at time t. Loops left -> right.
 * @param {Scene} scene
 * @param {number} t
 */
export function trainX(scene, t) {
  const tr = scene.train;
  const length = tr.carCount * (tr.carLength + tr.carGap);
  const phase = (((t + 0.7) % tr.loopPeriod) + tr.loopPeriod) % tr.loopPeriod; // +0.7 s: train near x=500 at t=12
  return -200 - length + phase * tr.speed;
}

// ---------------------------------------------------------------------------
// Billboards (glowing, no text)
// ---------------------------------------------------------------------------

function buildBillboards() {
  return [
    { x: 351, y: 36, w: 84, h: 58, depth: 4, colorA: 0xffb04a, colorB: 0xc8402a, frame: PALETTE.gunmetalDark, seed: 1 },
    { x: 955, y: 58, w: 78, h: 44, depth: 3.5, colorA: 0x39a8ff, colorB: 0xff3a6a, frame: PALETTE.gunmetalDark, seed: 2 },
  ];
}

// ---------------------------------------------------------------------------
// Smoke stacks
// ---------------------------------------------------------------------------

function buildSmokeStacks() {
  // x/y = top centre of the chimney. rate = particles per second; life in seconds.
  return [
    { x: 822, y: 48, w: 9, h: 70, depth: 4.5, rate: 6, life: 7, rise: 18, drift: 5, size: 10 },
    { x: 846, y: 38, w: 8, h: 80, depth: 4.5, rate: 6, life: 7, rise: 20, drift: 4, size: 10 },
    { x: 892, y: 56, w: 10, h: 64, depth: 4.5, rate: 5, life: 6, rise: 16, drift: 6, size: 9 },
    { x: 1150, y: 14, w: 10, h: 40, depth: 2, rate: 5, life: 5, rise: 22, drift: 6, size: 12 },
    { x: 282, y: 338, w: 12, h: 70, depth: 1.5, rate: 6, life: 6, rise: 16, drift: 5, size: 13 },
  ];
}

/**
 * State of particle i of a smoke stack at time t. Particles cycle forever.
 * Particle count per stack = ceil(rate * life).
 * @param {{ x: number, y: number, rate: number, life: number, rise: number, drift: number, size: number }} stack
 * @param {number} i
 * @param {number} t
 */
export function smokeParticle(stack, i, t) {
  const count = Math.ceil(stack.rate * stack.life);
  const age = ((t + (i / count) * stack.life) % stack.life + stack.life) % stack.life;
  const k = age / stack.life; // 0 = just emitted, 1 = dead
  const wobble = Math.sin(i * 12.9898 + t * 0.7) * 4 * k;
  return {
    x: stack.x + stack.drift * age + wobble,
    y: stack.y - stack.rise * age,
    size: stack.size * (0.6 + 2.6 * k),
    alpha: Math.min(1, k * 6) * (1 - k) * 0.55,
    rotation: i * 1.7 + t * 0.2,
  };
}

// ---------------------------------------------------------------------------
// Bridge (elevated walkway)
// ---------------------------------------------------------------------------

function buildBridge() {
  const pillars = [86, 372, 640];
  const pillarW = 40;
  return {
    depth: 0,
    // deck: walking surface (wet, reflective) seen as a thin top strip
    deck: { x: -40, y: DECK_TOP, w: 800, h: 13 },
    // hazard stripe band along the front edge
    stripeBand: { x: -40, y: DECK_TOP + 13, w: 800, h: 9 },
    stripeSpacing: 22, // one yellow + one black stripe per spacing
    stripeSlant: 7, // stripes lean right by this many units over the band height
    // dark girder below the stripe band (vents, lamp housings)
    girder: { x: -40, y: DECK_TOP + 22, w: 800, h: 24 },
    pillars: pillars.map((x) => ({ x: x - pillarW / 2, y: DECK_TOP + 46, w: pillarW, h: 400 - (DECK_TOP + 46) })),
    // diagonal braces from pillar sides up to the girder: [x1,y1,x2,y2]
    braces: pillars.flatMap((x) => [
      [x - pillarW / 2, 300, x - 70, DECK_TOP + 46],
      [x + pillarW / 2, 300, x + 70, DECK_TOP + 46],
    ]),
    redLights: pillars.flatMap((x) => [
      { x: x - pillarW / 2 - 5, y: 292, radius: 14 },
      { x: x + pillarW / 2 + 5, y: 292, radius: 14 },
    ]),
    // hanging cables below the girder, as point lists (sagging curves)
    cables: [
      [{ x: 110, y: 246 }, { x: 230, y: 271 }, { x: 350, y: 246 }],
      [{ x: 400, y: 246 }, { x: 510, y: 265 }, { x: 620, y: 246 }],
      [{ x: -40, y: 253 }, { x: 20, y: 269 }, { x: 70, y: 248 }],
    ],
  };
}

function buildRailings() {
  // Railings along the back edge of the deck and the platforms.
  // Each: from x0 to x1 at walking-surface y, height h, post spacing.
  return [
    { x0: -40, x1: 70, y: DECK_TOP, h: 20, postSpacing: 22, depth: 0 },
    { x0: 172, x1: 310, y: DECK_TOP, h: 20, postSpacing: 23, depth: 0 },
    { x0: 370, x1: 470, y: DECK_TOP, h: 20, postSpacing: 25, depth: 0 },
    { x0: 488, x1: 720, y: DECK_TOP, h: 20, postSpacing: 26, depth: 0 },
    { x0: 840, x1: 1052, y: 138, h: 20, postSpacing: 24, depth: 0 },
    { x0: 812, x1: 870, y: 297, h: 18, postSpacing: 20, depth: 0 },
  ];
}

// ---------------------------------------------------------------------------
// Right-hand stairs, ladders, stepped platforms; left tower
// ---------------------------------------------------------------------------

function buildStructures() {
  return {
    depth: 0,
    // stairs rise from the bridge deck (bottom-left) to the upper platform (top-right)
    stairs: { x0: 722, y0: DECK_TOP, x1: 840, y1: 138, steps: 11, thickness: 8 },
    platforms: [
      { x: 840, y: 138, w: 400, h: 14 }, // upper (runs past the right edge for parallax)
      { x: 760, y: 204, w: 284, h: 12 }, // middle, continues the deck
      { x: 810, y: 297, w: 250, h: 12 }, // lower
      { x: 1060, y: 283, w: 70, h: 10 }, // small step
    ],
    // vertical struts holding up the platforms: x, top, bottom
    struts: [
      { x: 860, y0: 152, y1: 204 }, { x: 960, y0: 152, y1: 204 }, { x: 1030, y0: 152, y1: 204 },
      { x: 822, y0: 216, y1: 297 }, { x: 1030, y0: 216, y1: 297 },
      { x: 830, y0: 309, y1: 400 }, { x: 1040, y0: 309, y1: 360 },
    ],
    ladders: [
      { x: 994, y0: 138, y1: 204, w: 12, rungSpacing: 7 },
      { x: 870, y0: 204, y1: 297, w: 12, rungSpacing: 7 },
    ],
    // big machinery block on the left behind the bridge
    leftTower: {
      x: -40, y: 0, w: 280, h: DECK_TOP,
      door: { x: 112, y: 122, w: 46, h: 74 },
      lattice: { x: 18, y: 0, w: 70, h: 160, cells: 4 },
      panels: [{ x: 180, y: 20, w: 50, h: 70 }, { x: 0, y: 160, w: 60, h: 36 }],
      pipes: [
        { x0: 238, y0: 30, x1: 238, y1: 196, r: 5 },
        { x0: 200, y0: 30, x1: 260, y1: 30, r: 4 },
        { x0: -40, y0: 172, x1: 110, y1: 172, r: 4 },
      ],
    },
    // right machinery tower with two ventilation fans
    rightTower: {
      x: 1048, y: 30, w: 192, h: 108,
      fans: [{ cx: 1102, cy: 82, r: 19 }, { cx: 1152, cy: 82, r: 19 }],
      pipes: [{ x0: 1048, y0: 52, x1: 1000, y1: 52, r: 4 }],
    },
    // dome-roofed building behind the platforms (mid-distance)
    dome: { x: 790, y: 72, w: 140, h: 90, depth: 2.5 },
    // pipes running under the left of the frame (foreground)
    groundPipes: [
      { x0: -40, y0: 352, x1: 140, y1: 352, r: 8 },
      { x0: -40, y0: 372, x1: 200, y1: 372, r: 6 },
      { x0: 60, y0: 320, x1: 60, y1: 400, r: 7 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Crates and barrels (multiplied by stress.objects)
// ---------------------------------------------------------------------------

/**
 * @param {number} seed
 * @param {number} objects
 */
function buildClutter(seed, objects) {
  /** @type {{ kind: 'crate'|'barrel', x: number, y: number, w: number, h: number, depth: number, tint: number }[]} */
  const items = [
    // left crates on the deck
    { kind: 'crate', x: 46, y: DECK_TOP - 38, w: 50, h: 38, depth: 0, tint: 0x3d4233 },
    { kind: 'crate', x: 96, y: DECK_TOP - 26, w: 34, h: 26, depth: 0, tint: 0x3d4233 },
    // central crate stack
    { kind: 'crate', x: 576, y: DECK_TOP - 44, w: 54, h: 44, depth: 0, tint: PALETTE.gunmetal },
    { kind: 'crate', x: 528, y: DECK_TOP - 26, w: 48, h: 26, depth: 0, tint: 0x4a4228 },
    { kind: 'crate', x: 632, y: DECK_TOP - 26, w: 40, h: 26, depth: 0, tint: PALETTE.gunmetal },
    // barrels on the platforms
    { kind: 'barrel', x: 996, y: 138 - 22, w: 15, h: 22, depth: 0, tint: PALETTE.warningRedDeep },
    { kind: 'barrel', x: 1013, y: 138 - 22, w: 15, h: 22, depth: 0, tint: PALETTE.warningRedDeep },
    { kind: 'barrel', x: 920, y: 204 - 18, w: 13, h: 18, depth: 0, tint: PALETTE.warningRedDeep },
    { kind: 'barrel', x: 935, y: 204 - 18, w: 13, h: 18, depth: 0, tint: PALETTE.warningRedDeep },
    { kind: 'barrel', x: 1018, y: 297 - 22, w: 15, h: 22, depth: 0, tint: PALETTE.warningRedDeep },
    { kind: 'barrel', x: 1036, y: 297 - 22, w: 15, h: 22, depth: 0, tint: PALETTE.warningRedDeep },
  ];
  // stress: extra copies scattered on the deck and platforms
  const rng = makeRng(subSeed(seed, 'clutter'));
  const surfaces = [
    { x0: 10, x1: 700, y: DECK_TOP },
    { x0: 850, x1: 1180, y: 138 },
    { x0: 770, x1: 1030, y: 204 },
    { x0: 820, x1: 1050, y: 297 },
  ];
  const base = items.length;
  for (let i = 0; i < base * (objects - 1); i++) {
    const surf = rng.pick(surfaces);
    const barrel = rng.chance(0.4);
    const w = barrel ? rng.range(12, 16) : rng.range(18, 40);
    const h = barrel ? w * 1.4 : rng.range(14, 30);
    items.push({
      kind: barrel ? 'barrel' : 'crate',
      x: rng.range(surf.x0, surf.x1 - w), y: surf.y - h, w, h, depth: 0,
      tint: barrel ? PALETTE.warningRedDeep : rng.pick([PALETTE.gunmetal, 0x3d4233, 0x4a4228]),
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Lamps (sodium amber). The first 8 are hand-placed; stress adds more.
// ---------------------------------------------------------------------------

/**
 * @param {number} seed
 * @param {number} count
 * @returns {Lamp[]}
 */
function buildLamps(seed, count) {
  /** @type {Lamp[]} */
  const fixed = [
    { x: 700, y: 178, color: PALETTE.amber, radius: 70, intensity: 1.0, depth: 0, kind: 'post' }, // lamp post on deck
    { x: 144, y: 246, color: PALETTE.amber, radius: 60, intensity: 0.8, depth: 0, kind: 'under' },
    { x: 380, y: 246, color: PALETTE.amber, radius: 60, intensity: 0.8, depth: 0, kind: 'under' },
    { x: 700, y: 246, color: PALETTE.amber, radius: 60, intensity: 0.8, depth: 0, kind: 'under' },
    { x: 145, y: 70, color: PALETTE.amber, radius: 80, intensity: 0.9, depth: 0, kind: 'wall' }, // left tower
    { x: 232, y: 118, color: PALETTE.amber, radius: 55, intensity: 0.8, depth: 0, kind: 'wall' },
    { x: 950, y: 158, color: PALETTE.amber, radius: 60, intensity: 0.85, depth: 0, kind: 'under' }, // under upper platform
    { x: 1146, y: 246, color: PALETTE.amber, radius: 60, intensity: 0.85, depth: 0, kind: 'post' }, // post on the rock
  ];
  const lamps = fixed.slice(0, Math.min(count, fixed.length));
  const rng = makeRng(subSeed(seed, 'lamps'));
  for (let i = fixed.length; i < count; i++) {
    lamps.push({
      x: rng.range(10, 1190),
      y: rng.pick([246, 158, 216, 309, rng.range(40, 380)]),
      color: rng.chance(0.85) ? PALETTE.amber : PALETTE.amberPale,
      radius: rng.range(30, 60),
      intensity: rng.range(0.5, 0.9),
      depth: 0,
      kind: 'extra',
    });
  }
  return lamps;
}

// ---------------------------------------------------------------------------
// Patrol drone with sweeping searchlight
// ---------------------------------------------------------------------------

function buildDrone() {
  return {
    depth: 0.5,
    centre: { x: 740, y: 54 },
    amplitude: { x: 36, y: 8 },
    period: 14, // seconds for one figure-of-eight
    bodyW: 50,
    bodyH: 18,
    // searchlight: angle in radians in world space (y down): 0 = pointing right,
    // +PI/2 = straight down. Sweeps baseAngle +/- sweep.
    coneBaseAngle: 0.62,
    coneSweep: 0.32,
    coneSweepPeriod: 6,
    coneHalfAngle: 0.2,
    coneLength: 300,
    color: PALETTE.amberPale,
  };
}

/**
 * Drone position and searchlight angle at time t.
 * @param {Scene} scene
 * @param {number} t
 * @returns {{ x: number, y: number, angle: number, tilt: number }}
 */
export function droneState(scene, t) {
  const d = scene.drone;
  const w = (2 * Math.PI * t) / d.period;
  const x = d.centre.x + d.amplitude.x * Math.sin(w);
  const y = d.centre.y + d.amplitude.y * Math.sin(2 * w);
  const angle = d.coneBaseAngle + d.coneSweep * Math.sin((2 * Math.PI * t) / d.coneSweepPeriod);
  // body tilts slightly with horizontal velocity
  const tilt = 0.12 * Math.cos(w);
  return { x, y, angle, tilt };
}

// ---------------------------------------------------------------------------
// Rock and red organic growth (lower right)
// ---------------------------------------------------------------------------

/** @param {number} seed */
function buildGrowth(seed) {
  const rng = makeRng(subSeed(seed, 'growth'));
  // rock outline, clockwise, closed implicitly
  /** @type {Point[]} */
  const rock = [];
  const ridge = [
    [840, 400], [846, 330], [880, 318], [930, 322], [980, 300], [1040, 290],
    [1080, 262], [1130, 248], [1170, 226], [1200, 214], [1240, 206], [1240, 400],
  ];
  for (let i = 0; i < ridge.length; i++) {
    const [x, y] = ridge[i];
    rock.push({ x, y });
    // jitter extra points between ridge points for a rough edge
    if (i < ridge.length - 2) {
      const [nx, ny] = ridge[i + 1];
      for (let k = 1; k < 4; k++) {
        const f = k / 4;
        rock.push({ x: x + (nx - x) * f, y: y + (ny - y) * f + rng.range(-6, 6) });
      }
    }
  }
  // a lower mound at the bottom centre
  /** @type {Point[]} */
  const mound = [
    { x: 560, y: 400 }, { x: 590, y: 372 }, { x: 640, y: 360 }, { x: 700, y: 366 },
    { x: 760, y: 356 }, { x: 820, y: 368 }, { x: 860, y: 400 },
  ];
  // tendrils: curves crawling over the rock, as point lists
  /** @type {{ points: Point[], width: number }[]} */
  const tendrils = [];
  for (let i = 0; i < 16; i++) {
    let x = rng.range(880, 1200);
    let y = rng.range(330, 400);
    let a = -Math.PI / 2 + rng.range(-1.1, 1.1);
    const pts = [{ x, y }];
    const len = rng.int(6, 12);
    for (let k = 0; k < len; k++) {
      a += rng.range(-0.6, 0.6);
      const step = rng.range(8, 16);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push({ x, y: Math.min(400, y) });
    }
    tendrils.push({ points: pts, width: rng.range(3, 7) });
  }
  // a few tendrils crawling left across the mound
  for (let i = 0; i < 4; i++) {
    let x = rng.range(860, 900), y = rng.range(370, 395);
    const pts = [{ x, y }];
    for (let k = 0; k < 8; k++) {
      x -= rng.range(10, 18);
      y = Math.min(398, Math.max(360, y + rng.range(-7, 7)));
      pts.push({ x, y });
    }
    tendrils.push({ points: pts, width: rng.range(2, 4) });
  }
  // glowing pods (egg sacs) on the growth
  const pods = [];
  for (let i = 0; i < 10; i++) {
    pods.push({ x: rng.range(1040, 1190), y: rng.range(300, 390), r: rng.range(5, 11) });
  }
  return { depth: 0, rock, mound, tendrils, pods, color: PALETTE.growth, glow: PALETTE.growthGlow };
}

// ---------------------------------------------------------------------------
// Hunters: two crouching figures on the bridge (procedural stand-ins)
// ---------------------------------------------------------------------------

function buildHunters() {
  // x, y = feet position on the deck. crouch 0 = standing, 1 = fully crouched.
  // aim = gun angle in radians (0 = pointing right, y down).
  return [
    { x: 300, y: DECK_TOP, facing: 1, scale: 1.3, crouch: 0.55, aim: -0.04, backpack: true, scarf: false },
    { x: 430, y: DECK_TOP, facing: 1, scale: 1.2, crouch: 0.75, aim: -0.02, backpack: false, scarf: true },
  ];
}

// ---------------------------------------------------------------------------
// Rain (GPU-animated in every build)
// ---------------------------------------------------------------------------

/**
 * @param {number} seed
 * @param {number} count
 */
function buildRain(seed, count) {
  return {
    count,
    seed: subSeed(seed, 'rain'),
    speedMin: 650, // world units per second
    speedMax: 1000,
    angle: 0.1, // radians from vertical; positive = falling toward +x
    depthMin: 0,
    depthMax: 10,
    lengthMin: 7,
    lengthMax: 16,
    color: PALETTE.rain,
  };
}

/**
 * Per-drop attributes for the rain, deterministic from scene.rain.seed.
 * Upload once; animate in a shader with `rainDropAt` below (same maths).
 * @param {Scene} scene
 */
export function rainAttributes(scene) {
  const r = scene.rain;
  const rng = makeRng(r.seed);
  const n = r.count;
  const x0 = new Float32Array(n);
  const y0 = new Float32Array(n);
  const speed = new Float32Array(n);
  const depth = new Float32Array(n);
  const length = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x0[i] = rng.range(-100, WORLD.width + 100);
    y0[i] = rng.range(0, WORLD.height);
    // more drops far away than near (pow pushes toward depthMax)
    const d = r.depthMin + (r.depthMax - r.depthMin) * Math.pow(rng.next(), 0.6);
    depth[i] = d;
    const near = 1 / (1 + d * 0.25); // near drops are faster and longer
    speed[i] = (r.speedMin + (r.speedMax - r.speedMin) * rng.next()) * (0.45 + 0.55 * near);
    length[i] = (r.lengthMin + (r.lengthMax - r.lengthMin) * rng.next()) * (0.4 + 0.6 * near);
  }
  return { x0, y0, speed, depth, length };
}

/**
 * Where drop i is at time t (top of the streak). Shaders implement the same formula:
 *   travel = mod(y0 + speed * t, H + 40) - 20       (wraps top to bottom)
 *   y = travel,  x = x0 + tan(angle) * travel
 * @param {Scene} scene
 * @param {{ x0: Float32Array, y0: Float32Array, speed: Float32Array }} attrs
 * @param {number} i
 * @param {number} t
 */
export function rainDropAt(scene, attrs, i, t) {
  const H = WORLD.height + 40;
  const travel = ((((attrs.y0[i] + attrs.speed[i] * t) % H) + H) % H) - 20;
  return { x: attrs.x0[i] + Math.tan(scene.rain.angle) * travel, y: travel };
}

// ---------------------------------------------------------------------------
// Drips: water falling from the deck and platform edges
// ---------------------------------------------------------------------------

/** @param {number} seed */
function buildDrips(seed) {
  const rng = makeRng(subSeed(seed, 'drips'));
  // sources: x, y (edge), y1 (where the drop disappears)
  const sources = [
    { x: 252, y: DECK_TOP + 46, y1: 400 },
    { x: 560, y: DECK_TOP + 46, y1: 400 },
    { x: 566, y: DECK_TOP + 46, y1: 400 },
    { x: 330, y: DECK_TOP + 46, y1: 400 },
    { x: 880, y: 309, y1: 360 },
    { x: 1020, y: 309, y1: 330 },
    { x: 980, y: 216, y1: 297 },
  ];
  const drips = [];
  for (const src of sources) {
    for (let k = 0; k < 4; k++) {
      drips.push({ x: src.x + rng.range(-2, 2), y0: src.y, y1: src.y1, period: rng.range(0.9, 1.8), phase: rng.range(0, 2), depth: 0 });
    }
  }
  return { gravity: 520, color: PALETTE.water, drips, streamWidth: 1.5 };
}

/**
 * Position of a drip at time t: falls from y0 under gravity, restarts every period.
 * visible = false while waiting to fall or after passing y1.
 * @param {Scene} scene
 * @param {{ x: number, y0: number, y1: number, period: number, phase: number }} drip
 * @param {number} t
 */
export function dripState(scene, drip, t) {
  const local = (((t + drip.phase) % drip.period) + drip.period) % drip.period;
  const y = drip.y0 + 0.5 * scene.drips.gravity * local * local;
  return { x: drip.x, y, visible: y <= drip.y1, speed: scene.drips.gravity * local };
}

// ---------------------------------------------------------------------------
// Camera drift and parallax (shared by 2D and 3D builds)
// ---------------------------------------------------------------------------

/**
 * Horizontal camera drift in world units: slow, deterministic, +/- 30 over 20 s.
 * @param {Scene} scene
 * @param {number} t
 */
export function cameraX(scene, t) {
  return scene.camera.driftAmplitude * Math.sin((2 * Math.PI * t) / scene.camera.driftPeriod);
}

/**
 * Parallax factor: how much of the camera movement a layer at this depth follows.
 * 1 at depth 0 (moves with the foreground), approaching 0 far away.
 * @param {number} depth
 */
export function parallaxFactor(depth) {
  return 1 / (1 + depth);
}

/**
 * Screen-space x offset to add to an element at this depth (2D builds).
 * @param {Scene} scene
 * @param {number} depth
 * @param {number} t
 */
export function parallaxOffset(scene, depth, t) {
  return -cameraX(scene, t) * parallaxFactor(depth);
}

/**
 * Lamp flicker multiplier (most lamps steady, a few flicker).
 * @param {number} index
 * @param {number} t
 */
export function lampFlicker(index, t) {
  if (index % 5 !== 3) return 1;
  const v = Math.sin(t * 17 + index * 3.1) + Math.sin(t * 7.3 + index);
  return v > 1.4 ? 0.35 : 1;
}

/**
 * Red warning-light blink (0.25..1).
 * @param {number} index
 * @param {number} t
 */
export function redBlink(index, t) {
  return 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 3 + index * 0.9)) ** 4;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Linear blend of two 0xRRGGBB colours.
 * @param {number} a @param {number} b @param {number} f 0..1
 */
export function lerpColor(a, b, f) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * f) << 16) | (Math.round(ag + (bg - ag) * f) << 8) | Math.round(ab + (bb - ab) * f);
}

/**
 * Apply depth haze to a colour (convenience for builds that tint per element).
 * @param {Scene} scene @param {number} color @param {number} depth
 */
export function hazed(scene, color, depth) {
  const h = hazeAt(scene, depth);
  return lerpColor(color, h.color, h.opacity);
}
