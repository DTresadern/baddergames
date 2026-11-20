// PeerJS transport (the default): WebRTC data channels, with the public PeerJS server for
// signalling. PeerJS is loaded with a dynamic import of online-libs.js on first use; tests pass
// their own `loadPeer`. A raw connection delivers received data as an ArrayBuffer,
// which becomes a Uint8Array before it reaches the channel.
//
// The host's peer id is `berserker7-v6-<CODE>`; on 'unavailable-id' (the code is taken) the host
// tries a new code, up to HOST_RETRIES times. The guest connects with
// { reliable: true, serialization: 'raw' }, so codec bytes travel as they are. A second guest
// gets a `reject full` codec message and is closed. A join that has not opened after
// JOIN_TIMEOUT_MS fails with 'timeout'. When the signalling server connection is lost after the
// peer opened, the peer reconnects; open data connections carry on without it.
// Channels give getStats() (the data connection's RTCPeerConnection stats). Same interface as
// transport-local.js.

import { encode, rejectMessage } from './codec.js';
import { createRawChannel } from './link.js';

export const PEER_ID_PREFIX = 'berserker7-v6-';
export const HOST_RETRIES = 4;
export const JOIN_TIMEOUT_MS = 15000;
const REJECT_CLOSE_MS = 500; // time for the reject to leave before the connection closes

// PeerJS error type -> our reason.
export function peerErrorReason(type) {
  if (type === 'peer-unavailable') return 'not-found';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'server';
  if (type === 'browser-incompatible') return 'unsupported';
  return 'failed';
}

const defaultLoadPeer = () => import('./online-libs.js').then((m) => m.Peer);

const asBytes = (data) => (data instanceof ArrayBuffer ? new Uint8Array(data) : data);

export function createPeerTransport({ setTimeout: setTimer, clearTimeout: clearTimer, loadPeer = defaultLoadPeer }) {
  // Calls `use(Peer)` once PeerJS is loaded, unless `isClosed()` by then; a failed load is 'unsupported'.
  function withPeer(use, onError, isClosed) {
    loadPeer().then(
      (Peer) => {
        if (!isClosed()) use(Peer);
      },
      () => {
        if (!isClosed()) onError('unsupported');
      },
    );
  }

  function host({ makeCode, onReady, onGuest, onError }) {
    let peer = null;
    let opened = false;
    let closed = false;
    let guest = null; // { conn, channel }
    const fail = (reason) => {
      if (closed) return;
      closed = true;
      peer?.destroy();
      onError(reason);
    };

    function attempt(Peer, retriesLeft) {
      const code = makeCode();
      const p = new Peer(PEER_ID_PREFIX + code);
      peer = p;
      p.on('open', () => {
        if (closed || p !== peer) return;
        opened = true;
        onReady(code);
      });
      p.on('disconnected', () => {
        if (!closed && opened && p === peer && !p.destroyed) p.reconnect();
      });
      p.on('error', (err) => {
        if (closed || p !== peer) return;
        if (!opened && err?.type === 'unavailable-id' && retriesLeft > 0) {
          p.destroy();
          attempt(Peer, retriesLeft - 1);
          return;
        }
        // After open, signalling trouble does not end the room: the peer reconnects.
        const reason = peerErrorReason(err?.type);
        if (opened && (reason === 'server' || err?.type === 'disconnected' || err?.type === 'socket-closed')) return;
        fail(reason);
      });
      p.on('connection', (conn) => {
        if (closed) {
          conn.close();
          return;
        }
        if (guest) {
          conn.on('open', () => {
            conn.send(encode(rejectMessage('full')));
            setTimer(() => conn.close(), REJECT_CLOSE_MS);
          });
          return;
        }
        const channel = createRawChannel({
          send: (bytes) => conn.send(bytes),
          getStats: () => conn.peerConnection?.getStats() ?? null,
          close: () => {
            if (guest?.conn === conn) guest = null;
            // PeerJS 1.5.5 ignores close({ flush }) on a raw connection (it only sends a marker
            // object), so close after a delay that lets a last message (a bye) leave first.
            setTimer(() => conn.close(), REJECT_CLOSE_MS);
          },
        });
        guest = { conn, channel };
        conn.on('data', (data) => channel.deliver(asBytes(data)));
        conn.on('close', () => {
          if (guest?.conn === conn) guest = null;
          channel.remoteClosed();
        });
        conn.on('error', () => {
          if (guest?.conn === conn) guest = null;
          channel.remoteClosed();
        });
        conn.on('open', () => {
          if (!closed) onGuest(channel);
        });
      });
    }

    withPeer((Peer) => attempt(Peer, HOST_RETRIES), fail, () => closed);
    return {
      close() {
        if (closed) return;
        closed = true;
        guest?.channel.close();
        // Destroying the peer tears down the connection and loses a bye sent just before, so wait
        // as the guest channel's close does. `closed` is already set, so nothing reacts meanwhile.
        const p = peer;
        if (p) setTimer(() => p.destroy(), REJECT_CLOSE_MS);
      },
    };
  }

  function join(code, { onOpen, onError }) {
    let peer = null;
    let channel = null;
    let closed = false;
    const timer = setTimer(() => fail('timeout'), JOIN_TIMEOUT_MS);
    function end() {
      closed = true;
      clearTimer(timer);
      // Let a last message (a bye) leave before the peer goes.
      const p = peer;
      if (p) setTimer(() => p.destroy(), REJECT_CLOSE_MS);
    }
    function fail(reason) {
      if (closed) return;
      end();
      if (channel) channel.remoteClosed();
      else onError(reason);
    }
    withPeer(
      (Peer) => {
        peer = new Peer();
        peer.on('open', () => {
          if (closed) return;
          const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true, serialization: 'raw' });
          conn.on('open', () => {
            if (closed) return;
            clearTimer(timer);
            channel = createRawChannel({
              send: (bytes) => conn.send(bytes),
              getStats: () => conn.peerConnection?.getStats() ?? null,
              close: () => {
                // As on the host: a delayed plain close, so a last message (a bye) leaves first.
                setTimer(() => conn.close(), REJECT_CLOSE_MS);
                end();
              },
            });
            onOpen(channel);
          });
          conn.on('data', (data) => channel?.deliver(asBytes(data)));
          conn.on('close', () => fail('failed'));
          conn.on('error', () => fail('failed'));
        });
        peer.on('disconnected', () => {
          if (!closed && channel && !peer.destroyed) peer.reconnect();
        });
        peer.on('error', (err) => {
          // Once connected, signalling trouble does not end the game.
          if (channel && peerErrorReason(err?.type) === 'server') return;
          if (channel && (err?.type === 'disconnected' || err?.type === 'socket-closed')) return;
          fail(peerErrorReason(err?.type));
        });
      },
      fail,
      () => closed,
    );
    return {
      close() {
        if (closed) return;
        if (channel) channel.close();
        else end();
      },
    };
  }

  return { kind: 'peer', host, join };
}
