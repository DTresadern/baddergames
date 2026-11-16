// Optional PeerJS / WebRTC settings for online co-op.
//
// By default the game uses the public PeerJS signalling server (0.peerjs.com) and
// PeerJS's built-in STUN/TURN list. Some networks (often mobile data, strict NAT)
// cannot connect directly and need a TURN relay. To add one, uncomment and fill in:
//
// window.TECHNOPHAGE_PEER_OPTS = {
//   // host: 'peer.example.com', port: 443, path: '/', secure: true,   // your own peerjs-server
//   config: {
//     iceServers: [
//       { urls: 'stun:stun.l.google.com:19302' },
//       { urls: 'turn:turn.example.com:443?transport=tcp', username: 'USER', credential: 'PASS' },
//     ],
//   },
// };
