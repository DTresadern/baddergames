// Wraps a transport so the wire codec (msgpackr, in the same lazy chunk as PeerJS) is loaded before
// the transport starts. host() and join() first await load(), then call the inner transport, unless
// closed meanwhile; a failed load calls opts.onError('unsupported'). Same interface as the
// transports (`kind`, host, join -> { close() }); close() works before and after the inner start.
// Pure: no window access.

import { loadCodec } from './codec.js';

export function withCodec(transport, load = loadCodec) {
  function start(run, opts) {
    let closed = false;
    let inner = null;
    load().then(
      () => {
        if (!closed) inner = run();
      },
      () => {
        if (!closed) opts.onError('unsupported');
      },
    );
    return {
      close() {
        closed = true;
        inner?.close();
      },
    };
  }
  return {
    kind: transport.kind,
    host: (opts) => start(() => transport.host(opts), opts),
    join: (code, opts) => start(() => transport.join(code, opts), opts),
  };
}
