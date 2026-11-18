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
- Settings: `tick` (`always`, `uncovered`, `never`), `drawCovered` (true or false), `leave` (`suspend`, `unload`, `snapshot`), `pausable` (true or false, default true; false for the menus, see the pause toggle in Input).
- Leave modes: `suspend` keeps state and three.js objects; `unload` drops both and re-enters fresh; `snapshot` keeps a `structuredClone` of the state, unloads, and on return loads and restores that state, then calls `resume()`. A scene left by `unload` or `snapshot` while its load runs is unloaded when the load ends.
- State is one plain object (numbers, strings, booleans, arrays, plain objects). `tick` changes only the state; `draw` makes the three.js objects match it. No `Math.random` in a simulation.
- The harness owns each scene's resources. A scene passes every geometry, material, texture and render target it creates to `context.track(obj)`, and gets shared assets with `context.acquire(key, create)` (the harness's asset cache, `asset-cache.js`, counts users and disposes an asset when its last user releases it). After a failed load, and on every unload (including a snapshot leave), the harness disposes everything the scene tracked and releases everything it acquired, however far `load()` got, even when `unload()` throws or is missing. `unload()` must not dispose tracked resources or release acquired assets itself. No GPU objects created per frame.
- Lookups from state entities to three.js objects use a `WeakMap`, so they do not keep old state alive.
- No scene or game object reads a device or listens to input events; input arrives only as `tick`'s `inputs`.

The game page starts in the main menu (`scenes/main-menu.js`): the poster drawn as cover, a black panel holding three no-op items ("New Game", "Multiplayer", "Options"), and the title music. Each label is drawn once into its own off-screen 2D canvas (never added to the page) and shown as a tracked `CanvasTexture` on a plane; the highlighted item gets a white bar and full opacity, the others are dimmed. `menuLayout` and `itemAt` in `main-menu.js` give the item rectangles and hit test. Navigation: `moveUp` / `moveDown` from any connected player move the highlight with wrapping; a moved mouse over an item (`frame.pointer`) highlights it; `jump` and `interact` select the highlighted item; `primaryFire` selects the item under the pointer for a mouse player (a click elsewhere does nothing) and the highlighted item for a gamepad player. Player 1's frame always has a pointer (keyboard + mouse), so a trigger on player 1's gamepad selects only when the mouse is over an item; its A (`jump`) and X (`interact`) still select the highlight. Selecting "New Game" opens the New Game screen (below); the other items do nothing: `state.selected` (label) and `state.selections` (count) are for debug checks only; `state.request` (`'newGame'` or null, reset each tick) is what the scene's `tick` acts on. The poster comes from `poster.js` (`acquirePoster`, shared with the New Game screen through `context.acquire`, so it is loaded once) and labels from `labels.js` (`labelTexture`). There is no backdrop behind it. The loading scene shows while the poster loads. A debug panel (`game/src/debug/panel.js`, top-right, collapsed at start) has a "Main menu" button and buttons for each harness behaviour, including the test scenes ("Players scene (input test)", the A / B switch and the slow scene), which add the backdrop. Panel buttons give up focus after a click, so keys go to the game. `window.__b7` exposes the harness, renderer, asset cache, input (`window.__b7.input`, the object `attachInput` returns) and music (`window.__b7.music.debug`: `element`, `created`, `wanted`) for debug checks only; it is not a game API. The panel's "Fail slow scene's next load" button makes the slow scene's next `load()` throw after tracking and acquiring resources; the error message gives the GPU texture count at the moment of failure. The `leftState` and `returnedState` fields on each harness record are JSON copies of the state kept for the panel's identical-state check; nothing else reads them.

New Game screen (`scenes/new-game.js`): an overlay over the main menu, opened by `harness.openOverlay('newGame')` through the `screens` object `main.js` passes to both scenes. It is an overlay so the main menu never leaves its layer: the title music is not interrupted and there is no fade. While it is open the menu does not tick (it ignores input) but still draws underneath; in `online` play mode (set only from the debug panel) a covered main scene still ticks, so the hidden menu would react to input there. The menu's `suspend` and `exit` close it. It shows the shared poster, four campaign cards from `src/data/campaigns.js` (Megacity available and preselected; the others dimmed "Coming later" and not selectable), a difficulty list for the selected campaign (default "Inmate") and a "Back" item. `newGameLayout` puts the cards in one row when the view is at least 720 px wide and in a 2 x 2 grid below that, scaled uniformly to fit. Navigation: up and down (wrapping) and a moved mouse move the highlight; left and right change campaign (available ones only); `jump`, `interact` and a click select; a click on an available card sets the campaign. Back keys: the Back item, Escape and gamepad Start (`pause`), gamepad B and V (`melee`). Selecting a difficulty does nothing yet: `state.selected` (`easy`, `normal`, `hard`, `extreme` or `back`) and `state.selections` are for debug checks only; `state.request` is `'back'` when Back was selected at any point in the tick (so a later selection in the same tick cannot cancel it), and the scene's `tick` closes the overlay on it. Selecting Back closes the overlay. Its leave setting is `unload`, so closing frees its labels and each open starts fresh; the poster stays loaded because the main menu still holds it.

## Content (`game/public/content/`)

Runtime assets (images, audio). Vite copies them as-is into `dist/`, so they are published at `/berserker7/content/`. Load them with relative paths (`content/...`, no leading slash) so they work under the published base path. Subfolders: `textures/posters/`, `audio/music/` (more come later).

## Audio (`game/src/audio/music.js`)

