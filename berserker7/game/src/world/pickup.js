// Item pickups placed in a map (issue #133). Pure logic, no three.js; plain data.
// Map spawn: { type: 'pickup', item, x, y } (tile column x, the pickup's bottom at y, like an enemy
// spawn). Pickup data: { id (index among the map's pickup spawns), item, x (bottom centre), y, taken }.
// Host and offline only: tickSandbox calls stepPickups right after the players step. A pickup is
// used up once taken: it never comes back while the map runs. A guest gets the taken flags from the
// snapshots (`pk`, net/codec.js) and never adds items itself.

import { ITEMS, canTake } from './combat.js';
import { playerHeight } from './player.js';

// A pickup's box (tiles): width x height, bottom-centre at its x, y.
export const PICKUP = Object.freeze({ width: 0.6, height: 0.6 });
// Pickups a map (and a snapshot's taken mask) can hold.
export const MAX_PICKUPS = 8;

// The pickups of a map's spawns, none taken. Throws on an unknown item or more than MAX_PICKUPS.
export function createPickups(spawns, mapName = '') {
  const list = spawns.filter((s) => s.type === 'pickup');
  if (list.length > MAX_PICKUPS) throw new Error(`sandbox: map '${mapName}' has ${list.length} pickups (at most ${MAX_PICKUPS})`);
  return list.map((s, id) => {
    if (!ITEMS.includes(s.item)) throw new Error(`sandbox: map '${mapName}' has a pickup of unknown item ${String(s.item)}`);
    return { id, item: s.item, x: s.x + 0.5, y: s.y, taken: false };
  });
}

// True when the player's box overlaps the pickup's box.
function touches(player, pickup) {
  const half = player.size.width / 2;
  return player.x - half < pickup.x + PICKUP.width / 2 && pickup.x - PICKUP.width / 2 < player.x + half && player.y < pickup.y + PICKUP.height && pickup.y < player.y + playerHeight(player);
}

// Each untaken pickup goes to the first present player on row 0 (slot order) whose box overlaps it
// and who may take the item (canTake: a player carrying an onlyOne item leaves another one in the
// world, for the other player). Taking it adds the item to the inventory and uses the pickup up.
export function stepPickups(pickups, players) {
  for (const pickup of pickups) {
    if (pickup.taken) continue;
    const player = players.find((p) => p && (p.row ?? 0) === 0 && touches(p, pickup) && canTake(p, pickup.item));
    if (!player) continue;
    player.inventory.push(pickup.item);
    pickup.taken = true;
  }
  return pickups;
}

// The taken flags as a bit mask (bit i = pickup id i taken), and back onto a list of pickups.
export const takenMask = (pickups) => pickups.reduce((mask, p) => (p.taken ? mask | (1 << p.id) : mask), 0);
export function applyTakenMask(pickups, mask) {
  for (const p of pickups) p.taken = (mask & (1 << p.id)) !== 0;
  return pickups;
}
