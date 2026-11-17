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
- Each `frame(seconds)` in `harness.js`: 1. tick the allowed scenes once per step, in layer order; 2. clear, draw the allowed scenes in layer order, then the fade; 3. apply queued requests in request order, and activate scenes whose load finished; 4. advance the fade and swap the main scene at its midpoint.
- Requests (`setMain`, `bring`, `openOverlay`, `closeOverlay`, `addBackground`, `leave`, `preload`, `setPlayMode`) are always queued. Nothing changes mid-frame, including requests from scene hooks.
- Play modes: `local` and `online`. In `online`, overlays never pause the main scene.
- While the main scene loads, the loading scene is drawn in its place. A fade with nothing to show stays black at its midpoint until the scene is ready.

## Scene contract (`game/src/scenes/`)

- A scene is a plain object from a factory function: `{ settings, load, enter, tick, draw, suspend, resume, exit, unload }`. Missing hooks are no-ops; hook errors are not caught.
- Hooks: `load()` async (build three.js objects), `enter(params) -> state`, `tick(state, inputs, dt) -> state`, `draw(state, view)` (`view` has `renderer`, `width`, `height`), `suspend()`, `resume()`, `exit()`, `unload()` (free everything).
- Lifecycle: `unloaded -> loading -> ready -> active <-> suspended`; any loaded state `-> unloaded`. Illegal changes throw. Only `active` scenes tick and draw.
- Settings: `tick` (`always`, `uncovered`, `never`), `drawCovered` (true or false), `leave` (`suspend`, `unload`, `snapshot`).
- Leave modes: `suspend` keeps state and three.js objects; `unload` drops both and re-enters fresh; `snapshot` keeps a `structuredClone` of the state, unloads, and on return loads and restores that state, then calls `resume()`.
- State is one plain object (numbers, strings, booleans, arrays, plain objects). `tick` changes only the state; `draw` makes the three.js objects match it. No `Math.random` in a simulation.
- Every geometry, material, texture and render target a scene creates goes in its resource list (`resources.js`) and is disposed in `unload()`. Assets shared between scenes go through the asset cache (`asset-cache.js`), released in `unload()`. No GPU objects created per frame.
- Lookups from state entities to three.js objects use a `WeakMap`, so they do not keep old state alive.

The game page shows a debug panel (`game/src/debug/panel.js`) with buttons for each harness behaviour. `window.__b7` exposes the harness, renderer and asset cache for debug checks only; it is not a game API.
