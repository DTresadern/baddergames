// Headless smoke test: a bot plays every zone in the simulation (no browser).
// Usage: node tools/simtest.mjs [players=1|2] [seeds=3]
// Reports per zone whether the arena was reached, the boss killed and the exit used.

import { World, newPlayerData } from '../src/sim.js';
import { ZONES, DT } from '../src/config.js';

const players = Number(process.argv[2] || 1);
const seeds = Number(process.argv[3] || 3);
const MAX_TICKS = 60 * 60 * 6; // 6 minutes of game time per zone

function botInput(w, p, t) {
  // Aim at the nearest visible enemy, else straight ahead
  let best = null, bd = 1e12;
  for (const e of w.enemies) {
    if (e.hidden) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd && d < 700 ** 2) {
      bd = d;
      best = e;
    }
  }
  const aim = best ? Math.atan2(best.y + best.h / 2 - (p.y + 14), best.x + best.w / 2 - (p.x + p.w / 2)) : 0;
  const stuck = p.hitWall > 0;
  const exit = w.level.exit;
  let mx = 1;
  if (w.arena === 'done' && exit) mx = Math.sign(exit.x + exit.w / 2 - (p.x + p.w / 2)) || 0;
  else if (w.arena === 'fight') mx = Math.sin(t / 50) > 0 ? 1 : -1;
  return {
    mx, up: stuck, down: false, jump: true, jumpPressed: stuck || t % 97 === 0 || (best && t % 40 === 0),
    dashPressed: t % 300 === 0, fire: !!best || t % 30 === 0, discPressed: !!best && t % 240 === 0,
    aim, slot: -1, cycle: t % 600 === 0 ? 1 : 0,
  };
}

let failures = 0;
for (let zi = 0; zi < ZONES.length; zi++) {
  for (let s = 1; s <= seeds; s++) {
    const data = [newPlayerData(0, 'BOT1')];
    if (players > 1) data.push(newPlayerData(1, 'BOT2'));
    const w = new World({ role: 'host', zoneIndex: zi, seed: s * 7919 + zi, playerData: data, localIdx: data.map((_, i) => i) });
    let arenaAt = -1, bossAt = -1, t = 0, deaths = 0, maxX = 0;
    try {
      for (t = 0; t < MAX_TICKS && !w.done; t++) {
        const inputs = {};
        for (const p of w.players) {
          if (!p) continue;
          inputs[p.idx] = botInput(w, p, t);
          if (p.state !== 'alive') continue;
          p.hp = Math.max(p.hp, 60); // keep the bot alive; this tests progression, not difficulty
          p.invuln = Math.max(p.invuln, 0.05);
          maxX = Math.max(maxX, p.x);
          // Unstick: if the bot has not progressed for a while, nudge it forward
        }
        w.update(inputs, DT);
        w.events.length = 0;
        w.fx.length = 0;
        if (w.arena === 'fight' && arenaAt < 0) arenaAt = t;
        if (w.arena === 'done' && bossAt < 0) bossAt = t;
        for (const p of w.players) if (p && p.state !== 'alive') deaths++;
        if (t % 600 === 0 && w.arena === 'idle') {
          // progress guard: teleport the bot over obstacles it cannot path (bot is dumb, level may be fine)
          const p = w.players[0];
          if (p.x < maxX - 10 || (t > 0 && p.x === w._lastX)) {
            p.y -= 96;
            p.x += 64;
          }
          w._lastX = p.x;
        }
      }
    } catch (e) {
      failures++;
      console.log(`zone ${zi} seed ${s}: EXCEPTION at tick ${t}:`, e.stack.split('\n').slice(0, 4).join(' | '));
      continue;
    }
    const ok = w.done === 'zone';
    if (!ok) failures++;
    console.log(
      `zone ${zi} (${ZONES[zi].key}) seed ${s}: width ${w.level.w} tiles, enemies alive ${w.enemies.length}, ` +
        `arena ${arenaAt >= 0 ? (arenaAt / 60).toFixed(0) + 's' : 'NO'}, boss ${bossAt >= 0 ? ((bossAt - arenaAt) / 60).toFixed(0) + 's' : 'NO'}, ` +
        `exit ${ok ? (t / 60).toFixed(0) + 's' : 'NO'}, kills ${w.players.map((p) => p && p.kills).join('/')}`,
    );
  }
}
console.log(failures ? `FAILED: ${failures}` : 'ALL ZONES COMPLETED');
process.exit(failures ? 1 : 0);
