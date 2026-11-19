// Short display labels for input binding sources. Pure: no DOM.
// Used by the input panel to show each action's primary key or button.

const KEY_NAMES = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
};
const MODIFIERS = { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Meta' };
const MOUSE = ['LMB', 'MMB', 'RMB', 'Mouse 4', 'Mouse 5'];
const PAD_BUTTONS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3',
  'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home',
];
const STICKS = ['L-stick', 'L-stick', 'R-stick', 'R-stick'];
// Axis 0 and 2 run left (-) to right (+); axis 1 and 3 run up (-) to down (+).
const AXIS_DIRECTIONS = [
  { '+': '→', '-': '←' },
  { '+': '↓', '-': '↑' },
  { '+': '→', '-': '←' },
  { '+': '↓', '-': '↑' },
];

function keyLabel(code) {
  if (!code) return null;
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let match = /^Key([A-Z])$/.exec(code);
  if (match) return match[1];
  match = /^Digit([0-9])$/.exec(code);
  if (match) return match[1];
  match = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (match) return `${match[2] === 'Left' ? 'L' : 'R'}-${MODIFIERS[match[1]]}`;
  match = /^Numpad(.+)$/.exec(code);
  if (match) return `Num ${match[1]}`;
  return code;
}

export function sourceLabel(source) {
  if (typeof source !== 'string') return null;
  const [kind, ...rest] = source.split(':');
  if (kind === 'key' && rest.length === 1) return keyLabel(rest[0]);
  if (kind === 'mouse' && /^[0-4]$/.test(rest[0]) && rest.length === 1) return MOUSE[Number(rest[0])];
  if (kind === 'wheel' && rest.length === 1) {
    if (rest[0] === '+') return 'Wheel ↓';
    if (rest[0] === '-') return 'Wheel ↑';
    return null;
  }
  if (kind === 'button' && /^\d+$/.test(rest[0]) && rest.length === 1) {
    const index = Number(rest[0]);
    return PAD_BUTTONS[index] ?? `Button ${index}`;
  }
  if (kind === 'axis' && rest.length === 2 && /^\d+$/.test(rest[0]) && (rest[1] === '+' || rest[1] === '-')) {
    const index = Number(rest[0]);
    if (index < STICKS.length) return `${STICKS[index]} ${AXIS_DIRECTIONS[index][rest[1]]}`;
    return `Axis ${index}${rest[1] === '+' ? '+' : '−'}`;
  }
  return null;
}

export function schemeFor(playerConfig) {
  return playerConfig?.keyboardMouse ? 'keyboardMouse' : 'gamepad';
}

export function primaryLabel(bindings, scheme, action) {
  const first = bindings?.[scheme]?.[action]?.[0];
  return first === undefined ? null : sourceLabel(first);
}
