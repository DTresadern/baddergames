// Game world simulation.
//
// role 'host'  : authoritative. Runs enemies, damage, pickups, arena and exit logic.
// role 'guest' : runs its own player's movement and weapons locally, simulates
//                projectiles for visuals, and applies host snapshots and events.
//
// Each client owns its own player's position, aim, weapons and ammo (co-op, so trust
// is acceptable). The host owns health, life state, power-up timers, enemies,
// pickups and level state.

import { TILE, T, PLAYER, WEAPONS, AMMO, DISC, POWERUP_TIME, ZONES, DT, TUNING } from './config.js';
import { Level } from './level.js';
import { ENEMIES, makeEnemy, updateEnemy } from './enemies.js';
import { makeRng, clamp, aabb, num } from './util.js';

// Hunter sprite geometry (matches assets/manifest.json "hunter"; kept here so the
// simulation does not depend on loaded images).
export const HUNTER = { frameH: 84, pivotY: 32.1, muzzle: 40 };

export function newPlayerData(idx, name) {
  return {
    idx, name,
    owned: [true, false, false, false],
    ammo: { coil: 0, fuel: 0, cell: 0, disc: 3 },
    weapon: 0,
    kills: 0, score: 0,
  };
}

export function makePlayer(data, x, y, local) {
  return {
    ...data,
    ammo: { ...data.ammo },
    owned: [...data.owned],
    x: x - PLAYER.w / 2, y: y - PLAYER.h, w: PLAYER.w, h: PLAYER.h, vx: 0, vy: 0,
    facing: 1, aim: 0, onGround: false, climbing: false,
    coyote: 0, jumpBuf: 0, jumpHeld: false, dropT: 0, dashT: 0, dashCd: 0, dashDir: 1,
    hp: PLAYER.maxHp, state: 'alive', downT: 0, reviveT: 0, respawnT: 0, invuln: 1.5,
    fireCd: 0, discCd: 0, firing: 0, recoil: 0, walk: 0,
    cloak: 0, overdrive: 0, hazardT: 0,
    local, // true when this client simulates the player's movement
    // network smoothing for remote players
    tx: x - PLAYER.w / 2, ty: y - PLAYER.h,
  };
}

export function playerCarry(p) {
  return { idx: p.idx, name: p.name, owned: [...p.owned], ammo: { ...p.ammo }, weapon: p.weapon, kills: p.kills, score: p.score };
}

export function muzzleOf(p) {
  const px = p.x + p.w / 2;
  const py = p.y + p.h - HUNTER.frameH + HUNTER.pivotY;
  return [px + Math.cos(p.aim) * HUNTER.muzzle, py + Math.sin(p.aim) * HUNTER.muzzle, px, py];
}

let projSeq = 1;

export class World {
  constructor({ role, zoneIndex, seed, loop = 0, playerData, localIdx }) {
    this.role = role;
    this.zoneIndex = zoneIndex;
    this.zone = ZONES[zoneIndex];
    this.seed = seed;
    this.loop = loop;
    this.level = new Level(zoneIndex, seed, this.zone);
    this.rng = makeRng(seed ^ 0x9e3779b9);
    this.tick = 0;
    this.time = 0;
    this.players = [];
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.crates = [];
    this.events = []; // authoritative events (host: sent to guests; both: drawn locally)
    this.fx = []; // local-only visual/audio events
    this.nextId = 1;
    this.arena = 'idle';
    this.bossId = 0;
    this.exitT = 0;
    this.wipeT = 0;
    this.done = null; // set to 'zone' when the exit is used
    this.checkpoint = { ...this.level.starts[0] };
    this.localIdx = localIdx; // array of player indexes simulated on this client
    this.hpScale = 1;
    this.messages = [];

    const L = this.level;
    playerData.forEach((d, i) => {
      if (!d) return;
      const s = L.starts[i] || L.starts[0];
      this.players[i] = makePlayer(d, s.x, s.y, localIdx.includes(i));
    });
    this.crates = L.crates.map((c, i) => ({ id: i, x: c.x - 28, y: c.y - 24, w: 56, h: 24, hp: 30, alive: true }));
    this.spawned = new Set();

    if (role === 'host') {
      const prng = makeRng(seed ^ 0x51ed);
      for (const p of L.pickups) {
        if (p.kind === 'ammo') this.addPickup('ammo', prng.pick(['coil', 'fuel', 'cell', 'disc', 'coil', 'cell']), p.x, p.y);
        else if (p.kind === 'medkit') this.addPickup('medkit', null, p.x, p.y);
        else {
          const r = prng.pick(['w1', 'w2', 'w3', 'w1', 'w2', 'w3', 'cloak', 'overdrive']);
          if (r[0] === 'w') this.addPickup('weapon', Number(r[1]), p.x, p.y);
          else this.addPickup(r, null, p.x, p.y);
        }
      }
    }
  }

  get playerCount() {
    return this.players.filter(Boolean).length;
  }

  emit(ev) {
    this.events.push(ev);
  }

  local(ev) {
    this.fx.push(ev);
  }

  msg(text, time = 3) {
    this.emit(['msg', text, time]);
  }

  addPickup(kind, item, x, y, vy = 0) {
    const p = { id: this.nextId++, kind, item, x: x - 11, y: y - 22, w: 22, h: 22, vx: 0, vy, onGround: false, t: 0 };
    this.pickups.push(p);
    return p;
  }

  spawnEnemy(type, x, y, opts = {}) {
    // Burrowing worms need solid ground under them (not a catwalk, not mid-air)
    if (ENEMIES[type].ai === 'worm') while (y < this.level.pxH && !this.level.solidAt(x, y + 1)) y += TILE;
    const boss = ENEMIES[type].boss;
    const coop = 1 + (boss ? TUNING.bossCoopScale : 0.6) * (this.playerCount - 1);
    const scale = (1 + 0.15 * this.zoneIndex + 0.5 * this.loop) * coop * (boss ? TUNING.bossHp : TUNING.enemyHp);
    const e = makeEnemy(this.nextId++, type, x, y, scale, this.rng);
    if (opts.parent) e.parent = opts.parent;
    if (opts.child) e.parent = opts.child;
    if (opts.cocoon) e.state = 'cocoon';
    e.aggro = opts.parent || opts.child ? 3 : 0;
    this.enemies.push(e);
    return e;
  }

