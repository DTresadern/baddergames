// Room codes: 6 characters from an alphabet without the look-alikes 0, O, 1 and I.
// Pure: the random source is passed in.

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const PATTERN = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

// `randomUint32s(n)` returns n random unsigned 32-bit integers (crypto.getRandomValues in the
// browser). The alphabet has 32 characters, so `% 32` has no bias.
export function makeRoomCode(randomUint32s) {
  return Array.from(randomUint32s(ROOM_CODE_LENGTH), (n) => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join('');
}

// Uppercase, without spaces and dashes (people type "abc-def" or paste "ABC DEF").
export function cleanRoomCode(text) {
  return String(text ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

export function isRoomCode(text) {
  return typeof text === 'string' && PATTERN.test(text);
}

// The invite link: the page URL with `room=CODE`, keeping `net=local` when present and dropping
// `lag` (a test option for one browser only).
export function inviteUrl(href, code) {
  const url = new URL(href);
  url.searchParams.delete('lag');
  url.searchParams.delete('room');
  url.searchParams.set('room', code);
  url.hash = '';
  return url.toString();
}
