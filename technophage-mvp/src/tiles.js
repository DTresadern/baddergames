// Procedural pixel-art for level tiles and the mid-distance parallax layer.
// Every tile is drawn from a seed derived from its position, so redraws match.

import { TILE, T, VIEW_H } from './config.js';
import { makeRng } from './util.js';
import { assets } from './assets.js';

const SEG = 512; // static level canvas segment width in pixels

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  } else {
    r *= 1 + f;
    g *= 1 + f;
    b *= 1 + f;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export const LIQUID_COLOR = {
  upper: ['#1fb6c9', '#0c4f5a'],
  lower: ['#6b5a2a', '#2a2210'],
  underbelly: ['#8fbf2a', '#2c3d0a'],
  caverns: ['#8a4cff', '#2a1050'],
  depths: ['#b0182a', '#3a0510'],
};

export class LevelArt {
  constructor(level, zone) {
    this.level = level;
    this.zone = zone;
    this.pal = zone.tiles;
    this.segs = [];
    this.depth = this.computeDepth();
    const n = Math.ceil(level.pxW / SEG);
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = SEG;
      c.height = level.pxH;
      this.segs.push(c);
    }
    for (let ty = 0; ty < level.h; ty++) for (let tx = 0; tx < level.w; tx++) this.drawTile(tx, ty);
  }

  // Distance (in tiles, max 5) from each solid tile to open space; deep rock goes dark.
  computeDepth() {
    const L = this.level;
    const d = new Uint8Array(L.w * L.h).fill(5);
    const q = [];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (!L.isSolidTile(L.get(x, y)) || L.get(x, y) === T.GATE) {
        d[y * L.w + x] = 0;
        q.push([x, y]);
      }
    }
    while (q.length) {
      const [x, y] = q.shift();
      const v = d[y * L.w + x];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
        if (d[ny * L.w + nx] > v + 1) {
          d[ny * L.w + nx] = v + 1;
          q.push([nx, ny]);
        }
      }
    }
    return d;
  }

  ctxFor(px) {
    const i = Math.floor(px / SEG);
    return [this.segs[i], i * SEG];
  }

  // Redraw a tile and its neighbours after the level changes
  refresh(tx, ty) {
    this.depth = this.computeDepth();
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
      if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) continue;
      const px = x * TILE;
      const [c, ox] = this.ctxFor(px);
      if (!c) continue;
      c.getContext('2d').clearRect(px - ox, y * TILE, TILE, TILE);
      this.drawTile(x, y);
    }
  }

  drawTile(tx, ty) {
    const L = this.level;
    const t = L.get(tx, ty);
    if (t === T.EMPTY || t === T.GATE || t === T.LIQUID) return;
    const px = tx * TILE, py = ty * TILE;
    const [c, ox] = this.ctxFor(px);
    if (!c) return;
    const g = c.getContext('2d');
    g.save();
    g.translate(px - ox, py);
    g.beginPath();
    g.rect(0, 0, TILE, TILE);
    g.clip();
    const rng = makeRng((tx * 73856093) ^ (ty * 19349663) ^ L.seed);
    const solid = (x, y) => {
      const v = L.get(x, y);
      return v === T.SOLID || v === T.BREAK;
    };
    if (t === T.SOLID) this.solid(g, rng, tx, ty, solid);
    else if (t === T.BREAK) {
      const img = assets.sprites['breakable_' + L.breakStage(tx, ty)];
      if (img) g.drawImage(img, 0, 0, TILE, TILE);
      else this.breakable(g, rng);
    }
    else if (t === T.PLATFORM) this.platform(g, rng, L.get(tx - 1, ty) === T.PLATFORM, L.get(tx + 1, ty) === T.PLATFORM);
    else if (t === T.LADDER) this.ladder(g);
    else if (t === T.HAZARD) this.hazard(g, rng);
    g.restore();
  }

  solid(g, rng, tx, ty, solid) {
    const p = this.pal;
    const z = this.zone;
    const depth = this.depth[ty * this.level.w + tx];
    const dark = Math.min(1, (depth - 1) / 4);
    const up = !solid(tx, ty - 1), down = !solid(tx, ty + 1), left = !solid(tx - 1, ty), right = !solid(tx + 1, ty);
    g.fillStyle = shade(p.base, -0.65 * dark);
    g.fillRect(0, 0, TILE, TILE);
    if (z.cave) {
      // Rock: blotches, cracks, mineral glints
      for (let i = 0; i < 7; i++) {
        g.fillStyle = shade(p.base, rng.range(-0.5, 0.2) - 0.6 * dark);
        const s = rng.int(4, 12);
        g.fillRect(rng.int(-4, TILE - 4), rng.int(-4, TILE - 4), s, s * rng.range(0.5, 1));
      }
      if (rng.chance(0.4)) {
        g.strokeStyle = shade(p.dark, -0.3);
        g.beginPath();
        let x = rng.int(0, TILE), y = 0;
        g.moveTo(x, y);
        for (let i = 0; i < 4; i++) g.lineTo((x += rng.int(-6, 6)), (y += 8));
        g.stroke();
      }
      if (z.flesh) {
        g.strokeStyle = 'rgba(160,30,50,0.6)';
        g.beginPath();
        g.moveTo(rng.int(0, TILE), 0);
        g.quadraticCurveTo(rng.int(0, TILE), rng.int(0, TILE), rng.int(0, TILE), TILE);
        g.stroke();
        if (rng.chance(0.15) && depth < 3) {
          g.fillStyle = p.accent;
          g.fillRect(rng.int(4, 26), rng.int(4, 26), 3, 3);
        }
      } else if (rng.chance(0.12) && depth < 3) {
        g.fillStyle = p.trim;
        g.fillRect(rng.int(4, 26), rng.int(4, 26), 2, 2);
      }
    } else {
      // Industrial plating: panel seams, rivets, grime, vents
      g.fillStyle = shade(p.dark, -0.2);
      g.fillRect(0, TILE - 1, TILE, 1);
      g.fillRect(TILE - 1, 0, 1, TILE);
      g.fillStyle = shade(p.light, -0.3 - 0.6 * dark);
      g.fillRect(0, 0, TILE, 1);
      g.fillRect(0, 0, 1, TILE);
      for (let i = 0; i < 20; i++) {
        g.fillStyle = rng.chance(0.5) ? shade(p.dark, -0.5 * dark) : shade(p.light, -0.4 - 0.5 * dark);
        g.fillRect(rng.int(1, TILE - 2), rng.int(1, TILE - 2), 1, 1);
      }
      if (depth <= 2) {
        const v = rng();
        if (v < 0.15) {
          // vent slats
          g.fillStyle = shade(p.dark, -0.4);
          for (let y = 8; y < 26; y += 4) g.fillRect(6, y, 20, 2);
        } else if (v < 0.3) {
          // pipe
          g.fillStyle = shade(p.light, -0.2);
          g.fillRect(0, 12, TILE, 7);
          g.fillStyle = shade(p.light, 0.15);
          g.fillRect(0, 13, TILE, 1);
          g.fillStyle = shade(p.dark, -0.2);
          g.fillRect(0, 18, TILE, 1);
        } else if (v < 0.4) {
          g.fillStyle = shade(p.dark, -0.1);
          g.fillRect(4, 4, 24, 24);
          g.fillStyle = shade(p.base, 0.05);
          g.fillRect(5, 5, 22, 22);
        }
        // rivets
        g.fillStyle = shade(p.light, 0.1 - 0.5 * dark);
        for (const [x, y] of [[3, 3], [28, 3], [3, 28], [28, 28]]) g.fillRect(x, y, 2, 2);
        // grime runs
        g.fillStyle = 'rgba(0,0,0,0.25)';
        if (rng.chance(0.4)) g.fillRect(rng.int(2, 28), 0, rng.int(1, 3), rng.int(8, 32));
        g.fillStyle = p.grime;
        g.globalAlpha = 0.35;
        if (rng.chance(0.5)) g.fillRect(rng.int(0, 20), rng.int(0, 20), rng.int(6, 14), rng.int(4, 12));
        g.globalAlpha = 1;
      }
    }
    // Edges
    if (up) {
      if (z.flesh) {
        g.fillStyle = shade(p.light, 0.1);
        g.fillRect(0, 0, TILE, 4);
        g.fillStyle = shade(p.light, 0.4);
        g.fillRect(0, 0, TILE, 1);
        g.fillStyle = shade(p.base, -0.2);
        for (let x = 0; x < TILE; x += rng.int(3, 7)) g.fillRect(x, 4, 2, rng.int(2, 7));
      } else if (z.cave) {
        g.fillStyle = shade(p.light, 0.05);
        g.fillRect(0, 0, TILE, 3);
        g.fillStyle = p.accent;
        g.globalAlpha = 0.55;
        for (let x = 0; x < TILE; x += 2) if (rng.chance(0.55)) g.fillRect(x, 0, 2, rng.int(1, 5));
        g.globalAlpha = 1;
      } else {
        g.fillStyle = shade(p.light, 0.2);
        g.fillRect(0, 0, TILE, 2);
        g.fillStyle = shade(p.dark, -0.3);
        g.fillRect(0, 2, TILE, 1);
        if ((tx + ty) % 5 < 2) {
          // hazard stripes along walkable edges
          for (let x = -8; x < TILE; x += 8) {
            g.fillStyle = p.accent;
            g.beginPath();
            g.moveTo(x, 3);
            g.lineTo(x + 4, 3);
            g.lineTo(x + 8, 8);
            g.lineTo(x + 4, 8);
            g.fill();
          }
          g.fillStyle = '#0d0d0d';
          g.fillRect(0, 8, TILE, 1);
        }
      }
    }
    if (down) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, TILE - 4, TILE, 4);
      if (z.cave && rng.chance(0.4)) {
        g.fillStyle = shade(p.base, -0.3);
        const x = rng.int(4, 26);
        g.fillRect(x, TILE - 4, 3, 4);
      }
    }
    if (left) {
      g.fillStyle = shade(p.light, -0.1);
      g.fillRect(0, 0, 2, TILE);
    }
    if (right) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(TILE - 3, 0, 3, TILE);
    }
  }

  breakable(g, rng) {
    const p = this.pal;
    g.fillStyle = shade(p.base, 0.12);
    g.fillRect(0, 0, TILE, TILE);
    g.fillStyle = shade(p.light, 0.1);
    g.fillRect(1, 1, TILE - 2, 2);
    g.strokeStyle = shade(p.dark, -0.4);
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      let x = rng.int(4, 28), y = rng.int(0, 10);
      g.moveTo(x, y);
      for (let j = 0; j < 4; j++) g.lineTo((x += rng.int(-7, 7)), (y += rng.int(4, 9)));
      g.stroke();
    }
    g.fillStyle = p.trim;
    g.globalAlpha = 0.8;
    g.fillRect(12, 13, 8, 6);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(15, 14, 2, 4);
  }

  platform(g, rng, hasL, hasR) {
    const p = this.pal;
    const z = this.zone;
    if (z.flesh) {
      g.fillStyle = shade(p.light, -0.1);
      g.fillRect(0, 2, TILE, 7);
      g.fillStyle = shade(p.light, 0.3);
      g.fillRect(0, 2, TILE, 1);
      g.fillStyle = shade(p.base, -0.3);
      for (let x = 0; x < TILE; x += 6) g.fillRect(x, 9, 2, rng.int(2, 8));
      return;
    }
    if (z.cave) {
      // timber scaffolding
      g.fillStyle = '#4a3420';
      g.fillRect(0, 2, TILE, 7);
      g.fillStyle = '#7a5a34';
      g.fillRect(0, 2, TILE, 2);
      g.fillStyle = '#2a1c10';
      g.fillRect(0, 8, TILE, 1);
      g.fillRect(rng.int(4, 28), 3, 1, 5);
      if (!hasL || !hasR) {
        g.fillStyle = '#3a2816';
        g.fillRect(hasL ? TILE - 6 : 2, 9, 4, 23);
      }
      return;
    }
    // steel catwalk with grating and rail
    g.fillStyle = shade(p.light, 0.35);
    g.fillRect(0, 0, TILE, 3);
    g.fillStyle = shade(p.accent, -0.2);
    if (!hasL) g.fillRect(0, 0, 4, 3);
    if (!hasR) g.fillRect(TILE - 4, 0, 4, 3);
    g.fillStyle = shade(p.dark, -0.3);
    g.fillRect(0, 3, TILE, 1);
    g.fillStyle = shade(p.base, -0.1);
    g.fillRect(0, 4, TILE, 6);
    g.fillStyle = shade(p.dark, -0.5);
    for (let x = 1; x < TILE; x += 4) g.fillRect(x, 5, 2, 4);
    g.fillStyle = shade(p.light, -0.2);
    for (let x = 0; x < TILE; x += 16) g.fillRect(x, 10, 2, 6);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, 10, TILE, 2);
  }

  ladder(g) {
    const p = this.pal;
    const col = this.zone.cave ? '#6a5236' : shade(p.accent, -0.35);
    g.fillStyle = col;
    g.fillRect(6, 0, 3, TILE);
    g.fillRect(23, 0, 3, TILE);
    for (let y = 4; y < TILE; y += 8) {
      g.fillRect(6, y, 20, 2);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(6, y + 2, 20, 1);
      g.fillStyle = col;
    }
  }

  hazard(g, rng) {
    const z = this.zone;
    const p = this.pal;
    if (z.flesh) {
      for (let x = 0; x < TILE; x += 8) {
        g.fillStyle = '#e8d8c0';
        g.beginPath();
        g.moveTo(x, TILE);
        g.lineTo(x + 4, TILE - rng.int(14, 26));
        g.lineTo(x + 8, TILE);
        g.fill();
        g.fillStyle = '#7a1018';
        g.fillRect(x + 1, TILE - 4, 6, 4);
      }
      return;
    }
    if (z.cave) {
      for (let x = 0; x < TILE; x += 8) {
        const h = rng.int(12, 26);
        g.fillStyle = p.trim;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.moveTo(x, TILE);
        g.lineTo(x + 3, TILE - h);
        g.lineTo(x + 8, TILE);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#fff';
        g.fillRect(x + 3, TILE - h + 2, 1, 4);
      }
      return;
    }
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, TILE - 6, TILE, 6);
    for (let x = 0; x < TILE; x += 8) {
      g.fillStyle = '#9aa0a8';
      g.beginPath();
      g.moveTo(x, TILE - 5);
      g.lineTo(x + 4, TILE - 22);
      g.lineTo(x + 8, TILE - 5);
      g.fill();
      g.fillStyle = '#d8dde4';
      g.fillRect(x + 3, TILE - 20, 1, 10);
      g.fillStyle = '#6a1010';
      g.fillRect(x + 3, TILE - 22, 2, 3);
    }
  }

  // Stamp a blood/ichor decal onto the static level art
  decal(x, y, color, size) {
    const [c, ox] = this.ctxFor(x);
    if (!c) return;
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'source-atop'; // only on existing tile pixels
    g.fillStyle = color;
    g.globalAlpha = 0.75;
    g.fillRect(Math.round(x - ox - size / 2), Math.round(y - size / 2), size, Math.max(1, size - 1));
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  draw(ctx, camX, camY, viewW) {
    const i0 = Math.max(0, Math.floor(camX / SEG));
    const i1 = Math.min(this.segs.length - 1, Math.floor((camX + viewW) / SEG));
    for (let i = i0; i <= i1; i++) ctx.drawImage(this.segs[i], Math.round(i * SEG - camX), Math.round(-camY));
  }
}