  spawnProjectile(p) {
    const pr = { id: projSeq++, pierce: 0, hit: null, r: 3, grav: 0, bounce: false, ...p };
    this.projectiles.push(pr);
    // Host-originated enemy projectiles are sent to guests
    if (this.role === 'host' && pr.owner < 0) {
      this.emit(['proj', pr.kind, Math.round(pr.x), Math.round(pr.y), Math.round(pr.vx), Math.round(pr.vy), pr.grav, pr.color, pr.r, pr.life]);
    }
    return pr;
  }

  // ---- player control (runs on the client that owns the player) ----------

  controlPlayer(p, inp, dt) {
    const L = this.level;
    p.recoil = Math.max(0, p.recoil - dt * 6);
    p.firing = Math.max(0, p.firing - dt);
    if (p.state !== 'alive') {
      p.vx *= 0.9;
      p.vy = Math.min(p.vy + PLAYER.gravity * dt, PLAYER.maxFall);
      p.climbing = false;
      L.moveBody(p, dt, { ladderTop: true });
      return;
    }
    p.aim = inp.aim;
    if (Math.abs(Math.cos(p.aim)) > 0.05) p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;

    const over = p.overdrive > 0 ? 1.3 : 1;
    const inLiquid = L.overlaps(p, T.LIQUID);
    const speedMul = over * (inLiquid ? 0.55 : 1);
    const mx = inp.mx;

    // Ladders
    const cx = p.x + p.w / 2;
    const midTile = L.tileAt(cx, p.y + p.h / 2);
    const feetTile = L.tileAt(cx, p.y + p.h + 2);
    const onLadder = midTile === T.LADDER || L.tileAt(cx, p.y + p.h - 4) === T.LADDER;
    if (!p.climbing && ((onLadder && (inp.up || (inp.down && !p.onGround))) || (inp.down && feetTile === T.LADDER && p.onGround))) {
      p.climbing = true;
      p.x = Math.floor(cx / TILE) * TILE + TILE / 2 - p.w / 2;
      if (inp.down && feetTile === T.LADDER && !onLadder) p.y += 4;
    }
    if (p.climbing) {
      p.vx = mx * PLAYER.runSpeed * 0.4;
      p.vy = ((inp.down ? 1 : 0) - (inp.up ? 1 : 0)) * PLAYER.climbSpeed;
      if (!onLadder && feetTile !== T.LADDER) p.climbing = false;
      if (inp.jumpPressed && !inp.up) {
        p.climbing = false;
        p.vy = -PLAYER.jumpVel * 0.75;
      }
      if (p.climbing) {
        L.moveBody(p, dt, { dropThrough: true });
        if (p.onGround && inp.down) p.climbing = false;
        this.firePlayer(p, inp, dt);
        return;
      }
    }

    // Dash
    p.dashCd -= dt;
    if (inp.dashPressed && p.dashCd <= 0) {
      p.dashT = PLAYER.dashTime;
      p.dashCd = PLAYER.dashCooldown;
      p.dashDir = mx !== 0 ? Math.sign(mx) : p.facing;
      this.local(['sfx', 'dash', p.x, p.y]);
      this.local(['dash', p.x + p.w / 2, p.y + p.h / 2, p.dashDir]);
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDir * PLAYER.dashSpeed * over;
      p.vy = 0;
    } else {
      const target = mx * PLAYER.runSpeed * speedMul;
      const accel = p.onGround ? (mx === 0 ? PLAYER.friction : PLAYER.groundAccel) : PLAYER.airAccel;
      p.vx += clamp(target - p.vx, -accel * dt, accel * dt);
      p.vy = Math.min(p.vy + PLAYER.gravity * dt, inLiquid ? 220 : PLAYER.maxFall);
    }

    // Jumping (with coyote time and input buffering), drop-through with down+jump
    p.coyote = p.onGround ? PLAYER.coyote : p.coyote - dt;
    p.jumpBuf = inp.jumpPressed ? PLAYER.jumpBuffer : p.jumpBuf - dt;
    p.dropT -= dt;
    const onPlatform = p.onGround && [T.PLATFORM, T.LADDER].includes(L.tileAt(cx, p.y + p.h + 2));
    if (p.jumpBuf > 0 && inp.down && onPlatform) {
      p.dropT = 0.25;
      p.jumpBuf = 0;
      p.onGround = false;
    } else if (p.jumpBuf > 0 && (p.coyote > 0 || inLiquid)) {
      // In liquid every jump press is a swim kick, so a hunter can always get out
      p.vy = -PLAYER.jumpVel * (p.overdrive > 0 ? 1.1 : 1) * (inLiquid ? 0.85 : 1);
      p.jumpBuf = 0;
      p.coyote = 0;
      p.jumpHeld = true;
      this.local(['sfx', 'jump', p.x, p.y]);
    }
    if (p.jumpHeld && !inp.jump) {
      if (p.vy < 0) p.vy *= PLAYER.jumpCut;
      p.jumpHeld = false;
    }
    if (p.vy >= 0) p.jumpHeld = false;

    const wasAir = !p.onGround;
    const fallV = p.vy;
    L.moveBody(p, dt, { dropThrough: p.dropT > 0, ladderTop: !inp.down });
    if (p.onGround && wasAir && fallV > 300) this.local(['land', p.x + p.w / 2, p.y + p.h, fallV]);

    // Hazard tiles bounce the player (damage is applied by the host)
    if (L.overlaps({ x: p.x + 4, y: p.y + 8, w: p.w - 8, h: p.h - 6 }, T.HAZARD)) {
      p.vy = -520;
      p.coyote = 0;
    }
    if (p.y > L.pxH + 200) {
      p.y = L.pxH + 200;
      p.vy = 0;
    }

    if (p.onGround && Math.abs(p.vx) > 20) p.walk += Math.abs(p.vx) * dt * 0.045;
    this.firePlayer(p, inp, dt);
  }

