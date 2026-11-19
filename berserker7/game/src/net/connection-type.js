// How a WebRTC connection travels, from an RTCPeerConnection.getStats() report. Pure: no window,
// no WebRTC; the report is any object with values() or forEach (a Map in tests).
//
// The selected ICE candidate pair has a local and a remote candidate, each of a type:
//   host  - same network (a local address, no NAT in between)
//   srflx - direct through a NAT (address found with STUN)
//   prflx - direct, address found during the connection checks
//   relay - through a TURN server (indirect, adds latency)
// The label is `<local> ↔ <remote> <protocol>`, with ` via <address>:<port>` of the relay
// candidate when either end is a relay. Returns null when no selected pair can be found.

const UNKNOWN = '?';

function entriesOf(report) {
  const byId = new Map();
  const add = (entry) => {
    if (entry && typeof entry === 'object' && entry.id !== undefined) byId.set(entry.id, entry);
  };
  if (!report) return byId;
  if (typeof report.values === 'function') for (const entry of report.values()) add(entry);
  else if (typeof report.forEach === 'function') report.forEach(add);
  return byId;
}

function selectedPair(byId) {
  const all = [...byId.values()];
  const transport = all.find((e) => e.type === 'transport' && e.selectedCandidatePairId !== undefined);
  const chrome = transport ? byId.get(transport.selectedCandidatePairId) : undefined;
  if (chrome) return chrome;
  const pairs = all.filter((e) => e.type === 'candidate-pair');
  return (
    pairs.find((e) => e.selected === true) ?? pairs.find((e) => e.nominated === true && e.state === 'succeeded') ?? null
  );
}

const typeOf = (c) => (typeof c.candidateType === 'string' && c.candidateType ? c.candidateType : UNKNOWN);

function relayAddress(c) {
  const address = c.address ?? c.ip;
  if (!address) return '';
  const port = c.port;
  return ` via ${address}${port !== undefined && port !== null && port !== '' ? `:${port}` : ''}`;
}

export function connectionTypeLabel(report) {
  const byId = entriesOf(report);
  const pair = selectedPair(byId);
  if (!pair) return null;
  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  if (!local || !remote) return null;
  const protocol = local.protocol ?? remote.protocol ?? UNKNOWN;
  const relay = typeOf(local) === 'relay' ? local : typeOf(remote) === 'relay' ? remote : null;
  return `${typeOf(local)} ↔ ${typeOf(remote)} ${protocol}${relay ? relayAddress(relay) : ''}`;
}
