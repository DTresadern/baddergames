// The net session: one object, created in main.js, outside the scenes. Host-authoritative: the
// host's browser runs the game and sends snapshots of the Sandbox players and enemies; the guest
// sends one input message per tick, predicts its own player (reconciling on each snapshot) and
// draws the host's player and enemies interpolated; both estimate the shared clock from pings.
//
// Scenes never see this object. The harness gets wrapInput(input) as its input (a guest's frame
// becomes the host's player 2 frame, inputs[1]); the Sandbox gets netView(), plain data and pure
// queries. main.js calls afterFrame(now) after each harness frame and reacts to events.
//
// Host states: creating, waiting, joined (a guest is connected), left (the guest left; still
// hosting and waiting for a new one), failed (with a reason), idle (after leave).
// Guest states: connecting, connected, ended (with a reason: invalid, not-found, full, version,
// dropped, host-left, server, timeout, unsupported, failed, left).
// Events (subscribe): { type: 'state', state }, { type: 'connected', map } (guest),
// { type: 'ended', reason, wasConnected } (guest), { type: 'map', map } (guest: the host changed
// map), { type: 'host-failed', reason }.

import { ACTIONS } from '../input/actions.js';
import { MAP_KEY } from '../scenes/sandbox.js';
import {
  PROTOCOL_VERSION,
  byeMessage,
  frameFromMasks,
  helloMessage,
  inputMessage,
  mapMessage,
  pingMessage,
  pongMessage,
  rejectMessage,
  snapMessage,
  snapshotFromMessage,
  welcomeMessage,
} from './codec.js';
import { createClockSync } from './clock-sync.js';
import { INTERP_DELAY_TICKS, createInterpolationBuffer } from './interpolation.js';
import { clampLag, createLink } from './link.js';
import { createInputHistory } from './prediction.js';
import { cleanRoomCode, isRoomCode, makeRoomCode } from './room-code.js';

export const PING_INTERVAL_MS = 500;
export const SNAPSHOT_EVERY_TICKS = 2; // 30 per second
export const JITTER_START = 2; // guest inputs queued before the host starts consuming them
export const JITTER_MAX = 8; // beyond this the oldest queued input is dropped (its presses kept)
const PAUSE_BIT = 1 << ACTIONS.indexOf('pause');

// `?net=local` (BroadcastChannel transport, else PeerJS), `?lag=ms` (0..2000) and `?room=CODE`
// (an invite link; null when absent), from the page's query string.
export function parseNetOptions(search) {
  const params = new URLSearchParams(search);
  return { local: params.get('net') === 'local', lagMs: clampLag(params.get('lag') ?? 0), room: params.get('room') };
}

// The host's queue of guest inputs: append in tick order, consume one per host tick once
// JITTER_START are queued; when empty, repeat the last held mask with no presses (ack unchanged)
// and wait for JITTER_START again. Over JITTER_MAX, drop the oldest but OR its presses into the
// next one, so a jump is never lost.
export function createGuestInputQueue() {
  const queue = [];
  let lastQueued = -1;
  let consuming = false;
  let last = { held: 0, aim: 0 };
  let prevHeld = 0;
  let ack = -1;
  return {
    push({ tick, held, pressed, aim }) {
      if (tick <= lastQueued) return;
      lastQueued = tick;
      queue.push({ tick, held, pressed, aim });
      if (queue.length > JITTER_MAX) {
        const dropped = queue.shift();
        queue[0].pressed |= dropped.pressed;
      }
    },
    // The next frame for the guest's player (player index 1).
    next() {
      if (!consuming && queue.length >= JITTER_START) consuming = true;
      let masks;
      if (consuming && queue.length > 0) {
        const entry = queue.shift();
        ack = entry.tick;
        last = { held: entry.held, aim: entry.aim };
        masks = entry;
      } else {
        consuming = false;
        masks = { held: last.held, pressed: 0, aim: last.aim };
      }
      // The guest's pause key opens the guest's own pause overlay, never the host's.
      const frame = frameFromMasks({ held: masks.held & ~PAUSE_BIT, pressed: masks.pressed & ~PAUSE_BIT, aim: masks.aim }, prevHeld & ~PAUSE_BIT, 1);
      prevHeld = masks.held;
      return frame;
    },
    ack: () => ack,
    size: () => queue.length,
  };
}