  firePlayer(p, inp, dt) {
    p.fireCd -= dt;
    p.discCd -= dt;
    // Weapon switching
    if (inp.slot >= 0 && p.owned[inp.slot]) p.weapon = inp.slot;
    if (inp.cycle) {
      for (let i = 1; i <= 4; i++) {
        const w = (p.weapon + inp.cycle * i + 8) % 4;
        if (p.owned[w] && (w === 0 || p.ammo[WEAPONS[w].ammo] > 0)) {
          p.weapon = w;
          break;
        }
      }
    }
    const W = WEAPONS[p.weapon];
    if (inp.fire && p.fireCd <= 0) {
      if (W.ammo && p.ammo[W.ammo] <= 0) {
        p.weapon = 0;
        this.local(['sfx', 'empty', p.x, p.y]);
        p.fireCd = 0.25;
      } else {
        if (W.ammo) p.ammo[W.ammo]--;
        p.fireCd = W.interval * (p.overdrive > 0 ? 0.6 : 1);
        const [mx, my] = muzzleOf(p);
        const seed = (Math.random() * 1e9) | 0;
        this.shoot(p.idx, p.weapon, mx, my, p.aim, seed, true);
        p.firing = 0.12;
        p.recoil = W.kind === 'rail' ? 1 : W.kind === 'bolt' ? 0.35 : 0.1;
        if (W.kind === 'rail') {
          p.vx -= Math.cos(p.aim) * 140;
        }
        this.outbox?.push(['fire', p.weapon, Math.round(mx), Math.round(my), Math.round(p.aim * 1000), seed]);
      }
    }
    if (inp.discPressed && p.discCd <= 0 && p.ammo.disc > 0) {
      p.ammo.disc--;
      p.discCd = DISC.cooldown;
      const [mx, my] = muzzleOf(p);
      this.shoot(p.idx, 4, mx, my, p.aim, 0, true);
      this.outbox?.push(['fire', 4, Math.round(mx), Math.round(my), Math.round(p.aim * 1000), 0]);
    }
  }

  // Create the projectiles for one trigger pull. Deterministic for a given seed, so
  // host and guest produce the same shot from the same message.
  // weapon 4 = thrown disc charge.
  shoot(owner, weapon, x, y, angle, seed, mine) {
    const rng = makeRng(seed);
    const p = this.players[owner];
    if (weapon === 4) {
      const vx = Math.cos(angle) * DISC.speed + (p ? p.vx * 0.4 : 0);
      const vy = Math.sin(angle) * DISC.speed - 120;
      this.projectiles.push({ id: projSeq++, kind: 'disc', owner, x, y, vx, vy, grav: 1200, life: DISC.fuse, dmg: DISC.dmg, r: 5, bounce: true, color: '#ffcf5a', pierce: 0 });
      this.local(['sfx', 'throw', x, y]);
      if (this.role === 'host' && mine) this.emit(['shot', owner, weapon, Math.round(x), Math.round(y), Math.round(angle * 1000), seed]);
      return;
    }
    const W = WEAPONS[weapon];
    if (W.kind === 'beam') {
      this.beam(owner, W, x, y, angle);
    } else {
      const a = angle + rng.range(-1, 1) * W.spread;
      const sp = W.speed * (W.kind === 'flame' ? rng.range(0.8, 1.15) : 1);
      this.projectiles.push({
        id: projSeq++, kind: W.kind, owner, x, y, vx: Math.cos(a) * sp + (W.kind === 'flame' && p ? p.vx * 0.5 : 0), vy: Math.sin(a) * sp,
        grav: W.kind === 'flame' ? -260 : 0, life: W.life * (W.kind === 'flame' ? rng.range(0.7, 1.1) : 1), dmg: W.dmg, pierce: W.pierce || 0,
        r: W.kind === 'flame' ? 9 : W.kind === 'rail' ? 4 : 3, color: W.color, hit: W.pierce ? new Set() : null, breaks: W.breaks, weapon,
        ox: x, oy: y,
      });
    }
    this.local(['muzzle', owner, x, y, angle, weapon]);
    if (W.kind !== 'flame' || rng() < 0.3) this.local(['sfx', W.sound, x, y]);
    if (this.role === 'host' && mine) this.emit(['shot', owner, weapon, Math.round(x), Math.round(y), Math.round(angle * 1000), seed]);
  }

  // Plasma cutter: short instant beam. Cuts through every enemy along it, stops at walls.
  beam(owner, W, x, y, angle) {
    const L = this.level;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let len = 0;
    for (; len < W.range; len += 4) {
      const px = x + cos * len, py = y + sin * len;
      const t = L.tileAt(px, py);
      if (L.isSolidTile(t)) {
        if (this.role === 'host' && t === T.BREAK) this.damageTile(Math.floor(px / TILE), Math.floor(py / TILE), W.dmg * 1.5);
        this.local(['spark', px, py, 2, '#b7fbff']);
        break;
      }
    }
    const ex = x + cos * len, ey = y + sin * len;
    this.local(['beam', x, y, ex, ey]);
    if (this.role !== 'host') return;
    for (const e of this.enemies) {
      if (e.hidden || e.dead) continue;
      if (segBox(x, y, ex, ey, e)) this.damageEnemy(e, W.dmg, owner, cos * 30, sin * 30, 'plasma');
    }
    for (const c of this.crates) if (c.alive && segBox(x, y, ex, ey, c)) this.damageCrate(c, W.dmg);
  }

  // ---- host-side combat ---------------------------------------------------

  damageTile(tx, ty, dmg) {
    if (this.level.damageTile(tx, ty, dmg)) {
      this.emit(['tile', tx, ty]);
      this.emit(['debris', tx * TILE + TILE / 2, ty * TILE + TILE / 2]);
    }
  }

  damageCrate(c, dmg) {
    c.hp -= dmg;
    if (c.hp <= 0 && c.alive) {
      c.alive = false;
      this.emit(['crate', c.id]);
      const r = this.rng();
      const x = c.x + c.w / 2, y = c.y + c.h;
      if (r < 0.45) this.addPickup('ammo', this.rng.pick(['coil', 'fuel', 'cell', 'disc']), x, y, -300);
      else if (r < 0.7) this.addPickup('medkit', null, x, y, -300);
      else if (r < 0.78) this.addPickup(this.rng.pick(['cloak', 'overdrive']), null, x, y, -300);
    }
  }

  damageEnemy(e, dmg, owner, kx, ky, kind) {
    if (e.dead || e.invuln) return;
    const d = ENEMIES[e.type];
    const real = dmg * (1 - (d.armor || 0));
    e.hp -= real;
    e.flash = 0.08;
    e.aggro = 4;
    if (e.state === 'cocoon') e.state = 'drop';
    if (!d.boss && d.ai !== 'spawner' && d.ai !== 'worm') {
      e.vx += kx * (d.ai === 'swarm' ? 3 : 0.6);
      if (d.ai === 'stalker' && e.onGround && this.rng.chance(0.25)) {
        // Dodge after being hit (Abuse ants)
        e.vy = -480;
        e.vx = this.rng.chance(0.5) ? 380 : -380;
      }
    }
    if (this.rng() < 0.5 || kind === 'rail') {
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (d.mechanical) this.emit(['spark', Math.round(cx), Math.round(cy), 4, '#ffd27a']);
      else this.emit(['blood', Math.round(cx), Math.round(cy), d.blood, kind === 'rail' ? 14 : 4, Math.sign(kx) || 1]);
    }
    if (e.hp <= 0) this.killEnemy(e, owner, kind);
  }

