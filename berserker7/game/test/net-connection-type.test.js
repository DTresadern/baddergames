import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionTypeLabel } from '../src/net/connection-type.js';

const report = (...entries) => new Map(entries.map((e) => [e.id, e]));
const cand = (id, type, candidateType, extra = {}) => ({ id, type, candidateType, protocol: 'udp', ...extra });
const chrome = (l, r, extra = {}) =>
  report(
    { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
    { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
    cand('L', 'local-candidate', l, extra.local),
    cand('R', 'remote-candidate', r, extra.remote),
  );

test('chrome: host to host udp', () => {
  assert.equal(connectionTypeLabel(chrome('host', 'host')), 'host ↔ host udp');
});

test('srflx to srflx', () => {
  assert.equal(connectionTypeLabel(chrome('srflx', 'srflx')), 'srflx ↔ srflx udp');
});

test('prflx', () => {
  assert.equal(connectionTypeLabel(chrome('host', 'prflx')), 'host ↔ prflx udp');
});

test('relay shows the relay address and port, local preferred', () => {
  assert.equal(
    connectionTypeLabel(chrome('relay', 'srflx', { local: { address: '1.2.3.4', port: 3478 }, remote: { address: '9.9.9.9', port: 1 } })),
    'relay ↔ srflx udp via 1.2.3.4:3478',
  );
  assert.equal(
    connectionTypeLabel(chrome('srflx', 'relay', { remote: { ip: '5.6.7.8', port: 443, protocol: 'udp' } })),
    'srflx ↔ relay udp via 5.6.7.8:443',
  );
});

test('relay without port or address', () => {
  assert.equal(connectionTypeLabel(chrome('relay', 'host', { local: { address: '1.2.3.4' } })), 'relay ↔ host udp via 1.2.3.4');
  assert.equal(connectionTypeLabel(chrome('relay', 'host')), 'relay ↔ host udp');
});

test('tcp protocol', () => {
  assert.equal(connectionTypeLabel(chrome('host', 'host', { local: { protocol: 'tcp' } })), 'host ↔ host tcp');
});

test('firefox: pair with selected true', () => {
  const r = report(
    { id: 'P0', type: 'candidate-pair', selected: false, localCandidateId: 'L0', remoteCandidateId: 'R0' },
    { id: 'P', type: 'candidate-pair', selected: true, localCandidateId: 'L', remoteCandidateId: 'R' },
    cand('L0', 'local-candidate', 'relay'),
    cand('R0', 'remote-candidate', 'relay'),
    cand('L', 'local-candidate', 'srflx'),
    cand('R', 'remote-candidate', 'host'),
  );
  assert.equal(connectionTypeLabel(r), 'srflx ↔ host udp');
});

test('fallback: nominated and succeeded pair', () => {
  const r = report(
    { id: 'P1', type: 'candidate-pair', nominated: true, state: 'failed', localCandidateId: 'L1', remoteCandidateId: 'R1' },
    { id: 'P', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L', remoteCandidateId: 'R' },
    cand('L1', 'local-candidate', 'relay'),
    cand('R1', 'remote-candidate', 'relay'),
    cand('L', 'local-candidate', 'host'),
    cand('R', 'remote-candidate', 'prflx'),
  );
  assert.equal(connectionTypeLabel(r), 'host ↔ prflx udp');
});

test('unknown candidate type shows ?', () => {
  assert.equal(connectionTypeLabel(chrome('host', undefined)), 'host ↔ ? udp');
});

test('works with a forEach-only report', () => {
  const map = chrome('host', 'host');
  assert.equal(connectionTypeLabel({ forEach: (fn) => map.forEach(fn) }), 'host ↔ host udp');
});

test('null for an empty or missing report, or no selected pair', () => {
  assert.equal(connectionTypeLabel(new Map()), null);
  assert.equal(connectionTypeLabel(null), null);
  assert.equal(
    connectionTypeLabel(report({ id: 'P', type: 'candidate-pair', nominated: false, state: 'waiting', localCandidateId: 'L', remoteCandidateId: 'R' })),
    null,
  );
});

test('null when a candidate of the selected pair is missing', () => {
  const r = report(
    { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
    { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
    cand('L', 'local-candidate', 'host'),
  );
  assert.equal(connectionTypeLabel(r), null);
});