// `now()` ms; `setTimeout` / `clearTimeout` for the link; `randomUint32s(n)` for room codes;
// `lagMs` delays every send (test option); `mapKey()` the Sandbox map a new guest is told;
// `sandboxState()` the Sandbox state while it is the active main scene, else null.
export function createNetSession({
  now,
  setTimeout: setTimer,
  clearTimeout: clearTimer,
  randomUint32s,
  lagMs = 0,
  mapKey = () => MAP_KEY,
  sandboxState = () => null,
}) {
  const listeners = new Set();
  let generation = 0; // bumped on every new role, so callbacks of an old one are ignored
  let role = null;
  let state = 'idle';
  let reason = null;
  let code = null;
  let handle = null; // the transport's host or join handle
  let link = null;
  let linkChannel = null; // the raw channel under `link`
  let localTick = 0;
  let clock = createClockSync();
  let nextPingAt = 0;
  let pingId = 0;
  // Host
  let guestReady = false; // a guest said hello with the right version
  let guestInputs = createGuestInputQueue();
  let lastSnapTick = -Infinity;
  let lastSentMap = null;
  // Guest
  let slot = 0;
  let history = createInputHistory();
  let interp = createInterpolationBuffer();
  // The host's enemies by id: id -> { type, buffer } (insertion order = first seen). Null before
  // the first snapshot (and after a map change), so the Sandbox keeps its own map's enemies.
  let enemyBuffers = null;
  let pendingSnapshot = null;
  let lastSnapshotTick = -1;
  let worldOffset = null; // host world tick (wt) minus host net tick, from the newest snapshot

  const emit = (event) => {
    for (const fn of [...listeners]) fn(event);
  };
  const setState = (s, r = null) => {
    state = s;
    reason = r;
    emit({ type: 'state', state: s, reason: r });
  };

  function makeLink(channel, onMessage, onClose) {
    return createLink({ channel, now, setTimeout: setTimer, clearTimeout: clearTimer, lagMs, onMessage, onClose });
  }

  function resetPeerData() {
    clock = createClockSync();
    nextPingAt = 0;
    guestReady = false;
    guestInputs = createGuestInputQueue();
    lastSnapTick = -Infinity;
    lastSentMap = null;
    slot = 0;
    history = createInputHistory();
    interp = createInterpolationBuffer();
    enemyBuffers = null;
    pendingSnapshot = null;
    lastSnapshotTick = -1;
    worldOffset = null;
  }

  function onPong(msg) {
    clock.add({ sent: msg.time, received: now(), remoteTick: msg.tick, localTick });
  }

  // --- host ---

  function host({ transport }) {
    leave();
    const gen = ++generation;
    const live = () => gen === generation;
    role = 'host';
    code = null;
    resetPeerData();
    setState('creating');
    handle = transport.host({
      makeCode: () => makeRoomCode(randomUint32s),
      onReady(c) {
        if (!live()) return;
        code = c;
        setState('waiting');
      },
      onGuest(channel) {
        if (!live() || link) {
          channel.close();
          return;
        }
        guestReady = false;
        linkChannel = channel;
        link = makeLink(channel, (msg) => live() && hostReceive(msg), () => live() && guestGone());
      },
      onError(r) {
        if (!live()) return;
        generation += 1;
        link?.close('failed');
        link = null;
        linkChannel = null;
        handle?.close();
        handle = null;
        role = null;
        setState('failed', r);
        emit({ type: 'host-failed', reason: r });
      },
    });
  }

  function hostReceive(msg) {
    switch (msg.t) {
      case 'hello':
        if (guestReady) return;
        if (msg.v !== PROTOCOL_VERSION) {
          link.send(rejectMessage('version'));
          link.close('rejected');
          return;
        }
        guestReady = true;
        guestInputs = createGuestInputQueue();
        clock = createClockSync();
        lastSnapTick = -Infinity;
        lastSentMap = mapKey();
        link.send(welcomeMessage(lastSentMap, 1, localTick));
        setState('joined');
        break;
      case 'input':
        if (guestReady) guestInputs.push(msg);
        break;
      case 'ping':
        link.send(pongMessage(msg, localTick));
        break;
      case 'pong':
        onPong(msg);
        break;
      case 'bye':
        link.close('bye');
        break;
      default:
    }
  }

  function guestGone() {
    link = null;
    linkChannel = null;
    const was = guestReady;
    guestReady = false;
    if (was) setState('left');
  }

  // --- guest ---

  // An invalid code is checked first. With a session active (host or guest) it changes nothing;
  // with none it ends as 'invalid'. A valid code leaves the current session, then joins.
  // Returns false for an invalid code, true when a join started.
  function join(text, { transport }) {
    const cleaned = cleanRoomCode(text);
    if (!isRoomCode(cleaned)) {
      if (role !== null) return false;
      leave();
      resetPeerData();
      code = cleaned;
      setState('ended', 'invalid');
      emit({ type: 'ended', reason: 'invalid', wasConnected: false });
      return false;
    }
    leave();
    const gen = ++generation;
    const live = () => gen === generation;
    resetPeerData();
    code = cleaned;
    role = 'guest';
    setState('connecting');
    handle = transport.join(code, {
      onOpen(channel) {
        if (!live()) {
          channel.close();
          return;
        }
        linkChannel = channel;
        link = makeLink(
          channel,
          (msg) => live() && guestReceive(msg),
          (r) => {
            if (!live()) return;
            link = null;
            linkChannel = null;
            guestEnd(r === 'dropped' ? 'dropped' : state === 'connected' ? 'host-left' : 'failed');
          },
        );
        link.send(helloMessage());
      },
      onError(r) {
        if (live()) guestEnd(r);
      },
    });
    return true;
  }

  function guestReceive(msg) {
    switch (msg.t) {
      case 'welcome':
        if (state !== 'connecting') return;
        slot = msg.slot;
        setState('connected');
        emit({ type: 'connected', map: msg.map });
        break;
      case 'reject':
        guestEnd(msg.reason);
        break;
      case 'map':
        if (state !== 'connected') return;
        // The new map has its own enemies: forget the old map's.
        enemyBuffers = null;
        emit({ type: 'map', map: msg.map });
        break;
      case 'snap': {
        if (state !== 'connected' || msg.tick <= lastSnapshotTick) return;
        lastSnapshotTick = msg.tick;
        worldOffset = msg.wt - msg.tick;
        const snapshot = snapshotFromMessage(msg);
        pendingSnapshot = snapshot; // an older unapplied one is discarded
        if (snapshot.players[0]) interp.push(snapshot.tick, snapshot.players[0]);
        updateEnemies(snapshot);
        history.drop(snapshot.ack);
        break;
      }
      case 'ping':
        link.send(pongMessage(msg, localTick));
        break;
      case 'pong':
        onPong(msg);
        break;
      case 'bye':
        guestEnd('host-left');
        break;
      default:
    }
  }

  // The snapshot carries the full enemy list. A new id gets a buffer (it appears at its snapshot
  // position); a known id gets the new position pushed (enemies interpolate like a player, with no
  // velocity or aim sent); a known id missing from the snapshot is removed.
  function updateEnemies(snapshot) {
    enemyBuffers ??= new Map();
    const present = new Set();
    for (const e of snapshot.enemies) {
      present.add(e.id);
      if (!enemyBuffers.has(e.id)) enemyBuffers.set(e.id, { type: e.type, buffer: createInterpolationBuffer() });
      const entry = enemyBuffers.get(e.id);
      entry.type = e.type;
      entry.buffer.push(snapshot.tick, { x: e.x, y: e.y, vx: 0, vy: 0, aim: 0, awake: e.awake });
    }
    for (const id of enemyBuffers.keys()) if (!present.has(id)) enemyBuffers.delete(id);
  }

  function guestEnd(r) {
    if (role !== 'guest') return;
    const wasConnected = state === 'connected';
    generation += 1;
    role = null;
    const l = link;
    link = null;
    linkChannel = null;
    l?.close(r);
    handle?.close();
    handle = null;
    setState('ended', r);
    emit({ type: 'ended', reason: r, wasConnected });
  }

  // --- both ---

  // Sends bye and closes. Host: back to idle. Guest: ended with reason 'left'.
  function leave() {
    if (role === null) return;
    if (role === 'guest') {
      link?.send(byeMessage());
      guestEnd('left');
      return;
    }
    generation += 1;
    role = null;
    const l = link;
    link = null;
    linkChannel = null;
    if (l) {
      l.send(byeMessage());
      l.close('left');
    }
    handle?.close();
    handle = null;
    code = null;
    guestReady = false;
    setState('idle');
  }

  function wrapInput(input) {
    return {
      setAimOrigin: (...args) => input.setAimOrigin?.(...args),
      clearAimOrigins: () => input.clearAimOrigins?.(),
      sample() {
        const frames = input.sample();
        localTick += 1;
        if (role === 'host' && guestReady) {
          // The guest's frame drives player 2 in the Sandbox only. On any other screen (menus,
          // New Game, Join) slot 1 is a disconnected frame, so a guest cannot select items there.
          const out = [...frames];
          const guestFrame = guestInputs.next();
          out[1] = sandboxState() ? guestFrame : { ...guestFrame, connected: false };
          return out;
        }
        if (role === 'guest' && state === 'connected' && link) {
          history.record(localTick, frames[0]);
          link.send(inputMessage(localTick, frames[0]));
        }
        return frames;
      },
    };
  }

  function afterFrame(time) {
    if (role === null || !link) return;
    const connected = role === 'host' ? guestReady : state === 'connected';
    if (!connected) return;
    if (role === 'host' && localTick - lastSnapTick >= SNAPSHOT_EVERY_TICKS) {
      const sandbox = sandboxState();
      if (sandbox) {
        if (sandbox.map !== lastSentMap) {
          lastSentMap = sandbox.map;
          link.send(mapMessage(sandbox.map));
        }
        link.send(snapMessage({ tick: localTick, ack: guestInputs.ack(), wt: sandbox.ticks, players: sandbox.players, enemies: sandbox.enemies }));
        lastSnapTick = localTick;
      }
    }
    if (link && time >= nextPingAt) {
      nextPingAt = time + PING_INTERVAL_MS;
      link.send(pingMessage(pingId, time));
      pingId = (pingId + 1) % 2 ** 31;
    }
  }

  // The host tick the guest draws the host player and enemies at: INTERP_DELAY_TICKS behind the
  // newest host tick arriving now (the clock's arrival offset, measured on pongs, which come the
  // same way as snapshots). The host tick now (offsetTicks) is one one-way delay later, past the
  // newest snapshot once that delay is over about 100 ms, where the interpolation would hold.
  const remoteDrawTick = () => localTick + clock.estimate().arrivalOffsetTicks - INTERP_DELAY_TICKS;

  const view = Object.freeze({
    role: () => role,
    localSlot: () => (role === 'guest' && state === 'connected' ? slot : 0),
    peerPresent: () => (role === 'host' ? guestReady : role === 'guest' && state === 'connected'),
    // The newest snapshot not yet applied, as { tick, ack, wt, players, enemies }, or null.
    takeSnapshot() {
      const s = pendingSnapshot;
      pendingSnapshot = null;
      return s;
    },
    // The guest's recorded input frames after `ack`, oldest first: [{ tick, frame }].
    inputsAfter: (ack) => history.after(ack),
    // The host's player drawn at remoteDrawTick(), or null.
    remotePlayer() {
      if (role !== 'guest' || interp.size() === 0) return null;
      return interp.sampleAt(remoteDrawTick());
    },
    // The host world tick (wt) remotePlayer() and remoteEnemies() are drawn at (remoteDrawTick(),
    // never past the newest snapshot, as the interpolation holds there), or null before the first
    // snapshot. The Sandbox draws remote riders relative to the platforms with it (rideShift,
    // world/platform.js).
    remoteWorldTick() {
      if (role !== 'guest' || worldOffset === null) return null;
      return Math.min(remoteDrawTick(), lastSnapshotTick) + worldOffset;
    },
    // The host's enemies ([{ id, type, x, y, vx, vy, aim, awake }], the ids of the newest snapshot
    // in first-seen order) at the same tick as remotePlayer(); null before the first snapshot (and
    // after a map change until the next one).
    remoteEnemies() {
      if (role !== 'guest' || enemyBuffers === null) return null;
      const tick = remoteDrawTick();
      return [...enemyBuffers].map(([id, { type, buffer }]) => ({ ...buffer.sampleAt(tick), id, type }));
    },
  });

  return {
    host,
    join,
    leave,
    wrapInput,
    afterFrame,
    // The raw channel's stats (a promise of an RTCStatsReport, or null), only while a peer is connected.
    connectionStats() {
      try {
        const connected = role === 'host' ? state === 'joined' : role === 'guest' && state === 'connected';
        return connected && link && linkChannel ? (linkChannel.getStats?.() ?? null) : null;
      } catch {
        return null;
      }
    },
    netView: () => view,
    active: () => role !== null,
    role: () => role,
    code: () => code,
    state: () => state,
    localTick: () => localTick,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stats() {
      const c = clock.estimate();
      const s = link ? link.stats() : { msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0 };
      return {
        role,
        code,
        state,
        reason,
        pingMs: c.rttMs,
        offsetTicks: c.offsetTicks,
        msgsIn: s.msgsIn,
        bytesIn: s.bytesIn,
        msgsOut: s.msgsOut,
        bytesOut: s.bytesOut,
        lagMs: clampLag(lagMs),
      };
    },
  };
}