  killEnemy(e, owner, kind) {
    const d = ENEMIES[e.type];
    e.dead = true;
    const cx = Math.round(e.x + e.w / 2), cy = Math.round(e.y + e.h / 2);
    this.emit(['die', e.type, cx, cy, d.mechanical ? 1 : 0, d.blood || '#888', kind === 'flame' ? 1 : 0, e.facing]);
    if (d.mechanical || d.boss) this.emit(['boom', cx, cy, d.boss ? 3 : 1]);
    const p = this.players[owner];
    if (p) {
      p.kills++;
      p.score += d.score;
    }
    // Drops (Abuse: enemies usually drop ammo)
    const r = this.rng();
    if (d.boss) {
      for (let i = 0; i < 4; i++) this.addPickup('ammo', this.rng.pick(['coil', 'fuel', 'cell', 'disc']), cx + i * 30 - 45, cy, -400);
      this.addPickup('medkit', null, cx, cy, -500);
    } else if (r < 0.28) this.addPickup('ammo', this.rng.pick(['coil', 'fuel', 'cell', 'disc', 'cell']), cx, cy, -250);
    else if (r < 0.34) this.addPickup('medkit', null, cx, cy, -250);
    if (e.id === this.bossId) this.bossDown();
  }

  hurtPlayer(p, dmg, kx, ky, contact) {
    if (p.state !== 'alive' || p.invuln > 0 || p.dashT > 0) return;
    p.hp -= dmg;
    p.invuln = contact ? PLAYER.invuln : 0.25;
    this.emit(['hurt', p.idx, Math.round(dmg), Math.round(kx), Math.round(ky)]);
    if (p.local) this.applyKnock(p, kx, ky);
    if (p.hp <= 0) {
      p.hp = 0;
      if (this.playerCount > 1) {
        p.state = 'down';
        p.downT = PLAYER.bleedOut;
        p.reviveT = 0;
        this.emit(['down', p.idx]);
        this.msg(`${p.name} IS DOWN — GET TO THEM`, 3);
      } else {
        p.state = 'dead';
        p.respawnT = 2.5;
        this.emit(['down', p.idx]);
      }
    }
  }

  applyKnock(p, kx, ky) {
    p.vx += kx;
    if (ky) p.vy = Math.min(p.vy, ky);
  }

  bossDown() {
    this.arena = 'done';
    this.level.gateClosed = false;
    this.emit(['gate', 0]);
    this.msg('THREAT NEUTRALISED — EXIT LIFT ONLINE', 4);
    this.emit(['shake', 14]);
    for (const e of this.enemies) if (!e.dead && e.parent) e.hp = 0, this.killEnemy(e, -1, 'boom');
  }

  // ---- update ---------------------------------------------------------------

  // inputs: map of player index -> input, for players simulated on this client
  update(inputs, dt = DT) {
    this.tick++;
    this.time += dt;
    for (const p of this.players) {
      if (!p) continue;
      // Timers tick for every player, including remote ones. (Previously only the owning
      // client counted invulnerability down, so the host saw a guest as invulnerable forever.)
      p.invuln = Math.max(0, p.invuln - dt);
      if (!p.local) p.dashT = Math.max(0, p.dashT - dt);
      p.cloak = Math.max(0, p.cloak - dt);
      p.overdrive = Math.max(0, p.overdrive - dt);
      if (p.local) this.controlPlayer(p, inputs[p.idx] || NO_INPUT, dt);
      else {
        // Remote players: ease toward the last reported position
        p.x += (p.tx - p.x) * 0.4;
        p.y += (p.ty - p.y) * 0.4;
        p.firing = Math.max(0, p.firing - dt);
        if (p.onGround && Math.abs(p.vx) > 20) p.walk += Math.abs(p.vx) * dt * 0.045;
      }
    }
    if (this.role === 'host') this.hostUpdate(dt);
    this.updateProjectiles(dt);
  }

