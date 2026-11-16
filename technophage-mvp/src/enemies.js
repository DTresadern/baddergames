// Enemy definitions and AI. AI runs on the host only.

import { TILE } from './config.js';
import { clamp } from './util.js';

// w/h = hitbox. sprite = key in assets/manifest.json. score = points to the killer.
export const ENEMIES = {
  rat: { sprite: 'rat', w: 44, h: 26, hp: 16, speed: 215, ai: 'walker', melee: 8, sense: 460, blood: '#7d140c', score: 10, jumpy: true },
  stalker: { sprite: 'stalker', w: 70, h: 48, hp: 48, speed: 265, ai: 'stalker', melee: 15, sense: 600, blood: '#a8121a', score: 30 },
  insectoid: { sprite: 'insectoid', w: 84, h: 64, hp: 150, speed: 105, ai: 'charger', melee: 22, sense: 520, blood: '#9a3a0c', score: 60, armor: 0.25 },
  enforcer: {
    sprite: 'enforcer', w: 30, h: 76, hp: 62, speed: 120, ai: 'gunner', melee: 6, sense: 640, blood: '#6e0d0d', score: 40,
    shot: { kind: 'ebolt', dmg: 9, speed: 560, burst: 3, gap: 0.12, cool: 1.7, spread: 0.05, color: '#ff4030', muzzle: [24, 26] },
    keep: 260,
  },
  mech: {
    sprite: 'mech', w: 96, h: 124, hp: 340, speed: 55, ai: 'gunner', melee: 20, sense: 680, mechanical: true, score: 150, armor: 0.35,
    shot: { kind: 'ebolt', dmg: 6, speed: 640, burst: 9, gap: 0.07, cool: 2.4, spread: 0.12, color: '#ffb030', muzzle: [64, 62] },
    keep: 340,
  },
  drone: {
    sprite: 'drone', w: 70, h: 38, hp: 42, speed: 150, ai: 'flyer', melee: 8, sense: 640, mechanical: true, score: 35,
    shot: { kind: 'ebolt', dmg: 10, speed: 500, burst: 1, gap: 0, cool: 1.5, spread: 0.02, color: '#ff3355', muzzle: [30, 10] },
    searchlight: true,
  },
  swarm: { sprite: 'swarm', w: 44, h: 40, hp: 26, speed: 240, ai: 'swarm', melee: 10, sense: 560, blood: '#ff2a2a', mechanical: true, score: 25 },
  mould: {
    sprite: 'mould', w: 86, h: 34, hp: 95, speed: 0, ai: 'spitter', melee: 10, sense: 480, blood: '#a3b52a', score: 40,
    shot: { kind: 'acid', dmg: 12, speed: 430, cool: 1.9, color: '#c7ff3a' },
  },
  burster: { sprite: 'burster', w: 120, h: 100, hp: 230, speed: 0, ai: 'spawner', melee: 14, sense: 700, blood: '#a8121a', score: 120, children: ['stalker', 'rat', 'rat'], spawnEvery: 3.6, maxChildren: 3 },
  worm: {
    sprite: 'worm', w: 100, h: 56, hp: 120, speed: 170, ai: 'worm', melee: 18, sense: 560, blood: '#8a1c1c', score: 70,
    shot: { kind: 'acid', dmg: 11, speed: 420, cool: 0.5, color: '#d6ff6a' },
  },

  // Bosses: larger sprites, extra attack patterns (see boss flags in AI below)
  drone_boss: {
    sprite: 'drone_boss', w: 150, h: 80, hp: 550, speed: 120, ai: 'flyer', melee: 16, sense: 2000, mechanical: true, score: 1000, boss: true, name: 'SPIRE GUNSHIP',
    shot: { kind: 'ebolt', dmg: 10, speed: 520, burst: 5, gap: 0.08, cool: 1.3, spread: 0.3, color: '#ff3355', muzzle: [60, 20] },
    searchlight: true, summon: 'swarm', summonEvery: 7,
  },
  mech_boss: {
    sprite: 'mech_boss', w: 200, h: 250, hp: 800, speed: 45, ai: 'gunner', melee: 30, sense: 2000, mechanical: true, score: 1500, boss: true, armor: 0.15, name: 'ENFORCEMENT CHASSIS',
    shot: { kind: 'ebolt', dmg: 7, speed: 680, burst: 16, gap: 0.05, cool: 1.8, spread: 0.18, color: '#ffb030', muzzle: [128, 118] },
    mortar: { every: 4.5, count: 3 }, keep: 380,
  },
  worm_boss: {
    sprite: 'worm_boss', w: 200, h: 112, hp: 700, speed: 200, ai: 'worm', melee: 26, sense: 2000, blood: '#8a1c1c', score: 1500, boss: true, name: 'SUMP LEVIATHAN',
    shot: { kind: 'acid', dmg: 13, speed: 470, cool: 0.22, color: '#d6ff6a' },
  },
  insectoid_boss: {
    sprite: 'insectoid_boss', w: 170, h: 130, hp: 800, speed: 130, ai: 'charger', melee: 32, sense: 2000, blood: '#9a3a0c', score: 1800, boss: true, armor: 0.25, name: 'BROOD MATRIARCH',
    summon: 'rat', summonEvery: 5,
    shot: { kind: 'acid', dmg: 12, speed: 460, cool: 2.4, color: '#c7ff3a' },
  },
  burster_boss: {
    sprite: 'burster_boss', w: 250, h: 210, hp: 1100, speed: 0, ai: 'spawner', melee: 30, sense: 2000, blood: '#a8121a', score: 2500, boss: true, name: 'HIVE HEART',
    children: ['stalker', 'swarm', 'rat'], spawnEvery: 2.6, maxChildren: 6,
    shot: { kind: 'acid', dmg: 12, speed: 440, cool: 2.2, color: '#5ff3ff', fan: 7 },
  },
};

