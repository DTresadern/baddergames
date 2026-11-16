// Online co-op transport.
//
// Default: PeerJS (WebRTC data channel). The host's browser runs the game; the guest
// connects to it with a 6-character room code. No game server is needed, only the
// PeerJS signalling server (public 0.peerjs.com by default).
//
// Set window.TECHNOPHAGE_PEER_OPTS before the game loads to use your own PeerJS
// server and TURN relay, e.g. in config.js next to index.html:
//   window.TECHNOPHAGE_PEER_OPTS = { config: { iceServers: [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'turn:turn.example.com:443', username: 'u', credential: 'p' } ] } };
//
// ?net=local in the URL swaps in a BroadcastChannel transport, so two tabs on one
// machine can play together without any network (used for development and tests).

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const PREFIX = 'technophage-v1-';
const MAX_IN = { host: 16 * 1024, guest: 256 * 1024 }; // bytes per message accepted
const MAX_RATE = 200; // messages per second accepted from a peer
const SEND_LAG = Math.min(2000, Number(new URLSearchParams(location.search).get('lag')) || 0);

export function makeCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return [...a].map((v) => ALPHABET[v % ALPHABET.length]).join('');
}

export function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

// Wraps a raw string channel with size limits, rate limits and JSON parsing.
class Link {
  constructor(role, sendRaw, closeRaw) {
    this.role = role;
    this.sendRaw = sendRaw;
    this.closeRaw = closeRaw;
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
    this.lastRecv = performance.now();
    this.rateWindow = 0;
    this.rateCount = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
  }

  send(obj) {
    if (this.closed) return;
    const s = JSON.stringify(obj);
    this.bytesOut += s.length;
    const go = () => {
      if (this.closed) return;
      try {
        this.sendRaw(s);
      } catch (e) {
        console.warn('send failed', e);
      }
    };
    // ?lag=ms delays everything this client sends (for testing on one machine)
    if (SEND_LAG > 0) setTimeout(go, SEND_LAG);
    else go();
  }

  receive(data) {
    if (this.closed || typeof data !== 'string') return;
    this.lastRecv = performance.now();
    if (data.length > MAX_IN[this.role]) return;
    const now = performance.now();
    if (now - this.rateWindow > 1000) {
      this.rateWindow = now;
      this.rateCount = 0;
    }
    if (++this.rateCount > MAX_RATE) return;
    this.bytesIn += data.length;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg && typeof msg === 'object' && typeof msg.t === 'string' && this.onmessage) this.onmessage(msg);
  }

  closed_() {
    if (this.closed) return;
    this.closed = true;
    if (this.onclose) this.onclose();
  }

  close() {
    try {
      this.closeRaw();
    } catch {
      /* already closed */
    }
    this.closed_();
  }
}

// ---------------------------------------------------------------------------
// PeerJS transport

function peerOpts() {
  return Object.assign({ debug: 1 }, window.TECHNOPHAGE_PEER_OPTS || {});
}

function needPeer() {
  if (!window.Peer) throw new Error('PeerJS failed to load');
}

// Host: register a room and wait for a guest. onGuest(link) is called once per guest.
export function hostRoom(onGuest, onStatus) {
  if (new URLSearchParams(location.search).get('net') === 'local') return hostLocal(onGuest);
  needPeer();
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = makeCode();
      const peer = new window.Peer(PREFIX + code, peerOpts());
      let opened = false;
      peer.on('open', () => {
        opened = true;
        resolve({ code, close: () => peer.destroy() });
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          const link = new Link('host', (s) => conn.send(s), () => conn.close());
          conn.on('data', (d) => link.receive(d));
          conn.on('close', () => link.closed_());
          conn.on('error', () => link.closed_());
          onGuest(link);
        });
      });
      peer.on('disconnected', () => {
        // Lost the signalling server; existing data connections keep working.
        if (onStatus) onStatus('signalling lost');
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
      });
      peer.on('error', (err) => {
        if (!opened && err.type === 'unavailable-id' && tries++ < 4) {
          peer.destroy();
          attempt();
        } else if (!opened) {
          peer.destroy();
          reject(new Error(describe(err)));
        } else if (onStatus) onStatus(describe(err));
      });
    };
    attempt();
  });
}

// Guest: connect to a room code.
export function joinRoom(code) {
  if (new URLSearchParams(location.search).get('net') === 'local') return joinLocal(code);
  needPeer();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(peerOpts());
    let done = false;
    const fail = (msg) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('Timed out. Check the code, or try both on Wi-Fi (a TURN relay may be needed).'), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
      conn.on('open', () => {
        clearTimeout(timer);
        done = true;
        const link = new Link('guest', (s) => conn.send(s), () => {
          conn.close();
          peer.destroy();
        });
        conn.on('data', (d) => link.receive(d));
        conn.on('close', () => link.closed_());
        conn.on('error', () => link.closed_());
        resolve(link);
      });
      conn.on('error', (e) => fail(describe(e)));
    });
    peer.on('error', (e) => {
      clearTimeout(timer);
      fail(describe(e));
    });
  });
}

function describe(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'Room not found. Check the code.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Cannot reach the PeerJS signalling server.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return (err && err.message) || String(err);
}

// ---------------------------------------------------------------------------
// BroadcastChannel transport (same machine, for development)

function hostLocal(onGuest) {
  const code = makeCode();
  const bc = new BroadcastChannel('technophage-' + code);
  let link = null;
  bc.onmessage = (e) => {
    const m = e.data;
    if (m.k === 'join' && !link) {
      link = new Link('host', (s) => bc.postMessage({ k: 'h', s }), () => bc.postMessage({ k: 'bye' }));
      bc.postMessage({ k: 'welcome' });
      onGuest(link);
    } else if (m.k === 'g' && link) link.receive(m.s);
    else if (m.k === 'bye' && link) {
      link.closed_();
      link = null;
    }
  };
  return Promise.resolve({ code, close: () => bc.close() });
}

function joinLocal(code) {
  return new Promise((resolve, reject) => {
    const bc = new BroadcastChannel('technophage-' + code);
    const timer = setTimeout(() => reject(new Error('Room not found. Check the code.')), 3000);
    let link = null;
    bc.onmessage = (e) => {
      const m = e.data;
      if (m.k === 'welcome' && !link) {
        clearTimeout(timer);
        link = new Link('guest', (s) => bc.postMessage({ k: 'g', s }), () => {
          bc.postMessage({ k: 'bye' });
          bc.close();
        });
        resolve(link);
      } else if (m.k === 'h' && link) link.receive(m.s);
      else if (m.k === 'bye' && link) link.closed_();
    };
    bc.postMessage({ k: 'join' });
  });
}
