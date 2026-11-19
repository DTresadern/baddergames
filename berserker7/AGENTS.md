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
- check the build: `npm run preview` (serves `dist/`)

Version label and CI:

- The version label (bottom-right) shows the short commit and UTC build time when built by CI (from `GITHUB_SHA`), and `dev` otherwise.
  - `main.js` hides it (`hidden` attribute) when the `showVersionLabel` setting is false, at start-up and on every change.
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
- `setMain(id, { params, fade, fromAlpha })`:
  - `fade` is the fade duration in seconds (0 = swap at once). The screen darkens over the first half, the scene swaps at the midpoint, and the new scene shows over the second half.
  - `fromAlpha` (0 to 1) is the darkness the fade starts at; by default the darkness of the fade it replaces, else 0.
  - With `fromAlpha: 1` the screen is taken as already black: the swap happens in the frame the request applies and the new scene fades in over `fade / 2`.
- Play modes: `local` and `online`. In `online`, overlays never pause the main scene.
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
  - It shows the poster drawn as cover, a semi-transparent black panel holding three items ("New Game", "Multiplayer", "Options"; only "Multiplayer" and "Options" do nothing), and plays the title music.
  - Each label is drawn once into its own off-screen 2D canvas (never added to the page) and shown as a tracked `CanvasTexture` on a plane.
  - The highlighted item gets a white bar and full opacity; the others are dimmed.
  - `menuLayout` and `itemAt` in `main-menu.js` give the item rectangles and hit test.
- Navigation:
  - `moveUp` / `moveDown` from any connected player move the highlight with wrapping.
  - A moved mouse over an item (`frame.pointer`) highlights it.
  - `jump` and `interact` select the highlighted item.
  - `primaryFire` selects the item under the pointer for a mouse player (a click elsewhere does nothing) and the highlighted item for a gamepad player.
  - Player 1's frame always has a pointer (keyboard + mouse), so a trigger on player 1's gamepad selects only when the mouse is over an item; its A (`jump`) and X (`interact`) still select the highlight.
- Selecting "New Game" opens the New Game screen (see New Game screen); the other items do nothing.
- State fields:
  - `state.selected` (label) and `state.selections` (count) are for debug checks only.
  - `state.request` (`'newGame'` or null, reset each tick) is what the scene's `tick` acts on.
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
  - The menu's `suspend` and `exit` close it.
- The menu while it is open:
  - The menu does not tick (it ignores input) but still draws underneath.
  - In `online` play mode (set only from the debug panel) a covered main scene still ticks, so the hidden menu would react to input there.
- Layout:
  - It shows the shared poster (the one picked at start-up, passed as `poster`; see Main menu), four campaign cards from `src/data/campaigns.js` (Megacity available and preselected; the others dimmed "Coming later" and not selectable), a difficulty list for the selected campaign (default "Inmate") and a "Back" item.
  - `newGameLayout` puts the cards in one row when the view is at least 720 px wide and in a 2 x 2 grid below that, scaled uniformly to fit.
- Navigation:
  - Up and down (wrapping) and a moved mouse move the highlight.
  - Left and right change campaign (available ones only).
  - `jump`, `interact` and a click select.
  - A click on an available card sets the campaign.
  - Back keys: the Back item, Escape and gamepad Start (`pause`), V and gamepad B (`melee`).
  - Selecting a difficulty (any of the four, by mouse or keys) creates the session and saves the last choice (see below), then calls `screens.startGame()`: `main.js` closes the overlay and fades to the Sandbox as the main scene (`GAME_FADE_SECONDS` 2, the total: 1 s to black, 1 s back in). Difficulty has no effect yet.
  - The main menu leaves the main layer at the fade's midpoint (leave `suspend`), and its `suspend` calls `music.stop()`, so the title music stops there.
  - Selecting Back closes the overlay; it creates no session and saves nothing.
- State fields:
  - `state.selected` (`easy`, `normal`, `hard`, `extreme` or `back`) and `state.selections` are for debug checks only.
  - `state.start` is `{ campaign, difficulty }` when a difficulty was selected in the tick (the last one wins), else null; it is reset each tick.
  - `state.request` is `'back'` when Back was selected at any point in the tick (so a later selection in the same tick cannot cancel it), and the scene's `tick` closes the overlay on it.
- Opening and saving (`createNewGame({ screens, settings, session, poster })`):
  - `enter` calls `initNewGame(settings.get().lastChoice)`: the saved campaign if it is an available campaign, else the first available one (Megacity); the saved difficulty if it is one of `DIFFICULTIES`, else `DEFAULT_DIFFICULTY`.
  - The scene's `tick`, when `state.start` is set: `session.set(createSession(state.start))`, `settings.set({ lastChoice: { ...state.start } })`, then `screens.startGame()`; then the Back handling (a Back in the same tick also closes the overlay).
- Its leave setting is `unload`, so closing frees its labels and each open starts fresh. The poster stays loaded because the main menu still holds it.

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
- Adding an asset: put the file under `game/public/content/...`, add an entry to `ASSETS` with its groups, and in code use `acquireTexture(context.acquire, key)` for a texture, `acquireMap(context.acquire, key)` for a map or `assetByKey(key).path` for music.

## Sandbox (`scenes/sandbox.js`, `world/`)

A test scene: a tile map and a box player that runs and jumps. Experimental.