// Nearest targetable player (Abuse: enemies target the nearest player).
export function nearestTarget(world, e, range) {
  let best = null;
  let bd = range * range;
  for (const p of world.players) {
    if (!p || p.state !== 'alive' || p.cloak > 0) continue;
    const dx = p.x + p.w / 2 - (e.x + e.w / 2);
    const dy = p.y + p.h / 2 - (e.y + e.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

const G = 1600;

function groundAhead(level, e, dir) {
  const fx = dir > 0 ? e.x + e.w + 4 : e.x - 4;
  const fy = e.y + e.h + 4;
  return level.solidAt(fx, fy) || level.tileAt(fx, fy) === 2;
}

function faceTo(e, p) {
  if (p) e.facing = p.x + p.w / 2 > e.x + e.w / 2 ? 1 : -1;
}

function center(o) {
  return [o.x + o.w / 2, o.y + o.h / 2];
}

// Fire a shot (or burst element) from an enemy at a target.
function enemyShoot(sim, e, p, spec, extraSpread = 0) {
  const d = ENEMIES[e.type];
  const mx = e.facing > 0 ? e.x + (spec.muzzle ? spec.muzzle[0] : e.w) : e.x + e.w - (spec.muzzle ? spec.muzzle[0] : e.w);
  const my = e.y + (spec.muzzle ? spec.muzzle[1] : e.h / 2);
  const [px, py] = center(p);
  if (spec.kind === 'acid') {
    // Lob: pick a flight time from horizontal distance, solve vy
    const dx = px - mx;
    const t = clamp(Math.abs(dx) / spec.speed + 0.35, 0.45, 1.4);
    const vx = dx / t + sim.rng.range(-40, 40);
    const vy = (py - my - 0.5 * 900 * t * t) / t;
    sim.spawnProjectile({ kind: 'acid', owner: -1, x: mx, y: my, vx, vy, dmg: spec.dmg, life: 3, grav: 900, color: spec.color, r: 6 });
  } else {
    const a = Math.atan2(py - my, px - mx) + sim.rng.range(-1, 1) * ((spec.spread || 0) + extraSpread);
    sim.spawnProjectile({ kind: 'ebolt', owner: -1, x: mx, y: my, vx: Math.cos(a) * spec.speed, vy: Math.sin(a) * spec.speed, dmg: spec.dmg, life: 2.2, color: spec.color, r: 4 });
  }
  sim.emit(['sfx', d.mechanical ? 'eshot' : 'spit', mx, my]);
}

export function updateEnemy(sim, e, dt) {
  const d = ENEMIES[e.type];
  const level = sim.level;
  e.t += dt;
  e.cool -= dt;
  e.flash = Math.max(0, e.flash - dt);
  e.stun = Math.max(0, e.stun - dt);
  const target = nearestTarget(sim, e, d.sense * (e.aggro > 0 ? 1.6 : 1));
  e.aggro = Math.max(0, e.aggro - dt);
  const see = target && level.los(e.x + e.w / 2, e.y + e.h * 0.3, target.x + target.w / 2, target.y + target.h * 0.3);

  // Summoning bosses
  if (d.summon && target) {
    e.summonT = (e.summonT ?? d.summonEvery) - dt;
    // Cap living minions so a long fight cannot fill the arena
    if (e.summonT <= 0 && sim.enemies.filter((c) => c.parent === e.id && !c.dead).length < 6) {
      e.summonT = d.summonEvery;
      for (let i = 0; i < 2; i++) sim.spawnEnemy(d.summon, e.x + e.w / 2 + sim.rng.range(-60, 60), e.y + e.h * 0.5, { child: e.id });
      sim.emit(['sfx', 'screech', e.x, e.y]);
    }
  }

  switch (d.ai) {
    case 'walker':
    case 'stalker':
    case 'charger':
    case 'gunner':
      groundAI(sim, e, d, target, see, dt);
      break;
    case 'flyer':
      flyerAI(sim, e, d, target, see, dt);
      break;
    case 'swarm':
      swarmAI(sim, e, d, target, dt);
      break;
    case 'spitter':
      if (target && see && e.cool <= 0) {
        faceTo(e, target);
        enemyShoot(sim, e, target, d.shot);
        e.cool = d.shot.cool * sim.rng.range(0.8, 1.2);
        e.anim = 0.3;
      }
      e.anim = Math.max(0, (e.anim || 0) - dt);
      break;
    case 'spawner':
      spawnerAI(sim, e, d, target, see, dt);
      break;
    case 'worm':
      wormAI(sim, e, d, target, see, dt);
      break;
  }
}

function groundAI(sim, e, d, target, see, dt) {
  const level = sim.level;
  // Ceiling cocoon (Abuse ants): hang until a player passes below, then drop.
  if (e.state === 'cocoon') {
    e.vx = 0;
    e.vy = 0;
    for (const p of sim.players) {
      if (p && p.state === 'alive' && Math.abs(p.x + p.w / 2 - (e.x + e.w / 2)) < 140 && p.y > e.y) {
        e.state = 'drop';
        sim.emit(['sfx', 'screech', e.x, e.y]);
      }
    }
    return;
  }
  let want = 0;
  const speed = d.speed * (e.stun > 0 ? 0 : 1);
  if (target && (see || e.aggro > 0)) {
    faceTo(e, target);
    const [tx, ty] = center(target);
    const [ex, ey] = center(e);
    const dx = tx - ex;
    const adx = Math.abs(dx);
    if (!e.alerted) {
      e.alerted = true;
      if (d.ai === 'stalker' || d.ai === 'charger') sim.emit(['sfx', 'screech', ex, ey]);
    }
    if (d.ai === 'gunner') {
      // Hold a firing distance, shoot bursts
      if (adx > d.keep + 60) want = Math.sign(dx);
      else if (adx < d.keep - 80) want = -Math.sign(dx);
      if (see && e.cool <= 0 && adx < d.sense) {
        e.burst = d.shot.burst;
        e.burstT = 0;
        e.cool = d.shot.cool * sim.rng.range(0.85, 1.2);
      }
      if (d.mortar) {
        e.mortarT = (e.mortarT ?? d.mortar.every) - dt;
        if (e.mortarT <= 0) {
          e.mortarT = d.mortar.every;
          for (let i = 0; i < d.mortar.count; i++) {
            const vx = (dx / 1.3) * sim.rng.range(0.6, 1.3);
            sim.spawnProjectile({ kind: 'mortar', owner: -1, x: e.x + e.w / 2, y: e.y + 20, vx, vy: -700 - i * 60, dmg: 30, life: 4, grav: 900, color: '#ffb030', r: 7 });
          }
          sim.emit(['sfx', 'mortar', e.x, e.y]);
        }
      }
    } else if (d.ai === 'charger') {
      if (e.state === 'windup') {
        e.stateT -= dt;
        if (e.stateT <= 0) {
          e.state = 'charge';
          e.stateT = 1.1;
          sim.emit(['sfx', 'roar', ex, ey]);
        }
      } else if (e.state === 'charge') {
        e.stateT -= dt;
        e.vx = e.facing * d.speed * 4;
        if (e.hitWall || e.stateT <= 0) {
          if (e.hitWall) {
            e.stun = 1.0;
            sim.emit(['shake', 6]);
          }
          e.state = 'walk';
          e.cool = 2.2;
        }
      } else {
        want = Math.sign(dx);
        if (e.cool <= 0 && adx < 420 && Math.abs(ty - ey) < 90 && e.onGround) {
          e.state = 'windup';
          e.stateT = 0.55;
          e.vx = 0;
        }
        // The matriarch spits between charges
        if (d.shot) {
          e.spitT = (e.spitT ?? d.shot.cool) - dt;
          if (e.spitT <= 0 && see) {
            e.spitT = d.shot.cool;
            for (let i = 0; i < 3; i++) enemyShoot(sim, e, target, d.shot);
          }
        }
      }
    } else {
      want = Math.sign(dx);
      if (d.ai === 'stalker' && e.onGround && e.cool <= 0) {
        if (adx < 150) {
          // Pounce
          e.vx = Math.sign(dx) * 430;
          e.vy = -430;
          e.cool = 1.1;
          sim.emit(['sfx', 'hiss', ex, ey]);
        } else if (adx > 280 && see && sim.rng.chance(0.02)) {
          // Long leap
          e.vx = Math.sign(dx) * 560;
          e.vy = -560;
          e.cool = 1.4;
        }
      }
      if (adx < 8) want = 0;
    }
    // Jump at obstacles and up toward higher targets
    if (e.onGround && e.state !== 'charge' && d.ai !== 'gunner' && d.ai !== 'charger') {
      if (e.hitWall || (ty < ey - 70 && adx < 160 && sim.rng.chance(0.04))) {
        e.vy = d.jumpy ? -520 : -600;
      }
    }
  } else {
    // Patrol
    e.patrolT -= dt;
    if (e.patrolT <= 0) {
      e.patrolT = sim.rng.range(1.5, 4);
      e.dir = sim.rng.chance(0.3) ? 0 : sim.rng.chance(0.5) ? 1 : -1;
    }
    want = e.dir;
    if (want) e.facing = want;
  }
  // Do not walk off ledges while patrolling or holding distance
  if (want && e.onGround && !groundAhead(sim.level, e, want) && (!target || d.ai === 'gunner' || d.ai === 'charger')) {
    want = 0;
    e.dir = -e.dir;
  }

  if (e.state !== 'charge' && e.state !== 'windup') {
    const tv = want * speed * (target ? 1 : 0.4);
    if (e.onGround) e.vx += clamp(tv - e.vx, -1800 * dt, 1800 * dt);
    else e.vx += clamp(tv - e.vx, -500 * dt, 500 * dt);
  } else if (e.state === 'windup') e.vx *= 0.8;

  // Bursts
  if (e.burst > 0 && target) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      e.burst--;
      e.burstT = d.shot.gap;
      enemyShoot(sim, e, target, d.shot);
      e.anim = 0.12;
    }
  }
  e.anim = Math.max(0, (e.anim || 0) - dt);
  if (e.state === 'drop') e.state = 'walk';
  e.vy = Math.min(e.vy + G * dt, 1000);
  level.moveBody(e, dt, { ladderTop: true });
}

function flyerAI(sim, e, d, target, see, dt) {
  let tx, ty;
  if (target) {
    faceTo(e, target);
    const [px, py] = center(target);
    const side = e.x + e.w / 2 < px ? -1 : 1;
    tx = px + side * (d.boss ? 260 : 190) + Math.sin(e.t * 0.9 + e.id) * 60;
    ty = py - (d.boss ? 220 : 150) + Math.sin(e.t * 1.7) * 30;
    if (see && e.cool <= 0) {
      e.burst = d.shot.burst;
      e.burstT = 0;
      e.cool = d.shot.cool * sim.rng.range(0.8, 1.2);
    }
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burst--;
        e.burstT = d.shot.gap;
        enemyShoot(sim, e, target, d.shot);
      }
    }
    e.aimX = px;
    e.aimY = py;
  } else {
    tx = e.homeX + Math.sin(e.t * 0.5 + e.id) * 120;
    ty = e.homeY - 80 + Math.sin(e.t * 1.3) * 20;
    e.aimX = e.x + e.w / 2 + e.facing * 200;
    e.aimY = e.y + 220;
  }
  const ax = clamp(tx - (e.x + e.w / 2), -1, 1) * 600;
  const ay = clamp(ty - (e.y + e.h / 2), -1, 1) * 600;
  e.vx = clamp(e.vx + ax * dt, -d.speed, d.speed);
  e.vy = clamp(e.vy + ay * dt, -d.speed, d.speed);
  e.vx *= 0.985;
  e.vy *= 0.985;
  sim.level.moveBody(e, dt, { dropThrough: true });
  if (e.hitWall) e.vx = -e.vx * 0.5;
}

