// A checked link over a raw string channel. Pure: time and timers are passed in.
//
// Raw channel (made by a transport with createRawChannel): { send(text), close(), listen(handlers),
// getStats() }, strings only. getStats() is for the debug panel: a promise of an RTCStatsReport, or null. The link adds:
//   receive: drop texts over MAX_MESSAGE_BYTES, drop beyond MAX_MESSAGES_PER_SECOND in a 1 s window,
//            decode with the codec and drop what it rejects; the rest go to onMessage(msg)
//   send:    encode (throws on a malformed message), then an optional `lagMs` delay, in order
//   stats:   messages and bytes sent and received in the last second, lastReceived time
//   silence: no message for `timeoutMs` closes the link as 'dropped'
//   close(reason) once, onClose(reason) once. A remote close gives 'closed'.

import { MAX_MESSAGE_BYTES, byteLength, decode, encode } from './codec.js';

export const MAX_MESSAGES_PER_SECOND = 200;
export const TIMEOUT_MS = 5000;
export const MAX_LAG_MS = 2000;
const WINDOW_MS = 1000;

// The transports' side of a channel. `send` and `close` go to the network; the transport calls
// deliver(text) for each received string and remoteClosed() when the other side closed. Texts
// that arrive before listen() are kept and handed over by it. `getStats` (optional) returns the
// connection's stats (a promise) or null.
export function createRawChannel({ send, close, getStats = null }) {
  let handlers = null;
  let closed = false;
  const early = [];
  return {
    send(text) {
      if (!closed) send(text);
    },
    close() {
      if (closed) return;
      closed = true;
      close();
    },
    listen(h) {
      handlers = h;
      for (const text of early.splice(0)) handlers.text(text);
      if (closed) handlers.close();
    },
    deliver(text) {
      if (closed) return;
      if (handlers) handlers.text(text);
      else early.push(text);
    },
    remoteClosed() {
      if (closed) return;
      closed = true;
      handlers?.close();
    },
    getStats: () => (closed || !getStats ? null : getStats()),
    closed: () => closed,
  };
}

export function clampLag(ms) {
  const n = Number(ms);
  return Number.isFinite(n) ? Math.min(MAX_LAG_MS, Math.max(0, n)) : 0;
}

// Counts in a rolling window: add(bytes), then rate(now) -> { msgs, bytes } in the last second.
function rollingCounter() {
  const log = [];
  const prune = (now) => {
    while (log.length > 0 && log[0].time <= now - WINDOW_MS) log.shift();
  };
  return {
    add(now, bytes) {
      log.push({ time: now, bytes });
      prune(now);
    },
    rate(now) {
      prune(now);
      return { msgs: log.length, bytes: log.reduce((sum, e) => sum + e.bytes, 0) };
    },
  };
}

export function createLink({
  channel,
  now,
  setTimeout: setTimer,
  clearTimeout: clearTimer,
  lagMs = 0,
  timeoutMs = TIMEOUT_MS,
  onMessage = () => {},
  onClose = () => {},
}) {
  const lag = clampLag(lagMs);
  const sent = rollingCounter();
  const received = rollingCounter();
  const queue = []; // lagged texts: { due, text }
  let queueTimer = null;
  let silenceTimer = null;
  let windowStart = now();
  let windowCount = 0;
  let lastReceived = now();
  let closed = false;

  function transmit(text) {
    channel.send(text);
    sent.add(now(), byteLength(text));
  }

  function flushDue() {
    queueTimer = null;
    const t = now();
    while (queue.length > 0 && queue[0].due <= t) transmit(queue.shift().text);
    if (queue.length > 0) queueTimer = setTimer(flushDue, queue[0].due - t);
  }

  function watchSilence() {
    const left = lastReceived + timeoutMs - now();
    if (left <= 0) close('dropped');
    else silenceTimer = setTimer(watchSilence, left);
  }

  function receive(text) {
    if (closed) return;
    const t = now();
    received.add(t, typeof text === 'string' ? byteLength(text) : 0);
    if (typeof text !== 'string' || byteLength(text) > MAX_MESSAGE_BYTES) return;
    if (t - windowStart >= WINDOW_MS) {
      windowStart = t;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > MAX_MESSAGES_PER_SECOND) return;
    const msg = decode(text);
    if (msg === null) return;
    lastReceived = t;
    onMessage(msg);
  }

  function send(msg) {
    if (closed) return;
    const text = encode(msg);
    if (lag === 0) {
      transmit(text);
      return;
    }
    queue.push({ due: now() + lag, text });
    if (queueTimer === null) queueTimer = setTimer(flushDue, lag);
  }

  // Lagged messages still waiting are sent at once, so a `bye` sent just before is not lost.
  function close(reason = 'closed') {
    if (closed) return;
    closed = true;
    if (queueTimer !== null) clearTimer(queueTimer);
    if (silenceTimer !== null) clearTimer(silenceTimer);
    if (!channel.closed?.()) for (const { text } of queue.splice(0)) transmit(text);
    channel.close();
    onClose(reason);
  }

  channel.listen({ text: receive, close: () => close('closed') });
  if (!closed) silenceTimer = setTimer(watchSilence, timeoutMs);

  return {
    send,
    close,
    closed: () => closed,
    lagMs: lag,
    stats() {
      const t = now();
      const s = sent.rate(t);
      const r = received.rate(t);
      return { msgsOut: s.msgs, bytesOut: s.bytes, msgsIn: r.msgs, bytesIn: r.bytes, lastReceived };
    },
  };
}
