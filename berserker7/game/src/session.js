// The run being set up, as plain data: no functions and no engine objects, so it can later be
// saved or sent over the network (it survives structuredClone and a JSON round trip unchanged).
// The holder is what scenes receive; see berserker7/AGENTS.md, Settings and session.

export function createSession({ campaign, difficulty }) {
  return Object.freeze({ campaign, difficulty });
}

// Holds the current session (null until one is set).
export function createSessionHolder() {
  let current = null;
  return {
    get: () => current,
    set(session) {
      current = session;
    },
    clear() {
      current = null;
    },
  };
}