  hostUpdate(dt) {
    const L = this.level;
    // Activate enemies as players approach (with a margin beyond the screen)
    for (const s of L.spawns) {
      if (this.spawned.has(s.id)) continue;
      if (this.players.some((p) => p && Math.abs(p.x - s.x) < 760)) {
        this.spawned.add(s.id);
        const z = this.zone;
        if (s.pool === 'ground') this.spawnEnemy(this.rng.pick(z.ground), s.x, s.y);
        else if (s.pool === 'air') {
          if (z.cave && this.rng.chance(0.5)) {
            // Cocoon stalker hanging from the ceiling (Abuse ants)
            let cy = s.y - TILE;
            while (cy > TILE && !L.solidAt(s.x, cy - TILE)) cy -= TILE;
            this.spawnEnemy('stalker', s.x, cy + 48 , { cocoon: true });
          } else this.spawnEnemy(this.rng.pick(z.air), s.x, s.y);
        } else {
          // Stationary enemies have no gravity: settle them onto the surface below
          let y = s.y;
          while (y < L.pxH && !L.solidAt(s.x, y + 1) && L.tileAt(s.x, y + 1) !== T.PLATFORM) y += TILE;
          this.spawnEnemy(this.rng.pick(z.static), s.x, y);
        }
      }
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      updateEnemy(this, e, dt);
      if (e.y > L.pxH + 100) {
        if (e.id === this.bossId) {
          e.x = L.bossSpawn.x - e.w / 2;
          e.y = L.bossSpawn.y - e.h - TILE * 2;
          e.vx = e.vy = 0;
        } else e.dead = true;
      }
      // Contact damage
      e.contactT -= dt;
      if (e.hidden || e.state === 'cocoon') continue;
      const d = ENEMIES[e.type];
      for (const p of this.players) {
        if (!p || p.state !== 'alive') continue;
        if (aabb(p, shrink(e, 0.15))) {
          const dir = p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1;
          const charge = e.state === 'charge' ? 2 : 1;
          this.hurtPlayer(p, d.melee * charge, dir * 360 * charge, -300, true);
          if (d.ai === 'swarm') e.vx = -e.vx, e.vy = -Math.abs(e.vy) - 100;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    // Safety net: the arena must never stay locked without its boss
    if (this.arena === 'fight' && this.bossId && !this.enemies.some((e) => e.id === this.bossId)) this.bossDown();

    // Player-side host checks: hazards, liquids, pickups, checkpoints, revive
    const alive = this.players.filter((p) => p && p.state === 'alive');
    for (const p of this.players) {
      if (!p) continue;
      p.hazardT -= dt;
      if (p.state === 'alive') {
        if (L.overlaps({ x: p.x + 4, y: p.y + 8, w: p.w - 8, h: p.h - 6 }, T.HAZARD) && p.hazardT <= 0) {
          p.hazardT = 0.5;
          this.hurtPlayer(p, 20, 0, -520, true);
        }
        if (L.overlaps(p, T.LIQUID) && p.hazardT <= 0) {
          p.hazardT = 0.25;
          this.hurtPlayer(p, 3, 0, 0, false);
        }
        if (p.y > L.pxH + 100) {
          this.hurtPlayer(p, 25, 0, 0, true);
          this.respawnPlayer(p, true);
        }
        for (const c of L.checkpoints) {
          if (Math.abs(p.x + p.w / 2 - c.x) < 40 && Math.abs(p.y + p.h - c.y) < 50 && (this.checkpoint.x !== c.x || this.checkpoint.y !== c.y)) {
            this.checkpoint = { x: c.x, y: c.y };
            this.emit(['ckpt', c.x, c.y]);
            this.msg('CHECKPOINT SYNCED', 2);
            for (const q of this.players) if (q && q.state === 'alive') q.hp = Math.max(q.hp, 60);
          }
        }
      } else if (p.state === 'down') {
        p.downT -= dt;
        const helper = alive.find((q) => Math.abs(q.x - p.x) < 70 && Math.abs(q.y - p.y) < 70);
        if (helper) p.reviveT += dt;
        else p.reviveT = Math.max(0, p.reviveT - dt);
        if (p.reviveT >= PLAYER.reviveTime) {
          p.state = 'alive';
          p.hp = 45;
          p.invuln = 1.5;
          this.emit(['revive', p.idx]);
          this.msg(`${p.name} REVIVED`, 2);
        } else if (p.downT <= 0) {
          p.state = 'dead';
          p.respawnT = PLAYER.respawnDelay;
        }
      } else if (p.state === 'dead') {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawnPlayer(p, false);
      }
    }

    // Wipe: everyone down or dead
    const living = this.players.filter((p) => p && p.state === 'alive').length;
    if (living === 0 && this.playerCount > 1) {
      this.wipeT += dt;
      if (this.wipeT > 2.5) {
        this.wipeT = 0;
        // In a boss fight the boss keeps its damage and the hunters regroup at the arena entrance
        this.msg(this.arena === 'fight' ? 'SIGNAL LOST — REGROUPING AT ARENA ENTRANCE' : 'SIGNAL LOST — RECONSTITUTING AT CHECKPOINT', 3);
        for (const p of this.players) if (p) this.respawnPlayer(p, false);
      }
    } else this.wipeT = 0;

    this.updatePickups(dt);
    this.updateArena();
  }

  respawnPlayer(p, keepState) {
    // Respawn next to a living partner when possible, otherwise at the checkpoint
    const partner = this.players.find((q) => q && q !== p && q.state === 'alive' && q.onGround);
    const arenaEntry = { x: this.level.arenaStartX + TILE * 3.5, y: (this.level.h - 3) * TILE };
    const at = this.arena === 'fight' ? arenaEntry : partner ? { x: partner.x + partner.w / 2, y: partner.y + partner.h } : this.checkpoint;
    p.x = at.x - p.w / 2;
    p.y = at.y - p.h - 2;
    p.tx = p.x;
    p.ty = p.y;
    p.vx = p.vy = 0;
    if (!keepState) {
      p.state = 'alive';
      p.hp = PLAYER.maxHp;
    }
    p.invuln = 2;
    this.emit(['respawn', p.idx, Math.round(p.x), Math.round(p.y), p.state === 'alive' ? 1 : 0]);
  }

  updatePickups(dt) {
    const L = this.level;
    for (const k of this.pickups) {
      k.t += dt;
      if (!k.onGround) {
        k.vy = Math.min(k.vy + 1400 * dt, 800);
        L.moveBody(k, dt, { ladderTop: true });
      }
      for (const p of this.players) {
        if (!p || p.state !== 'alive' || k.taken || k.t < 0.35) continue;
        if (aabb(p, k) && this.givePickup(p, k)) k.taken = true;
      }
    }
    this.pickups = this.pickups.filter((k) => !k.taken);
  }

  givePickup(p, k) {
    let text = '';
    if (k.kind === 'medkit') {
      if (p.hp >= PLAYER.maxHp) return false;
      p.hp = Math.min(PLAYER.maxHp, p.hp + 35);
      text = '+35 INTEGRITY';
    } else if (k.kind === 'cloak') {
      p.cloak = POWERUP_TIME.cloak;
      text = 'OPTIC CAMO';
    } else if (k.kind === 'overdrive') {
      p.overdrive = POWERUP_TIME.overdrive;
      text = 'OVERDRIVE';
    } else if (k.kind === 'ammo') {
      if (p.ammo[k.item] >= AMMO[k.item].max) return false;
      text = { coil: 'COIL SLUGS', fuel: 'FUEL CELL', cell: 'PLASMA CELLS', disc: 'DISC CHARGES' }[k.item];
    } else if (k.kind === 'weapon') {
      text = WEAPONS[k.item].name;
    }
    // Inventory changes are applied by the client that owns the player
    this.emit(['give', p.idx, k.kind, k.item ?? 0, Math.round(k.x), Math.round(k.y), text]);
    if (p.local) this.applyGive(p, k.kind, k.item);
    return true;
  }

  applyGive(p, kind, item) {
    if (kind === 'ammo') p.ammo[item] = Math.min(AMMO[item].max, p.ammo[item] + AMMO[item].pickup);
    else if (kind === 'weapon') {
      const W = WEAPONS[item];
      const fresh = !p.owned[item];
      p.owned[item] = true;
      p.ammo[W.ammo] = Math.min(AMMO[W.ammo].max, p.ammo[W.ammo] + AMMO[W.ammo].pickup * 2);
      if (fresh) p.weapon = item;
    }
  }

  updateArena() {
    const L = this.level;
    if (this.arena === 'idle' && L.arenaX) {
      const inside = this.players.filter((p) => p && p.state === 'alive' && p.x > L.arenaX && p.x < L.arenaEndX);
      if (inside.length) {
        this.arena = 'fight';
        L.gateClosed = true;
        this.emit(['gate', 1]);
        // Bring stragglers into the arena
        for (const p of this.players) {
          if (p && p.x < L.arenaStartX + TILE * 2) {
            p.x = L.arenaStartX + TILE * 3;
            p.y = inside[0].y;
            p.tx = p.x;
            p.ty = p.y;
            this.emit(['respawn', p.idx, Math.round(p.x), Math.round(p.y), p.state === 'alive' ? 1 : 0]);
          }
        }
        const b = L.bossSpawn;
        const type = this.zone.boss;
        const boss = this.spawnEnemy(type, b.x, b.y);
        if (ENEMIES[type].ai === 'flyer') boss.y -= TILE * 3;
        this.bossId = boss.id;
        this.emit(['boss', type, ENEMIES[type].name]);
        this.emit(['shake', 10]);
      }
    }
    // Exit lift: every living player must stand on it
    if (L.exit && this.arena === 'done' && !this.done) {
      const living = this.players.filter((p) => p && p.state !== 'dead');
      const on = living.filter((p) => p.state === 'alive' && aabb(p, L.exit));
      if (living.length && on.length === living.length) this.exitT += DT;
      else this.exitT = Math.max(0, this.exitT - DT * 2);
      if (this.exitT > 1.5) {
        this.done = 'zone';
        this.emit(['zoneclear']);
      }
    }
  }

  // ---- projectiles (both roles) ------------------------------------------

  updateProjectiles(dt) {
    const L = this.level;
    const host = this.role === 'host';
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.vy += pr.grav * dt;
      if (pr.kind === 'flame') {
        pr.vx *= 1 - 2.2 * dt;
        pr.vy *= 1 - 1.5 * dt;
        pr.r += 22 * dt;
      }
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 10));
      for (let s = 0; s < steps && !pr.dead; s++) {
        const ox = pr.x, oy = pr.y;
        pr.x += (pr.vx * dt) / steps;
        pr.y += (pr.vy * dt) / steps;
        const t = L.tileAt(pr.x, pr.y);
        if (L.isSolidTile(t)) {
          if (pr.bounce) {
            const hx = L.solidAt(pr.x, oy), hy = L.solidAt(ox, pr.y);
            pr.x = ox;
            pr.y = oy;
            if (hx || !hy) pr.vx = -pr.vx * 0.55;
            if (hy || !hx) pr.vy = -pr.vy * 0.5;
            pr.vx *= 0.85;
            if (Math.abs(pr.vy) > 80) this.local(['sfx', 'clink', pr.x, pr.y]);
            break;
          }
          if (host && pr.owner >= 0 && t === T.BREAK) this.damageTile(Math.floor(pr.x / TILE), Math.floor(pr.y / TILE), pr.kind === 'rail' ? 60 : pr.dmg * (pr.kind === 'flame' ? 0.3 : 1));
          this.impact(pr, ox, oy);
          break;
        }
        // Hits
        if (pr.owner >= 0) {
          for (const e of this.enemies) {
            if (e.dead || e.hidden) continue;
            if (pr.hit && pr.hit.has(e.id)) continue;
            if (pr.x > e.x - pr.r && pr.x < e.x + e.w + pr.r && pr.y > e.y - pr.r && pr.y < e.y + e.h + pr.r) {
              if (pr.kind === 'disc') {
                pr.life = 0;
                break;
              }
              if (host) this.damageEnemy(e, pr.dmg, pr.owner, Math.sign(pr.vx) * (pr.kind === 'rail' ? 200 : 40), 0, pr.kind);
              if (pr.hit) pr.hit.add(e.id);
              if (pr.pierce-- <= 0) {
                this.impact(pr, pr.x, pr.y, true);
                break;
              }
            }
          }
          if (host && !pr.dead) {
            for (const c of this.crates) {
              if (c.alive && pr.x > c.x && pr.x < c.x + c.w && pr.y > c.y && pr.y < c.y + c.h && !(pr.hit && pr.hit.has('c' + c.id))) {
                this.damageCrate(c, pr.dmg);
                if (pr.hit) pr.hit.add('c' + c.id);
                if (pr.kind !== 'flame' && pr.kind !== 'rail') this.impact(pr, pr.x, pr.y);
                break;
              }
            }
          }
        } else {
          for (const p of this.players) {
            if (!p || p.state !== 'alive') continue;
            if (pr.x > p.x - pr.r && pr.x < p.x + p.w + pr.r && pr.y > p.y - pr.r && pr.y < p.y + p.h + pr.r) {
              if (host) this.hurtPlayer(p, pr.dmg, Math.sign(pr.vx) * 120, pr.kind === 'mortar' ? -300 : 0, false);
              this.impact(pr, pr.x, pr.y);
              break;
            }
          }
        }
      }
      if (!pr.dead && pr.life <= 0) {
        if (pr.kind === 'disc' || pr.kind === 'mortar') this.impact(pr, pr.x, pr.y);
        else pr.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  impact(pr, x, y, flesh) {
    pr.dead = true;
    if (pr.kind === 'disc') return this.explode(pr, x, y, DISC.radius, DISC.dmg, true);
    if (pr.kind === 'mortar') return this.explode(pr, x, y, 80, pr.dmg, false);
    if (pr.kind === 'acid') this.local(['splash', x, y, pr.color]);
    else if (pr.kind !== 'flame') this.local(['spark', x, y, pr.kind === 'rail' ? 10 : 3, pr.color]);
    if (pr.kind === 'rail' && !flesh) this.local(['sfx', 'ricochet', x, y]);
  }

  // Explosion damage falls off linearly from centre to edge (as in Abuse).
  explode(pr, x, y, radius, dmg, byPlayer) {
    this.local(['explode', x, y, radius]);
    this.local(['sfx', 'explode', x, y]);
    this.local(['shake', byPlayer ? 7 : 5]);
    if (this.role !== 'host') return;
    const falloff = (o) => {
      const d = Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y);
      return d < radius ? 1 - d / radius : 0;
    };
    if (byPlayer) {
      for (const e of this.enemies) {
        const f = falloff(e);
        if (f > 0) this.damageEnemy(e, dmg * (0.3 + 0.7 * f), pr.owner, Math.sign(e.x - x) * 300 * f, 0, 'boom');
      }
      for (const c of this.crates) if (c.alive && falloff(c) > 0) this.damageCrate(c, 100);
      const r = Math.ceil(radius / TILE);
      const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
      for (let ty = cy - r; ty <= cy + r; ty++) for (let tx = cx - r; tx <= cx + r; tx++) {
        if (Math.hypot((tx + 0.5) * TILE - x, (ty + 0.5) * TILE - y) < radius) this.damageTile(tx, ty, 80);
      }
    } else {
      for (const p of this.players) {
        if (!p) continue;
        const f = falloff(p);
        if (f > 0) this.hurtPlayer(p, dmg * (0.4 + 0.6 * f), Math.sign(p.x - x) * 400 * f, -380 * f, false);
      }
    }
  }

  // ---- networking: snapshots and events -----------------------------------

  // Host -> guest snapshot. Integers keep the JSON small.
  snapshot(events) {
    return {
      t: 's',
      k: this.tick,
      p: this.players.map((p) => p && [
        p.idx, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), Math.round(p.aim * 1000), p.facing,
        (p.onGround ? 1 : 0) | (p.climbing ? 2 : 0) | (p.firing > 0 ? 4 : 0) | (p.dashT > 0 ? 8 : 0),
        Math.ceil(p.hp), STATE_CODE[p.state], Math.ceil(p.downT), Math.round(p.reviveT * 10), Math.ceil(p.cloak * 10), Math.ceil(p.overdrive * 10),
        p.weapon, p.kills, p.score, Math.round(p.walk * 100),
      ]),
      e: this.enemies.map((e) => [
        e.id, e.type, Math.round(e.x), Math.round(e.y), e.facing, e.flash > 0 ? 1 : 0, ENEMY_STATE[e.state] ?? 0,
        Math.round((e.rise ?? 1) * 100), Math.round((e.hp / e.maxHp) * 100), Math.round(e.aimX || 0), Math.round(e.aimY || 0), e.hidden ? 1 : 0, e.anim > 0 ? 1 : 0,
      ]),
      k2: this.pickups.map((k) => [k.id, k.kind, k.item ?? 0, Math.round(k.x), Math.round(k.y)]),
      a: [ARENA_CODE[this.arena], this.bossId, Math.round(this.exitT * 100), this.level.gateClosed ? 1 : 0],
      ev: events,
    };
  }

  // Guest: apply a host snapshot (positions are interpolated by the renderer).
  applySnapshot(s) {
    if (!s || !Array.isArray(s.p) || !Array.isArray(s.e)) return;
    for (const row of s.p) {
      if (!Array.isArray(row)) continue;
      const i = num(row[0], 0, 1, -1);
      const p = this.players[i];
      if (!p) continue;
      p.hp = num(row[8], 0, 999);
      p.state = STATE_NAME[num(row[9], 0, 2)] || 'alive';
      p.downT = num(row[10], 0, 99);
      p.reviveT = num(row[11], 0, 100) / 10;
      p.cloak = num(row[12], 0, 999) / 10;
      p.overdrive = num(row[13], 0, 999) / 10;
      p.kills = num(row[15], 0, 1e7);
      p.score = num(row[16], 0, 1e9);
      if (!p.local) {
        p.tx = num(row[1], -1e5, 1e5);
        p.ty = num(row[2], -1e5, 1e5);
        p.vx = num(row[3], -5000, 5000);
        p.vy = num(row[4], -5000, 5000);
        p.aim = num(row[5], -4000, 4000) / 1000;
        p.facing = row[6] < 0 ? -1 : 1;
        const f = num(row[7], 0, 15);
        p.onGround = !!(f & 1);
        p.climbing = !!(f & 2);
        if (f & 4) p.firing = 0.12;
        p.weapon = num(row[14], 0, 3);
        p.walk = num(row[17], 0, 1e9) / 100;
      }
    }
    const seen = new Set();
    const byId = new Map(this.enemies.map((e) => [e.id, e]));
    for (const r of s.e) {
      if (!Array.isArray(r) || !ENEMIES[r[1]]) continue;
      const id = num(r[0], 0, 1e9);
      seen.add(id);
      let e = byId.get(id);
      const d = ENEMIES[r[1]];
      if (!e) {
        e = { id, type: r[1], w: d.w, h: d.h, x: num(r[2], -1e5, 1e5), y: num(r[3], -1e5, 1e5), facing: 1, rx: 0, ry: 0, t: Math.random() * 10 };
        e.rx = e.x;
        e.ry = e.y;
        this.enemies.push(e);
      }
      e.px = e.rx; // previous target
      e.py = e.ry;
      e.rx = num(r[2], -1e5, 1e5);
      e.ry = num(r[3], -1e5, 1e5);
      e.lerpT = 0;
      e.facing = r[4] < 0 ? -1 : 1;
      e.flash = r[5] ? 0.08 : 0;
      e.state = ENEMY_STATE_NAME[num(r[6], 0, 9)] || 'walk';
      e.rise = num(r[7], 0, 100) / 100;
      e.hpPct = num(r[8], 0, 100);
      e.aimX = num(r[9], -1e5, 1e5);
      e.aimY = num(r[10], -1e5, 1e5);
      e.hidden = !!r[11];
      e.anim = r[12] ? 0.1 : 0;
    }
    this.enemies = this.enemies.filter((e) => seen.has(e.id));
    if (Array.isArray(s.k2)) {
      this.pickups = s.k2.filter(Array.isArray).slice(0, 200).map((r) => ({
        id: r[0], kind: String(r[1]).slice(0, 12), item: r[2], x: num(r[3], -1e5, 1e5), y: num(r[4], -1e5, 1e5), w: 22, h: 22, t: 1,
      }));
    }
    if (Array.isArray(s.a)) {
      this.arena = ARENA_NAME[num(s.a[0], 0, 2)] || 'idle';
      this.bossId = num(s.a[1], 0, 1e9);
      this.exitT = num(s.a[2], 0, 1000) / 100;
      this.level.gateClosed = !!s.a[3];
    }
    if (Array.isArray(s.ev)) for (const ev of s.ev.slice(0, 300)) this.applyEvent(ev);
  }

  // Guest: smooth enemy positions between snapshots
  guestInterpolate(dt) {
    for (const e of this.enemies) {
      e.lerpT = Math.min(1, (e.lerpT ?? 1) + dt / (DT * 2));
      e.x = e.px + (e.rx - e.px) * e.lerpT;
      e.y = e.py + (e.ry - e.py) * e.lerpT;
      if (!Number.isFinite(e.x)) e.x = e.rx, e.y = e.ry;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
    }
  }

  // Guest: apply one authoritative event from the host.
  applyEvent(ev) {
    if (!Array.isArray(ev) || typeof ev[0] !== 'string') return;
    const me = (i) => this.players[i] && this.players[i].local;
    switch (ev[0]) {
      case 'shot': {
        const owner = num(ev[1], 0, 1);
        if (me(owner)) return; // our own shots are already simulated
        const p = this.players[owner];
        if (p) p.firing = 0.12;
        this.shoot(owner, num(ev[2], 0, 4), num(ev[3], -1e5, 1e5), num(ev[4], -1e5, 1e5), num(ev[5], -4000, 4000) / 1000, num(ev[6], 0, 2 ** 31), false);
        return;
      }
      case 'proj':
        this.projectiles.push({
          id: projSeq++, kind: ['ebolt', 'acid', 'mortar'].includes(ev[1]) ? ev[1] : 'ebolt', owner: -1,
          x: num(ev[2], -1e5, 1e5), y: num(ev[3], -1e5, 1e5), vx: num(ev[4], -5000, 5000), vy: num(ev[5], -5000, 5000),
          grav: num(ev[6], -5000, 5000), color: /^#[0-9a-f]{6}$/i.test(ev[7]) ? ev[7] : '#ff4030', r: num(ev[8], 1, 12), life: num(ev[9], 0, 6), pierce: 0, dmg: 0,
        });
        return;
      case 'tile':
        this.level.set(num(ev[1], 0, 9999), num(ev[2], 0, 99), T.EMPTY);
        this.events.push(ev);
        return;
      case 'crate': {
        const c = this.crates[num(ev[1], 0, 9999)];
        if (c) c.alive = false;
        this.events.push(ev);
        return;
      }
      case 'give': {
        const p = this.players[num(ev[1], 0, 1)];
        const kind = String(ev[2]);
        if (p && p.local && (kind === 'ammo' ? AMMO[ev[3]] : kind === 'weapon' ? WEAPONS[num(ev[3], 1, 3)] : true)) {
          this.applyGive(p, kind, kind === 'weapon' ? num(ev[3], 1, 3) : ev[3]);
        }
        this.events.push(ev);
        return;
      }
      case 'hurt': {
        const p = this.players[num(ev[1], 0, 1)];
        if (p && p.local) this.applyKnock(p, num(ev[3], -2000, 2000), num(ev[4], -2000, 2000));
        this.events.push(ev);
        return;
      }
      case 'respawn': {
        const p = this.players[num(ev[1], 0, 1)];
        if (p) {
          p.x = p.tx = num(ev[2], -1e5, 1e5);
          p.y = p.ty = num(ev[3], -1e5, 1e5);
          p.vx = p.vy = 0;
        }
        this.events.push(ev);
        return;
      }
      case 'ckpt':
        this.checkpoint = { x: num(ev[1], 0, 1e5), y: num(ev[2], 0, 1e5) };
        this.events.push(ev);
        return;
      default:
        this.events.push(ev);
    }
  }

  // Host: apply a guest's report of its own player.
  applyGuestState(i, m) {
    const p = this.players[i];
    if (!p) return;
    const L = this.level;
    const nx = num(m.x, -100, L.pxW + 100, p.tx);
    const ny = num(m.y, -400, L.pxH + 400, p.ty);
    p.tx = nx;
    p.ty = ny;
    p.vx = num(m.vx, -2000, 2000);
    p.vy = num(m.vy, -2000, 2000);
    p.aim = num(m.a, -4000, 4000) / 1000;
    p.facing = m.f < 0 ? -1 : 1;
    const f = num(m.fl, 0, 15);
    p.onGround = !!(f & 1);
    p.climbing = !!(f & 2);
    p.dashT = f & 8 ? 0.05 : 0;
    p.weapon = num(m.w, 0, 3);
    if (Array.isArray(m.am)) ['coil', 'fuel', 'cell', 'disc'].forEach((k, j) => (p.ammo[k] = num(m.am[j], 0, AMMO[k].max)));
    const ow = num(m.ow, 0, 15);
    p.owned = [true, !!(ow & 2), !!(ow & 4), !!(ow & 8)];
  }

  // Host: replay a guest's trigger pull so its damage counts.
  applyGuestFire(i, m) {
    const p = this.players[i];
    if (!p || p.state !== 'alive') return;
    const w = num(m[1], 0, 4);
    // Rate limit with a token bucket: allows network bunching, not sustained over-rate fire
    const now = this.time;
    p.fireBudget = p.fireBudget || [3, 3, 3, 3, 3];
    p.fireStamp = p.fireStamp || [now, now, now, now, now];
    const rate = w === 4 ? 1 / DISC.cooldown : 1 / (WEAPONS[w].interval * 0.6);
    p.fireBudget[w] = Math.min(rate * 0.5 + 3, p.fireBudget[w] + (now - p.fireStamp[w]) * rate * 1.1);
    p.fireStamp[w] = now;
    if (p.fireBudget[w] < 1) return;
    p.fireBudget[w]--;
    // Shots must start near the guest's reported position
    const x = num(m[2], -1e5, 1e5), y = num(m[3], -1e5, 1e5);
    if (Math.abs(x - (p.tx + p.w / 2)) > 140 || Math.abs(y - (p.ty + p.h / 2)) > 140) return;
    p.firing = 0.12;
    this.shoot(i, w, x, y, num(m[4], -4000, 4000) / 1000, num(m[5], 0, 2 ** 31), false);
    // Forward to other clients (none in a 2-player game, kept for completeness)
    this.emit(['shot', i, w, Math.round(x), Math.round(y), m[4], m[5]]);
  }
}

const NO_INPUT = { mx: 0, up: false, down: false, jump: false, jumpPressed: false, dashPressed: false, fire: false, discPressed: false, aim: 0, slot: -1, cycle: 0 };
const STATE_CODE = { alive: 0, down: 1, dead: 2 };
const STATE_NAME = ['alive', 'down', 'dead'];
const ENEMY_STATE = { walk: 0, cocoon: 1, drop: 2, windup: 3, charge: 4, under: 5, rise: 6, attack: 7, sink: 8 };
const ENEMY_STATE_NAME = Object.keys(ENEMY_STATE);
const ARENA_CODE = { idle: 0, fight: 1, done: 2 };
const ARENA_NAME = ['idle', 'fight', 'done'];

function shrink(e, f) {
  return { x: e.x + e.w * f, y: e.y + e.h * f, w: e.w * (1 - 2 * f), h: e.h * (1 - 2 * f) };
}

function segBox(x1, y1, x2, y2, b) {
  // Sample along the segment (beams are short)
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
  }
  return false;
}
