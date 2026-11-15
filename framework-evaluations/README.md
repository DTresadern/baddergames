# Framework evaluation: three.js vs PixiJS

One procedural scene (the Technophage "surface megacity") built four ways — three.js 2D,
three.js 3D, PixiJS 2D, PixiJS 3D — and measured with one benchmark harness.
No bitmap images: geometry, shaders, particles and lights are all made in code.

Status: three.js 2D is built. The other three pages are placeholders.

-----

## Layout

| path | what |
|---|---|
| `shared/scene.js` | framework-neutral scene description: `buildScene(seed, stress)` plus pure time helpers |
| `shared/stress.js` | stress axes (rain, lights, objects) and URL parsing |
| `shared/bench-hook.js` | in-page instrumentation, identical in every build (`window.__bench`) |
| `shared/palette.js`, `shared/rng.js` | named colours, seeded PRNG |
| `threejs/`, `pixijs/` | one Vite project each; pages `2d.html` and `3d.html` |
| `<framework>/src/<mode>/main.js` | bootstrap, bench hook wiring, frame loop |
| `<framework>/src/<mode>/layers/` | one module per scene element group |
| `<framework>/src/<mode>/effects/` | reusable drawing helpers and shaders |
| `bench/run.js` | build, bundle sizes, benchmark, screenshots |
| `bench/report.js`, `bench/loc.js` | markdown tables from results; lines of code |
| `bench/results/results.json` | committed summary of the last runs |
| `screenshots/` | captures at `t=12`, 1800x600 |

-----

## Commands

Run from `framework-evaluations/`.

1. Install: `npm ci`
2. Build both projects: `npm run build`
3. Type-check (strict, JS with JSDoc): `npm run typecheck`
4. Dev servers: `npm run dev` # three.js on http://localhost:5173, PixiJS on http://localhost:5174
   - open `http://localhost:5173/2d.html`
   - one only: `npm run dev:threejs` or `npm run dev:pixijs`

Page options (all builds): `2d.html?rain=64000&lights=8&objects=1&seed=1&t=12.5`.
`t` freezes the animation at that time in seconds.

-----

## Benchmark and screenshots

The runner drives the dedicated Chromium through the chromium-automation skill's library.
Set `CDP_LIB` to the absolute path of that library's `scripts/cdp.mjs`:

1. `export CDP_LIB=/absolute/path/to/chromium-automation/scripts/cdp.mjs`
2. Smoke test: `npm run bench -- --quick --only threejs-2d`
3. Full run: `npm run bench` # every built page x every stress level
4. Screenshots: `npm run screenshots` # writes screenshots/<framework>-<mode>.png
5. Tables: `npm run report`

Check: `npm run report` prints an Environment table. `GPU` must name the real GPU (not
SwiftShader) and `frame rate uncapped` must be `true`.

If `CDP_LIB` is unset the runner stops with a message. Other options: `--only a,b`,
`--no-build` (reuse `dist/`), `--headed`.

Chromium flags used (recorded in `results.json`):

| flag | why |
|---|---|
| `--ignore-gpu-blocklist --enable-gpu` | without them headless Chromium on this machine used SwiftShader (software WebGL) |
| `--disable-gpu-vsync --disable-frame-rate-limit` | without them `requestAnimationFrame` was capped at 16.7 ms |

-----

## The scene contract (for builders)

- World: x 0..1200, y 0..400, y down, 3:1. `depth` 0 = bridge plane, larger = further (to about 10).
- 2D builds: parallax offset `parallaxOffset(scene, depth, t)`; haze via `hazeAt` / `hazed`.
- 3D builds: `X = x - 600`, `Y = 200 - y`, `Z = -depth * D` (D = camera distance to the
  depth-0 plane); scale X and Y by `(1 + depth)` to keep the 2D composition.
- Time helpers (pure functions of t): `trainX`, `droneState`, `smokeParticle`, `dripState`,
  `rainDropAt`, `cameraX`, `lampFlicker`, `redBlink`. Rain per-drop data: `rainAttributes`.
- Bench hook: `installBench({ framework, mode, version, getFrameworkDrawCalls })` returns
  `{ frameBegin, frameEnd, markFirstFrame, params, setInfo }`. Call `frameBegin()` /
  `frameEnd()` around the render and `markFirstFrame()` after the first render.
  Both frameworks must render with WebGL2.
