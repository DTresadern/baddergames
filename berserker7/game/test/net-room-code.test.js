import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROOM_ALPHABET, ROOM_CODE_LENGTH, cleanRoomCode, inviteUrl, isRoomCode, makeRoomCode } from '../src/net/room-code.js';

test('room codes: 32 characters without 0, O, 1, I; 6 long', () => {
  assert.equal(ROOM_ALPHABET.length, 32);
  assert.equal(new Set(ROOM_ALPHABET).size, 32);
  for (const c of '0O1I') assert.equal(ROOM_ALPHABET.includes(c), false, c);
  assert.equal(ROOM_CODE_LENGTH, 6);
});

test('makeRoomCode: one alphabet character per random number', () => {
  const code = makeRoomCode((n) => Array.from({ length: n }, (_, i) => i * 33 + 0xffffffe0));
  assert.equal(code, 'ABCDEF'); // n % 32 = i
  assert.ok(isRoomCode(code));
  assert.ok(isRoomCode(makeRoomCode((n) => new Uint32Array(n).fill(0xffffffff))));
});

test('cleanRoomCode and isRoomCode', () => {
  assert.equal(cleanRoomCode(' abc-def '), 'ABCDEF');
  assert.equal(cleanRoomCode('ab c\tde f'), 'ABCDEF');
  assert.equal(cleanRoomCode(null), '');
  assert.ok(isRoomCode('ABCDEF'));
  assert.ok(isRoomCode('Z23456'));
  for (const bad of ['ABCDE', 'ABCDEFG', 'abcdef', 'ABCDE0', 'ABCDEO', 'ABCDE1', 'ABCDEI', 'ABC-EF', '', 123456, null]) {
    assert.equal(isRoomCode(bad), false, String(bad));
  }
});

test('inviteUrl: sets room, keeps net=local, drops lag', () => {
  assert.equal(inviteUrl('http://localhost:5291/?net=local&lag=200', 'ABCDEF'), 'http://localhost:5291/?net=local&room=ABCDEF');
  assert.equal(inviteUrl('https://example.org/berserker7/?room=OLDOLD#x', 'ZZZZZZ'), 'https://example.org/berserker7/?room=ZZZZZZ');
});
