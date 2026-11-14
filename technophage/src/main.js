// Boot, menus, fixed-timestep loop and online co-op glue.

import { VIEW_W, VIEW_H, DT, SNAPSHOT_EVERY, PROTOCOL, ZONES, WEAPONS, VERSION } from './config.js';
import { loadAssets } from './assets.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Renderer } from './render.js';
import { World, newPlayerData, makePlayer, playerCarry, HUNTER } from './sim.js';
import { hostRoom, joinRoom, cleanCode } from './net.js';
import { cleanName, num } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const input = new Input(canvas);
const audio = new Audio();
const renderer = new Renderer(canvas, audio);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('technophage.' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('technophage.' + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

// ---------------------------------------------------------------------------
// Session state

const S = {
  mode: null, // 'solo' | 'local' | 'host' | 'guest'
  world: null,
  running: false,
  paused: false,
  acc: 0,
  last: 0,
  link: null, // host: guest link; guest: host link
  room: null,
  code: '',
  pending: [], // host: events waiting for the next snapshot
  rtt: 0,
  pingT: 0,
  fade: 0,
  transition: null,
  carry: null,
  padAim: [0, 0],
  // Online: every level the host builds gets a new id. Guest reports carry the id of the
  // level they were made in, and the host ignores reports from a level it has left (stale
  // positions from the previous level used to trigger the next level's boss arena).
  levelId: 0,
  lobby: null, // host or guest lobby state before the game starts
};

function seed() {
  return (Math.random() * 2 ** 31) | 0;
}

function myName() {
  return cleanName($('name').value);
}

// ---------------------------------------------------------------------------
// Starting games

function startWorld(opts) {
  const w = new World(opts);
  if (opts.role === 'guest') w.outbox = [];
  S.world = w;
  renderer.setWorld(w);
  audio.setAmbient(w.zone);
  S.fade = 1;
  return w;
}

function startSolo(local) {
  S.mode = local ? 'local' : 'solo';
  const data = [newPlayerData(0, myName())];
  if (local) data.push(newPlayerData(1, 'PLAYER 2'));
  const zone = num(new URLSearchParams(location.search).get('zone'), 0, ZONES.length - 1); // ?zone=N starts in a later zone
  startWorld({ role: 'host', zoneIndex: zone, seed: seed(), playerData: data, localIdx: local ? [0, 1] : [0] });
  enterGame();
}

async function startHost() {
  setStatus('Opening room…');
  try {
    S.mode = 'host';
    S.room = await hostRoom(onGuestLink, (s) => renderer.message('NET: ' + s, 3));
    S.code = S.room.code;
    S.lobby = { role: 'host', guest: null, ready: false };
    showLobby();
    setStatus('');
  } catch (e) {
    S.mode = null;
    setStatus('Could not open a room: ' + e.message, true);
  }
}

// Host presses START in the lobby
function hostStartGame() {
  const data = [newPlayerData(0, myName())];
  if (S.link && S.lobby && S.lobby.guest) data.push(newPlayerData(1, S.lobby.guest));
  S.lobby = null;
  S.levelId++;
  const w = startWorld({ role: 'host', zoneIndex: 0, seed: seed(), playerData: data, localIdx: [0] });
  if (S.link && w.players[1]) S.link.send(welcomeMsg(w));
  hideLobby();
  enterGame();
  if (!w.players[1]) renderer.message(`ROOM ${S.code} — YOUR PARTNER CAN STILL JOIN`, 6);
}

async function startJoin() {
  const code = cleanCode($('code').value);
  if (code.length !== 6) return setStatus('Enter the 6-character room code.', true);
  setStatus('Connecting…');
  store.set('lastCode', code);
  try {
    const link = await joinRoom(code);
    S.mode = 'guest';
    S.link = link;
    S.code = code;
    link.onclose = () => endSession('Connection to host lost.');
    let welcomed = false;
    const timer = setTimeout(() => {
      if (!welcomed) endSession('Host did not respond.');
    }, 8000);
    link.onmessage = (m) => {
      if (m.t === 'lobby') {
        welcomed = true;
        clearTimeout(timer);
        S.lobby = { role: 'guest', host: cleanName(m.host), guest: cleanName(m.guest), ready: !!(S.lobby && S.lobby.ready) };
        showLobby();
        setStatus('');
      } else if (m.t === 'welcome') {
        welcomed = true;
        clearTimeout(timer);
        S.lobby = null;
        hideLobby();
        guestBuild(m);
        enterGame();
      } else if (m.t === 'full') endSession('Room is full.');
      else if (m.t === 'err') endSession(String(m.m || 'Rejected by host').slice(0, 80));
      else if (m.t === 'bye') endSession('Host left the game.');
      else if (m.t === 'ping') link.send({ t: 'pong', c: m.c });
      else if (S.world) guestMessage(m);
    };
    link.send({ t: 'hello', v: PROTOCOL, name: myName(), carry: S.carry });
  } catch (e) {
    setStatus(e.message, true);
  }
}

function enterGame() {
  input.fireLatch = false;
  if (input.mouseOnly) renderer.message('MOUSE MODE: POINT FAR LEFT/RIGHT TO MOVE · RIGHT CLICK TO JUMP', 6);
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  S.running = true;
  S.paused = false;
  input.enabled = true;
  setStatus('');
}

function endSession(reason) {
  S.running = false;
  if (S.link) S.link.onclose = null;
  try {
    S.link && S.link.close();
  } catch {
    /* ignore */
  }
  try {
    S.room && S.room.close();
  } catch {
    /* ignore */
  }
  S.link = null;
  S.room = null;
  S.world = null;
  S.mode = null;
  S.lobby = null;
  S.pending = [];
  S.transition = null;
  hideLobby();
  audio.stopAmbient();
  $('pause').classList.add('hidden');
  $('interlude').classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (reason) setStatus(reason, true);
}

// ---------------------------------------------------------------------------
// Host side networking

function onGuestLink(link) {
  if (S.link || (!S.world && !S.lobby)) {
    link.send({ t: 'full' });
    setTimeout(() => link.close(), 200);
    return;
  }
  link.onmessage = (m) => {
    if (m.t === 'hello') {
      if (m.v !== PROTOCOL) {
        link.send({ t: 'err', m: 'Game version mismatch. Both players should reload the page.' });
        return;
      }
      if (S.link) return;
      S.link = link;
      const hostName = myName();
      let name = cleanName(m.name);
      if (name === hostName) name = name.slice(0, 10) + '-2';
      audio.play('revive');
      if (S.lobby) {
        // Waiting in the lobby: the host starts when ready
        S.lobby.guest = name;
        S.lobby.ready = false;
        link.send({ t: 'lobby', host: hostName, guest: name });
        showLobby();
      } else {
        // Game already running: drop in next to the host
        const w = S.world;
        const p0 = w.players[0];
        w.players[1] = makePlayer(newPlayerData(1, name), p0.x + p0.w / 2 - 30, p0.y + p0.h, false);
        link.send(welcomeMsg(w));
        renderer.message(`${name} JOINED`, 3);
      }
    } else if (S.link === link) hostMessage(m);
  };
  link.onclose = () => {
    if (S.link !== link) return;
    S.link = null;
    if (S.lobby) {
      S.lobby.guest = null;
      S.lobby.ready = false;
      showLobby();
    } else if (S.world && S.world.players[1]) {
      renderer.message(`${S.world.players[1].name} DISCONNECTED`, 4);
      S.world.players[1] = undefined;
      S.world.players.length = 1;
    }
  };
}

function welcomeMsg(w) {
  return {
    t: 'welcome',
    lv: S.levelId,
    zone: w.zoneIndex,
    seed: w.seed,
    loop: w.loop,
    you: 1,
    players: w.players.map((p) => p && playerCarry(p)),
    tiles: w.level.destroyed || [],
    crates: w.crates.filter((c) => !c.alive).map((c) => c.id),
    ckpt: [w.checkpoint.x, w.checkpoint.y],
    pos: w.players[1] ? [Math.round(w.players[1].x), Math.round(w.players[1].y)] : null,
  };
}

function hostMessage(m) {
  const w = S.world;
  if (!w && m.t !== 'ready' && m.t !== 'ping' && m.t !== 'pong' && m.t !== 'bye') return;
  switch (m.t) {
    case 'st':
      if (m.lv === S.levelId) w.applyGuestState(1, m);
      break;
    case 'fire':
      if (m.lv === S.levelId && Array.isArray(m.f)) for (const f of m.f.slice(0, 20)) w.applyGuestFire(1, ['fire', ...f]);
      break;
    case 'ready':
      if (S.lobby) {
        S.lobby.ready = !!m.r;
        showLobby();
      }
      break;
    case 'ping':
      S.link.send({ t: 'pong', c: m.c });
      break;
    case 'pong':
      S.rtt = performance.now() - num(m.c, 0, 1e12);
      break;
    case 'bye':
      S.link.close();
      break;
  }
}

// ---------------------------------------------------------------------------
// Guest side networking

function guestBuild(m) {
  S.levelId = num(m.lv, 0, 1e9);
  const zone = num(m.zone, 0, ZONES.length - 1);
  const players = Array.isArray(m.players) ? m.players : [];
  const mine = S.carry || players[1];
  const data = [sanitizeCarry(players[0], 0), sanitizeCarry(mine, 1)];
  data[1].name = cleanName(players[1]?.name);
  const w = startWorld({ role: 'guest', zoneIndex: zone, seed: num(m.seed, 0, 2 ** 31), loop: num(m.loop, 0, 99), playerData: data, localIdx: [1] });
  if (Array.isArray(m.tiles)) for (const t of m.tiles.slice(0, 2000)) if (Array.isArray(t)) w.level.set(num(t[0], 0, 9999), num(t[1], 0, 99), 0);
  if (Array.isArray(m.crates)) for (const id of m.crates) if (w.crates[id]) w.crates[id].alive = false;
  if (Array.isArray(m.ckpt)) w.checkpoint = { x: num(m.ckpt[0], 0, 1e5), y: num(m.ckpt[1], 0, 1e5) };
  if (Array.isArray(m.pos)) {
    const p = w.players[1];
    p.x = num(m.pos[0], 0, 1e5);
    p.y = num(m.pos[1], 0, 1e5);
  }
  if (m.tiles && m.tiles.length) renderer.setWorld(w); // redraw art with destroyed tiles
}

function sanitizeCarry(c, idx) {
  const d = newPlayerData(idx, 'HUNTER');
  if (!c || typeof c !== 'object') return d;
  d.name = cleanName(c.name);
  if (Array.isArray(c.owned)) d.owned = [true, !!c.owned[1], !!c.owned[2], !!c.owned[3]];
  if (c.ammo && typeof c.ammo === 'object') for (const k of Object.keys(d.ammo)) d.ammo[k] = num(c.ammo[k], 0, 999);
  d.weapon = num(c.weapon, 0, 3);
  if (!d.owned[d.weapon]) d.weapon = 0;
  d.kills = num(c.kills, 0, 1e7);
  d.score = num(c.score, 0, 1e9);
  return d;
}

function guestMessage(m) {
  const w = S.world;
  switch (m.t) {
    case 's':
      w.applySnapshot(m);
      break;
    case 'level': {
      const me = w.players[1];
      S.carry = me ? playerCarry(me) : S.carry;
      guestBuild(m);
      break;
    }
    case 'zoneclear':
      showInterlude(m);
      break;
    case 'bye':
      endSession('Host left the game.');
      break;
    case 'ping':
      S.link.send({ t: 'pong', c: m.c });
      break;
    case 'pong':
      S.rtt = performance.now() - num(m.c, 0, 1e12);
      break;
  }
}

// ---------------------------------------------------------------------------
// Zone transitions (host decides)

function hostZoneClear() {
  const w = S.world;
  const carry = w.players.map((p) => p && playerCarry(p));
  let zone = w.zoneIndex + 1;
  let loop = w.loop;
  const victory = zone >= ZONES.length;
  if (victory) {
    zone = 0;
    loop++;
  }
  const stats = { t: 'zoneclear', zone: w.zoneIndex, victory, players: carry.map((c) => c && [c.name, c.kills, c.score]) };
  showInterlude(stats);
  if (S.link) S.link.send(stats);
  S.transition = { t: victory ? 7 : 4, zone, loop, carry };
}

function hostNextZone(tr) {
  const local = S.mode === 'local' ? [0, 1] : [0];
  // Restore each hunter to full health between zones; inventory carries over
  S.levelId++;
  const w = startWorld({ role: 'host', zoneIndex: tr.zone, seed: seed(), loop: tr.loop, playerData: tr.carry.map((c) => c || undefined), localIdx: local });
  if (S.link) {
    const msg = welcomeMsg(w);
    msg.t = 'level';
    S.link.send(msg);
  }
  $('interlude').classList.add('hidden');
}

function showInterlude(m) {
  const el = $('interlude');
  const zone = ZONES[num(m.zone, 0, ZONES.length - 1)];
  $('il-title').textContent = m.victory ? 'THE HIVE BURNS' : `${zone.name} CLEARED`;
  $('il-sub').textContent = m.victory ? 'The cycle repeats, harder. Descend again.' : `Descending to ${ZONES[(num(m.zone, 0, 9) + 1) % ZONES.length].name}…`;
  const rows = $('il-rows');
  rows.textContent = '';
  for (const r of (Array.isArray(m.players) ? m.players : []).slice(0, 2)) {
    if (!Array.isArray(r)) continue;
    const div = document.createElement('div');
    div.textContent = `${cleanName(r[0])} — ${num(r[1], 0, 1e7)} kills — ${num(r[2], 0, 1e9)} pts`;
    rows.appendChild(div);
  }
  el.classList.remove('hidden');
  if (S.mode === 'guest') setTimeout(() => el.classList.add('hidden'), m.victory ? 6500 : 3500);
}

// ---------------------------------------------------------------------------
// Main loop

function localInputs() {
  const w = S.world;
  const inputs = {};
  const cam = renderer.cam;
  for (const p of w.players) {
    if (!p || !p.local) continue;
    if (p.idx === 0 || S.mode === 'guest') {
      const piv = [p.x + p.w / 2 - cam.x, p.y + p.h - HUNTER.frameH + HUNTER.pivotY - cam.y];
      let inp = input.keyboard(piv);
      // A gamepad drives player 1 when there is no second local player
      if (S.mode !== 'local') {
        const g = input.gamepad(0, S.padAim[0]);
        if (g) {
          S.padAim[0] = g.aim;
          if (g.aimActive || g.mx || g.fire || g.jump || g.dashPressed || g.discPressed || g.cycle) inp = mergePad(inp, g);
        }
      }
      inputs[p.idx] = inp;
      renderer.moveHint = input.mouseOnly ? inp.mx : 0;
    } else {
      const g = input.gamepad(0, S.padAim[1]);
      if (g) S.padAim[1] = g.aim;
      inputs[p.idx] = g || { mx: 0, aim: S.padAim[1], slot: -1, cycle: 0 };
    }
  }
  input.consume();
  input.mouse.moved = false;
  if (Object.values(inputs).some((i) => i && i.pause)) setTimeout(togglePause, 0);
  return inputs;
}

function mergePad(k, g) {
  return {
    mx: g.mx || k.mx,
    up: g.up || k.up,
    down: g.down || k.down,
    jump: g.jump || k.jump,
    jumpPressed: g.jumpPressed || k.jumpPressed,
    dashPressed: g.dashPressed || k.dashPressed,
    fire: g.fire || k.fire,
    discPressed: g.discPressed || k.discPressed,
    aim: g.aimActive ? g.aim : k.aim,
    slot: k.slot,
    cycle: g.cycle || k.cycle,
  };
}

function tick() {
  const w = S.world;
  const inputs = localInputs();
  const evStart = w.events.length;
  w.update(inputs, DT);
  if (S.mode === 'guest') {
    w.guestInterpolate(DT);
    if (S.link) {
      if (w.outbox.length) {
        S.link.send({ t: 'fire', lv: S.levelId, f: w.outbox.map((f) => f.slice(1)) });
        w.outbox.length = 0;
      }
      if (w.tick % SNAPSHOT_EVERY === 0) {
        const p = w.players[1];
        S.link.send({
          t: 'st', lv: S.levelId, x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), a: Math.round(p.aim * 1000), f: p.facing,
          fl: (p.onGround ? 1 : 0) | (p.climbing ? 2 : 0) | (p.firing > 0 ? 4 : 0) | (p.dashT > 0 ? 8 : 0), w: p.weapon,
          am: [p.ammo.coil, p.ammo.fuel, p.ammo.cell, p.ammo.disc], ow: (p.owned[1] ? 2 : 0) | (p.owned[2] ? 4 : 0) | (p.owned[3] ? 8 : 0),
        });
      }
    }
  } else {
    // Host: forward authoritative events in the next snapshot
    if (S.link) {
      for (let i = evStart; i < w.events.length; i++) if (w.events[i][0] !== 'zoneclear') S.pending.push(w.events[i]);
      if (w.tick % SNAPSHOT_EVERY === 0) {
        S.link.send(w.snapshot(S.pending.splice(0, 400)));
        if (S.pending.length > 2000) S.pending.length = 0;
      }
    }
    if (w.done === 'zone' && !S.transition) hostZoneClear();
  }
  // Local co-op shares one screen: keep both hunters inside the camera view
  if (S.mode === 'local') {
    const cam = renderer.cam;
    for (const p of w.players) {
      if (!p || p.state === 'dead') continue;
      const nx = Math.max(cam.x + 4, Math.min(cam.x + VIEW_W - p.w - 4, p.x));
      if (nx !== p.x && !w.level.solidAt(nx + p.w / 2, p.y + p.h / 2)) p.x = nx;
    }
  }
  // Ping every second
  S.pingT -= DT;
  if (S.link && S.pingT <= 0) {
    S.pingT = 1;
    S.link.send({ t: 'ping', c: performance.now() });
    if (S.mode === 'guest' && performance.now() - S.link.lastRecv > 5000) endSession('Host stopped responding.');
  }
}

// Browsers pause requestAnimationFrame in hidden tabs. A host must keep simulating
// for its partner, so a worker timer steps the game
// while the tab is hidden (page timers are throttled there). Rendering is skipped.
function startBackgroundTicker() {
  try {
    const src = 'setInterval(() => postMessage(0), 16);';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = () => {
      if (document.hidden && S.running && (S.mode === 'host' || S.mode === 'guest')) step(performance.now(), false);
    };
  } catch {
    /* workers unavailable: the game pauses while hidden */
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  step(now, true);
}

function step(now, draw) {
  const dt = Math.min(0.1, (now - (S.last || now)) / 1000);
  S.last = now;
  if (!S.running || !S.world) return;
  const pauseSim = S.paused && (S.mode === 'solo' || S.mode === 'local');
  if (pauseSim && draw) {
    const g = input.gamepad(0, 0); // let Start unpause while the simulation is stopped
    if (g && g.pause) togglePause();
  }
  if (!pauseSim) {
    S.acc += dt;
    let n = 0;
    while (S.acc >= DT && n < 6) {
      tick();
      if (!S.world) return;
      S.acc -= DT;
      n++;
    }
    if (n === 6) S.acc = 0;
  }
  if (S.transition) {
    S.transition.t -= dt;
    if (S.transition.t <= 0) {
      const tr = S.transition;
      S.transition = null;
      hostNextZone(tr);
    }
  }
  const w = S.world;
  if (!draw) {
    renderer.consume(w); // keep effect queues from growing
    return;
  }
  renderer.mouse = { x: input.mouse.x, y: input.mouse.y };
  renderer.fireLock = input.toggleFire && input.fireLatch;
  const focus = w.players.filter((p) => p && p.local && p.state !== 'dead').map((p) => ({ x: p.x + p.w / 2 + Math.cos(p.aim) * 70, y: p.y + p.h / 2 + Math.sin(p.aim) * 40 }));
  if (!focus.length) w.players.filter((p) => p && p.state !== 'dead').forEach((p) => focus.push({ x: p.x + p.w / 2, y: p.y + p.h / 2 }));
  renderer.updateCamera(dt, focus);
  renderer.consume(w);
  renderer.render(dt, { netText: netText() });
  if (S.fade > 0) {
    S.fade = Math.max(0, S.fade - dt * 1.5);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgba(0,0,0,${S.fade})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function netText() {
  if (S.mode === 'host') return S.link ? `ROOM ${S.code} · CO-OP · ${Math.round(S.rtt)} ms` : `ROOM ${S.code} · WAITING FOR PARTNER (share the code)`;
  if (S.mode === 'guest') return `ROOM ${S.code} · ${Math.round(S.rtt)} ms`;
  if (S.mode === 'local') return input.padCount() ? 'LOCAL CO-OP' : 'LOCAL CO-OP · CONNECT A GAMEPAD FOR PLAYER 2';
  return '';
}

// ---------------------------------------------------------------------------
// UI wiring

// ---------------------------------------------------------------------------
// Lobby (online games wait here until the host presses START)

function inviteLink() {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('room', S.code);
  return u.toString();
}

function showLobby() {
  const L = S.lobby;
  if (!L) return;
  $('menu').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobby-code').textContent = S.code;
  const list = $('lobby-players');
  list.textContent = '';
  const row = (name, tag, cls) => {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.textContent = name;
    const t = document.createElement('span');
    t.textContent = tag;
    t.className = cls || '';
    li.append(n, t);
    list.appendChild(li);
  };
  if (L.role === 'host') {
    row(myName(), 'HOST', 'tag-host');
    if (L.guest) row(L.guest, L.ready ? 'READY' : 'NOT READY', L.ready ? 'tag-ready' : 'tag-wait');
    else row('Waiting for partner…', '', 'tag-wait');
    $('lobby-note').textContent = L.guest
      ? 'Press START when you are both ready.'
      : 'Share the code or link. You can also start now; your partner can join a running game.';
    $('btn-start').classList.remove('hidden');
    $('btn-ready').classList.add('hidden');
    $('btn-start').textContent = L.guest ? 'START' : 'START WITHOUT PARTNER';
  } else {
    row(L.host, 'HOST', 'tag-host');
    row(L.guest, L.ready ? 'READY' : 'NOT READY', L.ready ? 'tag-ready' : 'tag-wait');
    $('lobby-note').textContent = `Waiting for ${L.host} to start the game.`;
    $('btn-start').classList.add('hidden');
    $('btn-ready').classList.remove('hidden');
    $('btn-ready').textContent = L.ready ? 'NOT READY' : 'READY';
  }
}

function hideLobby() {
  $('lobby').classList.add('hidden');
}

function guestToggleReady() {
  if (!S.lobby || S.lobby.role !== 'guest' || !S.link) return;
  S.lobby.ready = !S.lobby.ready;
  S.link.send({ t: 'ready', r: S.lobby.ready });
  showLobby();
}

async function copyInvite() {
  const text = inviteLink();
  try {
    await navigator.clipboard.writeText(text);
    $('btn-copy').textContent = 'COPIED';
  } catch {
    $('btn-copy').textContent = 'COPY FAILED';
    window.prompt('Copy this link', text);
  }
  setTimeout(() => ($('btn-copy').textContent = 'COPY INVITE LINK'), 2000);
}

// Control settings, mirrored between the main menu and the pause menu
function applyControls(scheme, toggle, save = true) {
  input.mouseOnly = scheme === 'mouse';
  input.toggleFire = !!toggle;
  input.fireLatch = false;
  document.querySelectorAll('.opt-scheme').forEach((el) => (el.value = scheme));
  document.querySelectorAll('.opt-toggle').forEach((el) => (el.checked = !!toggle));
  if (save) {
    store.set('scheme', scheme);
    store.set('toggleFire', !!toggle);
  }
}

function setStatus(text, err) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('err', !!err);
}

function fit() {
  const scale = Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H);
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
}

function togglePause() {
  if (!S.running) return;
  S.paused = !S.paused;
  input.fireLatch = false;
  $('pause').classList.toggle('hidden', !S.paused);
  $('pause-note').textContent = S.mode === 'host' || S.mode === 'guest' ? 'Online games keep running while this menu is open.' : '';
  $('pause-code').textContent = S.code ? `Room code: ${S.code}` : '';
}

// Version label: VERSION from config.js, plus commit and build date when the deploy
// workflow has written version.json (a local server has none).
async function showVersion() {
  const el = $('version');
  el.textContent = `v${VERSION} · local build`;
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    const commit = String(v.commit || '').replace(/[^0-9a-f]/gi, '').slice(0, 7);
    const built = String(v.built || '').replace(/[^0-9TZ:-]/g, '').slice(0, 10);
    el.textContent = `v${VERSION} · ${commit}${built ? ' · ' + built : ''}`;
  } catch {
    /* keep the local label */
  }
}

async function boot() {
  fit();
  showVersion();
  addEventListener('resize', fit);
  $('name').value = store.get('name', 'HUNTER');
  $('code').value = store.get('lastCode', '');
  $('volume').value = store.get('volume', 0.7);
  applyControls(store.get('scheme', 'kbm') === 'mouse' ? 'mouse' : 'kbm', store.get('toggleFire', false), false);
  document.querySelectorAll('.opt-scheme').forEach((el) => el.addEventListener('change', () => applyControls(el.value, input.toggleFire)));
  document.querySelectorAll('.opt-toggle').forEach((el) => el.addEventListener('change', () => applyControls(input.mouseOnly ? 'mouse' : 'kbm', el.checked)));
  audio.setVolume(Number($('volume').value));
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('code').value = cleanCode(params.get('room'));

  setStatus('Loading assets…');
  try {
    await loadAssets((f) => setStatus(`Loading assets… ${Math.round(f * 100)}%`));
  } catch (e) {
    setStatus(e.message, true);
    return;
  }
  setStatus('');
  $('buttons').classList.remove('hidden');

  const gesture = () => audio.start();
  const wire = (id, fn) => $(id).addEventListener('click', () => {
    gesture();
    audio.play('ui');
    store.set('name', myName());
    fn();
  });
  wire('btn-solo', () => startSolo(false));
  wire('btn-local', () => startSolo(true));
  wire('btn-host', startHost);
  wire('btn-join', startJoin);
  wire('btn-controls', () => $('controls').classList.toggle('hidden'));
  wire('btn-resume', togglePause);
  wire('btn-start', hostStartGame);
  wire('btn-ready', guestToggleReady);
  wire('btn-copy', copyInvite);
  wire('btn-leave', () => {
    if (S.link) S.link.send({ t: 'bye' });
    endSession('');
  });
  wire('btn-quit', () => {
    if (S.link) S.link.send({ t: 'bye' });
    endSession('');
  });
  $('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join').click();
  });
  $('volume').addEventListener('input', (e) => {
    audio.setVolume(Number(e.target.value));
    store.set('volume', Number(e.target.value));
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  });
  canvas.addEventListener('mousedown', gesture);
  addEventListener('beforeunload', () => {
    if (S.link) S.link.send({ t: 'bye' });
  });
  requestAnimationFrame(frame);
  startBackgroundTicker();

  // Development hook for automated tests: ?autostart=solo|host|join
  const auto = params.get('autostart');
  if (auto === 'solo') startSolo(false);
  else if (auto === 'host') startHost();
  else if (auto === 'join') startJoin();
}

// Exposed for debugging in the browser console
window.TECHNOPHAGE = { S, renderer, input, audio, WEAPONS };
boot();