- Units: one world unit is one tile. Positions, sizes and speeds are in tiles (speeds tiles/s). x is right, y is up. The 64 px `tileSize` in the map file is art data; physics never uses it.
- Map files (`public/content/maps/`, manifest group `sandbox`): `{ format: 1, name, tileSize, legend, grid, spawns }`.
  - `walkway.json` (`map.walkway`): a floor 2 tiles thick and 60 long, a wall 8 tiles tall (6 above the floor) at each end, 16 rows in all, the player spawn on the floor near the left end.
  - `mvp-upper-1.json` (`map.mvp-upper-1`): the ground of the old MVP's first level (zone 0, seed 72, MVP columns 0 to 160), solid tiles only, 162 x 22 tiles: platforms, ladders, hazards, liquids, gates and entities dropped; breakable blocks set into the ground slab kept as solid; solid pieces not connected to the ground dropped; a full-height wall at each end. One-off conversion; no generator is kept in the repository. The Sandbox loads this one (`MAP_KEY` in `scenes/sandbox.js`).
  - `legend` maps one character to `{ type, color }`; `type: "solid"` blocks the player. A character not in the legend (use `.`) is empty.
  - `grid` is a list of strings written top to bottom; the loader flips it, so the last string is y = 0 and the column index is x.
  - `spawns` is a list of `{ type, x, y }` in tile coordinates with y up (the same coordinates the loader produces). A `player` spawn is the tile the player's feet stand in: the box is centred on tile column `x` and its bottom is at `y`.
- Tile map (`world/tilemap.js`, `createTileMap({ types })`): sparse chunks of 32 x 32 tiles (`CHUNK_SIZE`) in a `Map` keyed `"cx,cy"`; each chunk is `{ cx, cy, tiles: Uint16Array }`. Tile id 0 is empty; `types[id]` is `{ solid, color }`.
  - `setTile(x, y, id)`, `tileAt(x, y)` (a missing chunk reads 0 and is not created), `isSolid(x, y)`, `chunks()`, `chunkSize`. Coordinates are integers; negative ones work.
  - It knows nothing about files. The tile map is level data, not scene state: it is built in `load()` and passed to the tick function, and the scene state stays plain data (`{ ticks, map, player }`).
- Grid loader (`world/grid-map.js`, `loadGridMap(json) -> { name, tileSize, tiles, spawns }`): throws on a `format` other than 1; legend ids start at 1 in legend order. It is the only code that reads `grid` and `legend`; another file format needs only another loader returning the same shape.
- Player (`world/player.js`, pure, tested in Node): a box 1 tile wide and 2 tall. `{ x, y, vx, vy, onGround, aim }`, with `x, y` the bottom-centre and `aim` copied from `frame.aim` (radians, y up). For now `moveUp` (W, up arrow) also jumps, in `stepPlayer` only; `DEFAULT_BINDINGS` are unchanged so W does not select menu items. `stepPlayer(player, frame, tiles, dt)` moves on x, pushes out of solid tiles, then does the same on y. All movement numbers are in the frozen `MOVE` object at the top of the file (width, height, max speed, ground and air acceleration and friction, gravity, jump speed, max fall speed). There is no swept collision: a step is under half a tile at the fastest fall.
- Scene (`createSandbox()`): `tick: uncovered`, `drawCovered: true`, `leave: suspend`, pausable (Escape opens pause). Player 1 only. Tiles are drawn as one `InstancedMesh` per chunk and tile type; all geometry, materials and meshes are tracked. The camera follows the player's centre and shows `zoom.get()` tiles in height. `zoom` is a holder from `createCameraZoom()` (whole tiles, `CAMERA_TILES_MIN` 18 to `CAMERA_TILES_MAX` 28, default `CAMERA_TILES_HIGH` 22, not saved, so a reload starts at 22 again; the game camera is expected to vary between 18 and 28 tiles high, adjusted per area later, with 22 as the default) that `main.js` creates and passes to both `createSandbox({ zoom })` and the debug panel, so a change shows on the next frame. An aim line (`AIM_LENGTH`, 2 tiles) starts at the head (top centre of the box) and points along `player.aim`; `draw` sets player 1's aim origin to the head with `view.setAimOrigin`, so mouse aim is measured from it (the gamepad right stick sets `frame.aim` too). Pure helpers `initSandbox(map)` and `tickSandbox(state, inputs, dt, tiles)` are for tests.
- Reaching it: the debug panel's "Sandbox" button, or selecting a difficulty on the New Game screen. The debug "Main menu" button goes back.

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
  - While the Sandbox is the main scene the panel shows a zoom slider (`#b7-zoom`, 18 to 28 tiles high, step 1, value in `[data-value="zoom"]`). `[` zooms out and `]` zooms in by 2 tiles per press, from a window `keydown` listener in the panel (debug tooling, not game input; ignored while typing in a text field). They work whether the panel is open or not.
  - Buttons give up focus after a click, so keys go to the game.
  - The "Fail slow scene's next load" button makes the slow scene's next `load()` throw after tracking and acquiring resources; the error message gives the GPU texture count at the moment of failure.
  - The `leftState` and `returnedState` fields on each harness record are JSON copies of the state kept for the panel's identical-state check; `test/harness.test.js` also reads them.
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
- Input panel (`game/src/debug/input-panel.js`):
  - `#b7-input`: top-left; bottom-left (24 px up, clear of the bottom-right version label) on windows up to 760 px wide; collapsed by default at every width.
  - Toggled by `#b7-input-toggle`.
  - Per player `[data-player="0"]` and `[data-player="1"]`:
    - `[data-field="device"]`
    - `[data-field="aim"]` (degrees)
    - `[data-field="wheel"]` (running sum of `frame.wheel`: signed, steps down minus steps up)
    - One row per action `[data-action-row="<action>"]` with attributes `data-held` (`true` or `false`), `data-pressed` and `data-released` (running counts)
  - Also `[data-field="ignored"]` (ignored gamepads) and `[data-field="pad-event"]`.
  - Refreshes every 100 ms.
