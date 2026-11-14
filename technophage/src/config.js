// Shared constants. All distances are in game pixels, times in seconds.

export const VIEW_W = 960;
export const VIEW_H = 540;
export const TILE = 32;
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // host sends a snapshot every N ticks (30 per second)
// Game version shown on the main menu. Bump on each release: major.minor.patch
export const VERSION = '0.4.0';
export const PROTOCOL = 2; // bump when the network messages change; mismatched clients are refused
// Playtest tuning: multiply health without editing every enemy definition
export const TUNING = {
  bossHp: 1,
  enemyHp: 1,
  bossCoopScale: 0.35, // extra boss health per additional player (enemies use 0.6)
};
export const INTERP_DELAY = 0.1; // guests draw remote things this far in the past

// Tile ids
export const T = {
  EMPTY: 0,
  SOLID: 1,
  PLATFORM: 2, // one-way, stand on top, jump up through, drop down through
  LADDER: 3,
  HAZARD: 4,
  LIQUID: 5,
  BREAK: 6, // breakable block, destroyed by damage
  GATE: 7, // solid while its gate is closed
};

export const PLAYER = {
  w: 26,
  h: 60, // 2 tiles minus a little, so 2-tile-high passages fit
  runSpeed: 235,
  groundAccel: 2600,
  airAccel: 1500,
  friction: 2200,
  gravity: 1750,
  jumpVel: 700, // ~140 px (4.4 tiles) at full hold
  jumpCut: 0.45, // vertical speed multiplier when jump is released early
  maxFall: 950,
  coyote: 0.1,
  jumpBuffer: 0.12,
  climbSpeed: 170,
  dashSpeed: 620,
  dashTime: 0.16,
  dashCooldown: 0.7,
  maxHp: 100,
  invuln: 0.6,
  bleedOut: 18, // seconds a downed player can be revived
  reviveTime: 1.6,
  respawnDelay: 4,
};

// Ammo pools
export const AMMO = {
  coil: { max: 40, pickup: 12 },
  fuel: { max: 240, pickup: 80 },
  cell: { max: 160, pickup: 50 },
  disc: { max: 6, pickup: 2 },
};

// Weapons. Index is the weapon slot (keys 1-4).
export const WEAPONS = [
  {
    id: 'pulse', name: 'PULSE CARBINE', ammo: null, interval: 0.11, dmg: 9, speed: 980,
    spread: 0.035, life: 0.9, color: '#ffb347', kind: 'bolt', sprite: null, sound: 'pulse',
  },
  {
    id: 'coil', name: 'COIL RIFLE', ammo: 'coil', interval: 0.55, dmg: 70, speed: 2100,
    spread: 0, life: 0.6, pierce: 5, color: '#7ff6ff', kind: 'rail', sprite: 'w_coil', sound: 'coil',
    breaks: true,
  },
  {
    id: 'incin', name: 'INCINERATOR', ammo: 'fuel', interval: 0.035, dmg: 3.2, speed: 430,
    spread: 0.16, life: 0.5, pierce: 99, color: '#ff7a1a', kind: 'flame', sprite: 'w_incin', sound: 'flame',
  },
  {
    id: 'plasma', name: 'PLASMA CUTTER', ammo: 'cell', interval: 0.05, dmg: 7, range: 250,
    color: '#b7fbff', kind: 'beam', sprite: 'w_plasma', sound: 'beam', breaks: true,
  },
];

export const DISC = { speed: 560, fuse: 1.25, radius: 96, dmg: 95, cooldown: 0.6 };

export const POWERUP_TIME = { cloak: 10, overdrive: 10 };

export const ZONES = [
  {
    key: 'upper', name: 'UPPER MEGACITY', sub: 'Spire District 9 — curfew in effect',
    bg: ['upper', 'upper_alt'], ambient: [0.38, 0.42, 0.54], fog: 'rgba(40,70,110,0.10)',
    sky: ['#05070d', '#13213a'], rain: true,
    tiles: { base: '#2a2f38', dark: '#14171c', light: '#4a5361', accent: '#d8a21c', grime: '#1d2a33', trim: '#ff2bd6' },
    lights: ['#ff2bd6', '#2be8ff', '#ffb347'],
    ground: ['enforcer', 'enforcer', 'rat', 'stalker'], air: ['drone', 'drone', 'swarm'], static: ['burster'],
    boss: 'drone_boss',
  },
  {
    key: 'lower', name: 'LOWER MEGACITY', sub: 'Block 41 checkpoint — enforcement zone',
    bg: ['lower'], ambient: [0.44, 0.38, 0.31], fog: 'rgba(110,80,40,0.10)',
    sky: ['#0b0805', '#2a1d10'], rain: true,
    tiles: { base: '#3b3530', dark: '#1b1714', light: '#6b6155', accent: '#e0b020', grime: '#2c241c', trim: '#ff3b2b' },
    lights: ['#ffb347', '#ff3b2b', '#ffd27a'],
    ground: ['enforcer', 'enforcer', 'mech', 'stalker'], air: ['drone'], static: ['burster'],
    boss: 'mech_boss',
  },
  {
    key: 'underbelly', name: 'THE UNDERBELLY', sub: 'Pumping Station 7 — containment failing',
    bg: ['underbelly'], ambient: [0.27, 0.33, 0.31], fog: 'rgba(40,90,80,0.12)',
    sky: ['#030606', '#0e1c1a'], rain: false, drips: true,
    tiles: { base: '#26302d', dark: '#0f1413', light: '#45574f', accent: '#c9b13a', grime: '#1b2b22', trim: '#ff2b2b' },
    lights: ['#ff2b2b', '#e8d27a', '#4fffd0'],
    ground: ['rat', 'rat', 'stalker', 'worm'], air: ['swarm'], static: ['mould', 'burster'],
    boss: 'worm_boss',
  },
  {
    key: 'caverns', name: 'THE CAVERNS', sub: 'Excavation Shaft K — signal lost',
    bg: ['caverns', 'caverns_alt'], ambient: [0.27, 0.25, 0.37], fog: 'rgba(70,40,110,0.12)',
    sky: ['#040309', '#160f26'], rain: false, drips: true, cave: true,
    tiles: { base: '#2c2838', dark: '#121019', light: '#4d4560', accent: '#7cff6b', grime: '#22301f', trim: '#64e8ff' },
    lights: ['#7cff6b', '#64e8ff', '#b77cff'],
    ground: ['insectoid', 'stalker', 'rat', 'stalker'], air: ['swarm'], static: ['mould'],
    boss: 'insectoid_boss',
  },
  {
    key: 'depths', name: 'INFESTED DEPTHS', sub: 'The hive is awake',
    bg: ['depths'], ambient: [0.37, 0.22, 0.24], fog: 'rgba(110,20,40,0.14)',
    sky: ['#070203', '#230810'], rain: false, drips: true, cave: true, flesh: true,
    tiles: { base: '#3a1d22', dark: '#160709', light: '#6b3238', accent: '#5ff3ff', grime: '#2a0c10', trim: '#5ff3ff' },
    lights: ['#5ff3ff', '#ff3b5b', '#ffb0b0'],
    ground: ['stalker', 'stalker', 'insectoid', 'rat'], air: ['swarm', 'swarm'], static: ['burster', 'mould'],
    boss: 'burster_boss',
  },
];