function swarmAI(sim, e, d, target, dt) {
  let tx = e.homeX, ty = e.homeY - 100;
  if (target) {
    [tx, ty] = center(target);
    faceTo(e, target);
  }
  const jitter = Math.sin(e.t * 9 + e.id * 3) * 260;
  const dx = tx - (e.x + e.w / 2), dy = ty - (e.y + e.h / 2);
  const dd = Math.hypot(dx, dy) || 1;
  const sp = target ? d.speed : d.speed * 0.4;
  e.vx += ((dx / dd) * sp * 3 + -dy / dd * jitter) * dt;
  e.vy += ((dy / dd) * sp * 3 + dx / dd * jitter) * dt;
  const v = Math.hypot(e.vx, e.vy);
  if (v > sp) {
    e.vx *= sp / v;
    e.vy *= sp / v;
  }
  sim.level.moveBody(e, dt, { dropThrough: true });
  if (e.hitWall) e.vx = -e.vx;
  if (e.hitCeil || e.onGround) e.vy = -e.vy;
}

function spawnerAI(sim, e, d, target, see, dt) {
  e.vx = 0;
  if (!target) return;
  faceTo(e, target);
  e.spawnT = (e.spawnT ?? 1.5) - dt;
  const alive = sim.enemies.filter((c) => c.parent === e.id).length;
  if (e.spawnT <= 0 && alive < d.maxChildren) {
    e.spawnT = d.spawnEvery * sim.rng.range(0.8, 1.2);
    const type = sim.rng.pick(d.children);
    sim.spawnEnemy(type, e.x + e.w / 2 + e.facing * e.w * 0.3, e.y + e.h - 4, { parent: e.id });
    sim.emit(['blood', e.x + e.w / 2, e.y + e.h * 0.5, ENEMIES[e.type].blood, 18, e.facing]);
    sim.emit(['sfx', 'burst', e.x, e.y]);
    e.anim = 0.4;
  }
  if (d.shot) {
    if (e.cool <= 0 && see) {
      e.cool = d.shot.cool;
      const [cx, cy] = center(e);
      const n = d.shot.fan || 1;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.32;
        sim.spawnProjectile({ kind: 'acid', owner: -1, x: cx, y: e.y + 30, vx: Math.cos(a) * d.shot.speed, vy: Math.sin(a) * d.shot.speed, dmg: d.shot.dmg, life: 4, grav: 600, color: d.shot.color, r: 7 });
      }
      sim.emit(['sfx', 'spit', cx, cy]);
    }
  }
  e.anim = Math.max(0, (e.anim || 0) - dt);
}