// ---------------------------------------------------------------------------
// Mid-distance silhouettes. One repeating strip per zone.

export function makeMidStrip(zone, seed) {
  const W = 1600, H = VIEW_H + 200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rng = makeRng(seed ^ 0xabc);
  // Silhouettes sit between the sky colours so they read as distant, not as flat blocks
  const sil = shade(zone.sky[1], -0.35);
  const sil2 = shade(zone.sky[1], -0.15);
  const lights = zone.lights;
  const key = zone.key;
  if (key === 'upper' || key === 'lower') {
    let x = -40;
    while (x < W) {
      const w = key === 'lower' ? rng.int(140, 300) : rng.int(60, 150);
      const h = key === 'lower' ? rng.int(260, 520) : rng.int(220, 640);
      const top = H - h;
      g.fillStyle = rng.chance(0.5) ? sil : sil2;
      g.fillRect(x, top, w, h);
      if (key === 'upper') {
        g.fillRect(x + w / 2 - 2, top - rng.int(20, 80), 3, 80); // antenna
        if (rng.chance(0.5)) {
          g.fillStyle = rng.pick(['#ff2bd6', '#2be8ff']);
          g.globalAlpha = 0.3;
          g.fillRect(x + rng.int(4, Math.max(5, w - 20)), top + rng.int(20, 120), rng.int(4, 8), rng.int(24, 48));
          g.globalAlpha = 1;
        }
      } else {
        // brutalist stepped top and walkway
        g.fillRect(x - 10, top + 40, w + 20, 14);
        g.fillStyle = sil2;
        g.fillRect(x + w, top + rng.int(100, 300), rng.int(40, 90), 6);
      }
      // window grid: sparse, mostly dim sodium light, rare neon
      const lit = rng.range(0.03, 0.12);
      for (let wy = top + 14; wy < H - 10; wy += 10) {
        for (let wx = x + 6; wx < x + w - 6; wx += 8) {
          if (rng.chance(lit)) {
            g.fillStyle = rng.chance(0.85) ? '#ffb347' : rng.pick(lights);
            g.globalAlpha = rng.range(0.12, 0.35);
            g.fillRect(wx, wy, 2, 3);
          }
        }
      }
      g.globalAlpha = 1;
      x += w + rng.int(10, 60);
    }
  } else if (key === 'underbelly') {
    for (let i = 0; i < 9; i++) {
      const y = rng.int(60, H - 80);
      const t = rng.int(20, 60);
      g.fillStyle = rng.chance(0.5) ? sil : sil2;
      g.fillRect(0, y, W, t);
      g.fillStyle = 'rgba(255,255,255,0.04)';
      g.fillRect(0, y + 3, W, 2);
      for (let x = rng.int(0, 200); x < W; x += rng.int(120, 300)) {
        g.fillStyle = sil;
        g.fillRect(x, y - 6, 14, t + 12);
      }
    }
    for (let i = 0; i < 10; i++) {
      const x = rng.int(0, W);
      g.fillStyle = sil;
      g.fillRect(x, 0, rng.int(16, 50), H);
      if (rng.chance(0.5)) {
        g.fillStyle = rng.pick(lights);
        g.globalAlpha = 0.6;
        g.fillRect(x + 4, rng.int(100, H - 100), 4, 4);
        g.globalAlpha = 1;
      }
    }
    // tanks
    for (let i = 0; i < 4; i++) {
      const x = rng.int(0, W), r = rng.int(60, 120);
      g.fillStyle = sil;
      g.beginPath();
      g.ellipse(x, H - r, r * 0.8, r, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // caves and depths: stalactites, stalagmites, ribs, glowing growths
    for (let i = 0; i < 40; i++) {
      const x = rng.int(0, W), w = rng.int(20, 90), h = rng.int(80, 300);
      g.fillStyle = rng.chance(0.5) ? sil : sil2;
      g.beginPath();
      g.moveTo(x - w / 2, 0);
      g.lineTo(x, h);
      g.lineTo(x + w / 2, 0);
      g.fill();
      g.beginPath();
      g.moveTo(x - w / 2 + 40, H);
      g.lineTo(x + 40, H - h * 0.8);
      g.lineTo(x + w / 2 + 40, H);
      g.fill();
    }
    if (zone.flesh) {
      g.strokeStyle = sil2;
      g.lineWidth = 14;
      for (let i = 0; i < 6; i++) {
        const x = rng.int(0, W);
        g.beginPath();
        g.arc(x, H, rng.int(160, 300), Math.PI, Math.PI * 2);
        g.stroke();
      }
    }
    for (let i = 0; i < 50; i++) {
      g.fillStyle = rng.pick(lights);
      g.globalAlpha = rng.range(0.2, 0.6);
      const s = rng.int(2, 5);
      g.fillRect(rng.int(0, W), rng.int(0, H), s, s);
    }
    g.globalAlpha = 1;
  }
  const fog = g.createLinearGradient(0, 0, 0, H);
  fog.addColorStop(0, 'rgba(0,0,0,0)');
  fog.addColorStop(1, zone.sky[1]);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.55;
  g.fillStyle = fog;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return c;
}
