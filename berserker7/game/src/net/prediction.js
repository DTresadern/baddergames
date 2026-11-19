// Client-side prediction for the guest's own player. Pure.
// The guest records each tick's input frame; a host snapshot says which of them it has applied
// (`ack`). Reconciling: start from the host's confirmed player and replay the inputs after `ack`.

export const HISTORY_CAP = 120; // 2 s at 60 Hz

// Input frames by local tick, oldest first, at most `cap` entries.
export function createInputHistory(cap = HISTORY_CAP) {
  let entries = [];
  return {
    record(tick, frame) {
      entries.push({ tick, frame });
      if (entries.length > cap) entries.shift();
    },
    // Entries with tick > ack, oldest first.
    after: (ack) => entries.filter((e) => e.tick > ack),
    // Forgets entries with tick <= ack.
    drop(ack) {
      entries = entries.filter((e) => e.tick > ack);
    },
    size: () => entries.length,
  };
}

// A copy of `confirmed` with `step(player, frame)` applied for each entry in order.
export function reconcile(confirmed, entries, step) {
  const player = structuredClone(confirmed);
  for (const { frame } of entries) step(player, frame);
  return player;
}