- The only code that touches audio. One streamed `HTMLAudioElement`, created on the first `play(url)`.
- Playback starts on the first click, key or touch (browsers block it before), and pauses while the tab is hidden.
- `MUSIC_VOLUME` is the one volume value.
- Scenes call `music.play(url)` from `enter` and `resume`, and `music.stop()` from `suspend` and `exit`.

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
- Frame, one per player per tick, plain data, new objects every tick: `{ player, connected, actions: { [action]: { held, pressed, released } }, aim, wheel, pointer }`. `pointer` is `{ x, y, width, height, moved }` for keyboard + mouse players (mouse position and canvas size in CSS px, top-left origin, y down; `moved` is true only on the first tick after a move) and `null` for gamepad-only players.
- Edge rules, per action, from all its bound sources on the player's devices: `held` = any source down now, or a source that went down and up again since the last tick (a tap), or a wheel step since the last tick; `pressed` = held now and not held last tick, or a wheel step this tick, or a new tap or press after a tick on which the action was held only by a tap or a wheel step; `released` = held last tick and not held now, or that same new tap or press (the earlier tap or wheel step ends on the tick the new one starts). So an action is pressed only when it goes from no bound source held to at least one, and released only when the last held source is let go: pressing, tapping or releasing a second source while another is held gives no edge, and neither does releasing and pressing the same key again between two ticks. A tap shorter than one tick is held for exactly one tick (pressed on it, released on the next); taps on consecutive ticks each give their own press. When one render frame runs several ticks, only the first sees a press. Key repeat adds no press. Window blur and a hidden tab release everything.
- Gamepad sources: buttons 6 and 7 (triggers) are down when their value is above 0.3, other buttons when pressed; `axis:i:±` is down when the axis value reaches 0.5 (`axisThreshold`) in that sign. The 0.25 dead zone (`deadZone`) is radial and applies only to the aim stick. A pad that disconnects gives `released` for its held actions on the next tick.
- Aim: radians, y up (0 = right, +π/2 = up on screen), range (-π, π], starts at 0. Mouse: when the mouse moved since the last tick, the angle from the player's aim origin to the pointer. The aim origin defaults to the canvas centre; a scene sets it in `draw` with `view.setAimOrigin(player, x, y)` (CSS px of the canvas). Otherwise the right stick (axes 2, 3) sets the angle when its length is at least 0.25 (radial dead zone). Otherwise the angle is unchanged. So a moved mouse wins over the stick in the same tick. The harness clears every aim origin before each frame's draw, after that frame's ticks, so an origin is only kept while a scene that sets it is drawn.
- Wheel: `frame.wheel` is the signed count of wheel steps since the last tick (+ = scroll down; keyboard + mouse players only). Several notches can land in one tick, so weapon cycling reads `frame.wheel` for the mouse wheel; `nextWeapon` and `previousWeapon` are pressed on every tick that has at least one step in their direction (`wheel:+`, `wheel:-`) and by their gamepad buttons. Weapon cycling per tick: `frame.wheel` when it is not 0, otherwise `nextWeapon.pressed` minus `previousWeapon.pressed`; a bumper press on the same tick as a wheel step is folded into that step. Reading the wheel (`devices.js`, settings in `WHEEL_SETTINGS` in `actions.js`): an event with zero distance (including -0) is ignored and is not activity. Pixel mode: a `deltaY` that is a non-zero whole multiple of `notchPixels` (120) is mouse-wheel notches, `deltaY / 120` steps at once (240 = 2), no lock; any other distance is a touchpad swipe, one step once it covers `swipePixels` (40) in one direction, then no more steps until the swipe ends (`swipeEndMs`, 120 ms, without an event that has distance) or reverses direction (a reversal starts a new swipe at once). Line and page modes: one step per event, or `|deltaY|` steps when that is a whole number above 1. The rule is tested by replaying recorded Chrome-on-Linux mouse-wheel and touchpad events (`game/test/fixtures/wheel-recordings.json`).
- Harness: `createHarness({ input, onInputs })`. `input.sample()` runs once per step, even when no scene ticks; `onInputs(inputs)` runs right after, before the scenes tick. `harness.lastInputs` holds the last tick's frames. `main.js` passes `togglePauseOnPress` (`pause-toggle.js`) as `onInputs`: any player's `pause` press (Escape, gamepad Start) opens the `pause` overlay, or closes it when open. A press opens it only when there is no main scene or the main scene's `pausable` setting is true (the main menu is not pausable, so Escape never opens pause on the menu screens).
- Browser wiring (`dom.js`, `attachInput`): keyboard by `event.code` on the window (keys typed into text fields are ignored; Space, arrows and Tab do not scroll or move focus); mouse buttons on the canvas, released on the window; context menu and side-button navigation blocked; mouse position from the window relative to the canvas (the surface size also follows window `resize`); wheel on the canvas (default blocked); gamepads polled on each sample.
- Many laptops disable the touchpad while keys are held, so aiming with the touchpad while moving may not work on some laptops. This is not worked around (see D-092).
- Input panel (`game/src/debug/input-panel.js`): `#b7-input` (top-left; bottom-left above the version label on windows up to 760 px wide; collapsed by default at every width), toggled by `#b7-input-toggle`. Per player `[data-player="0"]` and `[data-player="1"]`: `[data-field="device"]`, `[data-field="aim"]` (degrees), `[data-field="wheel"]` (total steps), and one row per action `[data-action-row="<action>"]` with attributes `data-held` (`true` or `false`), `data-pressed` and `data-released` (running counts). Also `[data-field="ignored"]` (ignored gamepads) and `[data-field="pad-event"]`. Refreshes every 100 ms.
