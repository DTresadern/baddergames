# Berserker 7

Sub-project of dev.baddergames. Namespace: `dev.baddergames.berserker7`. Root: `berserker7/` (this folder).

## Where things are

- This folder is part of one git repository for the whole project. The repository root is `../` from here.
- Read the shared instructions too: `../AGENTS.md`.
- Shared skills: `../.agents/skills/`. Namespaces and project settings: `../.mastermind/config.json`.
- Files outside this folder belong to the namespace that contains them. Change them only when your task names them.
- To confirm your namespace, root and the files to read: `../.agents/skills/mastermind/scripts/mm whoami`.

## This sub-project

Berserker 7 is a browser game built with three.js and Vite. It is the successor to the Technophage MVP.

- `game/` - game code. Published at `/berserker7/`.
- `tracker/` - feature tracker. Published at `/berserker7/tracker/`.

Commands, run from `berserker7/game/`:

- install: `npm ci`
- run: `npm run dev` (serves at the URL Vite prints; the version label shows `dev`)
- build: `npm run build` (output in `dist/`, not committed)
- check the build: `npm run preview` (serves `dist/`)

The version label (bottom-left) shows the short commit and UTC build time when built by CI (from `GITHUB_SHA`), and `dev` otherwise.

CI (`.github/workflows/checks.yml`) runs `node --check` on every tracked `.js` file, JSON parse checks, and `npm ci && npm run build` in `berserker7/game/`.
