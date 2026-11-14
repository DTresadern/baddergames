// Renderer: parallax, level art, sprites, particles, lighting and HUD.

import { VIEW_W, VIEW_H, TILE, T, WEAPONS, AMMO, PLAYER } from './config.js';
import { assets } from './assets.js';
import { LevelArt, makeMidStrip, LIQUID_COLOR } from './tiles.js';
import { ENEMIES } from './enemies.js';
import { clamp, lerp } from './util.js';

const PCOL = ['#ffb347', '#5ff3ff']; // player 1 amber, player 2 cyan
const LW = VIEW_W / 2, LH = VIEW_H / 2; // light map resolution

export class Renderer {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.audio = audio;
    this.light = document.createElement('canvas');
    this.light.width = LW;
    this.light.height = LH;
    this.lctx = this.light.getContext('2d');
    this.glowCache = new Map();
    this.coneCache = new Map();
    this.particles = [];
    this.beams = [];
    this.flashes = [];
    this.texts = [];
    this.messages = [];
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.hurtFlash = 0;
    this.time = 0;
    this.rain = Array.from({ length: 220 }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, s: 0.6 + Math.random() * 0.8 }));
    this.title = null;
    this.bossName = '';
    this.heartbeatT = 0;
    this.playerFlash = [0, 0];
    this.mouse = { x: VIEW_W / 2, y: VIEW_H / 2 };
    this.showCrosshair = true;
    this.moveHint = 0; // mouse-only movement direction and strength, for the crosshair
    this.fireLock = false;
  }

  setWorld(world) {
    this.world = world;
    this.art = new LevelArt(world.level, world.zone);
    this.mid = makeMidStrip(world.zone, world.seed);
    const bgKeys = world.zone.bg;
    this.bg = assets.bg['pp_' + world.zone.key] || assets.bg[bgKeys[world.seed % bgKeys.length]];
    this.particles = [];
    this.beams = [];
    this.flashes = [];
    this.texts = [];
    this.title = { name: world.zone.name, sub: world.zone.sub, t: 0, loop: world.loop };
    this.bossName = '';
    const p = world.players.find((q) => q && q.local) || world.players.find(Boolean);
    if (p) {
      this.cam.x = clamp(p.x - VIEW_W / 2, 0, world.level.pxW - VIEW_W);
      this.cam.y = clamp(p.y - VIEW_H / 2, 0, world.level.pxH - VIEW_H);
    }
  }

  // ---- caches -------------------------------------------------------------

  glow(color) {
    let c = this.glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, color);
    gr.addColorStop(0.35, color + '88');
    gr.addColorStop(1, color + '00');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this.glowCache.set(color, c);
    return c;
  }

  cone(color) {
    let c = this.coneCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(0, 80, 0, 0, 80, 256);
    gr.addColorStop(0, color);
    gr.addColorStop(0.6, color + '55');
    gr.addColorStop(1, color + '00');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 80);
    g.arc(0, 80, 256, -0.38, 0.38);
    g.closePath();
    g.fill();
    this.coneCache.set(color, c);
    return c;
  }

  // ---- effects --------------------------------------------------------------

  addP(o) {
    if (this.particles.length > 1400) this.particles.shift();
    this.particles.push({ vx: 0, vy: 0, grav: 0, drag: 0, size: 2, life: 0.5, add: false, stick: false, rot: 0, vr: 0, ...o, max: o.life ?? 0.5 });
  }

  burst(x, y, n, color, speed, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 1.2) : Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.addP({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: (opts.life ?? 0.5) * (0.5 + Math.random()), size: opts.size ?? 2, grav: opts.grav ?? 900, drag: opts.drag ?? 1, add: !!opts.add, stick: !!opts.stick });
    }
  }

  gibs(type, x, y, burnt, facing) {
    const d = ENEMIES[type];
    const img = assets.sprites[d.sprite];
    if (!img) return;
    const n = d.boss ? 14 : 6;
    for (let i = 0; i < n; i++) {
      const w = Math.max(6, Math.round(img.width * (0.18 + Math.random() * 0.22)));
      const h = Math.max(6, Math.round(img.height * (0.18 + Math.random() * 0.22)));
      const sx = Math.floor(Math.random() * (img.width - w));
      const sy = Math.floor(Math.random() * (img.height - h));
      this.addP({
        kind: 'gib', img, sx, sy, sw: w, sh: h, x, y, vx: (Math.random() - 0.5) * 520 + facing * 60, vy: -250 - Math.random() * 450,
        grav: 1300, drag: 0.4, life: 2.5 + Math.random() * 1.5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18, burnt, bounce: true,
      });
    }
  }

  explosion(x, y, r) {
    this.burst(x, y, 30, '#ffcf5a', r * 4, { add: true, life: 0.35, size: 3, grav: -200, drag: 3 });
    this.burst(x, y, 20, '#ff6a1a', r * 3, { add: true, life: 0.6, size: 4, grav: -150, drag: 3 });
    for (let i = 0; i < 14; i++) this.addP({ kind: 'smoke', x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r, vx: (Math.random() - 0.5) * 80, vy: -40 - Math.random() * 60, life: 1.2 + Math.random(), size: 10 + Math.random() * 16, color: '#1a1614', drag: 1 });
    this.burst(x, y, 16, '#2a2622', r * 5, { life: 1.2, size: 2, grav: 1200, stick: true });
    this.flashes.push({ x, y, r: r * 3.2, color: '#ffb060', life: 0.25, max: 0.25 });
    this.art?.decal(x, y + 8, '#0a0806', 20);
  }

  consume(world) {
    const all = world.fx.concat(world.events);
    world.fx.length = 0;
    world.events.length = 0;
    const local = (i) => world.players[i] && world.players[i].local;
    for (const ev of all) {
      switch (ev[0]) {
        case 'sfx': this.audio.play(ev[1], ev[2], ev[3]); break;
        case 'muzzle': {
          const [, owner, x, y, a, w] = ev;
          const W = WEAPONS[w];
          this.flashes.push({ x, y, r: w === 1 ? 160 : 90, color: W.color, life: 0.06, max: 0.06 });
          if (w !== 2) this.addP({ kind: 'flash', x, y, a, life: 0.05, size: w === 1 ? 18 : 10, color: W.color, add: true });
          if (w === 0 || w === 1) this.addP({ x, y, vx: -Math.cos(a) * 60 + (Math.random() - 0.5) * 80, vy: -160 - Math.random() * 80, color: '#c9a050', size: 2, life: 0.8, grav: 1200, bounce: true });
          if (w === 1) this.burst(x, y, 8, '#7ff6ff', 300, { dir: a, spread: 0.6, add: true, life: 0.2, grav: 0 });
          break;
        }
        case 'beam': this.beams.push({ x1: ev[1], y1: ev[2], x2: ev[3], y2: ev[4], life: 0.06 }); break;
        case 'spark': this.burst(ev[1], ev[2], ev[3] * 2, ev[4] || '#ffd27a', 260, { add: true, life: 0.25, grav: 600 }); break;
        case 'splash': this.burst(ev[1], ev[2], 10, ev[3], 180, { life: 0.5, grav: 700, stick: true, size: 3 }); break;
        case 'explode': this.explosion(ev[1], ev[2], ev[3] / 3); break;
        case 'boom':
          this.explosion(ev[1], ev[2], 30 * ev[3]);
          this.audio.play('explode', ev[1], ev[2]);
          this.shake = Math.max(this.shake, 6 * ev[3]);
          break;
        case 'shake': this.shake = Math.max(this.shake, ev[1]); break;
        case 'dash':
          for (let i = 0; i < 10; i++) this.addP({ x: ev[1] - ev[3] * i * 6, y: ev[2] + (Math.random() - 0.5) * 40, vx: -ev[3] * 100, color: '#9ad8ff', size: 2, life: 0.25, add: true });
          break;
        case 'land': this.burst(ev[1], ev[2], 8, '#6b6158', 120, { dir: -Math.PI / 2, spread: 2.6, life: 0.4, grav: 300 }); this.audio.play('land', ev[1], ev[2]); break;
        case 'blood': this.burst(ev[1], ev[2], ev[4], ev[3], 260, { dir: ev[5] > 0 ? -0.4 : Math.PI + 0.4, spread: 1.8, life: 0.9, grav: 1000, stick: true, size: 3 }); break;
        case 'die': {
          const [, type, x, y, mech, blood, burnt, facing] = ev;
          this.gibs(type, x, y, burnt, facing);
          if (mech) this.burst(x, y, 24, '#ffd27a', 380, { add: true, life: 0.5, grav: 800 });
          else this.burst(x, y, 40, blood, 380, { life: 1.1, grav: 1100, stick: true, size: 3 });
          this.audio.play(mech ? 'mechdie' : 'die', x, y);
          break;
        }
        case 'dirt': this.burst(ev[1], ev[2], 2, '#4a3a2a', 160, { dir: -Math.PI / 2, spread: 1.4, life: 0.5, grav: 900 }); break;
        case 'debris':
          this.burst(ev[1], ev[2], 18, this.world.zone.tiles.light, 300, { life: 1.2, grav: 1200, size: 3 });
          this.audio.play('debris', ev[1], ev[2]);
          break;
        case 'tile': this.art.refresh(ev[1], ev[2]); break;
        case 'tdmg':
          this.art.refresh(ev[1], ev[2]);
          this.burst(ev[1] * TILE + TILE / 2, ev[2] * TILE + TILE / 2, 6, this.world.zone.tiles.light, 160, { life: 0.6, grav: 1000, size: 2 });
          break;
        case 'crate': {
          const c = world.crates[ev[1]];
          if (c) {
            c.alive = false;
            this.burst(c.x + c.w / 2, c.y + c.h / 2, 20, '#5a5248', 320, { life: 1, grav: 1200, size: 3 });
            this.audio.play('crate', c.x, c.y);
          }
          break;
        }
        case 'give': {
          const [, idx, kind, , x, y, text] = ev;
          this.audio.play(kind === 'weapon' ? 'weapon' : 'pickup', x, y);
          this.texts.push({ x, y: y - 10, text: String(text).slice(0, 24), color: PCOL[idx] || '#fff', life: 1.2 });
          break;
        }
        case 'hurt': {
          const i = ev[1];
          this.playerFlash[i] = 0.12;
          if (local(i)) {
            this.hurtFlash = Math.min(0.6, this.hurtFlash + ev[2] / 40);
            this.shake = Math.max(this.shake, 3 + ev[2] / 6);
            this.audio.play('hurt');
          }
          const p = world.players[i];
          if (p) this.burst(p.x + p.w / 2, p.y + 20, 6, '#3fd0a0', 200, { life: 0.6, stick: true });
          break;
        }
        case 'down': this.audio.play('down'); break;
        case 'revive': this.audio.play('revive'); break;
        case 'respawn': {
          const p = world.players[ev[1]];
          if (p) this.burst(ev[2] + p.w / 2, ev[3] + p.h / 2, 30, PCOL[ev[1]], 260, { add: true, life: 0.6, grav: -100 });
          break;
        }
        case 'ckpt': this.audio.play('checkpoint'); break;
        case 'msg': this.message(String(ev[1]).slice(0, 60), Number(ev[2]) || 3); break;
        case 'gate':
          this.audio.play('gate');
          this.shake = Math.max(this.shake, 5);
          break;
        case 'boss':
          this.bossName = String(ev[2] || '').slice(0, 30);
          if (this.bossName) this.audio.play('alarm');
          break;
      }
    }
  }

  message(text, time = 3) {
    this.messages.push({ text, life: time });
    if (this.messages.length > 4) this.messages.shift();
  }

  // ---- frame ----------------------------------------------------------------

  updateCamera(dt, focus) {
    const w = this.world;
    const L = w.level;
    if (!focus.length) return;
    let tx = 0, ty = 0;
    for (const f of focus) {
      tx += f.x;
      ty += f.y;
    }
    tx /= focus.length;
    ty /= focus.length;
    const gx = clamp(tx - VIEW_W / 2, 0, L.pxW - VIEW_W);
    const gy = clamp(ty - VIEW_H / 2 - 30, 0, L.pxH - VIEW_H);
    const k = 1 - Math.pow(0.0005, dt);
    this.cam.x = lerp(this.cam.x, gx, k);
    this.cam.y = lerp(this.cam.y, gy, k);
  }

  updateParticles(dt) {
    const L = this.world.level;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.grav * dt;
      if (p.drag) {
        p.vx *= 1 - Math.min(1, p.drag * dt);
        p.vy *= p.kind === 'smoke' ? 1 - Math.min(1, p.drag * dt) : 1;
      }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if ((p.stick || p.bounce) && L.solidAt(nx, ny)) {
        if (p.stick) {
          this.art.decal(nx, ny, p.color, p.size + 1);
          p.life = 0;
          continue;
        }
        if (L.solidAt(nx, p.y)) p.vx *= -0.4;
        else p.vy *= -0.35;
        p.vx *= 0.7;
        p.vr *= 0.6;
        if (Math.abs(p.vy) < 40) p.grav = L.solidAt(p.x, p.y + 3) ? 0 : 1300;
      } else {
        p.x = nx;
        p.y = ny;
      }
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const m of this.messages) m.life -= dt;
    this.messages = this.messages.filter((m) => m.life > 0);

    // Ambient particles: drips from ceilings, embers in the depths
    const z = this.world.zone;
    if (z.drips && Math.random() < 0.5) {
      const x = this.cam.x + Math.random() * VIEW_W;
      let y = this.cam.y + Math.random() * VIEW_H * 0.6;
      if (L.solidAt(x, y - 4) && !L.solidAt(x, y + 4)) this.addP({ x, y, vy: 0, grav: 900, color: z.flesh ? '#8a1020' : '#6fa0a8', size: 2, life: 2, stick: true });
    }
    if (z.flesh && Math.random() < 0.3) this.addP({ x: this.cam.x + Math.random() * VIEW_W, y: this.cam.y + VIEW_H, vy: -30 - Math.random() * 40, vx: (Math.random() - 0.5) * 20, color: '#5ff3ff', size: 1, life: 6, add: true });
  }

  render(dt, opts) {
    this.time += dt;
    const ctx = this.ctx;
    const w = this.world;
    const z = w.zone;
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.2);
    for (let i = 0; i < 2; i++) this.playerFlash[i] = Math.max(0, this.playerFlash[i] - dt);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const cx = Math.round(this.cam.x + sx), cy = Math.round(this.cam.y + sy);
    this.audio.listener = { x: this.cam.x + VIEW_W / 2, y: this.cam.y + VIEW_H / 2 };

    // Sky and far background (scene art at 1/8 parallax, as in Abuse)
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, z.sky[0]);
    sky.addColorStop(1, z.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.bg) {
      const bh = VIEW_H + 60, bw = (this.bg.width * bh) / this.bg.height;
      const by = -((cy / Math.max(1, w.level.pxH - VIEW_H)) * 60);
      let bx = -((cx * 0.125) % (bw * 2));
      for (let x = bx; x < VIEW_W; x += bw * 2) {
        ctx.drawImage(this.bg, Math.round(x), Math.round(by), Math.round(bw), bh);
        ctx.save();
        ctx.translate(Math.round(x + bw * 2), Math.round(by));
        ctx.scale(-1, 1);
        ctx.drawImage(this.bg, 0, 0, Math.round(bw), bh);
        ctx.restore();
      }
    }
    // Push the painted backdrop back so it never competes with playable surfaces
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = z.fog;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Mid silhouettes
    const mw = this.mid.width;
    const mx = -((cx * 0.35) % mw);
    const my = -40 - cy * 0.15;
    ctx.globalAlpha = 0.8;
    for (let x = mx; x < VIEW_W; x += mw) ctx.drawImage(this.mid, Math.round(x), Math.round(my));
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(-cx, -cy);
    this.drawProps(ctx, w);
    ctx.restore();
    this.art.draw(ctx, cx, cy, VIEW_W);
    ctx.save();
    ctx.translate(-cx, -cy);
    this.drawGatesAndLiquid(ctx, w);
    this.drawCrates(ctx, w);
    this.drawPickups(ctx, w);
    for (const e of w.enemies) this.drawEnemy(ctx, e);
    for (const p of w.players) if (p) this.drawPlayer(ctx, p);
    this.drawProjectiles(ctx, w, false);
    this.drawParticles(ctx, false);
    ctx.restore();

    this.drawLighting(ctx, w, cx, cy);

    // Emissive pass (after lighting so it glows)
    ctx.save();
    ctx.translate(-cx, -cy);
    ctx.globalCompositeOperation = 'lighter';
    this.drawProjectiles(ctx, w, true);
    this.drawParticles(ctx, true);
    this.drawBeams(ctx);
    this.drawEyes(ctx, w);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    // Foreground weather
    if (z.rain) {
      ctx.strokeStyle = 'rgba(160,190,230,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const r of this.rain) {
        r.y += 900 * r.s * dt;
        r.x -= 160 * r.s * dt;
        if (r.y > VIEW_H) {
          r.y -= VIEW_H + 20;
          r.x = Math.random() * (VIEW_W + 100);
        }
        const x = ((r.x - cx * 0.2 * r.s) % VIEW_W + VIEW_W) % VIEW_W;
        ctx.moveTo(x, r.y);
        ctx.lineTo(x - 3 * r.s, r.y + 14 * r.s);
      }
      ctx.stroke();
    }
    this.drawTexts(ctx, cx, cy);
    // Vignette
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(160,0,0,${this.hurtFlash * 0.6})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < VIEW_H; y += 3) ctx.fillRect(0, y, VIEW_W, 1);

    this.drawHUD(ctx, w, opts, dt);
  }

  // ---- world drawing ---------------------------------------------------------

  drawProps(ctx, w) {
    const L = w.level;
    const t = this.time;
    for (const l of L.lamps) {
      if (Math.abs(l.x - this.cam.x - VIEW_W / 2) > VIEW_W) continue;
      ctx.fillStyle = '#121212';
      ctx.fillRect(l.x - 9, l.y - 6, 18, 7);
      ctx.fillStyle = l.color;
      ctx.globalAlpha = lampLevel(l, t);
      ctx.fillRect(l.x - 7, l.y, 14, 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#222';
      ctx.fillRect(l.x - 1, l.y - 40, 2, 34);
    }
    const cpImg = assets.sprites.checkpoint;
    for (const c of L.checkpoints) {
      const active = w.checkpoint.x === c.x && w.checkpoint.y === c.y;
      if (cpImg) {
        const x = Math.round(c.x - cpImg.width / 2), y = Math.round(c.y - cpImg.height);
        ctx.drawImage(cpImg, x, y);
        const sc = assets.points.checkpoint_screen;
        if (sc && active) {
          // active: screen turns green
          ctx.fillStyle = '#39ff8a';
          ctx.globalAlpha = 0.65 + Math.sin(t * 4) * 0.2;
          ctx.fillRect(x + sc[0], y + sc[1], sc[2], sc[3]);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      ctx.fillStyle = '#1b1d20';
      ctx.fillRect(c.x - 12, c.y - 40, 24, 40);
      ctx.fillStyle = '#2c3036';
      ctx.fillRect(c.x - 10, c.y - 38, 20, 3);
      ctx.fillStyle = active ? '#39ff8a' : '#ffb347';
      ctx.globalAlpha = 0.6 + Math.sin(t * 4) * 0.2;
      ctx.fillRect(c.x - 8, c.y - 32, 16, 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0a0a0a';
      for (let y = c.y - 31; y < c.y - 22; y += 2) ctx.fillRect(c.x - 8, y, 16, 1);
    }
    if (L.exit) {
      const e = L.exit;
      const lift = assets.sprites.exit_lift;
      if (lift) {
        // deck overlaps the floor so hunters stand on it
        const x = Math.round(e.x + e.w / 2 - lift.width / 2), y = Math.round(e.y + e.h - lift.height + 10);
        ctx.drawImage(lift, x, y);
        const ll = assets.points.lift_light;
        if (ll && w.arena === 'done') {
          ctx.fillStyle = '#39ff8a';
          ctx.fillRect(x + ll[0], y + ll[1] - 1, ll[2], ll[3] + 2);
        }
        return;
      }
      const door = assets.sprites.door;
      if (door) ctx.drawImage(door, Math.round(e.x + e.w / 2 - door.width / 2), Math.round(e.y + e.h - door.height));
      const ready = w.arena === 'done';
      ctx.fillStyle = ready ? '#39ff8a' : '#ff2b2b';
      ctx.globalAlpha = 0.7 + Math.sin(t * 5) * 0.3;
      ctx.fillRect(e.x + e.w / 2 - 6, e.y + e.h - door.height - 8, 12, 5);
      ctx.globalAlpha = 1;
      // lift deck
      for (let x = e.x; x < e.x + e.w; x += 10) {
        ctx.fillStyle = (x / 10) % 2 ? '#d8a21c' : '#111';
        ctx.fillRect(x, e.y + e.h - 4, 10, 4);
      }
    }
  }

  drawGatesAndLiquid(ctx, w) {
    const L = w.level;
    const t = this.time;
    for (const [gx, gy] of L.gates) {
      const x = gx * TILE, y = gy * TILE;
      if (L.gateClosed) {
        ctx.fillStyle = '#23272c';
        ctx.fillRect(x + 4, y, TILE - 8, TILE);
        ctx.fillStyle = '#3a4048';
        ctx.fillRect(x + 4, y, 3, TILE);
        for (let yy = y; yy < y + TILE; yy += 8) {
          ctx.fillStyle = '#d8a21c';
          ctx.fillRect(x + 8, yy, TILE - 16, 3);
        }
        ctx.fillStyle = Math.sin(t * 8) > 0 ? '#ff2020' : '#500';
        ctx.fillRect(x + TILE / 2 - 2, y + 12, 4, 4);
      } else if (L.get(gx, gy + 1) !== T.GATE) {
        // open gate: only the floor rail shows
        ctx.fillStyle = '#15171a';
        ctx.fillRect(x + 4, y + TILE - 3, TILE - 8, 3);
      }
    }
    // Liquid: animated surface
    const [lc, ld] = LIQUID_COLOR[w.zone.key];
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE) - 1), x1 = Math.min(L.w - 1, x0 + Math.ceil(VIEW_W / TILE) + 2);
    for (let ty = 0; ty < L.h; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (L.get(tx, ty) !== T.LIQUID) continue;
        const x = tx * TILE, y = ty * TILE;
        const surface = L.get(tx, ty - 1) !== T.LIQUID;
        ctx.fillStyle = ld;
        ctx.globalAlpha = 0.88;
        ctx.fillRect(x, y + (surface ? 8 : 0), TILE, surface ? TILE - 8 : TILE);
        if (surface) {
          ctx.fillStyle = lc;
          for (let i = 0; i < TILE; i += 4) {
            const h = Math.sin(t * 3 + (x + i) * 0.15) * 2;
            ctx.fillRect(x + i, y + 7 + h, 4, 3);
          }
          if (Math.random() < 0.02) this.addP({ x: x + Math.random() * TILE, y: y + 8, vy: -40, color: lc, size: 2, life: 0.6, grav: 100, add: true });
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  drawCrates(ctx, w) {
    const img = assets.sprites.crate;
    for (const c of w.crates) {
      if (!c.alive) continue;
      ctx.drawImage(img, Math.round(c.x + c.w / 2 - img.width / 2), Math.round(c.y + c.h - img.height));
    }
  }

  drawPickups(ctx, w) {
    const t = this.time;
    for (const k of w.pickups) {
      const bob = Math.sin(t * 3 + k.id) * 2;
      const x = Math.round(k.x + k.w / 2), y = Math.round(k.y + k.h / 2 + bob);
      const ppKey = k.kind === 'ammo' ? 'pickup_ammo_' + k.item : k.kind === 'cloak' ? 'pickup_camo' : 'pickup_' + k.kind;
      const pimg = assets.sprites[ppKey];
      if (pimg) {
        ctx.drawImage(pimg, x - Math.round(pimg.width / 2), y - Math.round(pimg.height / 2));
        continue;
      }
      if (k.kind === 'weapon') {
        const img = assets.sprites[WEAPONS[k.item]?.sprite];
        if (img) ctx.drawImage(img, x - img.width / 2, y - img.height / 2);
      } else if (k.kind === 'medkit') {
        ctx.fillStyle = '#d8d8d0';
        ctx.fillRect(x - 9, y - 7, 18, 14);
        ctx.fillStyle = '#c01818';
        ctx.fillRect(x - 2, y - 5, 4, 10);
        ctx.fillRect(x - 5, y - 2, 10, 4);
      } else if (k.kind === 'ammo') {
        const col = { coil: '#7ff6ff', fuel: '#ff7a1a', cell: '#b7fbff', disc: '#ffcf5a' }[k.item] || '#fff';
        ctx.fillStyle = '#2a2d31';
        ctx.fillRect(x - 9, y - 6, 18, 12);
        ctx.fillStyle = col;
        ctx.fillRect(x - 7, y - 4, 14, 3);
        ctx.fillStyle = '#111';
        ctx.fillRect(x - 9, y + 2, 18, 1);
      } else {
        const col = k.kind === 'cloak' ? '#5ff3ff' : '#ff9a2a';
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.6 + Math.sin(t * 6) * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 1, y - 4, 2, 8);
      }
    }
  }

  drawEnemy(ctx, e) {
    const d = ENEMIES[e.type];
    if (e.hidden && d.ai === 'worm') return;
    const base = d.sprite.replace('_boss', '');
    const img = assets.sprites[d.sprite];
    if (!img) return;
    const flip = e.facing * (assets.manifest.facing[base] || 1);
    const cx = e.x + e.w / 2;
    ctx.save();
    let ox = 0, oy = 0, rot = 0, sxs = 1, sys = 1, shear = 0;
    const moving = Math.abs(e.vx || 0) > 15 || (this.world.role === 'guest' && Math.abs((e.rx ?? 0) - (e.px ?? 0)) > 0.5);
    const tt = this.time + e.id;
    const walk = assets.anims[d.sprite + '_walk']; // authored walk cycle, when available
    switch (d.ai) {
      case 'walker':
      case 'stalker':
      case 'charger':
      case 'gunner':
        if (walk) {
          /* frames carry the motion */
        } else if (moving) {
          shear = Math.sin(tt * (d.speed > 150 ? 18 : 9)) * 0.1;
          oy = -Math.abs(Math.sin(tt * (d.speed > 150 ? 18 : 9))) * 2;
        } else sys = 1 + Math.sin(tt * 2.5) * 0.015;
        if (e.state === 'windup') ox = Math.sin(tt * 60) * 2;
        if (e.state === 'cocoon') rot = Math.PI;
        break;
      case 'flyer':
        rot = clamp((e.vx || (e.rx - e.px) * 30 || 0) / 600, -0.25, 0.25) * e.facing;
        oy = Math.sin(tt * 3) * 3;
        break;
      case 'swarm':
        rot = tt * 4;
        sxs = sys = 1 + Math.sin(tt * 7) * 0.12;
        break;
      case 'spitter':
        sys = 1 + Math.sin(tt * 3) * 0.06 + (e.anim > 0 ? 0.15 : 0);
        sxs = 1 - Math.sin(tt * 3) * 0.03;
        break;
      case 'spawner':
        sxs = sys = 1 + Math.sin(tt * 2) * 0.02 + (e.anim > 0 ? 0.05 : 0);
        break;
      case 'worm':
        rot = Math.sin(tt * 3) * 0.08;
        break;
    }
    const centred = d.ai === 'flyer' || d.ai === 'swarm';
    const ax = cx, ay = centred ? e.y + e.h / 2 : e.y + e.h;
    if (d.ai === 'worm') {
      ctx.beginPath();
      ctx.rect(e.x - 100, e.groundY !== undefined ? e.groundY - 600 : e.y - 600, e.w + 200, 600 + (e.groundY !== undefined ? 0 : e.h));
      if (e.groundY !== undefined) ctx.clip();
    }
    ctx.translate(Math.round(ax + ox), Math.round(ay + oy));
    if (rot) ctx.rotate(rot);
    if (shear) ctx.transform(1, 0, shear, 1, 0, 0);
    ctx.scale(flip * sxs, sys);
    if (walk) {
      // frame strip: frame 0 standing, cycling while moving
      const strip = assets.sprites[walk.sprite];
      const f = moving ? Math.floor(tt * walk.fps) % walk.frames : 0;
      const fx = f * walk.w, dx = -walk.w / 2, dy = -walk.h + 4;
      ctx.drawImage(strip, fx, 0, walk.w, walk.h, dx, dy, walk.w, walk.h);
      if (e.flash > 0) {
        ctx.globalAlpha = 0.8;
        ctx.drawImage(assets.white[walk.sprite], fx, 0, walk.w, walk.h, dx, dy, walk.w, walk.h);
        ctx.globalAlpha = 1;
      }
    } else {
      const dx = -img.width / 2, dy = centred ? -img.height / 2 : e.state === 'cocoon' ? -img.height + 6 : -img.height + 4;
      if (e.state === 'cocoon') ctx.filter = 'brightness(0.5) sepia(0.6)';
      ctx.drawImage(img, dx, dy);
      ctx.filter = 'none';
      if (e.flash > 0) {
        ctx.globalAlpha = 0.8;
        ctx.drawImage(assets.white[d.sprite], dx, dy);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    if (e.state === 'cocoon') {
      ctx.strokeStyle = 'rgba(200,190,170,0.4)';
      ctx.beginPath();
      ctx.moveTo(cx, e.y);
      ctx.lineTo(cx, e.y - 60);
      ctx.stroke();
    }
    // health bar for damaged regular enemies
    const pct = this.world.role === 'guest' ? e.hpPct : (e.hp / e.maxHp) * 100;
    if (!d.boss && pct < 100 && pct > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(Math.round(cx - 15), Math.round(e.y - 10), 30, 3);
      ctx.fillStyle = '#ff3b2b';
      ctx.fillRect(Math.round(cx - 15), Math.round(e.y - 10), Math.round(0.3 * pct), 3);
    }
  }

  drawPlayer(ctx, p) {
    const m = assets.manifest.hunter;
    const tag = p.idx === 0 ? 'p1' : 'p2';
    if (p.state === 'dead') return;
    const cx = Math.round(p.x + p.w / 2), feet = Math.round(p.y + p.h);
    if (p.state === 'down') {
      const img = assets.sprites[`hunter_${tag}_full`];
      ctx.save();
      ctx.translate(cx, feet - 12);
      ctx.rotate(-Math.PI / 2 * p.facing);
      ctx.scale(p.facing, 1);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, -m.bodyCenterX, -m.frameH / 2);
      ctx.restore();
      // revive ring
      const pr = p.reviveT / PLAYER.reviveTime;
      ctx.strokeStyle = PCOL[p.idx];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, feet - 60, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pr);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.ceil(p.downT)), cx, feet - 56);
      return;
    }
    const blink = p.invuln > 0 && p.invuln < 1.5 && Math.floor(this.time * 20) % 2 === 0;
    const cloak = p.cloak > 0;
    ctx.save();
    ctx.globalAlpha = cloak ? (p.local ? 0.35 : 0.14) : blink ? 0.5 : 1;
    ctx.translate(cx, feet);
    ctx.scale(p.facing, 1);
    const moving = p.onGround && Math.abs(p.vx) > 20;
    const ph = p.walk * Math.PI;
    const bob = moving ? -Math.abs(Math.sin(ph)) * 2 : 0;
    const lower = assets.sprites[`hunter_${tag}_lower`];
    const upper = assets.sprites[`hunter_${tag}_upper`];
    // legs: authored run cycle when available, otherwise the skewed placeholder
    const run = assets.anims.hunter_run;
    const runStrip = assets.sprites[`anim_hunter_${tag}_run`];
    ctx.save();
    if (run && runStrip && moving && !p.climbing) {
      let f = Math.floor(p.walk * 1.5) % run.frames;
      if (p.vx * p.facing < 0) f = run.frames - 1 - f; // backpedalling: play in reverse
      ctx.drawImage(runStrip, f * run.w, 0, run.w, run.h, -run.w / 2, -run.h, run.w, run.h);
    } else {
      if (moving) ctx.transform(1, 0, Math.sin(ph) * 0.14, 1, 0, 0);
      if (!p.onGround && !p.climbing) ctx.scale(1, 0.95);
      if (p.climbing) ctx.transform(1, 0, Math.sin(p.y * 0.1) * 0.08, 1, 0, 0);
      ctx.drawImage(lower, -m.bodyCenterX, -m.frameH + bob);
    }
    ctx.restore();
    // torso aims independently
    let a = p.facing > 0 ? p.aim : Math.PI - p.aim;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    a = clamp(a, -1.45, 1.45);
    const pvx = m.pivot[0] - m.bodyCenterX, pvy = m.pivot[1] - m.frameH + bob;
    ctx.translate(pvx, pvy);
    ctx.rotate(a);
    ctx.translate(-p.recoil * 3, 0);
    ctx.drawImage(upper, -m.pivot[0], -m.pivot[1]);
    if (p.weapon > 0) {
      const wi = assets.sprites[WEAPONS[p.weapon].sprite + '_hand'];
      if (wi) {
        const rb = m.rifleBox;
        ctx.drawImage(wi, rb[0] - m.pivot[0] + 2, (rb[1] + rb[3]) / 2 - m.pivot[1] - wi.height / 2);
      }
    }
    if (this.playerFlash[p.idx] > 0) {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(assets.white[`hunter_${tag}_upper`], -m.pivot[0], -m.pivot[1]);
    }
    ctx.restore();
    if (cloak) {
      // Optic camo: a faint shimmering outline offset by a wobble
      ctx.save();
      ctx.globalAlpha = 0.12 + Math.sin(this.time * 20) * 0.06;
      ctx.translate(cx + Math.sin(this.time * 31) * 1.5, feet);
      ctx.scale(p.facing, 1);
      ctx.drawImage(assets.white[`hunter_${tag}_full`], -m.bodyCenterX, -m.frameH);
      ctx.restore();
    }
    // Partner name tag
    if (!p.local || this.world.players.filter((q) => q && q.local).length > 1) {
      ctx.fillStyle = PCOL[p.idx];
      ctx.font = '700 10px monospace';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.8;
      ctx.fillText(p.name, cx, feet - m.frameH - 6);
      ctx.globalAlpha = 1;
    }
  }

  drawProjectiles(ctx, w, emissive) {
    const SPRITE = { bolt: 'proj_pulse', rail: 'proj_coil', ebolt: 'proj_ebolt', acid: 'proj_acid', mortar: 'proj_mortar', disc: 'proj_disc' };
    const GLOWS = { bolt: 1, rail: 1, ebolt: 1, acid: 1 };
    for (const pr of w.projectiles) {
      const x = pr.x, y = pr.y;
      const img = assets.sprites[SPRITE[pr.kind]];
      if (img) {
        // Production-pass sprite, nose at the projectile position, pointing along its path.
        // Drawn normally, then again additively in the emissive pass for glowing shots.
        if (emissive && !GLOWS[pr.kind]) continue;
        if (pr.kind === 'rail' && emissive) {
          // keep the long coil trail
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          const len = Math.min(260, Math.hypot(x - pr.ox, y - pr.oy));
          ctx.strokeStyle = pr.color;
          ctx.lineWidth = 3;
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.moveTo(x - (pr.vx / sp) * len, y - (pr.vy / sp) * len);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        if (pr.kind === 'disc') ctx.scale(pr.vx < 0 ? -1 : 1, 1);
        else ctx.rotate(Math.atan2(pr.vy, pr.vx));
        if (emissive) ctx.globalAlpha = 0.55;
        ctx.drawImage(img, -img.width + 3, -Math.round(img.height / 2));
        ctx.restore();
        continue;
      }
      switch (pr.kind) {
        case 'bolt':
        case 'ebolt': {
          const len = pr.kind === 'bolt' ? 0.018 : 0.02;
          ctx.strokeStyle = emissive ? pr.color : '#fff';
          ctx.lineWidth = emissive ? 4 : 2;
          ctx.globalAlpha = emissive ? 0.5 : 1;
          ctx.beginPath();
          ctx.moveTo(x - pr.vx * len, y - pr.vy * len);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'rail': {
          ctx.strokeStyle = emissive ? pr.color : '#ffffff';
          ctx.lineWidth = emissive ? 6 : 2;
          ctx.globalAlpha = emissive ? 0.5 : 1;
          ctx.beginPath();
          const tx = Math.abs(x - pr.ox) > 260 ? x - (pr.vx / Math.hypot(pr.vx, pr.vy)) * 260 : pr.ox;
          const ty = Math.abs(x - pr.ox) > 260 ? y - (pr.vy / Math.hypot(pr.vx, pr.vy)) * 260 : pr.oy;
          ctx.moveTo(tx, ty);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'flame': {
          if (!emissive) break;
          const k = 1 - pr.life / 0.5;
          ctx.fillStyle = k < 0.3 ? '#ffe07a' : k < 0.6 ? '#ff8a1a' : '#a8300a';
          ctx.globalAlpha = Math.max(0, 0.6 - k * 0.5);
          ctx.beginPath();
          ctx.arc(x, y, pr.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case 'acid':
        case 'mortar':
          ctx.fillStyle = emissive ? pr.color : pr.kind === 'mortar' ? '#222' : pr.color;
          ctx.globalAlpha = emissive ? 0.4 : 1;
          ctx.beginPath();
          ctx.arc(x, y, emissive ? pr.r * 1.8 : pr.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'disc':
          if (emissive) {
            if (Math.floor(this.time * (pr.life < 0.4 ? 20 : 8)) % 2) {
              ctx.fillStyle = '#ff3020';
              ctx.fillRect(x - 2, y - 2, 4, 4);
            }
          } else {
            ctx.fillStyle = '#9aa0a8';
            ctx.fillRect(x - 5, y - 2, 10, 4);
            ctx.fillStyle = '#ffcf5a';
            ctx.fillRect(x - 1, y - 2, 2, 4);
          }
          break;
      }
    }
  }

  drawParticles(ctx, emissive) {
    for (const p of this.particles) {
      if (!!p.add !== emissive) continue;
      const k = p.life / p.max;
      if (p.kind === 'gib') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life);
        if (p.burnt) ctx.filter = 'brightness(0.35)';
        ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, -p.sw / 2, -p.sh / 2, p.sw, p.sh);
        ctx.restore();
        continue;
      }
      if (p.kind === 'smoke') {
        ctx.globalAlpha = 0.5 * k;
        ctx.fillStyle = p.color;
        const s = p.size * (2 - k);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        ctx.globalAlpha = 1;
        continue;
      }
      if (p.kind === 'flash') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 0.35);
        ctx.lineTo(p.size * 1.4, 0);
        ctx.lineTo(0, p.size * 0.35);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-2, -2, 5, 4);
        ctx.restore();
        continue;
      }
      ctx.globalAlpha = emissive ? k : Math.min(1, k * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawBeams(ctx) {
    for (const b of this.beams) {
      const jit = () => (Math.random() - 0.5) * 6;
      ctx.strokeStyle = '#7fe6ff';
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      const n = 6;
      for (let i = 1; i <= n; i++) ctx.lineTo(b.x1 + ((b.x2 - b.x1) * i) / n + (i < n ? jit() : 0), b.y1 + ((b.y2 - b.y1) * i) / n + (i < n ? jit() : 0));
      ctx.stroke();
    }
  }

  drawEyes(ctx, w) {
    // Bioluminescent / sensor points so enemies read in the dark
    for (const e of w.enemies) {
      if (e.hidden) continue;
      const d = ENEMIES[e.type];
      const col = d.mechanical ? '#ff3020' : w.zone.flesh ? '#5ff3ff' : '#ffcf40';
      const fx = e.facing > 0 ? e.x + e.w * 0.85 : e.x + e.w * 0.15;
      const fy = d.ai === 'flyer' || d.ai === 'swarm' ? e.y + e.h * 0.5 : e.y + e.h * 0.3;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 2);
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx, cx, cy) {
    ctx.font = '700 11px monospace';
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.fillStyle = '#000';
      ctx.fillText(t.text, t.x - cx + 1, t.y - cy + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x - cx, t.y - cy);
    }
    ctx.globalAlpha = 1;
  }

  // ---- lighting -------------------------------------------------------------

  drawLighting(ctx, w, cx, cy) {
    const l = this.lctx;
    const z = w.zone;
    const [ar, ag, ab] = z.ambient;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = `rgb(${(ar * 255) | 0},${(ag * 255) | 0},${(ab * 255) | 0})`;
    l.fillRect(0, 0, LW, LH);
    l.globalCompositeOperation = 'lighter';
    const add = (x, y, r, color, a = 1) => {
      const sx = (x - cx) / 2, sy = (y - cy) / 2, sr = r / 2;
      if (sx + sr < 0 || sy + sr < 0 || sx - sr > LW || sy - sr > LH) return;
      l.globalAlpha = a;
      l.drawImage(this.glow(color), sx - sr, sy - sr, sr * 2, sr * 2);
    };
    const cone = (x, y, ang, len, color, a = 1) => {
      l.save();
      l.globalAlpha = a;
      l.translate((x - cx) / 2, (y - cy) / 2);
      l.rotate(ang);
      const s = len / 2 / 256;
      l.scale(s, s);
      l.drawImage(this.cone(color), 0, -80);
      l.restore();
    };
    const t = this.time;
    for (const lp of w.level.lamps) {
      const lv = lampLevel(lp, t);
      add(lp.x, lp.y + 30, 260, lp.color, 0.75 * lv);
      cone(lp.x, lp.y, Math.PI / 2, 300, lp.color, 0.5 * lv);
    }
    for (const c of w.level.checkpoints) add(c.x, c.y - 28, 120, w.checkpoint.x === c.x ? '#39ff8a' : '#ffb347', 0.6);
    if (w.level.exit) add(w.level.exit.x + w.level.exit.w / 2, w.level.exit.y, 220, w.arena === 'done' ? '#39ff8a' : '#ff2b2b', 0.6);
    for (const p of w.players) {
      if (!p || p.state === 'dead') continue;
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      add(px, py, 210, '#b8c8d8', 0.55); // personal light keeps the hunter readable
      if (p.state === 'alive' && p.cloak <= 0) cone(px, p.y + 16, p.aim, 520, '#fff2d0', 0.55); // shoulder lamp
      if (p.state === 'down') add(px, py, 140, PCOL[p.idx], 0.8 + Math.sin(t * 6) * 0.2);
    }
    for (const e of w.enemies) {
      const d = ENEMIES[e.type];
      if (e.hidden) continue;
      if (d.searchlight) {
        const ex = e.x + e.w / 2, ey = e.y + e.h * 0.6;
        const ang = Math.atan2((e.aimY || ey + 200) - ey, (e.aimX || ex) - ex);
        cone(ex, ey, ang, d.boss ? 640 : 460, '#fff0c0', 0.6);
      }
      if (w.zone.flesh || d.ai === 'spawner' || d.ai === 'spitter') add(e.x + e.w / 2, e.y + e.h / 2, e.w * 1.6, d.mechanical ? '#ff4030' : '#40e0c0', 0.3);
      if (e.flash > 0) add(e.x + e.w / 2, e.y + e.h / 2, 120, '#ffffff', 0.4);
    }
    for (const pr of w.projectiles) {
      if (pr.kind === 'flame') add(pr.x, pr.y, 90, '#ff7a1a', 0.35);
      else if (pr.kind === 'rail') add(pr.x, pr.y, 140, pr.color, 0.8);
      else if (pr.kind === 'disc') add(pr.x, pr.y, 50, '#ff3020', 0.5);
      else add(pr.x, pr.y, 70, pr.color, 0.6);
    }
    for (const b of this.beams) {
      add(b.x1, b.y1, 120, '#7fe6ff', 0.8);
      add((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, 160, '#7fe6ff', 0.6);
      add(b.x2, b.y2, 120, '#b7fbff', 0.8);
    }
    for (const f of this.flashes) add(f.x, f.y, f.r, f.color, f.life / f.max);
    for (const k of w.pickups) add(k.x + k.w / 2, k.y + k.h / 2, 70, k.kind === 'medkit' ? '#ff6060' : '#ffd27a', 0.5);
    // Liquids glow faintly
    if (z.key === 'underbelly' || z.key === 'depths' || z.key === 'caverns') {
      const L = w.level;
      const x0 = Math.max(0, Math.floor(cx / TILE)), x1 = Math.min(L.w - 1, x0 + Math.ceil(VIEW_W / TILE) + 1);
      for (let ty = 0; ty < L.h; ty++) for (let tx = x0; tx <= x1; tx += 2) {
        if (L.get(tx, ty) === T.LIQUID && L.get(tx, ty - 1) !== T.LIQUID) add(tx * TILE + 16, ty * TILE + 10, 110, LIQUID_COLOR[z.key][0], 0.35);
      }
    }
    l.globalAlpha = 1;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, VIEW_W, VIEW_H);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  // ---- HUD ------------------------------------------------------------------

  drawHUD(ctx, w, opts, dt) {
    ctx.textBaseline = 'alphabetic';
    const players = w.players.filter(Boolean);
    players.forEach((p, i) => this.playerPanel(ctx, p, p.idx === 0 ? 12 : VIEW_W - 232, 12));

    // Boss bar
    const boss = w.enemies.find((e) => e.id === w.bossId);
    if (boss && w.arena === 'fight') {
      const pct = (w.role === 'guest' ? boss.hpPct : (boss.hp / boss.maxHp) * 100) / 100;
      const bw = 420, bx = VIEW_W / 2 - bw / 2, by = VIEW_H - 34;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(bx - 4, by - 18, bw + 8, 30);
      ctx.fillStyle = '#300';
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = '#e02020';
      ctx.fillRect(bx, by, bw * clamp(pct, 0, 1), 8);
      ctx.fillStyle = '#ff9a9a';
      ctx.font = '700 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.bossName, VIEW_W / 2, by - 5);
    }

    // Messages
    ctx.textAlign = 'center';
    ctx.font = '700 14px monospace';
    this.messages.forEach((m, i) => {
      ctx.globalAlpha = Math.min(1, m.life * 2);
      ctx.fillStyle = '#000';
      ctx.fillText(m.text, VIEW_W / 2 + 1, 92 + i * 20 + 1);
      ctx.fillStyle = '#f2e6c8';
      ctx.fillText(m.text, VIEW_W / 2, 92 + i * 20);
    });
    ctx.globalAlpha = 1;

    // Zone title card
    if (this.title) {
      this.title.t += dt;
      const t = this.title.t;
      const a = t < 0.5 ? t * 2 : t < 3 ? 1 : Math.max(0, 1 - (t - 3));
      if (a <= 0) this.title = null;
      else {
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, VIEW_H / 2 - 50, VIEW_W, 90);
        ctx.fillStyle = '#f2e6c8';
        ctx.font = '700 34px monospace';
        ctx.fillText(this.title.name, VIEW_W / 2, VIEW_H / 2);
        ctx.font = '12px monospace';
        ctx.fillStyle = '#c8a060';
        ctx.fillText(`ZONE ${w.zoneIndex + 1}/5${this.title.loop ? '  ·  CYCLE ' + (this.title.loop + 1) : ''}  ·  ${this.title.sub.toUpperCase()}`, VIEW_W / 2, VIEW_H / 2 + 24);
        ctx.globalAlpha = 1;
      }
    }

    // Exit progress
    if (w.exitT > 0) {
      ctx.fillStyle = '#39ff8a';
      ctx.font = '700 13px monospace';
      ctx.fillText('DESCENDING' + '.'.repeat(1 + (Math.floor(this.time * 4) % 3)), VIEW_W / 2, VIEW_H - 70);
      ctx.fillRect(VIEW_W / 2 - 60, VIEW_H - 62, 120 * clamp(w.exitT / 1.5, 0, 1), 4);
    } else if (w.arena === 'done' && w.level.exit && players.some((p) => p.local && p.state === 'alive' && aabbOverlap(p, w.level.exit))) {
      ctx.fillStyle = '#c8e8d0';
      ctx.font = '12px monospace';
      ctx.fillText(players.length > 1 ? 'ALL HUNTERS MUST BOARD THE LIFT' : 'HOLD POSITION', VIEW_W / 2, VIEW_H - 70);
    }

    // Partner off-screen arrows
    for (const p of players) {
      if (p.local || p.state === 'dead') continue;
      const sx = p.x + p.w / 2 - this.cam.x, sy = p.y + p.h / 2 - this.cam.y;
      if (sx > 0 && sx < VIEW_W && sy > 0 && sy < VIEW_H) continue;
      const ax = clamp(sx, 24, VIEW_W - 24), ay = clamp(sy, 70, VIEW_H - 24);
      const ang = Math.atan2(sy - ay, sx - ax);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      ctx.fillStyle = p.state === 'down' ? (Math.floor(this.time * 4) % 2 ? '#ff3b2b' : PCOL[p.idx]) : PCOL[p.idx];
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-6, 7);
      ctx.fill();
      ctx.restore();
    }

    // Local player state overlays
    const me = players.find((p) => p.local);
    if (me && me.state !== 'alive') {
      ctx.fillStyle = 'rgba(80,0,0,0.25)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#ffb0a0';
      ctx.font = '700 18px monospace';
      ctx.fillText(me.state === 'down' ? `CRITICAL — PARTNER CAN REVIVE YOU (${Math.ceil(me.downT)}s)` : 'RECONSTITUTING...', VIEW_W / 2, VIEW_H / 2 + 80);
    }
    // Low-health heartbeat (Abuse)
    if (me && me.state === 'alive' && me.hp < 40) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.audio.play('heartbeat');
        this.heartbeatT = me.hp < 15 ? 0.55 : 0.9;
      }
      ctx.fillStyle = `rgba(120,0,0,${0.12 + Math.sin(this.time * 8) * 0.06})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // Network status
    ctx.textAlign = 'left';
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(220,220,220,0.6)';
    if (opts.netText) ctx.fillText(opts.netText, 12, VIEW_H - 10);

    // Crosshair
    if (this.showCrosshair && me) {
      const { x, y } = this.mouse;
      const col = PCOL[me.idx];
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x - 4, y);
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y - 4);
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
      // Mouse-only mode: chevrons show the hunter is walking toward the cursor
      if (this.moveHint) {
        const d = Math.sign(this.moveHint);
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(this.moveHint);
        ctx.fillStyle = col;
        for (let i = 0; i < 2; i++) {
          const cx = x + d * (18 + i * 7);
          ctx.beginPath();
          ctx.moveTo(cx + d * 5, y);
          ctx.lineTo(cx - d * 1, y - 5);
          ctx.lineTo(cx - d * 1, y + 5);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (this.fireLock) {
        ctx.font = '700 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff6a3a';
        ctx.fillText('FIRING', x, y + 24);
      }
    }
  }

  playerPanel(ctx, p, x, y) {
    const col = PCOL[p.idx];
    ctx.fillStyle = 'rgba(5,6,8,0.72)';
    ctx.fillRect(x, y, 220, 58);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 3, 58);
    ctx.font = '700 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${p.name}`, x + 10, y + 14);
    ctx.fillStyle = '#9a9a9a';
    ctx.textAlign = 'right';
    ctx.fillText(`${p.score}`, x + 212, y + 14);
    // health segments
    const segs = 20;
    for (let i = 0; i < segs; i++) {
      const on = p.hp > (i / segs) * PLAYER.maxHp;
      ctx.fillStyle = on ? (p.hp < 30 ? '#ff3b2b' : col) : '#26282b';
      ctx.fillRect(x + 10 + i * 10, y + 20, 8, 7);
    }
    // weapon
    const W = WEAPONS[p.weapon];
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e2d0';
    ctx.font = '10px monospace';
    const ammo = W.ammo ? `${p.ammo[W.ammo]}/${AMMO[W.ammo].max}` : '∞';
    ctx.fillText(`${W.name}  ${ammo}`, x + 10, y + 41);
    ctx.fillStyle = '#ffcf5a';
    ctx.fillText(`DISC ${p.ammo.disc}`, x + 10, y + 53);
    // owned weapon slots
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = p.owned[i] ? (i === p.weapon ? col : '#6a6a6a') : '#1e1e1e';
      ctx.fillRect(x + 150 + i * 16, y + 33, 12, 9);
      ctx.fillStyle = '#000';
      ctx.fillText(String(i + 1), x + 153 + i * 16, y + 41);
    }
    let px = x + 80;
    ctx.font = '700 10px monospace';
    if (p.cloak > 0) {
      ctx.fillStyle = '#5ff3ff';
      ctx.fillText(`CAMO ${Math.ceil(p.cloak)}`, px, y + 53);
      px += 62;
    }
    if (p.overdrive > 0) {
      ctx.fillStyle = '#ff9a2a';
      ctx.fillText(`OVERDRIVE ${Math.ceil(p.overdrive)}`, px, y + 53);
    }
  }
}

function lampLevel(l, t) {
  if (!l.flicker) return 1;
  const v = Math.sin(t * 13 + l.x) + Math.sin(t * 31 + l.y * 0.3);
  return v > 1.4 ? 0.15 : 0.9 + Math.sin(t * 50 + l.x) * 0.1;
}

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
