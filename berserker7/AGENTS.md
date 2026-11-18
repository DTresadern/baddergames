# Berserker 7

Sub-project of dev.baddergames. Namespace: `dev.baddergames.berserker7`. Root: `berserker7/` (this folder).

## Where things are

- This folder is part of one git repository for the whole project. The repository root is `../` from here.
- Read the shared instructions too: `../AGENTS.md`.
- Shared skills: `../.agents/skills/`. Namespaces and project settings: `../.mastermind/config.json`.
- Files outside this folder belong to the namespace that contains them. Change them only when your task names them.
- To confirm your namespace, root and the files to read: `../.agents/skills/mastermind/scripts/mm whoami`.

## This sub-project

Berserker 7 is a browser game built with three.js and Vite. Its features are planned in the feature tracker.

- `game/` - game code. Published at `/berserker7/`.
- `tracker/` - feature tracker. Published at `/berserker7/tracker/`.

Commands, run from `berserker7/game/`:

- install: `npm ci`
- run: `npm run dev` (serves at the URL Vite prints; the version label shows `dev`)
- test: `npm test` (Node's built-in test runner, files in `test/`, no browser)
- build: `npm run build` (output in `dist/`, not committed)
- check the build: `npm run preview` (serves `dist/`)

The version label (bottom-left) shows the short commit and UTC build time when built by CI (from `GITHUB_SHA`), and `dev` otherwise.

CI (`.github/workflows/checks.yml`) runs `node --check` on every tracked `.js` file, JSON parse checks, and `npm ci`, `npm test` and `npm run build` in `berserker7/game/`.

## Game harness (`game/src/engine/`)

- Fixed 60 Hz step with an accumulator (`clock.js`). Each frame's time is capped at 0.25 s and at most 8 steps run per frame, so a slow frame slows the game down. No interpolation: each frame draws the current state.
- Layers, drawn in this order: `background` (list), `main` (one scene), `overlays` (list, last on top).
- Each `frame(seconds)` in `harness.js`: 1. per step: sample the input once (one frame per player), call `onInputs(inputs)`, then tick the allowed scenes in layer order; 2. clear, draw the allowed scenes in layer order, then the fade; 3. end failed loads, apply queued requests in request order, and activate scenes whose load finished; 4. advance the fade and swap the main scene at its midpoint.
- Requests (`setMain`, `openOverlay`, `closeOverlay`, `addBackground`, `leave`, `preload`, `setPlayMode`) are always queued. Nothing changes mid-frame, including requests from scene hooks.
- Play modes: `local` and `online`. In `online`, overlays never pause the main scene.
- While the main scene loads, the loading scene is drawn in its place. A fade with nothing to show stays black at its midpoint until the scene is ready.

## Scene contract (`game/src/scenes/`)

- A scene is a plain object from a factory function: `{ settings, load, enter, tick, draw, suspend, resume, exit, unload }`. Missing hooks are no-ops; hook errors are not caught.
- Hooks: `load(context)` async (build three.js objects; `context` has `track`, `acquire` and `renderer`, and the scene keeps it for later hooks if it needs it), `enter(params) -> state`, `tick(state, inputs, dt) -> state` (`inputs[i]` is player i's input frame for this tick; an empty array when the harness has no input), `draw(state, view)` (`view` has `renderer`, `width`, `height` and `setAimOrigin(player, x, y)`), `suspend()`, `resume()`, `exit()`, `unload()` (optional: only for clean-up beyond tracked resources and acquired assets).
- Lifecycle: `unloaded -> loading -> ready -> active <-> suspended`; any loaded state `-> unloaded`; a failed load goes back to `unloaded` and leaves its layer, keeping any saved snapshot (a later request retries it). Illegal changes throw. Only `active` scenes tick and draw.
- Settings: `tick` (`always`, `uncovered`, `never`), `drawCovered` (true or false), `leave` (`suspend`, `unload`, `snapshot`).
- Leave modes: `suspend` keeps state and three.js objects; `unload` drops both and re-enters fresh; `snapshot` keeps a `structuredClone` of the state, unloads, and on return loads and restores that state, then calls `resume()`. A scene left by `unload` or `snapshot` while its load runs is unloaded when the load ends.
- State is one plain object (numbers, strings, booleans, arrays, plain objects). `tick` changes only the state; `draw` makes the three.js objects match it. No `Math.random` in a simulation.
- The harness owns each scene's resources. A scene passes every geometry, material, texture and render target it creates to `context.track(obj)`, and gets shared assets with `context.acquire(key, create)` (the harness's asset cache, `asset-cache.js`, counts users and disposes an asset when its last user releases it). After a failed load, and on every unload (including a snapshot leave), the harness disposes everything the scene tracked and releases everything it acquired, however far `load()` got, even when `unload()` throws or is missing. `unload()` must not dispose tracked resources or release acquired assets itself. No GPU objects created per frame.
- Lookups from state entities to three.js objects use a `WeakMap`, so they do not keep old state alive.
- No scene or game object reads a device or listens to input events; input arrives only as `tick`'s `inputs`.

The game page starts in the players scene (`scenes/players.js`, an input test). It shows a debug panel (`game/src/debug/panel.js`, top-right) with buttons for each harness behaviour, including "Players scene (input test)". Panel buttons give up focus after a click, so keys go to the game. `window.__b7` exposes the harness, renderer, asset cache and input (`window.__b7.input`, the object `attachInput` returns) for debug checks only; it is not a game API. The panel's "Fail slow scene's next load" button makes the slow scene's next `load()` throw after tracking and acquiring resources; the error message gives the GPU texture count at the moment of failure. The `leftState` and `returnedState` fields on each harness record are JSON copies of the state kept for the panel's identical-state check; nothing else reads them.

## Input (`game/src/input/`)

Pure logic (`actions.js`, `bindings.js`, `devices.js`, `sampler.js`) is separate from the browser wiring (`dom.js`), so Node tests cover it.

- Actions (`actions.js`, `ACTIONS`): `moveLeft`, `moveRight`, `moveUp`, `moveDown`, `jump`, `primaryFire`, `secondaryFire`, `melee`, `dash`, `interact`, `weapon1` to `weapon9`, `nextWeapon`, `previousWeapon`, `weaponMenu` (held), `pause`. Aim is not an action.
- Bindings: one data table, `DEFAULT_BINDINGS` in `actions.js`, with two schemes, `keyboardMouse` and `gamepad`. Source strings: `key:<KeyboardEvent.code>`, `mouse:<0-4>`, `wheel:+` (scroll down) and `wheel:-`; gamepad (standard mapping) `button:<0-31>`, `axis:<0-7>:+` and `axis:<0-7>:-`. Each scheme accepts only its own source kinds.
- Default bindings (`DEFAULT_BINDINGS`; gamepad numbers are standard-mapping button indices):

  | Action | Keyboard + mouse | Gamepad |
  |---|---|---|
  | `moveLeft` / `moveRight` / `moveUp` / `moveDown` | A / D / W / S, arrow keys | left stick, d-pad (14 / 15 / 12 / 13) |
  | `jump` | Space | A (0) |
  | `primaryFire` | left mouse button | right trigger (7) |
  | `secondaryFire` | right mouse button | left trigger (6) |
  | `melee` | V | B (1) |
  | `dash` | Shift (left or right) | left bumper (4) |
  | `interact` | E | X (2) |
  | `weapon1` to `weapon9` | number keys 1 to 9 | none |
  | `nextWeapon` / `previousWeapon` | wheel down / wheel up | right bumper (5) / Y (3) |
  | `weaponMenu` (held) | Q | View/Back (8) |
  | `pause` | Esc | Start (9) |
- Saved overrides: localStorage key `b7.bindings`, JSON in the same shape as the defaults but partial. `resolveBindings` (`bindings.js`) applies them; unknown schemes and actions are ignored, an invalid value keeps that action's default, an empty list unbinds it. Missing, unparseable or throwing storage gives the defaults. `saveBindings` exists for a later settings screen.
- Players and devices (`PLAYER_DEVICES` in `sampler.js`): player 1 (index 0) is keyboard + mouse and is always connected; player 2 (index 1) is on a gamepad with `mapping === 'standard'` and is connected only while that pad is; player 1 also gets a second such pad. Each player keeps the `gamepad.index` it was given while that pad stays connected (`perPlayer[i].padIndex`). A free player slot is filled only from connected standard pads that no player holds, in ascending gamepad index, with slots filled in ascending order of their `pad` number in `PLAYER_DEVICES` (player 2 has `pad: 0`, player 1 `pad: 1`): one pad goes to player 2, a second to player 1. When a player's pad disconnects, the slot goes empty and its held actions give `released` on the next tick; unplugging one pad never moves another player's pad. Non-standard pads are listed as ignored in the input panel; standard pads beyond the two assigned are not used.
- Frame, one per player per tick, plain data, new objects every tick: `{ player, connected, actions: { [action]: { held, pressed, released } }, aim, wheel }`.
- Edge rules, per action, from all its bound sources on the player's devices: `held` = any source down now, or a source that went down and up again since the last tick (a tap), or a wheel step since the last tick; `pressed` = held now and not held last tick, or a wheel step this tick; `released` = held last tick and not held now. So an action is pressed only when it goes from no bound source held to at least one, and released only when the last held source is let go: pressing, tapping or releasing a second source while another is held gives no edge, and neither does releasing and pressing the same key again between two ticks. A tap shorter than one tick is held for exactly one tick (pressed on it, released on the next). When one render frame runs several ticks, only the first sees a press. Key repeat adds no press. Window blur and a hidden tab release everything.
- Gamepad sources: buttons 6 and 7 (triggers) are down when their value is above 0.3, other buttons when pressed; `axis:i:±` is down when the axis value reaches 0.5 (`axisThreshold`) in that sign. The 0.25 dead zone (`deadZone`) is radial and applies only to the aim stick. A pad that disconnects gives `released` for its held actions on the next tick.
- Aim: radians, y up (0 = right, +π/2 = up on screen), range (-π, π], starts at 0. Mouse: when the mouse moved since the last tick, the angle from the player's aim origin to the pointer. The aim origin defaults to the canvas centre; a scene sets it in `draw` with `view.setAimOrigin(player, x, y)` (CSS px of the canvas). Otherwise the right stick (axes 2, 3) sets the angle when its length is at least 0.25 (radial dead zone). Otherwise the angle is unchanged. So a moved mouse wins over the stick in the same tick. The harness clears every aim origin before each frame's draw, after that frame's ticks, so an origin is only kept while a scene that sets it is drawn.
- Wheel: `frame.wheel` is the signed count of wheel steps since the last tick (+ = scroll down; keyboard + mouse players only). Several notches can land in one tick, so weapon cycling reads `frame.wheel` for the mouse wheel; `nextWeapon` and `previousWeapon` are pressed on every tick that has at least one step in their direction (`wheel:+`, `wheel:-`) and by their gamepad buttons. Reading the wheel (`devices.js`, settings in `WHEEL_SETTINGS` in `actions.js`): an event with zero distance (including -0) is ignored and is not activity. Pixel mode: a `deltaY` that is a non-zero whole multiple of `notchPixels` (120) is mouse-wheel notches, `deltaY / 120` steps at once (240 = 2), no lock; any other distance is a touchpad swipe, one step once it covers `swipePixels` (40) in one direction, then no more steps until the swipe ends (`swipeEndMs`, 120 ms, without an event that has distance) or reverses direction (a reversal starts a new swipe at once). Line and page modes: one step per event, or `|deltaY|` steps when that is a whole number above 1. The rule is tested by replaying recorded Chrome-on-Linux mouse-wheel and touchpad events (`game/test/fixtures/wheel-recordings.json`).
- Harness: `createHarness({ input, onInputs })`. `input.sample()` runs once per step, even when no scene ticks; `onInputs(inputs)` runs right after, before the scenes tick. `harness.lastInputs` holds the last tick's frames. `main.js` passes `togglePauseOnPress` (`pause-toggle.js`) as `onInputs`: any player's `pause` press (Escape, gamepad Start) opens the `pause` overlay, or closes it when open.
- Browser wiring (`dom.js`, `attachInput`): keyboard by `event.code` on the window (keys typed into text fields are ignored; Space, arrows and Tab do not scroll or move focus); mouse buttons on the canvas, released on the window; context menu and side-button navigation blocked; mouse position from the window relative to the canvas; wheel on the canvas (default blocked); gamepads polled on each sample.
- Many laptops disable the touchpad while keys are held, so aiming with the touchpad while moving may not work on some laptops. This is not worked around (see D-092).
- Input panel (`game/src/debug/input-panel.js`): `#b7-input` (top-left; bottom-left above the version label on windows up to 760 px wide; collapsed by default below 600 px), toggled by `#b7-input-toggle`. Per player `[data-player="0"]` and `[data-player="1"]`: `[data-field="device"]`, `[data-field="aim"]` (degrees), `[data-field="wheel"]` (total steps), and one row per action `[data-action-row="<action>"]` with attributes `data-held` (`true` or `false`), `data-pressed` and `data-released` (running counts). Also `[data-field="ignored"]` (ignored gamepads) and `[data-field="pad-event"]`. Refreshes every 100 ms.
