// Manual time and a fake BroadcastChannel for network tests (no browser, no real timers).

// A clock you advance by hand: now(), setTimeout, clearTimeout, advance(ms).
// Timers due at the same time run in the order they were set.
export function createFakeClock(start = 1000) {
  let time = start;
  let nextId = 1;
  const timers = new Map(); // id -> { due, fn, order }
  const clock = {
    now: () => time,
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { due: time + Math.max(0, ms), fn, order: id });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    // Moves time forward, running each timer at its due time.
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) {
          if (t.due <= end && (next === null || t.due < next[1].due || (t.due === next[1].due && t.order < next[1].order))) next = [id, t];
        }
        if (next === null) break;
        timers.delete(next[0]);
        time = Math.max(time, next[1].due);
        next[1].fn();
      }
      time = end;
    },
    pending: () => timers.size,
  };
  return clock;
}

// A BroadcastChannel class over one shared bus: posts reach every other open channel of the same
// name after `delayMs` (0: on the next advance). Messages are structured-cloned like the real one.
// `cut()` silently loses every later message, like a network that went away.
export function createFakeBroadcast(clock, { delayMs = 0 } = {}) {
  const open = new Set();
  let lost = false;
  const posted = []; // every message posted, for checks: { name, data }
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      open.add(this);
    }
    postMessage(data) {
      if (!open.has(this)) throw new Error('fake BroadcastChannel: closed');
      posted.push({ name: this.name, data: structuredClone(data) });
      for (const other of open) {
        if (other === this || other.name !== this.name) continue;
        const copy = structuredClone(data);
        clock.setTimeout(() => {
          if (open.has(other) && !lost) other.onmessage?.({ data: copy });
        }, delayMs);
      }
    }
    close() {
      open.delete(this);
    }
  }
  const cut = () => {
    lost = true;
  };
  return { BroadcastChannel: FakeBroadcastChannel, posted, cut, openCount: () => open.size };
}

// A raw channel pair (as createRawChannel gives a transport) joined back to back, for link tests.
export async function rawPair(clock, delayMs = 0) {
  const { createRawChannel } = await import('../src/net/link.js');
  let a = null;
  let b = null;
  const later = (fn) => clock.setTimeout(fn, delayMs);
  a = createRawChannel({ send: (t) => later(() => b.deliver(t)), close: () => later(() => b.remoteClosed()) });
  b = createRawChannel({ send: (t) => later(() => a.deliver(t)), close: () => later(() => a.remoteClosed()) });
  return [a, b];
}
