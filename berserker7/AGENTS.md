# Berserker 7

Sub-project of dev.baddergames. Namespace: `dev.baddergames.berserker7`. Root: `berserker7/` (this folder).

## Where things are

- This folder is part of one git repository for the whole project. The repository root is `../` from here.
- Read the shared instructions too: `../AGENTS.md`.
- Shared skills: `../.agents/skills/`. Namespaces and project settings: `../.mastermind/config.json`.
- Files outside this folder belong to the namespace that contains them. Change them only when your task names them.
- To confirm your namespace, root and the files to read: `../.agents/skills/mastermind/scripts/mm whoami`.

## This sub-project and commands

Berserker 7 is a browser game built with three.js and Vite. Its features are planned in the feature tracker.

- `game/` - game code. Published at `/berserker7/`.
- `tracker/` - feature tracker. Published at `/berserker7/tracker/`.

Commands, run from `berserker7/game/`:

- install: `npm ci`
- run: `npm run dev` (serves at the URL Vite prints; the version label shows `dev`)
- test: `npm test` (Node's built-in test runner, files in `test/`, no browser)
- build: `npm run build` (output in `dist/`, not committed)
- rebuild the test level: `npm run build:level` (see Sandbox)
- rebuild the depth rows test map: `npm run build:depth-rows` (see Sandbox)
- check the build: `npm run preview` (serves `dist/`)

Version label and CI:

- The version label (bottom-right) shows the short commit and UTC build time when built by CI (from `GITHUB_SHA`), and `dev` otherwise.
  - `main.js` hides it (`hidden` attribute) when the `showVersionLabel` setting is false, at start-up and on every change.
- `vite.config.js` computes the build info once: `{ sha: GITHUB_SHA (full), builtAt: ISO time }`, or null without `GITHUB_SHA`. The label, the embedded `__BUILD_SHA__` / `__BUILD_AT__` (null in dev) and `dist/version.json` (`{"sha":...,"builtAt":...}`, written by a small inline plugin in `generateBundle`, none without build info) all come from that one object, so they cannot disagree.
- Outdated-build check (`ui/version-check.js`, pure, never throws, tested):
  - `isOutdated(running, published)` is true only when `published` is a plain object with string `sha` and `builtAt` (a valid date), a different `sha` and a later `builtAt` than `running`. Anything else, and no `running`, is false.
  - `checkForNewerBuild({ running, fetch, now, url, timeoutMs, setTimeout, clearTimeout })` fetches `version.json?t=<now>` with `cache: 'no-store'` and an `AbortController` timeout (5 s) and resolves true or false. A reject, abort, non-OK response or bad JSON is false, silently. No `running` (dev) returns false with no fetch.
  - The main menu runs it on every entry (`enter`, and `resume`, which is how the debug "Main menu" returns) through `screens.checkVersion()`. `suspend` and `exit` call `screens.hideVersionNotice()`. `main.js` ignores a result that is stale (a counter, bumped on each check and each hide) or arrives when the main menu is not the main scene.
  - The notice (`createOutdatedNotice`, `#b7-outdated`, `role="status"`, `textContent` only, own element, separate from `#b7-notice`) stays until the menu is left: "You are on an old version. Hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac) to get the latest."
  - Placement: bottom centre, 24 px up, 12 px monospace, `max-width: calc(100vw - 32px)`, `pointer-events: none`. The menu panel is centred, at most 560 px tall and 80% of the height, so the space below it is at least 10% of the height (60 px at 800x600, 80 at 1280x720, 142 at 390x844). One line plus the 24 px offset is about 54 px, so it clears the panel at those sizes and the bottom-right version label (about 19 px tall). On a window under about 540 px tall, or a narrow one where the text wraps to three lines, it can overlap the panel's bottom edge.
  - Why "hard refresh": GitHub Pages serves `index.html` with `Cache-Control: max-age=600`, so a plain reload can keep the old build (and its asset names) for up to 10 minutes. `version.json` is fetched with a cache buster and `no-store`, so the check sees the new build at once even when the page does not.
- CI (`.github/workflows/checks.yml`) runs:
  - `node --check` on every tracked `.js` file
  - JSON parse checks
  - `npm ci`, `npm test` and `npm run build` in `berserker7/game/`

## Game harness (`game/src/engine/`)

- Fixed 60 Hz step with an accumulator (`clock.js`).
  - Each frame's time is capped at 0.25 s and at most 8 steps run per frame, so a slow frame slows the game down.
  - No interpolation: each frame draws the current state.
- Layers, drawn in this order: `background` (list), `main` (one scene), `overlays` (list, last on top).
- Each `frame(seconds)` in `harness.js`:
  1. Per step: sample the input once (one frame per player), call `onInputs(inputs)`, then tick the allowed scenes in layer order.
  2. Clear, draw the allowed scenes in layer order, then the fade.
  3. End failed loads, apply queued requests in request order, and activate scenes whose load finished.
  4. Advance the fade and swap the main scene at its midpoint.
- Requests (`setMain`, `openOverlay`, `closeOverlay`, `addBackground`, `leave`, `preload`, `setPlayMode`) are always queued. Nothing changes mid-frame, including requests from scene hooks.
- `setMain(id, { params, fade, fadeOut, fadeIn, fromAlpha })`:
  - `fade` is the fade duration in seconds (0 = swap at once). The screen darkens over the first half, the scene swaps at the midpoint, and the new scene shows over the second half.
  - `fadeOut` and `fadeIn` (seconds) set the two parts separately: to black over `fadeOut`, swap, back in over `fadeIn`. They must be given together (both positive, finite) and not with `fade`, else `setMain` throws. The transition stores `fadeOut`, `fadeIn` and `duration = fadeOut + fadeIn`; `fade` is the same as `fadeOut = fadeIn = fade / 2`.
  - `fromAlpha` (0 to 1) is the darkness the fade starts at; by default the darkness of the fade it replaces, else 0.
  - With `fromAlpha: 1` the screen is taken as already black: the swap happens in the frame the request applies and the new scene fades in over `fadeIn` (`fade / 2` with `fade`).
- Play modes: `local` and `online`. In `online`, overlays never pause the main scene. `main.js` and the debug panel set `online` while a net session is active (hosting, or joined as a guest) and `local` when it ends (see Networking).
- While the main scene loads, the loading scene is drawn in its place. A fade with nothing to show stays black at its midpoint until the scene is ready.

## Scene contract (`game/src/scenes/`)

- A scene is a plain object from a factory function: `{ settings, load, enter, tick, draw, suspend, resume, exit, unload }`. Missing hooks are no-ops; hook errors are not caught.
- Hooks:
  - `load(context)` async: build three.js objects. `context` has `track`, `acquire` and `renderer`, and the scene keeps it for later hooks if it needs it.
  - `enter(params) -> state`
  - `tick(state, inputs, dt) -> state`: `inputs[i]` is player i's input frame for this tick; an empty array when the harness has no input.
  - `draw(state, view)`: `view` has `renderer`, `width`, `height` and `setAimOrigin(player, x, y)`.
  - `suspend()`
  - `resume()`
  - `exit()`
  - `unload()`: optional; only for clean-up beyond tracked resources and acquired assets.
- Lifecycle: `unloaded -> loading -> ready -> active <-> suspended`; any loaded state `-> unloaded`.
  - A failed load goes back to `unloaded` and leaves its layer, keeping any saved snapshot (a later request retries it).
  - Illegal changes throw.
  - Only `active` scenes tick and draw.
- Settings:
  - `tick`: `always`, `uncovered`, `never`
  - `drawCovered`: true or false
  - `leave`: `suspend`, `unload`, `snapshot`
  - `pausable`: true or false, default true; false for the menus (see the pause toggle in Input)
- Leave modes:
  - `suspend` keeps state and three.js objects.
  - `unload` drops both and re-enters fresh.
  - `snapshot` keeps a `structuredClone` of the state, unloads, and on return loads and restores that state, then calls `resume()`.
  - A scene left by `unload` or `snapshot` while its load runs is unloaded when the load ends.
- State is one plain object (numbers, strings, booleans, arrays, plain objects).
  - `tick` changes only the state; `draw` makes the three.js objects match it.
  - No `Math.random` in a simulation.
- Resource ownership: the harness owns each scene's resources.
  - A scene passes every geometry, material, texture and render target it creates to `context.track(obj)`.
  - A scene gets shared assets with `context.acquire(key, create)`. The harness's asset cache (`asset-cache.js`) counts users and disposes an asset when its last user releases it.
  - After a failed load, and on every unload (including a snapshot leave), the harness disposes everything the scene tracked and releases everything it acquired, however far `load()` got, even when `unload()` throws or is missing.
  - `unload()` must not dispose tracked resources or release acquired assets itself.
  - No GPU objects created per frame.
- Lookups from state entities to three.js objects use a `WeakMap`, so they do not keep old state alive.
- No scene or game object reads a device or listens to input events; input arrives only as `tick`'s `inputs`.

## Start-up (`scenes/boot.js`, `scenes/intro.js`)

- Order: boot (loading screen, the scene the game page starts on) -> a press -> intro (two logos) -> main menu (`scenes/main-menu.js`).
  - Boot and intro draw a full-screen black quad first (the renderer's clear colour is not black); the main menu draws the poster scaled to cover the view instead. None of them is pausable.
- Boot (`createBoot({ loader, screens })`, the first main scene):
  - `enter` starts `loader.load('boot')`.
  - While loading: a centred bar, `min(400 px, 70% of the width)` wide and 6 px tall, a dim track with a white fill scaled by progress.
  - When done: the text "Click or press any key to start".
  - The first tick after that with an `activated` frame (see Input) calls `screens.startIntro()`; presses during loading are not kept.
  - Invite link: with `?room=CODE` in the page URL, `screens.startIntro()` skips the intro once: it fades to the main menu (`menuFade({ fromBlack: false })`) and opens the Join screen with the code filled in, joining at once (an invalid code shows the invalid-code message). See Join screen and Networking.
  - On a failure: "Could not load" and the path, in place of the bar or prompt, and nothing else happens.
  - `tickBoot(state, inputs, status)` is the pure logic.
- Intro (`createIntro({ music, screens })`):
  - Tick counts (fade, hold, skip delay) are rounded to whole ticks, because 1.3 * 60 is 78.00000000000001 in floating point; `FADE_TICKS` is exactly 78.
  - Constants in `intro.js`: `FADE_SECONDS` 1.3, `HOLD_SECONDS` 2, `MENU_FADE_IN_SECONDS` 2 (the menu's fade-in from black after the logos end), `TICKS_PER_SECOND` (from the clock's `STEP_SECONDS`, 60), `INTRO_LOGOS` (`logo.baddergames`, then `logo.w8omg`).
  - `introAt(tick)` gives `{ logo, alpha, phase }`: each logo fades in linearly over 1.3 s (78 ticks), holds 2 s, fades out over 1.3 s (a logo is 276 ticks, the intro 552); the second follows with no gap; then `end`.
  - `enter` calls `music.play` for `music.title` (the first logo starts fading in at the same moment).
  - The intro never stops the music, and the menu's own `play` of the same URL does not restart it.
- Leaving the intro (`tickIntro`):
  - At `end` it sets `state.request` to `'menu'`, and the scene's `tick` calls `screens.showMenu({ fromBlack: true })`: `main.js` calls `setMain('mainMenu', menuFade({ fromBlack }))`. `menuFade` (pure, in `intro.js`) gives `{ fade: 2 * MENU_FADE_IN_SECONDS, fromAlpha: 1 }`, so the menu fades in from black over 2 s.
  - Skip: any connected frame with `activated` or any action pressed (a click, key, Escape, touch or a gamepad button bound to an action; also a wheel step or a left-stick tilt, since they press actions too; not a mouse move, and not gamepad buttons 10, 11 or 16 and above, which are unbound by default), after the first `SKIP_DELAY_SECONDS` (0.25 s), sets `state.request` to `'skip'`, and the scene's `tick` calls `screens.showMenu({ fromBlack: false })`: `menuFade` gives `{ fade: 2 * FADE_SECONDS }`: the intro fades to black over 1.3 s, then the menu fades in over 1.3 s.
  - The delay is there because a touch screen sends the tap's compatibility mouse events after `touchend`, possibly a tick later, which would otherwise skip the intro the tap started.
  - One request only.
- Layout (`logoRect`): centred, aspect kept, inside `LOGO_MAX_WIDTH` (80%) of the view width and `LOGO_MAX_HEIGHT` (60%) of its height, and never more device pixels than the image has (CSS size at most image size / `renderer.getPixelRatio()`).
- w8omg logo:
  - The file is black text on white without alpha; it is shown as white text on black with its soft edges.
  - Its texture is `raw` (manifest), and a `ShaderMaterial` outputs white with alpha `(1 - texel.r) * opacity`, so over black each shown pixel is the exact inverse of the image.
  - The baddergames logo is a plain `MeshBasicMaterial` with its own alpha.

## Main menu (`scenes/main-menu.js`)

- Layout, drawing and music:
  - There is no backdrop behind the menu.
  - It shows the poster drawn as cover, a semi-transparent black panel holding three items ("New Game", "Multiplayer", "Options"; "Options" does nothing yet), and plays the title music.
  - Each label is drawn once into its own off-screen 2D canvas (never added to the page) and shown as a tracked `CanvasTexture` on a plane.
  - The highlighted item gets a white bar and full opacity; the others are dimmed.
  - `menuLayout` and `itemAt` in `main-menu.js` give the item rectangles and hit test.
- Navigation:
  - `moveUp` / `moveDown` from any connected player move the highlight with wrapping.
  - A moved mouse over an item (`frame.pointer`) highlights it.
  - `jump` and `interact` select the highlighted item.
  - `primaryFire` selects the item under the pointer for a mouse player (a click elsewhere does nothing) and the highlighted item for a gamepad player.
  - Player 1's frame always has a pointer (keyboard + mouse), so a trigger on player 1's gamepad selects only when the mouse is over an item; its A (`jump`) and X (`interact`) still select the highlight.
- Panel animation (shared with New Game, `scenes/panel-anim.js`, pure; `PANEL_ANIM`: width 0.3 s, height 0.3 s, items 0.2 s, line height 4 px; cubic ease-out):
  - Opening (`openingAt`, `OPEN_SECONDS` 0.8): the panel is a 4 px line that widens (0.3 s), grows to full height (0.3 s), then the labels and highlight bar fade in (0.2 s). Closing (`closingAt`, `CLOSE_SECONDS` 0.8) is the reverse: items fade out, height shrinks to the line, width shrinks to 0.
  - `animRect(rect, { width, height })` keeps the centre; a width of 0 means the mesh is hidden (`visible = false`), never scaled to 0.
- Opening state: `state.open = { phase, t }`, phase `'waiting'` (nothing shown), `'opening'`, `'open'`.
  - `tickMainMenu(state, inputs, dt, { fading, covered })`: `waiting` becomes `opening` on the first tick where `fading` is false (the menu's fade-in from black has ended; `screens.fading()` is `harness.transition !== null`). `opening` adds `dt` to `t` and becomes `open` at 0.8 s. While `covered` (`screens.overlayOpen()`: an overlay is open over the menu) input is ignored: no highlight move, no selection, `request` stays null; the animation still runs.
  - Input (keys, hover, clicks) is ignored unless the phase was already `open` at the start of the tick.
  - It plays on every entry (`enter` gives a fresh state). `resume` (for example the debug panel's "Main menu") sets a flag and the next tick resets `open` to waiting.
- Selecting "New Game" opens the New Game screen (see New Game screen); "Multiplayer" opens the Join screen (`screens.openJoin()`, see Join screen); "Options" does nothing.
- The menu's `suspend` and `exit` close both the New Game and the Join overlays (`screens.closeNewGame()`, `screens.closeJoin()`) and hide the outdated-version notice (`screens.hideVersionNotice()`). `enter` and `resume` call `screens.checkVersion()` (see Version label and CI).
- State fields:
  - `state.selected` (label) and `state.selections` (count) are for debug checks only.
  - `state.request` (`'newGame'`, `'multiplayer'` or null, reset each tick; the first selection in a tick wins) is what the scene's `tick` acts on.
- Shared assets:
  - There are two backgrounds, both in manifest group `menubg`: `poster.classic` (`content/textures/menubg/berserkerguy-classic-2-1.png`) and `poster.thrash` (`content/textures/menubg/berserkerguy-thrash-2-1.png`). `POSTERS` in `poster.js` is built from that group (manifest order). Each key must be `poster.<name>` (lowercase letters, digits, `-`; `shortNames` in `poster.js` throws at import otherwise), and `<name>` is its `?menubg=` value. Adding a background: its manifest entry, plus the background lists in `test/poster.test.js` and `test/manifest.test.js`.
  - `main.js` picks one once at start-up with `pickPoster` (equal chance; `Math.random`, not the seeded generator, since it is not gameplay) and passes the key as `poster` to `createMainMenu` and `createNewGame`; both throw if it is not in `POSTERS`.
  - `?menubg=classic` or `?menubg=thrash` forces one; any other value logs one warning and the pick is random.
  - Only the picked one is downloaded: `withPoster(groupAssets, poster)` is the loader's `listGroup` and adds it to the `boot` group, so it is preloaded with the boot group.
  - The poster comes from `acquireTexture` (`assets/textures.js`), shared with the New Game screen and the loader through the asset cache, so it is loaded once.
  - Labels come from `labels.js` (`labelTexture`).
- Preload:
  - `main.js` preloads the menu once the boot group has loaded.
  - The loading scene shows only if the menu is reached before that (for example from the debug panel during boot).

## New Game screen (`scenes/new-game.js`)

- Opening and closing:
  - An overlay over the main menu, opened by `harness.openOverlay('newGame')` through the `screens` object `main.js` passes to both scenes.
  - It is an overlay so the main menu never leaves its layer: the title music is not interrupted and there is no fade.
  - The menu's `suspend` (at the game fade's midpoint) and `exit` close it.
- The menu while it is open:
  - The menu ignores input while any overlay is open over it (`screens.overlayOpen()`), in either play mode. It still draws underneath.
  - In `local` play mode a covered menu is not ticked at all. In `online` play mode it still ticks (the panel animation runs) but takes no input.
- Layout:
  - It shows the shared poster (the one picked at start-up, passed as `poster`; see Main menu), four campaign cards from `src/data/campaigns.js` (Megacity available and preselected; the others dimmed "Coming later" and not selectable), a difficulty list for the selected campaign (default "Inmate") and a "Back" item.
  - `newGameLayout` puts the cards in one row when the view is at least 720 px wide and in a 2 x 2 grid below that, scaled uniformly to fit.
- Navigation:
  - Up and down (wrapping) and a moved mouse move the highlight.
  - Left and right change campaign (available ones only).
  - `jump`, `interact` and a click select.
  - A click on an available card sets the campaign.
  - Back keys: the Back item, Escape and gamepad Start (`pause`), V and gamepad B (`melee`).
  - Selecting a difficulty (any of the four, by mouse or keys) creates the session and saves the last choice (see below), then closes its boxes and, 0.5 s later, calls `screens.startGame()`: `main.js` fades to the Sandbox as the main scene (`GAME_FADE_OUT_SECONDS` 2 to black, `GAME_FADE_IN_SECONDS` 1 back in). `startGame` does not close the overlay: it stays on top (boxes already closed) so the menu's panel is not shown during the fade. Difficulty has no effect yet.
  - The main menu leaves the main layer at the fade's midpoint (leave `suspend`), and its `suspend` calls `music.stop()`, so the title music stops there.
  - Selecting Back closes the overlay; it creates no session and saves nothing.
- State fields:
  - `state.selected` (`easy`, `normal`, `hard`, `extreme` or `back`) and `state.selections` are for debug checks only.
  - `state.start` is `{ campaign, difficulty }` when a difficulty was selected in the tick (the last one wins), else null; it is reset each tick.
  - `state.request` is `'back'` when Back was selected at any point in the tick (so a later selection cannot cancel it; a selection in the same tick does cancel the Back), `'startGame'` once at the end of the closing delay; the scene's `tick` acts on it.
  - `state.closing` is null, or `{ t, started }` after a selection.
- Closing on a difficulty selection:
  - In the selection tick the session and last choice are saved (below) but `screens.startGame()` is not called; `state.closing = { t: 0, started: false }`. A selection wins over a Back in the same tick.
  - From then on all input is ignored and `closing.t` counts up by `dt`. Drawing: the four card fills, the chosen card's outline (its card's rect grown by 3 px) and the difficulty panel close with `closingAt` (items fade out, height to the line, width to 0, 0.8 s); card labels, difficulty labels, Back and the highlight bar fade with the items.
  - At `closing.t >= CLOSE_SECONDS + START_DELAY_SECONDS` (0.8 + 0.5 s) `state.request` becomes `'startGame'` once (`started` is then true) and the scene's `tick` calls `screens.startGame()`.
  - The Back path is unchanged: the overlay closes at once, with no animation.
- Opening and saving (`createNewGame({ screens, settings, session, poster })`):
  - `enter` calls `initNewGame(settings.get().lastChoice)`: the saved campaign if it is an available campaign, else the first available one (Megacity); the saved difficulty if it is one of `DIFFICULTIES`, else `DEFAULT_DIFFICULTY`.
  - The scene's `tick`, when `state.start` is set (the selection tick): `session.set(createSession(state.start))`, `settings.set({ lastChoice: { ...state.start } })`; later, on `state.request === 'startGame'`, `screens.startGame()`; on `'back'`, `screens.closeNewGame()`.
- Its leave setting is `unload`, so closing frees its labels and each open starts fresh. The poster stays loaded because the main menu still holds it.

## Join screen (`scenes/join.js`, `ui/join-form.js`)

- An overlay over the main menu, like New Game, so the menu ignores input while it is open (and keeps its music); opened by `screens.openJoin()` (the menu's "Multiplayer"), closed by `screens.closeJoin()`. Settings: `tick: uncovered`, `drawCovered: true`, `leave: unload`, `pausable: false`.
- The screen is a DOM form owned by `ui/join-form.js` (`createJoinForm({ document, onJoin, onBack })`), passed to `createJoin({ form, screens })` at registration. The scene's `enter` calls `form.show()` and its `exit` `form.hide()`; it draws nothing (the menu draws underneath). A `pause` press (Escape or gamepad Start outside the field) goes back.
- The form (`#b7-join`, centred, monospace like the debug panel): a room code field (`#b7-join-code`, `autocomplete="off"`, max length 8, uppercased as typed), "Join" (`#b7-join-submit`; Enter in the field also joins), "Back" (`#b7-join-back`; Escape in the field also goes back) and a message line (`#b7-join-message`). `textContent` only, never `innerHTML`.
- Keys typed in the field do not reach the game: `dom.js` ignores `keydown` in text fields (no action, no pause toggle, no activation) and a `keyup` there only releases.
- Join: the Join button calls `submitJoinCode(code, { net, transport, setMessage })` (`ui/join-form.js`, pure, tested), which checks the code first. An invalid code shows the `invalid` message and changes nothing (a host keeps hosting, its guest stays connected), except that a join still connecting is cancelled (`net.leave()`), as Back does. A valid code sets the message to "Connecting…" and calls `net.join(code, { transport })`. Messages (`JOIN_MESSAGES`, one per reason): `invalid` "Room codes are 6 letters and digits.", `not-found`, `full`, `version`, `dropped`, `host-left`, `server` (signalling server unreachable), `timeout`, `unsupported`, `failed`.
- Back, or closing the overlay any other way, cancels a join that is still connecting (`net.leave()`); a connected session carries on.
- On a successful join (`connected` event) `main.js` closes the overlay, sets the map choice to the host's map, sets play mode `online`, unloads the Sandbox (`harness.leave('sandbox', 'unload')`) and calls `setMain('sandbox', { fade: 1.2 })`. The main menu stops its music at the fade midpoint as for New Game.
- When a connected guest's session ends (`host-left`, `dropped`), `main.js` sets play mode `local`, closes pause and fades to the main menu (`setMain('mainMenu', { fade: 1.2 })`), and shows a notice (`ui/notice.js`, `#b7-notice`, top centre, dismissed by a click or after 6 s): "The host left the game." or "Connection to the host was lost.". Leaving on purpose ("Leave game") goes back with no notice.
- A join that fails (`ended` before connecting) shows its message and sets play mode `local` (a host that started a join has stopped hosting).

## Settings and session (`game/src/settings/store.js`, `game/src/session.js`)

Settings store (`createSettingsStore({ storage })`):

- It is the only code that reads or writes `localStorage` (`browserStorage(window)` in the same file gives the storage, or null when reading `window.localStorage` throws). Nothing else, including comments elsewhere, should mention reading it.
- Saved format: one JSON object under the key `b7.settings` (`SETTINGS_KEY`).

  | Field | Default | Valid |
  |---|---|---|
  | `version` | `1` (`SETTINGS_VERSION`) | positive integer |
  | `musicVolume` | `0.35` (`MUSIC_VOLUME`) | finite number, 0 to 1 |
  | `showVersionLabel` | `true` | boolean |
  | `bindings` | `{}` | plain object of overrides: only known schemes and actions with a list of valid sources; the rest is dropped |
  | `lastChoice` | `{ campaign: 'megacity', difficulty: 'normal' }` | `campaign` a string, `difficulty` one of `DIFFICULTIES`; each falls back on its own |
  | `progress` | `{}` | any plain object |

- `progress` is reserved for saved games and campaign progress. Nothing uses it yet. It is kept exactly as saved (deep copy), and `reset()` keeps it.
- Whether a saved campaign is available is checked by the New Game screen, not the store.
- Load rules (`parseSettings(text, { version, upgrades })`, pure, never throws):
  - Missing key, unparseable JSON, a value that is not a plain object, or a `version` that is not a positive integer: all defaults.
  - A `version` lower than `SETTINGS_VERSION`: the upgrades run in order. A missing step, a throwing step or a result that is not a plain object gives all defaults.
  - A `version` higher than `SETTINGS_VERSION` (saved by a newer build): the fields that exist are checked as the current format.
  - Then each setting is checked on its own: invalid or missing gives that setting's default and the others keep their saved values. Unknown top-level fields are dropped. The result always has the current version.
- Version upgrades:
  - `UPGRADES` is an object keyed by the version it upgrades from: `UPGRADES[n](data)` returns version n + 1 data.
  - To change the format: bump `SETTINGS_VERSION` to n + 1, add `UPGRADES[n]`, and add a test.
- Adding a setting: add one entry to the `SETTINGS` table (`name`, `default()`, `check(value)` returning the cleaned value or `INVALID`), then a test. A setting added with a default does not need a version bump.
- Legacy bindings move: the old key `b7.bindings` held the overrides alone.
  - On creation, if it exists: when `b7.settings` has no saved value its (cleaned) contents become `bindings` (unparseable gives `{}`); in every case the settings are saved, and the old key is removed only when that save succeeded (a failed save keeps it for the next start).
  - If the old key is absent, nothing is written on creation.
- Methods:
  - `get()`: the current settings, deeply frozen. Each change makes a new object, so callers cannot change the store.
  - `set(patch)`: `patch` is a partial object of setting names. Each value goes through the same check; an invalid value or unknown name is ignored (no throw). If nothing changes (compared as JSON) there is no save and no notification; otherwise it saves and notifies once. Returns true when something changed.
  - `reset()`: every setting but `progress` back to its default; saves and notifies only if something changed.
  - `subscribe(fn)`: `fn(settings)` after each change; returns the unsubscribe function.
- Blocked storage: with storage null, or a storage whose `getItem`, `setItem` or `removeItem` throws, the game keeps working in memory, nothing is saved and nothing is logged.
- Saving happens only on a change, never per frame.
- `main.js` creates the store first, then passes it to what needs it: `attachInput` (bindings, at start-up), `createMusic` (volume, plus a `subscribe` callback calling `setVolume`), the version label (`showVersionLabel`), the New Game scene and the debug panel.

Session (`createSession`, `createSessionHolder`):

- A session is the run being set up, as plain data: `{ campaign, difficulty }`, frozen, with no functions and no engine objects, so it survives `structuredClone` and a JSON round trip unchanged and can later be saved or sent over the network.
- The holder (`createSessionHolder()`) has `get()` (null at start), `set(session)` and `clear()`. Only the New Game screen sets it so far; nothing reads it yet.
- Scenes get `settings` and `session` through the objects passed at registration (like `music` and `screens`): `createNewGame({ screens, settings, session })`. They never read storage or devices themselves.

## Assets and content

- Content folder (`game/public/content/`): runtime assets (images, audio).
  - Vite copies them as-is into `dist/`, so they are published at `/berserker7/content/`.
  - Load them with relative paths (`content/...`, no leading slash) so they work under the published base path.
  - Subfolders: `textures/logos/`, `textures/menubg/`, `audio/music/`, `maps/` (more come later).
  - Every file the game uses is listed in the asset manifest (see Manifest below); code never writes a content path itself.
- Asset code is in `game/src/assets/`.
- Manifest (`manifest.js`): `ASSETS`, one frozen list of every runtime asset, `{ key, path, type, groups, colorSpace? }`.
  - `path` starts with `content/` and is relative to `public/` (for example `content/textures/logos/w8omg.png`; no leading slash, no `..`).
  - `type` is `texture`, `music` or `map`.
  - `groups` names the preload groups that load it (`GROUPS`: `boot`, `menubg` and `sandbox`; nothing loads `menubg` whole, start-up adds the picked poster to the boot load; the `sandbox` group holds the maps and is not preloaded, the Sandbox scene acquires its map itself).
  - A texture's `colorSpace` is `srgb` (default, colour images) or `raw` (stored values used as data; the w8omg logo).
  - `assetByKey(key)` and `groupAssets(group)` throw on an unknown key or group.
  - `checkManifest(list)` returns the problems (duplicate or missing key, bad path, unknown type or colour space, a colour space on an entry that is not a texture, unknown or empty groups, a group with no assets); the module throws at import if `ASSETS` has any.
  - A test checks that every path exists under `game/public/`.
- Textures (`textures.js`): `acquireTexture(acquire, key)` returns a promise of the texture, through the asset cache under the manifest key.
  - Scenes pass `context.acquire`; the loader passes the cache's own `acquire`.
  - Whoever acquires first starts the download; the others get the same entry, so a texture is loaded once.
  - Scenes must not `track` it.
- Maps (`maps.js`): `acquireMap(acquire, key)` returns a promise of the parsed JSON of a `map` asset, through the asset cache under the manifest key (entry `{ ready, dispose: () => {} }`: nothing to free). The default fetch is `fetch(path)` plus `.json()` and throws on a non-OK response; tests pass their own as the third argument. Scenes must not `track` it.
- Loader (`loader.js`, `createLoader({ assets, music })`):
  - `load(group)` returns a promise (the same one on every call for that group) and loads each asset of the group once, even when it is in several groups: textures through `acquireTexture`, maps through `acquireMap` (`loadJson` option for tests, like `loadTexture`), music through `music.preload`.
  - The loader never releases what it acquired, so preloaded assets stay loaded for the page's life and a scene's later acquire gets them at once; a scene releasing them does not dispose them.
  - `status(group)` gives `{ progress, done, error }`: `progress` is loaded assets / group size, only moves forward, and is exactly 1 when `done`.
  - Loud failure: the first asset that fails rejects the group's promise, sets `error` to `Could not load <path>`, and is logged once with `console.error`; the group never becomes done and there is no retry.
- Placeholder block atlas (`textures/environment/blocks-placeholder.png`, not in the manifest, nothing uses it yet): 28 programmer-art 64 px block textures (panels, vents, grating, pipes, fan, hazard stripes, walkway top, girders, crates, lit signs and windows, lamps, control box) drawn by `tools/blocks_placeholder.py` from the shared palette, after the scene mockups.
  - `blocks-placeholder.json` lists each tile's name, x, y, w, h, kind, the axes it tiles seamlessly along (`tiles`: `x`, `y`, `xy` or `none`) and a note; `blocks-placeholder.png.generated.json` is its image record.
  - Rebuild (from `game/`, needs Python 3 and Pillow): `python3 tools/blocks_placeholder.py`; `--check` redraws in memory and exits 1 if either file differs byte for byte.
- Adding an asset: put the file under `game/public/content/...`, add an entry to `ASSETS` with its groups, and in code use `acquireTexture(context.acquire, key)` for a texture, `acquireMap(context.acquire, key)` for a map or `assetByKey(key).path` for music.

## Sandbox (`scenes/sandbox.js`, `world/`)

A test scene: a tile map and a box player that runs and jumps. Experimental.

- Units: one world unit is one tile. Positions, sizes and speeds are in tiles (speeds tiles/s). x is right, y is up. The 64 px `tileSize` in the map file is art data; physics never uses it.
- Map files (`public/content/maps/`, manifest group `sandbox`): `{ format: 1, name, tileSize, legend, grid, spawns }`, plus an optional top-level `player: { width, height, crouchHeight }` (tiles; see Player size) and optional `platforms` (see Moving platforms; both loaders return them, default `[]`).
  - `walkway.json` (`map.walkway`): a floor 2 tiles thick and 60 long, a wall 8 tiles tall (6 above the floor) at each end, 16 rows in all, the player spawn on the floor near the left end.
  - `mvp-upper-1.json` (`map.mvp-upper-1`): the ground of the old MVP's first level (zone 0, seed 72, MVP columns 0 to 160), solid tiles only, 162 x 22 tiles: platforms, ladders, hazards, liquids, gates and entities dropped; breakable blocks set into the ground slab kept as solid; solid pieces not connected to the ground dropped; a full-height wall at each end. One-off conversion; no generator is kept in the repository. Selectable in the Sandbox.
  - `moge3-cyberpunk.json` (`map.moge3-cyberpunk`): a blockout of the "moge3-cyberpunk" mockup from its MoGe-3 mesh, made by `game/tools/moge_blockout.py` (Python 3 + numpy; takes the GLB path as an argument; `--help` lists the steps and options). A cells map: `{ format: 1, kind: "cells", name, tileSize, tile: { type, color }, source, spawns, cells: [[x, y, z], ...] }`, z towards the camera.
    - Conversion: depth scale 0.5 around the median depth 25.27 m (each vertex moved along its ray to m·(d/m)^0.5), levelled by the pitch (-8.7°), points deeper than 32 m dropped (skyline, far towers, sky) and the characters, creatures, drones and shots dropped by image boxes; the hunter is 2 tiles from the walkway top to its head (0.98 tiles per metre); the play plane z = 0 is at the hunter's depth (24.28 m) and the walkway top is y = 0; a cell is solid with at least 20 points (a surface shell). 916 cells, x -18..20, y -12..9, z -8..10; 59 on the play plane. At the play plane the source image is about 15.8 tiles high (the Sandbox shows 8 to 28).
    - Loader: `world/cell-map.js` (`loadCellMap`); every cell goes into the tile map of its row (its z): `rows`, a `Map` z -> tile map; `tiles` is row 0's (the play plane, always present). A player collides with its own row (see Depth rows). `cells` lists the off-plane cells, drawn as cubes (instead of depth cubes). Optional `transfers: [{ x0, x1, low, high }]` (see Depth rows) are checked (integers, x1 >= x0, |low - high| = 1; else it throws) and copied, default `[]`. `world/load-map.js` (`loadMap`) picks the loader by `kind`.
  - `moge3-cyberpunk-blocks.json` (`map.moge3-cyberpunk-blocks`, the Sandbox default, `MAP_KEY`): the test level. A second blockout of the same mockup, from the project owner's block markup instead of MoGe's camera, by `moge_blockout.py --mode blocks`. 1 cell = 1 marked block; `player: { width: 0.55, height: 1.2, crouchHeight: 0.6 }` (the collision box the project owner drew on the comparison: about 50 x 107 px at 91 px per tile).
    - Conversion: a level pinhole camera, principal point (995, 415) (the markup's vanishing point), focal length 400 px (from the marked floor tiles; vertical FOV 91.3°); depth in blocks = 0.21 × MoGe depth (metres), fitted to the marked walkway face squares (118 px, 3.39 blocks) and right-hand blocks (73 px, 5.48 blocks); points deeper than 7.25 blocks dropped (far background) and the same image boxes as above; the walkway top is y = 0 (camera 0.75 blocks above it); the play plane z = 0 is the ground the characters stand on (4.48 blocks deep); x shifted 0.51 so cell boundaries fall on the face squares' edges; a cell is solid with at least 100 points (214 cells); then the project owner's manual edits remove 28 off-plane cells (`game/tools/moge3-cyberpunk-blocks.remove.json`, applied by `--remove`; a listed cell missing from the map is an error). 186 cells, x -11..12, y -6..7, z -3..3; 31 on the play plane. At the play plane the source image is about 9.2 blocks high, so FOV 90 at zoom 9 is close to the mockup's view.
    - Produced in two steps: `moge_blockout.py --mode blocks ... --out tools/moge3-cyberpunk-blocks.base.json` writes the blockout (kept byte for byte); `npm run build:level` (`tools/build-level.mjs`, Node, no dependencies) adds the authored sections of `tools/levels/moge3-cyberpunk-blocks.sections.mjs` (data built with `fill`, `slab`, `columns`, `building`; cells deduplicated, a base cell never removed; plus `platforms`, enemy spawns and transfer zones, written as the `transfers` field after `platforms`) and writes the map in the tool's layout, with `source.sections` naming the sections file. A test checks the committed map equals the build output. Edit the sections file, never the map.
    - Extension (x 11 to 297; walkway tops): A 11-24 outdoor walkway at 0, a 1-tile crate step; B 25-44 indoor station, ceiling at 3, a crouch crawl (headroom 1) at 34-37; C 45-62 climb (steps 2, 4) to a deck at 6 over a lower walkway at 0; D 63-84 a gap at 6 crossed by a moving platform, a pit at -3 below with a step and slabs back up to the left side, landing ledge 79-84; E 80-104 the drop to a street at -2, under a bridge (underside 4); F 105-121 underpass (ceiling at 1) with a lift at 115-118, the only way up to 6; G 122-150 rooftop, steps to 7 and 9, a 3-wide gap; the roof at 9 runs on through x 150 (no end wall) into H; H 151-297 depth rows: a copy of the `depth-rows-test` layout (`depthRowsCells({ dx: 151, dy: 9, startWall: false })` from its generator) moved +151 in x and +9 in y (its floor top 0 is 9 here), rows 0, +1 and -1, its nine transfer zones at +151 (`TRANSFERS` in the sections file, `depthRowsTransfers(151)`), end wall at 297. Enemies at x 22, 40, 60, 95, 100, 110, 135, 145, 201, 249 (the last two on H's row 0). Rules kept in A-G: step-ups at most 2, same-height gaps at most 3, standing headroom at least 2 (a crawl exactly 1), near-side (z > 0) cells only below walkway level. 2863 cells, 2 platforms, 11 spawns, 9 transfers.
  - `depth-rows-test.json` (`map.depth-rows-test`): a cells map for depth rows (issue #98), made by `tools/levels/depth-rows-test.mjs` (`npm run build:depth-rows`, `--check` like `build:level`; a test checks the committed map equals its output). Rows 0, +1 (front) and -1 (back), x -1 to 146, nine transfer zones (A-F, G, H, J) covering descend and ascend towards and away from the camera, a stretch where rows 0 and -1 run side by side with no zone, a low back path behind row 0's wall and pillars, and a reach-test section (x 103-145: G ledge top 3 needs a jump and an air grab, H platform top 5 is out of reach even at the top of a jump, J ledge top 3 is grabbed after walking off row 0's tower). The way out of the end (right of the tower, which is out of jump reach): air grab onto the J ledge, jump onto wall 135 (top 5), walk left along the bridge at 130-134 and the H platform (all top 5), descend in zone H to row 0. The layout and zones are listed in the generator's header. `depthRowsCells({ dx, dy, startWall })` and `depthRowsTransfers(dx)` export the layout with an offset; `moge3-cyberpunk-blocks` reuses them. Edit the generator, never the map.
  - `legend` maps one character to `{ type, color }`; `type: "solid"` blocks the player. A character not in the legend (use `.`) is empty.
  - `grid` is a list of strings written top to bottom; the loader flips it, so the last string is y = 0 and the column index is x.
  - `spawns` is a list of `{ type, x, y }` in tile coordinates with y up (the same coordinates the loader produces). A `player` spawn is the tile the player's feet stand in: the box is centred on tile column `x` and its bottom is at `y`. An `enemy` spawn uses the same coordinates.
- Map choice: `createMapChoice()` in `scenes/sandbox.js` holds the map key (`SANDBOX_MAPS`: `map.moge3-cyberpunk-blocks` (default), `map.moge3-cyberpunk`, `map.mvp-upper-1`, `map.walkway`, `map.depth-rows-test`; not saved); `main.js` passes it to `createSandbox({ mapChoice })` and the debug panel, whose Map select (`#b7-map`) sets it and reloads the scene (`leave('sandbox', 'unload')`, then `setMain('sandbox')`). The scene loads the chosen map in `load()`.
- Falling: the state keeps `spawn` and `fallY` (lowest solid tile over the rows a player can reach, row 0 plus the rows the transfer zones name, - `FALL_MARGIN`, 10); a player below `fallY` goes back to the spawn (row 0, no hop, no recent presses), since maps can have open ends; an enemy goes back to its spawn (`state.enemySpawns`), idle.
- Tile map (`world/tilemap.js`, `createTileMap({ types })`): sparse chunks of 32 x 32 tiles (`CHUNK_SIZE`) in a `Map` keyed `"cx,cy"`; each chunk is `{ cx, cy, tiles: Uint16Array }`. Tile id 0 is empty; `types[id]` is `{ solid, color }`.
  - `setTile(x, y, id)`, `tileAt(x, y)` (a missing chunk reads 0 and is not created), `isSolid(x, y)`, `chunks()`, `chunkSize`. Coordinates are integers; negative ones work.
  - It knows nothing about files. The tile map is level data, not scene state: it is built in `load()` and passed to the tick function, and the scene state stays plain data (`{ ticks, map, players, localSlot, ... }`).
- Grid loader (`world/grid-map.js`, `loadGridMap(json) -> { name, tileSize, tiles, rows, spawns, player, platforms, transfers }`; `rows` is row 0 only, `transfers` `[]`): throws on a `format` other than 1; legend ids start at 1 in legend order. It is the only code that reads `grid` and `legend`; another file format needs only another loader returning the same shape.
- Player size: per map. The optional `player: { width, height, crouchHeight }` field of a map file (tiles) is merged over the defaults `PLAYER_SIZE` in `world/player.js` (1 wide, 2 tall, crouch 1); both loaders return the result as `map.player`. `initSandbox` passes it to `createPlayer(x, y, size)`, which stores a copy in `player.size` (plain data); `playerHeight`, collision width, the stand-up check and the draw all use the player's own size. A respawn keeps it. The drawn player plane is the map's width and standing height.
- Player (`world/player.js`, pure, tested in Node): a box `size.width` wide and `size.height` tall (default 1 x 2). `{ x, y, vx, vy, onGround, aim, crouching, size }`, with `x, y` the bottom-centre and `aim` copied from `frame.aim` (radians, y up), plus the depth row fields (see Depth rows) and the combat fields `health` (`PLAYER_HEALTH` 100), `inventory` (`[]`), `meleeTicks` (0) and `meleeDir` (1) (see Combat), and `crushed` (false; set by `stepPlayer` each step, see Moving platforms); `stepPlayer` leaves those alone. Crouch: holding `moveDown` (S, down arrow, stick or d-pad down) on the ground sets `crouching` and the box becomes `size.crouchHeight` (default 1) tall with the feet in place (`playerHeight(player)` gives the current height); down in mid-air does nothing; releasing down, or jumping, stands up only when the full height fits, so under a low ceiling the player stays crouched until there is room. Speed is unchanged. The head (aim line start, camera follow) is the top of the current box. For now `moveUp` (W, up arrow) also jumps, in `stepPlayer` only; `DEFAULT_BINDINGS` are unchanged so W does not select menu items. `stepPlayer(player, frame, tiles, dt, world)` moves on x, pushes out of solid tiles, then does the same on y; the optional `world = { platforms: [{ prev, now }], move }` adds moving platforms and replaces `MOVE` (see below); without it the step is tiles only. All movement numbers are in the frozen `MOVE` object at the top of the file (max speed, ground and air acceleration and friction, gravity, jump speed, max fall speed). There is no swept collision: a step is under half a tile at the fastest fall (see Moving platforms for the limit with platforms).
- Moving platforms (`world/platform.js`, pure, D-129): map field `platforms: [{ width, height, speed, mode, path }]`; `path` is `[x, y]` waypoints of the box's bottom-left corner (tiles), `speed` tiles/s, `mode` `pingpong` or `loop`. `platformAt(platform, tick)` gives `{ x, y, width, height }` from the world tick only (distance = speed × tick × `STEP_SECONDS`, walked along the path), so host and guest agree and platforms are never sent.
  - Solid, like tiles (issue #105; the one-way rule of #95 is gone): bodies (players and enemies, both through `stepPlayer`) collide on x and then on y with solid tiles and the platforms' `now` boxes in one query (`solidHit`, by box edges): walking into a side stops, a jump into the underside stops at the head (vy 0), and landing on the top is the same as landing on a tile. Crouching stands up only with room under tiles and platforms.
  - Platforms move first (`movePlatform`, the kinematic solid model): before a body's own movement each platform moves from `prev` to `now`, x first, then y. On each axis a rider (on the ground, feet on the `prev` top within 1e-3, overlapping it) is carried by the movement: carried sideways into a tile or another platform it stops against it; carried up into one (a ceiling) it is crushed. Any other body the moved platform now overlaps is pushed out along the movement by exactly the overlap (to the platform's leading edge); pushed up, a falling `vy` stops; pushed down, a rising `vy` stops. A push that would put the body into a tile or another platform crushes it.
  - Crush: the crushed body stays where it was before that push or carry, does not move on its own that step, and `crushed` is true (set on every `stepPlayer`; `stepWithFall` clears it for a step that does not reach `stepPlayer`). The host (or offline) kills it in `resolveCombat` (see Combat): a player goes back to the spawn, an enemy is removed. The guest predicts carries and pushes with the same rule (platforms come from the world tick); a crush reaches it as the host's respawn in the next snapshot, and a correction that moves the guest's own player more than `RESPAWN_SNAP_DISTANCE` (3 tiles) snaps its camera. Seen, not changed: at `?lag=200` a guest crushed by a platform can be pushed out of the platform's far side before the host's death and respawn reach it; left as it is for now.
  - Step limit: there is no swept collision, so a body's step must stay shorter than the body plus the thinnest solid on that axis (a fall step is at most 0.5 tile; the thinnest platform is 0.5 tall, a crouched player 0.6) and a platform's step shorter than a body's width or height.
  - Test level: a player standing on the top step under the first moving platform (x 63-64, top 5) is in its path at chest height and is crushed against the deck at x 62 when the platform comes back. Crossing D (deck to platform to the ledge at 79), climbing out of the pit (slab 66-67, step, deck; wait for the platform to pass the step) and the lift at 115-118 (on at the street, off at 6 with a jump onto the ledge) were checked in a Node simulation of `tickSandbox` with the real map.
  - World tick: `state.ticks`. A step from k to k + 1 uses `prev = platformAt(p, k)`, `now = platformAt(p, k + 1)` (`platformsStep`), then `state.ticks = k + 1`. Host and offline: k = `state.ticks`. Guest: see Net view. Drawn at `state.ticks`: one mesh per platform made in `load()` (2D a plane, 2.5D a shaded box width × height × 1 at z = 0), `PLATFORM_COLOR` #c9a23a.
- Depth rows (`world/rows.js`, pure, D-130): a cells map's z slices are rows; a player collides only with the row it is on (`player.row`). Transfer zones (map field `transfers: [{ x0, x1, low, high }]`): whole-tile columns x0..x1 (inside when `x0 <= x < x1 + 1`) and two adjacent rows, `low` the one whose floor is lower there. Only inside a zone that connects the player's row: "descend" goes to `low`, "ascend" to `high`; elsewhere crouch and jump are unchanged.
  - Player fields (from `createPlayer`, so enemies have them too, unused): `row` (0), `hop` (null or `{ to, t, y0, y1, fall }`: target row, ticks done, start and landing y, whether it is a falling hop) and `presses: { down, jump }` (ticks since the last `moveDown` / `jump` or `moveUp` press, capped at `PRESS_NONE` 255).
  - Controls (`frame.rowScheme`; anything but `B` is `A`): On the zone's high row (descend): A = crouch, then jump; B = crouch twice. On its low row (ascend), both schemes: the air grab, a crouch press made while airborne (no earlier jump needed; a crouch held since the ground does nothing); B also = jump twice. The two presses of a double at most `ROW_WINDOW_TICKS` (12, 200 ms) apart. `createRowScheme()` (`ROW_SCHEMES` A, B; default A; not saved) is made in `main.js`, which adds `rowScheme` to every sampled frame (a wrapper around the raw input before `net.wrapInput`; `window.__b7.input` stays raw) and passes the holder to the debug panel.
  - `stepRowPlayer(player, frame, rows, transfers, dt, world)`: ages the presses; during a hop only the aim follows input; else, before anything changes, takes the reach (`reachOf`) and the zone, decides the intent from the side of the zone the player is on (high row: descend rules; low row: ascend rules) and the ages before this tick's presses, records the presses, and with an intent looks for a landing; found: starts the hop (the press is used, no normal jump; both ages reset) and advances it once; otherwise `stepPlayer` on the player's row (moving platforms only on row 0). A missing row is empty.
  - Landing (`findLanding`): from the current row's floor under the box (`floorBelow`, scanning down at most 9 tiles; else the player's y), whole tops above it up to the reach (ascend; `reachOf(player)` = `player.y + playerHeight(player) + REACH_MARGIN`, `REACH_MARGIN` 0, measured at the press before this tick's movement: standing 1.2 above the feet, at the top of a jump 3.628) or `ROW_DROP_MAX` (6) below (descend), highest first; valid with a solid tile under a column of the box and room for the standing box. None: nothing happens.
  - Hop: `HOP_TICKS` (15, 0.25 s) from the press. Ascend: scripted as before (`fall` false): y moves from `y0` to `y1` plus an arc of `HOP_ARC` (0.5) tiles at the middle; x and velocity held; on the last tick the player is on the target row, standing. Descend: a falling hop (`fall` true; `y1` is only what `findLanding` found): the depth is eased over `HOP_TICKS` and y follows normal physics (`stepPlayer`, gravity, `maxFallSpeed`) on the target row from the first tick, after a `DROP_NUDGE_SPEED` (7 tiles/s) upward start (rises 0.43 tile), so a deep drop takes as long as a fall; x is held during the depth move (`DROP_AIR_CONTROL` false; true = normal air control), jump and crouch are ignored; after `HOP_TICKS` the row is the target and normal control continues, but the hop stays (`t` = `HOP_TICKS`) until the player lands, so no row switch starts while it is still falling (a crouch press cannot grab straight back up). A descend also needs `fallPathClear(tiles, player, top)`: no solid tile on the target row in the box's columns from the landing top up to the top of the standing box at the current y; else nothing happens. `playerDepth(player)`: the drawn depth, the row eased (smoothstep) towards the target during a hop.
  - Not built: enemies and shots changing rows, cutting away blocks in the way, moving platforms on rows other than 0. The 2D view draws z = 0 only.
- Enemies (`world/enemy.js`, pure): `ENEMY` (width 0.8, height 0.9, `triggerDistance` 7, `stopDistance` 0.3) and `ENEMY_MOVE` (`MOVE` with max speed 3, ground acceleration 30, ground friction 30, no jump). `state.enemies`: `{ id, type, x, y, vx, vy, onGround, awake, aim, crouching, size, health, attackCooldown, crushed }` per `enemy` spawn, made idle in `initSandbox` (at most `MAX_ENEMIES` 16, else it throws). `id` is a stable integer (0 to `ENEMY_ID_MAX` 65535) for the enemy's whole life, never reused while the map runs: a pre-placed enemy's id is its index among the map's enemy spawns, so host and guest agree. `type` is one of `ENEMY_TYPES` (only `walker` for now). `stepEnemy(enemy, players, tiles, dt, world)`: idle until a present player's centre is within the trigger distance of its centre; then awake for good, holding `moveLeft` / `moveRight` towards the nearest present player's x (nothing within the stop distance) through `stepPlayer` with `ENEMY_MOVE`. Idle enemies still fall. `health` starts at `ENEMY_HEALTH` (30) and `attackCooldown` at 0; an awake enemy attacks a player close to it (10 damage and a push, at most once per 60 ticks) and is removed at 0 health (see Combat). Its movement never pushes or blocks a player. Moving platforms block, carry, push and crush it like a player (see Moving platforms); a crushed enemy is removed. A fallen enemy goes back to its spawn as a new idle enemy (full health). Host and offline only: `tickSandbox` steps them after the players. Drawn as one red (`ENEMY_COLOR` #e03030) plane each, made in `load()`, with a health bar (see Combat).
- Combat (`world/combat.js`, pure, issue #105): every number is a frozen constant there. Experimental; refined in playtesting.
  - `damage(target, amount, source)` is the one damage function for every source (T-025): `health = max(0, health - amount)`, true when it reached 0. `source` is one of `DAMAGE_SOURCES` (`melee`, `enemy`, `crush`; anything else throws); nothing depends on it yet. The player melee, the enemy attack and a platform crush all use it.
  - Crush: a player or enemy a moving platform crushed this tick (`crushed`, see Moving platforms) takes `CRUSH_DAMAGE` (`Infinity`, source `crush`): always a kill, since with no room left any health remaining would leave it stuck inside the platform; the zero-health rule then sends it back to the spawn.
  - Inventory: `player.inventory` is a list of item ids, empty for now. `ITEMS` (empty) is the list of known ids in wire order; `hasItem(body, item)`; `inventoryMask` / `inventoryFromMask` turn it into a bit mask over `ITEMS` and back (always 0 for now).
  - Melee (`MELEE`: damage 10, `reachWidths` 1, `swingTicks` 9 (0.15 s), `cooldownTicks` 18 (0.3 s)): a `melee` press (V, gamepad B), or a `primaryFire` press (left mouse button, right trigger) while the inventory is empty, starts a swing when `meleeTicks` is 0 (`stepMelee`, each tick: `meleeTicks` counts down, then a wanted swing sets it to 18). The direction (`meleeDir`) comes from the aim: right when `cos(aim) >= 0`, else left. The swing box (`meleeBox`) runs from the player's centre to `reachWidths` player widths beyond its front edge, over the player's current height. It hits every enemy whose box overlaps it, once, on the swing's first tick (`meleeTicks === 18`), and only while the player is on row 0 (`ENEMY_ROW`; enemies never change rows).
  - Enemy attack (`ENEMY_ATTACK`: damage 10, range 0.3, `cooldownTicks` 60, `pushSpeed` 6, `pushLift` 5): an awake enemy whose `attackCooldown` is 0 attacks the nearest player on row 0 whose box is at most 0.3 tiles from its box horizontally (edge to edge; overlapping counts) and overlaps it vertically: 10 damage, the player's `vx` becomes 6 tiles/s away from the enemy (equal x: the way the enemy moves, else right), `vy` at least 5, `onGround` false, and the cooldown becomes 60. The cooldown counts down by one each tick, so one enemy attacks at most once per 60 ticks (1 s).
  - Order each host or offline tick (`tickSandbox`): players step (movement, then `stepMelee`, then the fall respawn), enemies step, then `resolveCombat(state)`: crushed players and enemies die, swings that started this tick hit, enemies at 0 health are removed from `state.enemies`, enemies attack; then `state.ticks` goes up.
  - A player at 0 health goes back to the spawn like a fall respawn (row 0, no hop, no recent presses) with `health` 100 and `meleeTicks` 0; the camera snaps for the local player. A fall respawn keeps health, inventory and melee fields.
  - Networking: the host decides every hit, including the guest's (T-112). Every player's melee timer steps in `stepWithFall`, so the guest predicts its own swing (drawn at once) and its replay matches the host, which steps the guest's player with the same frames. The guest never calls `resolveCombat`; health, inventory and melee fields come from the snapshot (its own player through `reconcile`, the host player through the interpolation, enemies' `health` through `remoteEnemies()`).
  - Drawing (both views, meshes made in `load()`): per player slot a swing plane (white, opacity 0.45) over `meleeBox` while `swinging` (the swing's first 9 ticks), just in front of the player (2D) or at its depth (2.5D), moved by `rideOffset` like the body for a remote player; per enemy pool slot a health bar (`ENEMY.width` × 0.08, `HEALTH_BAR_COLOR` #40e070) centred 0.1 above the enemy's top, anchored at its left end, `scale.x = health / 30`, shown only while `0 < health < 30`.
  - Health HUD (`ui/health-hud.js`, `createHealthHud({ document })`): `#b7-hud`, bottom-left (16 px from the left, 24 px up), 14 px monospace, white on a dark translucent background, `pointer-events: none`, `textContent` only. One line per present slot: `P1 100/100`, `P2 70/100`. `main.js` calls `update(players)` after each `harness.frame` with the Sandbox's `state.players` while the Sandbox is the active main scene (`sandboxState()`, the same check the net session uses), else null (hidden). The DOM changes only when the text does. On windows up to 760 px wide the input panel (`#b7-input`, z-index 2, also when collapsed) sits at the bottom-left, 24 px up, over it (the HUD is z-index 1).
- Scene (`createSandbox()`): `tick: uncovered`, `drawCovered: true`, `leave: suspend`, pausable (Escape opens pause). Tiles are drawn as one `InstancedMesh` per chunk and tile type; all geometry, textures, materials and meshes are tracked. Each tile type has one tracked texture (`scenes/tile-texture.js`): a checkerboard the size of the map's `tileSize` (64 px), built from bytes as a `DataTexture` (so Node tests can load the scene), with `TILE_CHECKER.square` (8 px) squares alternating between the legend colour and that colour moved `TILE_CHECKER.shade` (0.09) towards white. Nearest filtering for magnification and minification and no mipmaps, on purpose, so aliasing and jitter show. Each tile maps the texture once (UVs 0 to 1), so squares line up across tiles. The camera follows the player's head (see Camera position below) and shows `zoom.get()` tiles in height. `zoom` is a holder from `createCameraZoom()` (whole tiles, `CAMERA_TILES_MIN` 8 to `CAMERA_TILES_MAX` 28, default `CAMERA_TILES_HIGH` 12, not saved, so a reload starts at 12 again; the debug range is 8 to 28) that `main.js` creates and passes to both `createSandbox({ zoom })` and the debug panel, so a change shows on the next frame. An aim line (`AIM_LENGTH`, 2 tiles) starts at the head (top centre of the box) and points at the mouse (see Aim line below); `draw` sets the local player's head as device player 0's aim origin with `view.setAimOrigin(0, ...)`, so `frame.aim` is measured from it (the gamepad right stick sets `frame.aim` too). Pure helpers `initSandbox(map, key, localSlot)` and `tickSandbox(state, inputs, dt, tiles, halfLife, net, level)` (`level` = the loaded map's `{ platforms, rows, transfers }`, default none: `tiles` as row 0, no zones; players step through `stepRowPlayer`, enemies through `stepEnemy` on `tiles`) are for tests.
- Players and slots: `state.players` is a list indexed by player slot; `state.localSlot` is the slot this browser controls (0 offline or as host, 1 as a guest); `state.size` is the map's player size. Slot 0 is player 1, colour `0xf2c14e`; slot 1 is player 2, colour `0x4ec1f2` (`PLAYER_COLORS`). Players beyond slot 0 exist only while a net peer is present.
- Net view: `createSandbox({ net })` takes the net session's read-only view (`net.netView()`, see Networking; default `OFFLINE_NET`: role null, slot 0, no peer). The scene never sees the transport; input still arrives only as `tick`'s `inputs`. Each tick (`tickSandbox`):
  - If `net.localSlot()` differs from `state.localSlot`, the state starts again (fresh spawn) for that slot.
  - Offline or host: slot i steps with `inputs[i]`; slot 1 is added at the spawn when `net.peerPresent()` becomes true and removed when it becomes false. Offline, a local gamepad player 2 is not played (as before).
  - Guest: the own player (slot 1) is `reconcile(snapshot.players[1], net.inputsAfter(snapshot.ack), step)` when `net.takeSnapshot()` gives one (the current tick's frame is already in that list), else one step with `inputs[0]`. Replayed entry j steps from world tick `snapshot.wt + j` to `+ 1`, then `state.ticks = wt + entries`; without a snapshot one step from `state.ticks`. So the guest predicts at the world ticks the host will use and draws platforms at the same tick as its own player. Slot 0 is `net.remotePlayer()` (the interpolated host player), or the previous one when that is null. `state.enemies` becomes the list from `net.remoteEnemies()` (by id, interpolated, with the host's `health`), so enemies appear and disappear with the host's; the map's own enemies (same ids) until the first snapshot. Each view has a pool of `MAX_ENEMIES` enemy meshes made in `load()`; unused ones are hidden. `state.remoteTick` is `net.remoteWorldTick()`, read in the same tick (a guest only; removed when the state starts again). Drawing: the host player and enemies are sampled at that older world tick while platforms are drawn at `state.ticks`, so a remote body standing on a platform at `remoteTick` (feet within 0.05 of its top, overlapping it) is drawn moved by that platform's movement from `remoteTick` to `state.ticks` (`rideShift` in `world/platform.js`); it is drawn on the platform.
  - Each player falls back to the spawn on its own. The camera source follows the local player's head (snapped on a local respawn). `pointer` and `aimSource` come from `inputs[0]` and belong to the local player.
- 2.5D (`scenes/sandbox-3d.js`): two view modes over the same map, player and physics; only drawing and camera differ. `createViewMode()` holds the mode (`2d` or `2.5d`, default `2.5d`), the FOV (whole degrees, `FOV_MIN` 1 to `FOV_MAX` 130, default 60) and the camera offset (`offset()`, `setOffset(axis, v)`: tiles, x right, y up, ±`OFFSET_LIMIT` 4 in `OFFSET_STEP` 0.25 steps, default `OFFSET_DEFAULT` x 0, y 2); `main.js` passes it to `createSandbox({ viewMode })` and the debug panel, so a change shows on the next frame. Not saved.
  - `2d` is the earlier flat view: tiles as planes, orthographic camera.
  - Depth shading (cells maps, 2.5D; `DEPTH_SHADE` and `depthShade(z)` in `sandbox-3d.js`): off-plane cubes get a material colour multiplier per z (times the texture and the face shading), so the walkable layer reads apart. Play plane (z = 0): unchanged. Behind: brightness 0.62 at z = -1, 0.48 at -2, 0.38 at -3 and beyond, times a cool tint (0.82, 0.9, 1). In front (z > 0): brightness 0.34 times a warm tint (1, 0.88, 0.8). One material pair (checker, grid) per tile type and z, made in `load()`; a cells map's play plane cubes get one too. The shade is relative to the local player's drawn depth: when it changes, `draw` sets each pair's colour to `depthShade(z - depth)` (`setRGB`, no allocation), so the brightest blocks are on the player's row and the shading eases during a hop; `depthShade` interpolates a fractional z linearly between the whole depths around it. On row 0 the colours are the same as before rows. Grid maps' depth cubes are not shaded. Platforms stay yellow, enemies red.
  - Grid (`viewMode.grid()` / `setGrid(on)`, off by default, not saved): level tiles (2D) and cubes (2.5D, play plane and off-plane cells) use the grid texture instead of the checkerboard: `TILE_GRID` (`scenes/tile-texture.js`), a dark fill (#232836, close to the background) with a light border (#d8ecff) 2 px wide at 64 px on every tile face, nearest filtering, no mipmaps, one texture per tile type. Faces stay solid (back-face culling, depth writes, per-face shading), so hidden edges do not show. Each level group has a checkerboard and a grid material, made at load; `draw` only sets the instanced mesh's material. The player, aim line and city backdrop are unchanged.
  - `2.5d`: each solid tile is a 1 x 1 x 1 cube centred on the play plane (z = 0), the checker texture on every face, faces shaded by vertex colours (`FACE_SHADE`: top 1, front 0.8, sides 0.62, bottom and back 0.45; no lights). The player is a flat plane of the map's player size (default 1 x 2) at its depth (z = 0 on row 0; see Depth rows) facing the camera; the aim line stays.
  - Depth rows (2.5D): each player's body and aim line are drawn at its depth (`p.depth ?? playerDepth(p)`; `depth` is the guest's interpolated host player). Row camera (`viewMode.rowCamera()` / `setRowCamera(on)`, default on, not saved): the camera's z is the distance plus the local player's depth, so the player keeps its size on screen; off, it stays at the play plane's distance and the mouse mapping and aim origin use the tiles shown on the player's plane (`tilesHigh × (distance - depth) / distance`). Near and far planes are relative to the camera. Transfer zone markers (made in `load()`): per zone and each of its rows a thin box (zone width × 0.06 × 1) on that row's highest floor top in the zone, `MARKER_COLOR` #3ee8ff, opacity 0.85. Enemies and platforms stay at z = 0.
  - Perspective camera at distance `(tilesHigh / 2) / tan(fov / 2)` from the play plane (`perspectiveDistance`), so z = 0 shows exactly the zoom's view height at any FOV, as in 2D. Near and far planes are that distance ∓ `DEPTH_MARGIN` (4 tiles), near at least 0.1. At FOV 130 and 18 tiles high the distance is about 4.2 tiles, so near is 0.2 and the near-side depth cubes (front faces at z = +1.5, 2.7 tiles from the camera) are not clipped. At the closest zoom (8) and FOV 130 the distance is about 1.9 tiles: cells nearer than that are behind the camera.
  - Depth cubes (`depthCubes(tiles)`): decoration only, not in the tile map, so they never collide. On every `DEPTH_CUBE_SPACING`-th (3) column strictly between the leftmost and rightmost solid columns, one cube in the same row as the column's top solid tile (flush with the floor surface, as if the floor extends sideways), at z = -1 (far) or +1 (near) by a hash of the column (`hashInt`, not `Math.random`). Near-side cubes can cover the player.
  - Camera position, each frame, in both views (`draw`): rest = smoothed source (`state.camera`) + offset; with a mouse aim, camera = rest + `cameraShift(head, aim, viewMode.follow())`, where aim is the mouse projected onto the play plane (`screenToPlane`) through a camera at the rest position, never the actual camera (that feeds back and the camera flies off). The shift is (aim - head) × follow; if shorter than Min it is lengthened to Min along the aim direction (head to aim), so with Min > 0 the camera never sits at the head; if longer than Max it is scaled to Max (after Min, so Max wins when Max < Min); then x is scaled by X scale, and y by Y scale up when it is above 0 or Y scale down when it is below 0. With the aim point exactly at the head the last non-zero aim direction is used (kept in the scene, not the state); before the mouse has moved the camera stays at rest. No smoothing. The camera always looks straight along -z (no rotation), so its look target moves with it.
  - Camera source smoothing: `tickSandbox` moves `state.camera` towards the player's head (`playerHead`) every tick with `smerp(source, head, dt, halfLife)` (sandbox-3d.js): source += (head - source) × (1 - exp(-ln 2 × dt / halfLife)), frame-rate independent; half-life 0 snaps. It runs in the fixed 60 Hz tick, so it is plain state and deterministic. `snapCamera(state)` puts it on the head at once: on spawn (`initSandbox`, so also on a map change) and on a fall respawn. The aim shift is still measured from the actual head, through a camera at the rest position, and the aim line starts at the actual head.
  - Aim-follow settings (`FOLLOW_SETTINGS` in `scenes/sandbox-3d.js`, on the `viewMode` holder: `follow()`, `setFollow(key, v)`; not saved): Follow 0 to 1 step 0.05 default 0.4; Min 0 to 10 tiles step 0.25 default 0; Max 0 to 20 tiles step 0.25 default 8; X scale, Y scale up and Y scale down 0 to 2 step 0.05, defaults 1, 0.5 and 0.5 (Y scale up applies when the shift's y is above 0, aiming up; Y scale down when it is below 0, aiming down); Smoothing half-life 0 to 0.5 s step 0.01 default 0.05.
  - Mouse in the state: `tick` copies `inputs[0]`'s `frame.pointer` position into `state.pointer` (canvas CSS px) and sets `state.aimSource` to `mouse` when the pointer moved, or `stick` when `frame.aim` changed without a pointer move. The follow shift applies only while `aimSource` is `mouse`.
  - Aim line: with a mouse aim it points at the pointer projected through the actual (shifted) camera, the mouse's true world position; with a stick it uses `player.aim`. `frame.aim` (the input system's angle) is measured from the head's on-screen position under the actual camera (`view.setAimOrigin`), so the camera shift does not offset it either.
  - City backdrop (`scenes/city-backdrop.js`, 2.5D only, visual only): three rows of box buildings behind the play plane, to see the parallax the perspective camera gives for free (no scrolling code, no layer speeds). `CITY_LAYERS`: z -15 (sparse, gaps 6 to 14 tiles, about 34% covered, colour #4f5a6c), z -40 (gaps 2 to 6, 12% wider gaps of 8 to 14, about 51%, #3b4352), z -90 (gaps 0 to 2, 18% wider gaps of 6 to 14, about 74%, #292f3c); colours mix the level colour towards the background (35%, 60%, 82%). Each building is a few boxes (`layerBuildings`, `layerParts`): a body, sometimes 2-3 narrower tiers on top, a thin antenna, a signboard (a thin box just in front of the face, a `NEON_COLORS` colour mixed towards the background by the layer's fade), and skyways join some neighbours (their own seed). Each layer is one `InstancedMesh` of scaled shaded cubes with a white material and a colour per instance (`setColorAt`), wide enough for the default FOV (60) at the furthest zoom in a 21:9 window anywhere the camera can go (the level plus the largest offset and aim-follow Max), and reaching below the view. Fixed seeds (mulberry32), so the same layout on every load. The `viewMode` holder's `backdrop()` / `setBackdrop(on)` (default on) shows it; while it shows, the far plane is `CITY_FAR` (100) tiles behind the play plane.
  - Each scene graph (2D and 2.5D) has its own body and aim meshes for both slots, made in `load()` and hidden while a slot is empty (nothing is created per frame); geometries, textures and materials are shared and tracked. The camera, the aim origin and the mouse aim line follow the local player; other players' aim lines use their `aim`.
- Reaching it: the debug panel's "Sandbox" button, or selecting a difficulty on the New Game screen (the fade to the Sandbox starts after the screen's boxes close). The debug "Main menu" button goes back.

## Audio (`game/src/audio/music.js`)

- The only code that touches audio. One streamed `HTMLAudioElement` (never fetch + decode), created on the first `play(url)` or `preload(url)`.
- `preload(url)` sets the source without playing (does not set `wanted`).
  - Its promise resolves once the element can play through (`canplaythrough`, or `readyState` already 4).
  - It rejects on the element's `error` naming the url.
  - After `MUSIC_PRELOAD_TIMEOUT_MS` (15 s) it resolves with a `console.warn` that the music will stream when played (some mobile browsers ignore preload until a gesture).
  - A later `play` of the same url keeps the source and does not restart.
- Playback starts on the first click, key or touch (browsers block it before), and pauses while the tab is hidden.
- Volume:
  - `createMusic({ window, volume })`: `volume` defaults to `MUSIC_VOLUME` (0.35, the default for the `musicVolume` setting).
  - `music.setVolume(v)` clamps to 0 to 1 (a value that is not a number is ignored), keeps it for an element not yet created, and applies it to the element at once.
  - `music.debug.volume` is the current volume.
  - `music.js` does not read settings: `main.js` passes the saved volume and calls `setVolume` from a `settings.subscribe` callback.
- Scenes call `music.play(url)` from `enter` and `resume`, and `music.stop()` from `suspend` and `exit`. Exception: the intro plays the title music from `enter` and never stops it, so it carries on into the menu.

## Input (`game/src/input/`)

Pure logic (`actions.js`, `bindings.js`, `devices.js`, `sampler.js`) is separate from the browser wiring (`dom.js`), so Node tests cover it.

- Actions (`actions.js`, `ACTIONS`): `moveLeft`, `moveRight`, `moveUp`, `moveDown`, `jump`, `primaryFire`, `secondaryFire`, `melee`, `dash`, `interact`, `weapon1` to `weapon9`, `nextWeapon`, `previousWeapon`, `weaponMenu` (held), `pause`. Aim is not an action.
- Bindings: one data table, `DEFAULT_BINDINGS` in `actions.js`, with two schemes, `keyboardMouse` and `gamepad`.
  - Source strings: `key:<KeyboardEvent.code>`, `mouse:<0-4>`, `wheel:+` (scroll down) and `wheel:-`; gamepad (standard mapping) `button:<0-31>`, `axis:<0-7>:+` and `axis:<0-7>:-`.
  - Each scheme accepts only its own source kinds.
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
- Saved overrides: the `bindings` field of the saved settings (see Settings and session), in the same shape as the defaults but partial.
  - `main.js` passes `settings.get().bindings` to `attachInput({ bindings })` once at start-up; there is no live rebinding yet (a later rebind screen will add it).
  - `resolveBindings` (`bindings.js`) applies them. Unknown schemes and actions are ignored, an invalid value keeps that action's default, an empty list unbinds it.
  - The store cleans the overrides when it loads them, so only known schemes, known actions and valid source lists reach `resolveBindings`.
  - `input/` never reads storage.
- Players and devices (`PLAYER_DEVICES` in `sampler.js`):
  - Player 1 (index 0) is keyboard + mouse and is always connected.
  - Player 2 (index 1) is on a gamepad with `mapping === 'standard'` and is connected only while that pad is; player 1 also gets a second such pad.
  - Each player keeps the `gamepad.index` it was given while that pad stays connected (`perPlayer[i].padIndex`).
  - A free player slot is filled only from connected standard pads that no player holds, in ascending gamepad index, with slots filled in ascending order of their `pad` number in `PLAYER_DEVICES` (player 2 has `pad: 0`, player 1 `pad: 1`): one pad goes to player 2, a second to player 1.
  - When a player's pad disconnects, a connected standard pad that no player holds fills the freed slot in the same sample; with none, the slot goes empty. Its held actions give `released` on the next tick, except those the replacement pad also holds; unplugging one pad never moves another player's pad.
  - Non-standard pads are listed as ignored in the input panel; standard pads beyond the two assigned are not used.
- Frame, one per player per tick, plain data, new objects every tick: `{ player, connected, actions: { [action]: { held, pressed, released } }, aim, wheel, pointer, activated }`.
  - `pointer` is `{ x, y, width, height, moved }` for keyboard + mouse players (mouse position and canvas size in CSS px, top-left origin, y down; `moved` is true only on the first tick after a move) and `null` for gamepad-only players.
- `activated`: true on the first tick after one or more presses that the browser counts as user activation (they unlock sound), for keyboard + mouse players only; gamepad buttons never set it, so a gamepad-only frame is always false.
  - Counted presses (HTML spec, activation-triggering input events), all in `dom.js`:
    - A `keydown` whose `key` is not `Escape`, not a key repeat and not in a text field
    - A `mousedown` on the canvas (this also covers `pointerdown` from a mouse)
    - A `pointerup` on the canvas whose `pointerType` is not `mouse`
    - A `touchend` on the canvas
  - Where `navigator.userActivation` exists, a press counts only when `navigator.userActivation.isActive` is true inside the listener.
  - The count is a latch in `devices.js` (`activate`), cleared after each sample.
  - The touch listeners are passive and block nothing.
- Edge rules, per action, from all its bound sources on the player's devices:
  - `held` = any source down now, or a source that went down and up again since the last tick (a tap), or a wheel step since the last tick.
  - `pressed` = held now and not held last tick, or a wheel step this tick, or a new tap or press after a tick on which the action was held only by a tap or a wheel step.
  - `released` = held last tick and not held now, or that same new tap or press (the earlier tap or wheel step ends on the tick the new one starts).
  - So an action is pressed only when it goes from no bound source held to at least one, and released only when the last held source is let go.
  - Pressing, tapping or releasing a second source while another is held gives no edge (except a wheel step, which always gives `pressed`), and neither does releasing and pressing the same key again between two ticks.
  - A tap shorter than one tick is held for exactly one tick (pressed on it, released on the next); taps on consecutive ticks each give their own press.
  - When one render frame runs several ticks, only the first sees a press.
  - Key repeat adds no press.
  - Window blur and a hidden tab release everything.
- Gamepad sources:
  - Buttons 6 and 7 (triggers) are down when their value is above 0.3, other buttons when pressed.
  - `axis:i:±` is down when the axis value reaches 0.5 (`axisThreshold`) in that sign.
  - The 0.25 dead zone (`deadZone`) is radial and applies only to the aim stick.
  - A pad that disconnects gives `released` for its held actions on the next tick.
- Aim: radians, y up (0 = right, +π/2 = up on screen), range (-π, π], starts at 0.
  - Mouse: when the mouse moved since the last tick, the angle from the player's aim origin to the pointer.
  - The aim origin defaults to the canvas centre; a scene sets it in `draw` with `view.setAimOrigin(player, x, y)` (CSS px of the canvas).
  - Otherwise the right stick (axes 2, 3) sets the angle when its length is at least 0.25 (radial dead zone).
  - Otherwise the angle is unchanged.
  - So a moved mouse wins over the stick in the same tick.
  - The harness clears every aim origin before each frame's draw, after that frame's ticks, so an origin is only kept while a scene that sets it is drawn.
- Wheel: `frame.wheel` is the signed count of wheel steps since the last tick (+ = scroll down; keyboard + mouse players only).
  - Several notches can land in one tick, so weapon cycling reads `frame.wheel` for the mouse wheel.
  - `nextWeapon` and `previousWeapon` are pressed on every tick that has at least one step in their direction (`wheel:+`, `wheel:-`) and by their gamepad buttons.
  - Weapon cycling per tick: `frame.wheel` when it is not 0, otherwise `nextWeapon.pressed` minus `previousWeapon.pressed`; a bumper press on the same tick as a wheel step is folded into that step.
  - Reading the wheel (`devices.js`, settings in `WHEEL_SETTINGS` in `actions.js`):
    - An event with zero distance (including -0) is ignored and is not activity.
    - Pixel mode: a `deltaY` that is a non-zero whole multiple of `notchPixels` (120) is mouse-wheel notches, `deltaY / 120` steps at once (240 = 2), no lock.
    - Pixel mode: any other distance is a touchpad swipe, one step once it covers `swipePixels` (40) in one direction, then no more steps until the swipe ends (`swipeEndMs`, 120 ms, without an event that has distance) or reverses direction (a reversal starts a new swipe at once).
    - Line and page modes: one step per event, or `|deltaY|` steps when that is a whole number above 1.
  - The rule is tested by replaying recorded Chrome-on-Linux mouse-wheel and touchpad events (`game/test/fixtures/wheel-recordings.json`).
- Harness: `createHarness({ input, onInputs })`.
  - `input.sample()` runs once per step, even when no scene ticks; `onInputs(inputs)` runs right after, before the scenes tick.
  - `harness.lastInputs` holds the last tick's frames.
  - The harness's `input` is the net session's wrapper (`net.wrapInput(input)`, see Networking): while a guest is connected, a host's player 2 frame (`inputs[1]`) is the guest's input instead of the local gamepad player 2. `window.__b7.input` stays the raw input.
  - `main.js` passes `togglePauseOnPress` (`pause-toggle.js`) as `onInputs`: any player's `pause` press (Escape, gamepad Start) opens the `pause` overlay, or closes it when open.
  - A press opens it only when there is no main scene or the main scene's `pausable` setting is true (the main menu is not pausable, so Escape never opens pause on the menu screens).
- Browser wiring (`dom.js`, `attachInput`):
  - Keyboard by `event.code` on the window (keys typed into text fields are ignored; Space, arrows and Tab do not scroll or move focus).
  - Mouse buttons on the canvas, released on the window.
  - `pointerup` and `touchend` on the canvas only for `activated`.
  - Context menu and side-button navigation blocked.
  - Mouse position from the window relative to the canvas (the canvas size is read on every sample, so it follows resizes).
  - Wheel on the canvas (default blocked).
  - Gamepads polled on each sample.
- Many laptops disable the touchpad while keys are held, so aiming with the touchpad while moving may not work on some laptops. This is not worked around (see D-092).

## Debug tools

- Debug panel (`game/src/debug/panel.js`):
  - Top-right, collapsed at start.
  - Has a "Main menu" button and buttons for each harness behaviour, including the test scenes ("Players scene (input test)", the A / B switch and the slow scene), which add the backdrop.
  - The "Sandbox" button (`data-action="sandbox"`) leaves the backdrop if it is there and fades to the Sandbox (see Sandbox). "Main menu" is the way back.
  - While the Sandbox is the main scene the panel shows its Sandbox section (`.b7-sandbox`): a Map select (`#b7-map`, reloads the scene), a City backdrop checkbox (`#b7-city`, 2.5D, on by default), a Grid checkbox (`#b7-grid`, off by default, not saved), a Row switch select (`#b7-row-scheme`: A "crouch→jump / air crouch grabs up", default, or B "double crouch / double jump, air crouch grabs up"; see Depth rows), a "Camera follows row depth" checkbox (`#b7-row-camera`, on by default, disabled in 2D), view mode buttons "2D (ortho)" and "2.5D (perspective)" (`button[data-view-mode]`, `aria-pressed` on the active one), a zoom slider (`#b7-zoom`, 8 to 28 tiles high, step 1, value in `[data-value="zoom"]`) a FOV slider (`#b7-fov`, 1 to 130 degrees, step 1, value in `[data-value="fov"]`, disabled in 2D), "Camera X" / "Camera Y" offset sliders (`#b7-cam-x`, `#b7-cam-y`, -4 to +4 tiles, step 0.25, values in `[data-value="cam-x"]` and `[data-value="cam-y"]`), the aim-follow sliders Follow, Min, Max, X scale, Y scale up, Y scale down, Smoothing (`#b7-follow-<key>`, values in `[data-value="follow-<key>"]`), and a read-only Inventory line (`[data-value="inventory"]`: `P1: empty` or the item ids comma-joined, and `P2: ...` when slot 1 exists; refreshed with the panel, from the `sandboxState` getter `main.js` passes). `[` zooms out and `]` zooms in by 2 tiles per press, from a window `keydown` listener in the panel (debug tooling, not game input; ignored while typing in a text field). They work whether the panel is open or not.
  - Buttons give up focus after a click, so keys go to the game.
  - The "Fail slow scene's next load" button makes the slow scene's next `load()` throw after tracking and acquiring resources; the error message gives the GPU texture count at the moment of failure.
  - The `leftState` and `returnedState` fields on each harness record are JSON copies of the state kept for the panel's identical-state check; `test/harness.test.js` also reads them.
- Networking in the panel:
  - The `go-online` button (`button[data-action="go-online"]`): "Go online" calls `net.host({ transport })` and sets play mode `online`; while hosting it reads "Go offline" (`net.leave()`, play mode `local`); as a guest it reads "Leave game" (leaves; `main.js` takes the guest back to the main menu).
  - Network section (`.b7-net`, always shown): while hosting, the room code (`[data-value="room-code"]`), a "Copy invite link" button (`button[data-action="copy-invite"]`; `navigator.clipboard.writeText`, or else the link text `[data-value="invite-link"]` is selected) and the link itself (the page URL with `room=CODE`, keeping `net=local`, dropping `lag`). Values `[data-value="net-<key>"]`: `role`, `code`, `state` (offline, creating room, waiting, guest joined, guest left, failed, connecting, connected, ended, with the reason), `connection` (`—` while not connected; `local (BroadcastChannel)` on the local transport; over PeerJS the `connectionTypeLabel` of the selected ICE pair, asked every 3 s through `net.connectionStats()`, `…` before the first answer, a stale answer after a disconnect or reconnect ignored), `ping` (ms), `offset` (estimated tick offset), `msgs-in`, `msgs-out`, `bytes-in`, `bytes-out` (per second), `lag`. Refreshed with the panel.
- The panel also shows `[data-value="settings"]` (JSON of `settings.get()`) and `[data-value="session"]` (JSON of the current session, or `none`), refreshed with the other values (every 250 ms).
  - The "Reset settings" button (`button[data-action="reset-settings"]`) calls `settings.reset()` (everything but `progress` goes back to its default).
- `window.__b7` (for debug checks only; it is not a game API) exposes:
  - The harness
  - The renderer
  - The asset cache
  - The loader (`window.__b7.loader.status('boot')`)
  - Input (`window.__b7.input`, the object `attachInput` returns)
  - Music (`window.__b7.music.debug`: `element`, `created`, `wanted`, `volume`)
  - The settings store (`window.__b7.settings`) and the session holder (`window.__b7.session`)
  - The picked menu poster key (`window.__b7.poster`, `poster.classic` or `poster.thrash`)
  - The net session (`window.__b7.net`: `role()`, `state()`, `code()`, `stats()`, `netView()`, `localTick()`)
- Input panel (`game/src/debug/input-panel.js`):
  - `#b7-input`: 340 px wide (at most the window width less 16 px); top-left; bottom-left (24 px up, clear of the bottom-right version label) on windows up to 760 px wide; collapsed by default at every width.
  - Toggled by `#b7-input-toggle`.
  - Per player `[data-player="0"]` and `[data-player="1"]`:
    - `[data-field="device"]`
    - `[data-field="aim"]` (degrees)
    - `[data-field="wheel"]` (running sum of `frame.wheel`: signed, steps down minus steps up)
    - One row per action `[data-action-row="<action>"]` with attributes `data-held` (`true` or `false`), `data-pressed` and `data-released` (running counts)
    - Each row also has `[data-field="key"]`: a coloured chip with the primary binding (first source of the resolved bindings) for the player's scheme (player 1 keyboard + mouse, player 2 gamepad), brighter while held, hidden when unbound; labels come from `debug/binding-labels.js`
  - Also `[data-field="ignored"]` (ignored gamepads) and `[data-field="pad-event"]`.
  - Refreshes every 100 ms.

## Networking (`game/src/net/`)

Model: host-authoritative, two players, Sandbox only for now (T-109). The host's browser runs the game and sends snapshots; the guest sends one input message per tick; each player's own movement is predicted (the guest reconciles on each snapshot); the other player is interpolated on the guest; a shared clock is estimated from pings. The fixed 60 Hz tick, plain-data state and per-tick input frames are unchanged: the transport stays outside the scenes, and a remote player's input reaches the host's Sandbox as player 2's frame (`inputs[1]`).

- Modules. Pure ones take time functions, timers, channel constructors and random sources as parameters and never touch `window`, `document`, `performance`, `BroadcastChannel` or PeerJS, so Node tests run them.
  - `codec.js`: the only code that builds or parses wire messages (see below).
  - `online-libs.js`: re-exports PeerJS's `Peer` and msgpackr's `Packr`; the one lazily loaded module for going online (one chunk, loaded on host or join). Nothing imports it statically, so solo play never downloads PeerJS or msgpackr.
  - `lazy-transport.js`: `withCodec(transport, load = loadCodec)` wraps a transport (same `kind`, `host`, `join`): each awaits `loadCodec()` (so the online chunk), then starts the inner transport unless closed meanwhile; a failed load gives `onError('unsupported')`; `close()` works before and after the start. `main.js` wraps the chosen transport with it.
  - `room-code.js`: `ROOM_ALPHABET` (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, no 0, O, 1, I), `ROOM_CODE_LENGTH` 6, `makeRoomCode(randomUint32s)`, `cleanRoomCode(text)` (uppercase, no spaces or dashes), `isRoomCode(text)`, `inviteUrl(href, code)`.
  - `link.js`: wraps a raw byte channel (`createRawChannel`; data is `Uint8Array`) into a checked link: receive drops anything that is not a `Uint8Array` (counted as 0 bytes) or is over `MAX_MESSAGE_BYTES` (2048 bytes), beyond `MAX_MESSAGES_PER_SECOND` (200) in a 1 s window, and whatever the codec rejects; send encodes, then delays by `lagMs` (0 to 2000) in order; stats are messages and bytes per second in and out (rolling 1 s) and `lastReceived`; no message for `TIMEOUT_MS` (5000) closes it as `dropped`; `close(reason)` and `onClose(reason)` happen once (lagged sends still waiting go out at close, so a `bye` is not lost). `createRawChannel({ send, close, getStats })`: the optional `getStats` makes `channel.getStats()` return its result (a promise) or null (none, or closed).
  - `transport-local.js` (`?net=local`): a BroadcastChannel `b7-net-v7-<CODE>` between tabs of one browser. A joiner posts `{ k: 'join', from }`; the host answers `{ k: 'accept', from, to }`, or, with a guest already, a `reject full` codec message and nothing else. Codec bytes travel as `{ k: 'msg', from, to, b }` (a `Uint8Array`, copied by structured clone); `{ k: 'close', from, to }` ends a link. No answer within 2 s: `not-found`.
  - `transport-peer.js` (default): PeerJS 1.5.5 (exact pin), loaded with the dynamic `import('./online-libs.js')`. A raw connection delivers received data as an `ArrayBuffer`; the transport turns it into a `Uint8Array` before it reaches the channel; sends pass the codec's `Uint8Array` to `conn.send`. Host peer id `berserker7-v7-<CODE>` on the public PeerJS server, retried with a new code on `unavailable-id` (up to 4 times); data connection `{ reliable: true, serialization: 'raw' }`. Errors: `peer-unavailable` -> `not-found`; `network`, `server-error`, `socket-error` -> `server`; `browser-incompatible` -> `unsupported`; others `failed`. A join that has not opened after 15 s: `timeout`. A second guest gets `reject full` and is closed. Connections close with a plain `conn.close()` 500 ms after the last message (PeerJS 1.5.5 ignores `close({ flush: true })` on a raw connection), so a `bye` or `reject` leaves first. The host's close also destroys the peer 500 ms later (destroying it at once would lose a `bye` just sent), so a `bye` reaches the guest first. Losing the signalling server after open: `peer.reconnect()`; open connections continue. Its channels pass `getStats: () => conn.peerConnection?.getStats() ?? null` (host and guest); the local transport passes none.
  - Both transports: `host({ makeCode, onReady(code), onGuest(channel), onError(reason) })` and `join(code, { onOpen(channel), onError(reason) })`, each returning `{ close() }`.
  - `clock-sync.js`: samples from pongs; RTT = received - sent; remote tick now = remoteTick + (RTT / 2) / step ms; offset = that - local tick. Arrival offset = remoteTick - local tick (no RTT term): the remote tick of data arriving now; pongs come the same way as the remote's other messages (snapshots, on the guest), so it holds also when the two directions have different delays. The smallest-RTT sample of the last 16 is used for both. `estimate()` gives `{ rttMs, offsetTicks, arrivalOffsetTicks, samples }` (both offsets 0 before the first sample).
  - `prediction.js`: an input history (`{ tick, frame }`, at most 120) with `record`, `after(ack)`, `drop(ack)`; `reconcile(confirmed, entries, step)` copies the confirmed player and replays the entries.
  - `interpolation.js` (one buffer for the host player; `session.js` keeps one per enemy id, see `remoteEnemies()`): a buffer of `{ tick, player }` (host ticks, at most 32, ordered; duplicates and older ticks ignored). `sampleAt(tick)` lerps x, y, vx, vy (and `depth` when both entries have one) between the two entries around it, turns the aim the short way, and takes every other field (booleans, size, row, hop, health, inventory, melee ticks and direction) from the earlier entry; before the oldest it gives the oldest, after the newest the newest (no extrapolation). `INTERP_DELAY_TICKS` 6 (100 ms) behind the newest host tick arriving now (the receive-side clock), so three snapshot intervals of buffer at any delay.
  - `connection-type.js`: pure `connectionTypeLabel(report)` turns an `RTCPeerConnection.getStats()` report into `<local> ↔ <remote> <protocol>` (e.g. `srflx ↔ srflx udp`) from the selected ICE candidate pair (Chrome: `transport.selectedCandidatePairId`; Firefox: `selected`; else `nominated` and `succeeded`). Candidate types: `host` same network, `srflx` direct through NAT (STUN), `prflx` direct (found during connection checks), `relay` through TURN (then ` via <address>:<port>` of the relay candidate). `?` for an unknown type; null when no pair or candidate is found.
  - `session.js`: the net session (below). `connectionStats()` returns the current channel's `getStats()` (a promise, or null) only while a peer is connected (host `joined`, guest `connected`).
- Codec rule: `codec.js` is the only code that builds or parses wire messages; `encode(msg)` gives a `Uint8Array` (its own buffer) of plain MessagePack and `decode(bytes)` reads it, via msgpackr 2.1.4 with records and extensions off, maps as plain objects and the smallest map header (`variableMapSize`), so a later move to quantised integers changes only this file. msgpackr loads lazily: `await loadCodec()` first (one-time; a failed load can be retried); `encode` and `decode` throw until then (`codecLoaded()` tells). One frozen table `MESSAGES` gives each type `t` a flat, explicit field list `{ name: spec }`; specs are integer or number with min and max, boolean, enum of strings, or short string matching a pattern. No nested objects or arrays; player and enemy fields are per slot (`x0, y0, vx0, ...`, `x1, ...`; `ex0, ey0, ew0, ...`). `decode` returns null for anything that is not a `Uint8Array` (strings included), more than `MAX_MESSAGE_BYTES` (2048) bytes, an unpack error (including truncated input and trailing bytes), a value that is not a plain object, an unknown `t`, a missing or wrong-typed field or a non-finite number; numbers are clamped to their range, integers rounded and unknown fields dropped, into a new plain object. `encode` runs the same checks and throws (a malformed outgoing message is our bug). Helpers next to the table build each message and turn an input frame into `{ held, pressed, aim }` bit masks over `ACTIONS` (fewer than 31 actions, checked at import) and back (`released` from the previous held mask; `pointer: null`, `wheel: 0`, `activated: false`, `connected: true`), and Sandbox players and enemies into a snapshot and back. Nothing else builds message objects by hand.
- Messages (`PROTOCOL_VERSION` 7: players carry health, inventory and melee, enemies carry health; 6: players' hops carry `hf`, a fall; 5: players carry row, hop and press ages, `input` carries the row scheme; 4: enemies carry `id` and `type`; 3: `snap` gained `wt` and enemies; 2 was the first MessagePack version, 1 JSON text). Each time a message changes in a way an older build would misread, the version, the peer id prefix and the local channel name change together, so an older build finds no room (`not-found`) instead of failing silently:

  | Type | Direction | Fields |
  |---|---|---|
  | `hello` | guest -> host | `v` protocol version |
  | `welcome` | host -> guest | `map` (one of `SANDBOX_MAPS`), `slot` (1), `tick` (host tick) |
  | `reject` | host -> guest | `reason`: `full` or `version` |
  | `map` | host -> guest | `map` (the host changed map) |
  | `input` | guest -> host | `tick`, `held`, `pressed` (bit masks), `aim` (radians, clamped to ±π), `rs` row scheme (`A` or `B`; the frame's `rowScheme`, back as `rowScheme` from `frameFromMasks`, `A` when missing) |
  | `snap` | host -> guest | `tick`, `ack` (last guest input tick applied, or -1), `wt` (the host's Sandbox world tick, `state.ticks`), `n` (1 or 2), then per slot `x`, `y` (±100000), `vx`, `vy` (±1000), `g` onGround, `c` crouching, `a` aim, `r` row (±64), `h` hop active, `ht` hop target row, `hn` hop ticks done (0 to 15), `hy0`, `hy1` hop start and landing y, `hf` the hop is a fall, `pd`, `pj` down and jump press ages (0 to 255), `hp` health (0 to 100), `iv` inventory bit mask over `ITEMS` (0 to 2^`ITEMS.length` - 1, so 0 for now), `mt` melee ticks (0 to 18), `md` melee direction (-1 or 1; 0 in an empty slot, read back as 1); no hop: zeros and false; `ne` (0 to `MAX_ENEMIES` 16), then per enemy slot `ei` id (0 to 65535), `et` type (one of `ENEMY_TYPES`; anything else makes the message invalid), `ex`, `ey` (±100000), `ew` awake, `eh` health (0 to 30): the full enemy list every time. Empty slots are zeros (type `walker`). An id repeated in one snap is dropped on decode (the first kept). 1254 bytes at worst, 1146 with this level's 10 enemies (all extremes) |
  | `ping` | both | `id`, `time` (sender's clock, ms) |
  | `pong` | both | `id`, `time` (echoed), `tick` (the replier's tick) |
  | `bye` | both | none |

- Net session (`createNetSession`, one object created in `main.js`, outside the scenes):
  - Holds the role (`null`, `host`, `guest`), room code, state, link, input history, clock estimate, interpolation buffer and local tick.
  - `host({ transport })`: states `creating`, `waiting`, `joined` (a guest is connected), `left` (the guest left; still hosting, waiting for a new one), `failed` (with a reason). A `hello` with another version gets `reject version` and the link closes.
  - `join(code, { transport })`: states `connecting`, `connected`, `ended` with a reason: `invalid` (checked before anything else, even before leaving the current session), `not-found`, `full`, `version`, `dropped`, `host-left`, `server`, `timeout`, `unsupported`, `failed`, or `left` (left on purpose). With a session active (host or guest) an invalid code changes nothing: no state change, no event. Returns false for an invalid code, true when a join started.
  - `leave()`: sends `bye` and closes; `main.js` also calls it on `pagehide`, for both roles.
  - `wrapInput(input)`: the harness's input. `sample()` calls `input.sample()`, counts the local tick, then as a host with a guest replaces `frames[1]` with the guest's frame for this tick, and as a connected guest records `frames[0]` in the history under the local tick and sends it as an `input` message.
  - Host guest-input queue (`createGuestInputQueue`): inputs are appended in tick order (ticks not newer than the last queued are ignored); each host tick consumes one, starting once 2 are queued (jitter buffer). Each entry carries its `rs` into the frame's `rowScheme`. While empty the last `held`, aim and `rs` repeat with no presses, `ack` does not advance, and it waits for 2 again. Over 8 queued, the oldest is dropped and its `pressed` mask ORed into the next, so a jump is never lost (a scheme A descend whose down and jump merge into one frame still counts, see Depth rows; a scheme B double press merged into one frame is lost, and so is an air grab whose crouch merges with the jump press made on the ground before it; a guest prediction of either is corrected by the next snapshot). `ack` is the tick of the last consumed entry. The guest's `pause` is masked out, so it never opens the host's pause overlay. The guest's frame is `inputs[1]` only while the Sandbox is the active main scene (`sandboxState()` not null); on any other screen slot 1 gets the same frame with `connected: false`, so a guest cannot select menu items on the host.
  - `afterFrame(now)`, called by `main.js` after each `harness.frame`: as a host with a guest, every 2nd local tick (30/s) while the Sandbox is the active main scene, a `snap` of its players and enemies (read from the harness record) with `ack` and `wt`, preceded by `map` when the Sandbox's map differs from the last one sent; both roles send a `ping` every 500 ms and answer pings with `pong`.
  - `netView()` (for the Sandbox; plain data and pure queries): `role()`, `localSlot()` (1 for a connected guest, else 0), `peerPresent()`, `takeSnapshot()` (newest unapplied snapshot `{ tick, ack, wt, players, enemies }` or null; older unapplied ones are dropped), `inputsAfter(ack)`, `remotePlayer()` (the host player interpolated at the draw tick, local tick + arrival offset - 6, with `depth`, its drawn depth (`playerDepth`, added when the snapshot is buffered); or null before the first snapshot), `remoteEnemies()` (the host's enemies `{ id, type, x, y, vx, vy, aim, awake, health }`, one interpolation buffer per id with `vx`, `vy`, `aim` 0, sampled at the same tick, in first-seen order; per snapshot a new id gets a buffer from the snapshot's data, a known id gets the new position, a known id missing from the snapshot is removed with its buffer; null before the first snapshot, cleared to null on a `map` message and in `resetPeerData`). `remoteWorldTick()` (the host world tick those two are sampled at: the draw tick, never past the newest snapshot since the interpolation holds there, plus the newest snapshot's `wt - tick`; null before the first snapshot). `OFFLINE_NET.remoteEnemies` and `remoteWorldTick` give null.
  - `stats()`: role, code, state, reason, ping ms, offset ticks, messages and bytes in and out per second, lag.
  - Events (`subscribe(fn)`): `state`, `connected` (with the host's map), `ended` (reason, and whether it had connected), `map` (the host changed map; `main.js` reloads the guest's Sandbox), `host-failed`.
- Start-up options (`parseNetOptions`, read once in `main.js`): `?net=local` uses the BroadcastChannel transport, otherwise PeerJS; `?lag=ms` (0 to 2000) delays every send from that page; `?room=CODE` is an invite link (see Start-up).
- Hidden tab: browsers stop `requestAnimationFrame` in a hidden tab, which would freeze a host in the background. While a session is active and `document.hidden`, a tiny inline Blob worker posts 60 ticks a second and each one runs `harness.frame` and `afterFrame`; it stops when the tab is visible again.
- Codec benchmark: `game/tools/bench-codec.mjs` (`npm run bench:codec -- --iterations N`) compares JSON, `@msgpack/msgpack` and `msgpackr` (plain MessagePack, native addon off) on the snapshot and input messages, as sent today and quantised (1/256 tile, 1/65536 turn): bytes, encode and decode time, payload bytes per second; it checks every round trip first. `@msgpack/msgpack` is an exact-pinned dev dependency; `msgpackr` (exact 2.1.4) is a runtime dependency, used by the codec.
- Not built yet: Ready / Start / drop-in lobby, projectiles, world re-simulation (T-110), an integer wire format, TURN configuration, lag compensation or guest-decided hits (T-112).
