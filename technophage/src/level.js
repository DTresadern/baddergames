// Level generation from hand-authored chunks, plus tile collision.
// Host and guest generate the same level from (zone, seed).

import { TILE, T } from './config.js';
import { makeRng } from './util.js';

const ROWS = 22;

// Legend
//  .  empty           #  solid             =  one-way platform     H  ladder
//  ^  hazard          ~  toxic liquid      B  breakable block      G  gate (arena lock)
//  L  lamp            E  ground enemy      F  air enemy            M  static enemy (mould / burster)
//  C  crate           A  ammo              +  medkit               R  rare (weapon or power-up)
//  X  checkpoint      P  player start      >  exit lift            b  boss spawn
//  T  arena trigger column (any row)
export const CHUNKS = {
  start: [
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '.........L..........',
    '..........======....',
    '....................',
    '....................',
    '...........H........',
    '...........H....A...',
    '...L.......H..====..',
    '..P.P..X...H.....C..',
    '####################',
    '####################',
    '####################',
  ],
  mid: [
    // 0: catwalk over a toxic pit
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.........F..........',
      '....................',
      '....L.........L.....',
      '...........A........',
      '......==========....',
      '....................',
      '.....E..............',
      '...======...........',
      '..............E.....',
      '...............C....',
      '....................',
      '######~~~~~~~~######',
      '######~~~~~~~~######',
      '####################',
    ],
    // 1: stepped block (symmetric, 2-tile steps), high route with medkit
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.........+..........',
      '.......======.......',
      '..L..............L..',
      '..====........====..',
      '...F......E.........',
      '........####........',
      '.....E..####...E....',
      '......########......',
      '......########......',
      '...##############...',
      '.C.##############...',
      '####################',
      '####################',
      '####################',
    ],
    // 2: ladder tower: open ground route, ladder to three upper floors
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '.......R............',
      '....=======H........',
      '...........H........',
      '.......E...H....L...',
      '....####B##H==......',
      '...........H........',
      '.......A...H........',
      '....=======H........',
      '...........H........',
      '..L........H....F...',
      '...........H........',
      '..E.....===H........',
      '...........H........',
      '.C.........H..E.....',
      '...........H........',
      '#########B######~~##',
      '################~~##',
      '####################',
    ],
    // 3: hazard floor with floating platforms
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.........F..........',
      '....................',
      '..L........L.....L..',
      '....................',
      '.......====.........',
      '...............A....',
      '.............====...',
      '..===...............',
      '..........E.........',
      '.........====.......',
      '....................',
      '...^^^^^^^^^^^^^^...',
      '####################',
      '####################',
      '####################',
    ],
    // 4: tunnel with breakable wall and secret cache
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '####################',
      '#####.......####R###',
      '..L.......L.....B...',
      '....................',
      '.....E........E.....',
      '..................C.',
      '..A.................',
      '####################',
      '####################',
      '####################',
    ],
    // 5: double-deck with spawner
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.......F............',
      '....................',
      '....L........L......',
      '..........E.........',
      '...=================',
      '...H................',
      '...H................',
      '...H..........M.....',
      '...H.....E.....####.',
      '...H............##..',
      '...H.....C.......#..',
      '...H.....+.......#..',
      '####################',
      '####################',
      '####################',
    ],
    // 6: drop shaft and climb out
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.............F......',
      '.....L..............',
      '....................',
      '....................',
      '..====.....A........',
      '..........====......',
      '....................',
      '.......E............',
      '......=====.....H...',
      '................H...',
      '.........E......H...',
      '....M...........H.C.',
      '####################',
      '####################',
      '####################',
    ],
    // 7: crate yard
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '........F...........',
      '...L.........L......',
      '....................',
      '.............A......',
      '..........======....',
      '....................',
      '......E.............',
      '.....====....E......',
      '..C.........C.....C.',
      '..C....X....C.....C.',
      '####################',
      '####################',
      '####################',
    ],
    // 8: overpass over a gap of spikes
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.......L......L.....',
      '....................',
      '........F...........',
      '..........A.........',
      '.....=============..',
      '.....H..........H...',
      '.....H...E......H...',
      '.....H..........H...',
      '.....H..........H...',
      '..E..H..........H...',
      '.....H^^^^^^^^^^H...',
      '######^^^^^^^^^^####',
      '####################',
      '####################',
    ],
    // 9: pillar hall with two spawners
    [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '..L.....L......L....',
      '....................',
      '.....##.....##......',
      '.....##.....##......',
      '.....##.....##......',
      '.....##..R..##......',
      '.....##=====##......',
      '.....##.....##......',
      '.........E..........',
      '..A.M..........M....',
      '####################',
      '####################',
      '####################',
    ],
  ],
  arena: [
    'G............................G',
    'G............................G',
    'G............................G',
    'G............................G',
    'G............................G',
    'G............................G',
    'G............................G',
    'G............................G',
    'G............................G',
    'G...L.........L.........L....G',
    'G............................G',
    'G............................G',
    'G........=====....=====......G',
    'G............................G',
    'G.....+....................A.G',
    'G............................G',
    'G..T....====........====.....G',
    'G............................G',
    'G.....A......b...........+...G',
    '##############################',
    '##############################',
    '##############################',
  ],
  exit: [
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '.........L..........',
    '....................',
    '....................',
    '....................',
    '....................',
    '....X......>........',
    '####################',
    '####################',
    '####################',
  ],
};

