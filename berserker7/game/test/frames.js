// Hand-built input frames for menu tests: every action up except the ones named.

import { ACTIONS } from '../src/input/actions.js';

const idle = () => ({ held: false, pressed: false, released: false });

export function frame(pressed = [], pointer = null, connected = true, activated = false) {
  const actions = Object.fromEntries(ACTIONS.map((a) => [a, idle()]));
  for (const a of pressed) actions[a] = { held: true, pressed: true, released: false };
  return { player: 0, connected, actions, aim: 0, wheel: 0, pointer, activated };
}
