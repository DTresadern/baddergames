// Named actions and their default bindings, as data. Source string formats and aim:
// see berserker7/AGENTS.md, Input. Mouse buttons: 0 left, 1 middle, 2 right, 3 back, 4 forward.

const WEAPON_SLOTS = 9;
const weapons = Array.from({ length: WEAPON_SLOTS }, (_, i) => `weapon${i + 1}`);

export const ACTIONS = Object.freeze([
  'moveLeft',
  'moveRight',
  'moveUp',
  'moveDown',
  'jump',
  'primaryFire',
  'secondaryFire',
  'melee',
  'dash',
  'interact',
  ...weapons,
  'nextWeapon',
  'previousWeapon',
  'weaponMenu', // held while the weapon menu is open
  'pause',
]);

export const SCHEMES = Object.freeze(['keyboardMouse', 'gamepad']);

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Standard gamepad mapping: 0 A/cross, 1 B/circle, 2 X/square, 3 Y/triangle,
// 4 left bumper, 5 right bumper, 6 left trigger, 7 right trigger, 9 start,
// 12-15 d-pad up/down/left/right. Axes: 0/1 left stick x/y, 2/3 right stick x/y (y down).
export const DEFAULT_BINDINGS = deepFreeze({
  keyboardMouse: {
    moveLeft: ['key:KeyA', 'key:ArrowLeft'],
    moveRight: ['key:KeyD', 'key:ArrowRight'],
    moveUp: ['key:KeyW', 'key:ArrowUp'],
    moveDown: ['key:KeyS', 'key:ArrowDown'],
    jump: ['key:Space'],
    primaryFire: ['mouse:0'],
    secondaryFire: ['mouse:2'],
    melee: ['key:KeyV'],
    dash: ['key:ShiftLeft', 'key:ShiftRight'],
    interact: ['key:KeyE'],
    ...Object.fromEntries(weapons.map((action, i) => [action, [`key:Digit${i + 1}`]])),
    nextWeapon: ['wheel:+'],
    previousWeapon: ['wheel:-'],
    weaponMenu: ['key:KeyQ'],
    pause: ['key:Escape'],
  },
  gamepad: {
    moveLeft: ['axis:0:-', 'button:14'],
    moveRight: ['axis:0:+', 'button:15'],
    moveUp: ['axis:1:-', 'button:12'],
    moveDown: ['axis:1:+', 'button:13'],
    jump: ['button:0'],
    primaryFire: ['button:7'],
    secondaryFire: ['button:6'],
    melee: ['button:1'],
    dash: ['button:4'],
    interact: ['button:2'],
    ...Object.fromEntries(weapons.map((action) => [action, []])),
    nextWeapon: ['button:5'],
    previousWeapon: ['button:3'],
    weaponMenu: ['button:13'], // d-pad down is also moveDown, as the owner's table has it
    pause: ['button:9'],
  },
});