// Worm: travels hidden under the floor, erupts near a player, spits, then dives.
function wormAI(sim, e, d, target, see, dt) {
  e.stateT = (e.stateT ?? 0) - dt;
  e.vy = 0;
  const groundY = e.groundY;
  if (e.state === 'walk') e.state = 'under';
  if (e.state === 'under') {
    e.hidden = true;
    e.invuln = true;
    if (target) {
      const dx = target.x + target.w / 2 - (e.x + e.w / 2);
      e.vx = clamp(dx * 2, -d.speed, d.speed);
      faceTo(e, target);
      if (Math.abs(dx) < 120 && e.stateT <= 0) {
        e.state = 'rise';
        e.stateT = 0.5;
        e.vx = 0;
        sim.emit(['sfx', 'rumble', e.x, e.y]);
      }
    } else e.vx = 0;
    // do not tunnel through walls or off the floor
    const nx = e.x + e.vx * dt;
    const footL = sim.level.solidAt(nx + 4, groundY + 4);
    const footR = sim.level.solidAt(nx + e.w - 4, groundY + 4);
    const blocked = sim.level.solidAt(e.vx > 0 ? nx + e.w : nx, groundY - 8);
    if (footL && footR && !blocked) e.x = nx;
    if (Math.random() < 0.5) sim.emit(['dirt', e.x + e.w / 2, groundY]);
  } else if (e.state === 'rise') {
    e.hidden = false;
    e.invuln = false;
    e.rise = Math.min(1, (e.rise || 0) + dt * 2.2);
    if (e.stateT <= 0) {
      e.state = 'attack';
      e.stateT = d.boss ? 3.2 : 2.2;
      sim.emit(['sfx', 'roar', e.x, e.y]);
      sim.emit(['shake', d.boss ? 10 : 5]);
    }
  } else if (e.state === 'attack') {
    if (target) faceTo(e, target);
    if (target && e.cool <= 0) {
      e.cool = d.shot.cool;
      enemyShoot(sim, e, target, d.shot);
    }
    if (e.stateT <= 0) {
      e.state = 'sink';
      e.stateT = 0.6;
    }
  } else if (e.state === 'sink') {
    e.rise = Math.max(0, (e.rise || 0) - dt * 2);
    if (e.stateT <= 0) {
      e.state = 'under';
      e.stateT = d.boss ? 1.2 : 2;
    }
  }
  e.y = groundY - e.h * (e.rise || 0);
}

// Initial state for a new enemy
export function makeEnemy(id, type, x, y, hpScale, rng) {
  const d = ENEMIES[type];
  const e = {
    id, type,
    x: x - d.w / 2, y: y - d.h, w: d.w, h: d.h, vx: 0, vy: 0,
    hp: d.hp * hpScale, maxHp: d.hp * hpScale,
    facing: rng.chance(0.5) ? 1 : -1, t: rng() * 10, cool: rng.range(0.5, 1.5), flash: 0, stun: 0,
    state: 'walk', stateT: 0, patrolT: 0, dir: 0, aggro: 0, burst: 0, burstT: 0,
    onGround: false, hitWall: 0, homeX: x, homeY: y, anim: 0, contactT: 0,
  };
  if (d.ai === 'flyer' || d.ai === 'swarm') e.y = y - d.h - TILE * 2;
  if (d.ai === 'worm') {
    e.groundY = y;
    e.state = 'under';
    e.rise = 0;
    e.hidden = true;
  }
  return e;
}