export class Level {
  // layout (testing only): [{ k: 'start' | 'arena' | 'exit' | <mid chunk index>, mirror: bool }]
  constructor(zoneIndex, seed, zone, layout = null) {
    this.zoneIndex = zoneIndex;
    this.seed = seed;
    this.zone = zone;
    this.layout = layout;
    this.build();
  }

  build() {
    const rng = makeRng(this.seed);
    const zi = this.zoneIndex;
    const order = ['start'];
    const count = 6 + Math.min(zi, 4);
    let last = -1;
    for (let i = 0; i < count; i++) {
      let k;
      do k = rng.int(0, CHUNKS.mid.length - 1);
      while (k === last);
      last = k;
      order.push(k);
    }
    order.push('arena', 'exit');

    for (const rows of [CHUNKS.start, CHUNKS.arena, CHUNKS.exit, ...CHUNKS.mid]) {
      if (rows.length !== ROWS || rows.some((r) => r.length !== rows[0].length)) throw new Error('Malformed level chunk: ' + rows[0]);
    }
    if (this.layout) order.splice(0, order.length, ...this.layout.map((l) => l.k));
    const pieces = order.map((k, i) => {
      const rows = typeof k === 'number' ? CHUNKS.mid[k] : CHUNKS[k];
      const coin = rng.chance(0.5);
      const mirror = typeof k === 'number' && (this.layout ? !!this.layout[i].mirror : coin);
      return rows.map((r) => (mirror ? [...r].reverse().join('') : r));
    });
    this.w = pieces.reduce((s, p) => s + p[0].length, 0) + 2;
    this.h = ROWS;
    this.tiles = new Uint8Array(this.w * this.h);
    this.hp = new Float32Array(this.w * this.h); // breakable block health
    this.spawns = [];
    this.lamps = [];
    this.starts = [];
    this.checkpoints = [];
    this.gates = [];
    this.crates = [];
    this.pickups = [];
    this.exit = null;
    this.bossSpawn = null;
    this.arenaX = 0;
    this.arenaStartX = 0;

    // solid border column on each side
    for (let y = 0; y < ROWS; y++) {
      this.set(0, y, T.SOLID);
      this.set(this.w - 1, y, T.SOLID);
    }
    let ox = 1;
    let uid = 0;
    this.pieces = []; // chunk placement, for tools and debugging
    this.topUsed = new Array(this.w).fill(ROWS); // highest row any chunk content uses, per column
    pieces.forEach((rows, pi) => {
      this.pieces.push({ k: order[pi], x0: ox, w: rows[0].length });
      const isArena = order[pi] === 'arena';
      if (isArena) {
        this.arenaStartX = ox * TILE;
        this.arenaEndX = (ox + rows[0].length) * TILE;
      }
      for (let y = 0; y < ROWS; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          if (c !== '.') this.topUsed[ox + x] = Math.min(this.topUsed[ox + x], y);
          const tx = ox + x;
          const px = tx * TILE + TILE / 2;
          const py = (y + 1) * TILE; // bottom of the cell
          switch (c) {
            case '#': this.set(tx, y, T.SOLID); break;
            case '=': this.set(tx, y, T.PLATFORM); break;
            case 'H': this.set(tx, y, T.LADDER); break;
            case '^': this.set(tx, y, T.HAZARD); break;
            case '~': this.set(tx, y, T.LIQUID); break;
            case 'B': this.set(tx, y, T.BREAK); this.hp[y * this.w + tx] = 60; break;
            case 'G': this.set(tx, y, T.GATE); this.gates.push([tx, y]); break;
            case 'L': this.lamps.push({ x: px, y: y * TILE + 6, color: rng.pick(this.zone.lights), flicker: rng.chance(0.3) }); break;
            case 'E': this.spawns.push({ id: uid++, pool: 'ground', x: px, y: py }); break;
            case 'F': this.spawns.push({ id: uid++, pool: 'air', x: px, y: py }); break;
            case 'M': this.spawns.push({ id: uid++, pool: 'static', x: px, y: py }); break;
            case 'C': this.crates.push({ x: px, y: py }); break;
            case 'A': this.pickups.push({ kind: 'ammo', x: px, y: py }); break;
            case '+': this.pickups.push({ kind: 'medkit', x: px, y: py }); break;
            case 'R': this.pickups.push({ kind: 'rare', x: px, y: py }); break;
            case 'X': this.checkpoints.push({ x: px, y: py }); break;
            case 'P': this.starts.push({ x: px, y: py }); break;
            case '>': this.exit = { x: tx * TILE - TILE * 2, y: py - TILE * 3, w: TILE * 5, h: TILE * 3 }; break;
            case 'b': this.bossSpawn = { x: px, y: py }; break;
            case 'T': this.arenaX = tx * TILE; break;
          }
        }
      }
      ox += rows[0].length;
    });

