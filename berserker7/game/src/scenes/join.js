// Join screen (overlay over the main menu, like New Game, so the menu does not tick under it).
// The screen itself is a DOM form (ui/join-form.js) passed in at registration: `enter` shows it
// and `exit` hides it. Draws nothing; the menu still draws underneath. A `pause` press (Escape
// or gamepad Start outside the field) goes back, like Back.

export function createJoin({ form, screens }) {
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false },
    enter() {
      form.show();
      return { ticks: 0 };
    },
    tick(state, inputs) {
      state.ticks += 1;
      if (inputs.some((f) => f.connected && f.actions.pause.pressed)) screens.closeJoin();
      return state;
    },
    exit() {
      form.hide();
    },
  };
}
