// Local transport for `?net=local`: browser tabs on one machine talk over a BroadcastChannel
// named `b7-net-v4-<CODE>`, with no server and no internet. The channel constructor and timers are
// passed in, so Node tests run it with a fake.
//
// Framing (transport only; game messages are codec bytes inside `b`):
//   { k: 'join', from }           a joiner asks
//   { k: 'accept', from, to }     the host takes it as its guest
//   { k: 'msg', from, to, b }     one codec message (a Uint8Array, structured-cloned)
//   { k: 'close', from, to }      ends a link
// A host that already has a guest answers a join with a `reject full` codec message and nothing
// else. A join with no answer within JOIN_TIMEOUT_MS fails with 'not-found'.
//
// Transport interface (shared with transport-peer.js):
//   host({ makeCode, onReady(code), onGuest(channel), onError(reason) }) -> { close() }
//   join(code, { onOpen(channel), onError(reason) }) -> { close() }
// `channel` is a raw channel (createRawChannel in link.js).

import { encode, rejectMessage } from './codec.js';
import { createRawChannel } from './link.js';

export const LOCAL_CHANNEL_PREFIX = 'b7-net-v4-';
export const LOCAL_JOIN_TIMEOUT_MS = 2000;

export function createLocalTransport({ BroadcastChannel: Channel, setTimeout: setTimer, clearTimeout: clearTimer, randomId }) {
  function host({ makeCode, onReady, onGuest, onError }) {
    const code = makeCode();
    const id = randomId();
    let bc;
    try {
      bc = new Channel(LOCAL_CHANNEL_PREFIX + code);
    } catch {
      setTimer(() => onError('unsupported'), 0);
      return { close() {} };
    }
    let guest = null; // { id, channel }
    let closed = false;
    const post = (data) => {
      if (!closed) bc.postMessage(data);
    };
    bc.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') return;
      if (data.k === 'join' && typeof data.from === 'string') {
        if (guest?.id === data.from) return;
        if (guest) {
          post({ k: 'msg', from: id, to: data.from, b: encode(rejectMessage('full')) });
          return;
        }
        const guestId = data.from;
        const channel = createRawChannel({
          send: (b) => post({ k: 'msg', from: id, to: guestId, b }),
          close: () => {
            post({ k: 'close', from: id, to: guestId });
            if (guest?.id === guestId) guest = null;
          },
        });
        guest = { id: guestId, channel };
        post({ k: 'accept', from: id, to: guestId });
        onGuest(channel);
      } else if (data.to === id && guest && data.from === guest.id) {
        if (data.k === 'msg') guest.channel.deliver(data.b);
        else if (data.k === 'close') {
          const { channel } = guest;
          guest = null;
          channel.remoteClosed();
        }
      }
    };
    setTimer(() => {
      if (!closed) onReady(code);
    }, 0);
    return {
      close() {
        if (closed) return;
        guest?.channel.close();
        closed = true;
        bc.close();
      },
    };
  }

  function join(code, { onOpen, onError }) {
    const id = randomId();
    let bc;
    try {
      bc = new Channel(LOCAL_CHANNEL_PREFIX + code);
    } catch {
      setTimer(() => onError('unsupported'), 0);
      return { close() {} };
    }
    let hostId = null;
    let channel = null;
    let closed = false;
    const post = (data) => {
      if (!closed) bc.postMessage(data);
    };
    const end = () => {
      closed = true;
      clearTimer(timer);
      bc.close();
    };
    const timer = setTimer(() => {
      if (channel || closed) return;
      end();
      onError('not-found');
    }, LOCAL_JOIN_TIMEOUT_MS);
    function open(from) {
      clearTimer(timer);
      hostId = from;
      channel = createRawChannel({
        send: (b) => post({ k: 'msg', from: id, to: hostId, b }),
        close: () => {
          post({ k: 'close', from: id, to: hostId });
          end();
        },
      });
      onOpen(channel);
    }
    bc.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object' || data.to !== id) return;
      if (!channel) {
        // The first answer picks the host: an accept, or a message (a reject) without one.
        if (data.k === 'accept' || data.k === 'msg') open(data.from);
        if (data.k === 'msg') channel.deliver(data.b);
        return;
      }
      if (data.from !== hostId) return;
      if (data.k === 'msg') channel.deliver(data.b);
      else if (data.k === 'close') {
        end();
        channel.remoteClosed();
      }
    };
    post({ k: 'join', from: id });
    return {
      close() {
        if (channel) channel.close();
        else if (!closed) end();
      },
    };
  }

  return { kind: 'local', host, join };
}