    // Cave ceilings and uneven floors make the deeper zones feel natural rather than built.
    if (this.zone.cave) {
      // Never grow rock within 3 rows of anything a chunk places (in this column or its
      // neighbours), so the ceiling cannot seal off platforms, ladders or pickups.
      const clear = (x) => Math.min(this.topUsed[x - 1] ?? ROWS, this.topUsed[x], this.topUsed[x + 1] ?? ROWS) - 3;
      for (let x = 1; x < this.w - 1; x++) {
        const limit = clear(x);
        const h = Math.min(limit, Math.round(2 + Math.sin(x * 0.31 + this.seed) * 1.2 + Math.sin(x * 0.13) * 1.5 + rng() * 1.2));
        for (let y = 0; y < h; y++) if (this.get(x, y) === T.EMPTY) this.set(x, y, T.SOLID);
        if (rng.chance(0.18)) {
          const len = rng.int(1, 3);
          for (let y = Math.max(0, h); y < Math.min(h + len, limit); y++) if (this.get(x, y) === T.EMPTY && this.get(x, y + 1) === T.EMPTY) this.set(x, y, T.SOLID);
        }
      }
    }
    // Tag every breakable block with health
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === T.BREAK && !this.hp[i]) this.hp[i] = 60;
    this.gateClosed = false;
    this.pxW = this.w * TILE;
    this.pxH = this.h * TILE;
  }

  get(tx, ty) {
    if (tx < 0 || tx >= this.w) return T.SOLID;
    if (ty < 0) return T.EMPTY;
    if (ty >= this.h) return T.SOLID;
    return this.tiles[ty * this.w + tx];
  }

  set(tx, ty, v) {
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return;
    this.tiles[ty * this.w + tx] = v;
  }

  isSolidTile(t) {
    return t === T.SOLID || t === T.BREAK || (t === T.GATE && this.gateClosed);
  }

  solidAt(px, py) {
    return this.isSolidTile(this.get(Math.floor(px / TILE), Math.floor(py / TILE)));
  }

  tileAt(px, py) {
    return this.get(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  // Line of sight between two points, stepping half a tile at a time.
  los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / (TILE / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solidAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  // Damage a breakable block. Returns true when it is destroyed.
  damageTile(tx, ty, dmg) {
    if (this.get(tx, ty) !== T.BREAK) return false;
    const i = ty * this.w + tx;
    this.hp[i] -= dmg;
    if (this.hp[i] <= 0) {
      this.set(tx, ty, T.EMPTY);
      (this.destroyed ||= []).push([tx, ty]);
      return true;
    }
    return false;
  }

  // Move an axis-aligned body {x,y,w,h,vx,vy} by its velocity with tile collision.
  // opts.dropThrough ignores one-way platforms; opts.ladderTop treats ladder tops as platforms.
  moveBody(b, dt, opts = {}) {
    b.hitWall = 0;
    b.onGround = false;
    b.hitCeil = false;
    // Horizontal
    let nx = b.x + b.vx * dt;
    if (b.vx !== 0) {
      const edge = b.vx > 0 ? nx + b.w : nx;
      const tx = Math.floor(edge / TILE);
      const y0 = Math.floor((b.y + 1) / TILE);
      const y1 = Math.floor((b.y + b.h - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        if (this.isSolidTile(this.get(tx, ty))) {
          nx = b.vx > 0 ? tx * TILE - b.w - 0.01 : (tx + 1) * TILE + 0.01;
          b.hitWall = b.vx > 0 ? 1 : -1;
          b.vx = 0;
          break;
        }
      }
    }
    b.x = nx;
    // Vertical
    let ny = b.y + b.vy * dt;
    const x0 = Math.floor((b.x + 1) / TILE);
    const x1 = Math.floor((b.x + b.w - 1) / TILE);
    if (b.vy > 0) {
      const oldBottom = b.y + b.h;
      const ty = Math.floor((ny + b.h) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.get(tx, ty);
        let stand = this.isSolidTile(t);
        if (!stand && !opts.dropThrough && oldBottom <= ty * TILE + 0.5) {
          if (t === T.PLATFORM) stand = true;
          if (t === T.LADDER && opts.ladderTop && this.get(tx, ty - 1) !== T.LADDER) stand = true;
        }
        if (stand) {
          ny = ty * TILE - b.h;
          b.vy = 0;
          b.onGround = true;
          break;
        }
      }
    } else if (b.vy < 0) {
      const ty = Math.floor(ny / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isSolidTile(this.get(tx, ty))) {
          ny = (ty + 1) * TILE + 0.01;
          b.vy = 0;
          b.hitCeil = true;
          break;
        }
      }
    }
    b.y = ny;
    // Ground probe for bodies resting exactly on a surface
    if (!b.onGround && b.vy >= 0) {
      const ty = Math.floor((b.y + b.h + 1) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.get(tx, ty);
        if (this.isSolidTile(t) || (!opts.dropThrough && (t === T.PLATFORM || (t === T.LADDER && opts.ladderTop && this.get(tx, ty - 1) !== T.LADDER)) && Math.abs(b.y + b.h - ty * TILE) < 1.5)) {
          if (Math.abs(b.y + b.h - ty * TILE) < 1.5) b.onGround = true;
          break;
        }
      }
    }
  }

  // Which tile types does the body overlap?
  overlaps(b, type) {
    const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.get(tx, ty) === type) return true;
    return false;
  }
}
