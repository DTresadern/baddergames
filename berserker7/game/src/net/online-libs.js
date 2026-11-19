// The libraries needed only when the game goes online: PeerJS (WebRTC) and msgpackr (wire
// format). Loaded together with one dynamic import (see codec.js loadCodec and transport-peer.js),
// so they share one lazy chunk and solo play never downloads either. Nothing imports this file
// statically.

import * as peerjs from 'peerjs';

export const Peer = peerjs.Peer ?? peerjs.default;
export { Packr } from 'msgpackr';
