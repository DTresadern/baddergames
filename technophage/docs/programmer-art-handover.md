# Technophage: programmer art to replace

14 Nov 2026 · Game version 0.4.0

This lists every visual in the game that is drawn by code ("programmer art") instead of authored artwork, so it can be requested from the art session. Character and enemy animation is already covered by [`handover.md`](../handover.md) and is only listed here where the game needs extra states beyond normal animation.

For each item: what it is, why it exists, how the game uses it, and what to deliver. Code references point to where it is drawn today; the programmer will wire in new art.

-----

## Brief

Replace the code-drawn placeholders with authored pixel art that matches the zone art direction in [`README.md`](../README.md), in this order of importance:

1. **Level tiles** for all five zones: what every player looks at all the time, and what decides whether platforms read clearly.
2. **Interactive level objects**: arena gates, exit lift, checkpoint console, lamps, breakable blocks, liquids.
3. **Weapon effects**: projectiles, muzzle flashes, impacts and explosions.
4. **Pickups and power-ups.**
5. **Background layers**: separated, horizontally tiling parallax layers per zone.
6. **HUD and menu**: logo, panels, icons, crosshair.
7. **Particles and decals.**

-----

## Technical specification

| Item | Value |
| --- | --- |
| Game resolution | 960×540 logical pixels, scaled to the window with nearest-neighbour. Deliver at 1 art pixel = 1 game pixel. |
| Tile size | 32×32 |
| Level size | 22 tiles tall (704 px); 190–280 tiles wide. The camera scrolls both ways. |
| Hunter scale | Sprite frame 75×84 px, collision box 26×60 px, feet at the bottom of the frame |
| Format | PNG with alpha. Hard pixel edges: no semi-transparent fringes or dark halos. |
| Animation | Horizontal strip per animation plus a JSON entry: frame width/height, frame count, fps, pivot point, loop yes/no |
| Lighting | The game darkens every zone and adds coloured light. Art is multiplied by a light map, so supply it at normal brightness, not pre-darkened. Glowing parts (lights, screens, eyes, liquids, projectiles) should come as a separate "emissive" layer so they can be drawn after lighting and still glow. |
| Raw and runtime art | Raw art goes in `generated-art/` with its `.generated.json` record. Runtime-ready files go in `assets/` (via `tools/build-assets.py` or a new export step). |

### Zone palettes currently used by the code

These are placeholders taken from the README colour notes; replace them freely.

| Zone | Tile base / dark / light | Accent | Trim | Sky gradient | Liquid surface / body |
| --- | --- | --- | --- | --- | --- |
| Upper megacity | `#2a2f38` `#14171c` `#4a5361` | `#d8a21c` | `#ff2bd6` | `#05070d` → `#13213a` | coolant `#1fb6c9` / `#0c4f5a` |
| Lower megacity | `#3b3530` `#1b1714` `#6b6155` | `#e0b020` | `#ff3b2b` | `#0b0805` → `#2a1d10` | oil `#6b5a2a` / `#2a2210` |
| Underbelly | `#26302d` `#0f1413` `#45574f` | `#c9b13a` | `#ff2b2b` | `#030606` → `#0e1c1a` | sludge `#8fbf2a` / `#2c3d0a` |
| Caverns | `#2c2838` `#121019` `#4d4560` | `#7cff6b` | `#64e8ff` | `#040309` → `#160f26` | `#8a4cff` / `#2a1050` |
| Infested depths | `#3a1d22` `#160709` `#6b3238` | `#5ff3ff` | `#5ff3ff` | `#070203` → `#230810` | blood `#b0182a` / `#3a0510` |

-----

## 1. Level tiles (`src/tiles.js`)

Every tile is drawn at load time from code: random speckle, seams and rivets, with edges chosen by which neighbours are open. Solid tiles more than one tile from open space are progressively darkened to read as deep mass.

| ID | Tile | Current look | How the game uses it | Deliver |
| --- | --- | --- | --- | --- |
| T1 | **Solid wall/floor**, industrial zones (upper, lower, underbelly) | Grey-blue plates with seams, rivets, vents, pipe segments, grime runs; yellow/black hazard stripes on some top edges | Blocks movement and shots. Top edges are walkable floors. | Per zone: a 47-tile (or 16-tile minimum) autotile set: top edge, bottom edge, sides, inner and outer corners, plus 4–6 interior variants and 2–3 "deep interior" variants. Walkable top edges must read clearly as floor. |
| T2 | **Solid rock**, caverns | Violet-grey blotches, cracks, glowing mineral flecks, green moss fringe on top edges | Same as T1. The cavern and depths zones also grow a random rock ceiling and short stalactites along the top of the level. | Autotile set as T1, plus ceiling-edge and stalactite pieces (1–3 tiles long) |
| T3 | **Flesh/biomass**, infested depths | Maroon with dark veins, cyan nodules, glistening top membrane with drips | Same as T1 | Autotile set as T1, with an organic edge style |
| T4 | **Breakable block** | Pale block with cracks and a small coloured warning panel | Solid until destroyed. 60 health; any weapon or explosion damages it. Hides secret caches and a shortcut. | Intact plus 2–3 damage states. A destruction effect or debris pieces (currently flat-colour square particles). One variant per zone or one generic. |
| T5 | **One-way platform** | Industrial: steel catwalk with grating and a light rail, end caps marked in accent colour. Caverns: timber scaffold with a support post at the ends. Depths: sinew bridge with hanging strands. | Players jump up through it and stand on top. Down + jump drops through. Enemies walk on it. | Per zone: left end, middle, right end. The 32 px tile has a ~10 px visible band at the top, and the walkable surface is exactly the top pixel row of the tile. |
| T6 | **Ladder** | Two rails and rungs every 8 px; yellow-tinted metal, or wood in the caverns | Players climb it; the top of a ladder can be stood on. Usually a vertical run of 4–14 tiles. | Per zone (or industrial and cave): top, middle, bottom pieces. Rungs must read at a glance. |
| T7 | **Hazard spikes** | Industrial: grey metal spikes with red tips on a dark base. Caverns: cyan crystal shards. Depths: bone teeth on red gums. | Touching them does 20 damage and bounces the player up. They sit in floor pits, usually 1–2 tiles deep and 8–14 tiles wide. | One tile per zone style, tiling horizontally, plus optional left/right end pieces |
| T8 | **Toxic liquid** (drawn every frame in `render.js`, `drawGatesAndLiquid`) | Flat colour body; the surface is a row of 4 px blocks bobbing on a sine wave; bubble particles rise. Glows faintly in the lighting pass. | Slows the player, does 12 damage per second, and every jump press is a swim kick. Fills pits 2 tiles deep. | Per zone: animated surface tile (6–8 frames, looping, tiles horizontally), body tile, and an emissive glow layer for the surface |

-----

## 2. Interactive level objects (`src/render.js`, `drawProps` and `drawGatesAndLiquid`)

| ID | Object | Current look | Purpose and interaction | Deliver |
| --- | --- | --- | --- | --- |
| O1 | **Arena gate** | Full-height column (1 tile wide, 19 tiles tall) of dark shutter segments with yellow stripes and a blinking red light per tile. When open, only a dark floor rail shows. | One at each end of every boss arena. Slams shut when a hunter enters the arena and opens when the boss dies. Solid while closed. | Closed, opening and closing animation (6–10 frames), open state. Must tile vertically or come as one 32×608 piece. Emissive red warning light. |
| O2 | **Exit lift** | The pressure-door concept sprite (`door`, 160×79) behind a black/yellow striped deck drawn in code. A small status light: red when locked, green when the boss is dead. A "DESCENDING" progress bar appears in the HUD. | End of every level. Every living hunter must stand on it for 1.5 s to go to the next zone. The lift area is 160×96 px. | Lift platform (160 px wide), doors with closed/open states and an opening animation, status light (red/green, emissive), and optionally a descent animation for the transition |
| O3 | **Checkpoint console** | 24×40 dark box with a striped screen: amber when idle, green when active (pulsing) | Touching it sets the shared respawn point and tops both hunters up to at least 60 health. Two or three per level. | Idle and active states (screen animation 4–6 frames), emissive screen layer. Around 24–32 px wide, 40–48 px tall. |
| O4 | **Lamp fixture** | 18×7 dark box with a coloured 14×2 light strip, hanging from a thin pole; about 30% of lamps flicker | Decoration and the main light source: the code casts a coloured glow and a downward light cone from it. Lamp colours come from the zone palette (magenta/cyan/sodium in the upper city, red and amber below, green/cyan/violet in caves, cyan/red in the depths). | 2–3 fixture designs per zone (industrial hanging lamp, caged bulb, bioluminescent pod for the caverns/depths), each with an emissive part. The light itself stays code-generated. |
| O5 | **Exit and arena markers** | None visible; the arena trigger is invisible. | Optional: something that tells players they are entering a boss arena. | Optional warning sign or floor marking for the arena entrance |

-----

## 3. Weapons and effects (`src/render.js`, `drawProjectiles`, `drawBeams`, `consume`)

All of these are lines, circles and triangles drawn every frame. The glow comes from the lighting pass.

| ID | Effect | Current look | Behaviour | Deliver |
| --- | --- | --- | --- | --- |
| W1 | **Pulse carbine bolt** (default weapon) | 2 px white line, ~18 px long, with an orange glow line | 980 px/s, fired ~9 per second, slight spread | Bolt sprite (~16×4) with emissive core; impact spark (3–4 frames) |
| W2 | **Coil rifle slug** | White line with a cyan glow, trailing up to 260 px | 2,100 px/s, pierces up to 5 enemies, small recoil | Slug head plus trail (or a stretchable trail texture); a heavier impact effect |
| W3 | **Incinerator flame** | Additive circles turning yellow → orange → dark red as they grow from 9 px to ~20 px radius over 0.5 s | ~28 flames per second, rise slightly, pierce enemies, stop at walls | Flame particle animation (6–8 frames, 16–40 px), plus a nozzle flame at the muzzle |
| W4 | **Plasma cutter beam** | Pale cyan glow line plus a jittering white zig-zag core | Continuous beam up to 250 px; stops at walls, cuts breakable blocks, damages everything along it | Beam texture (repeatable segment, 3–4 frame flicker), muzzle and endpoint sparks |
| W5 | **Disc charge** (grenade) | 10×4 grey bar with a blinking red light | Thrown in an arc, bounces off surfaces, explodes after 1.25 s (radius 96) | Spinning disc animation (4–6 frames), blink light (emissive) |
| W6 | **Enemy bolt** | Red or orange 2 px line | Fired by enforcers, mechs and drones at 500–680 px/s | Bolt sprite per colour (or one tintable) |
| W7 | **Acid glob** | Coloured circle, radius 6–7 px, with glow | Lobbed in an arc by moulds, worms, the Brood Matriarch and the Hive Heart; splashes on impact | Glob animation (wobble, 3–4 frames), splash (4–6 frames) |
| W8 | **Mortar shell** | Dark circle with orange glow | Fired upward in arcs by the Enforcement Chassis boss; explodes on impact (radius 80) | Shell sprite with emissive fuse |
| W9 | **Muzzle flash** | Coloured triangle with a white centre, 1–2 frames | Every player shot | Per weapon: 2–3 frame flash, pointing right (rotated in code) |
| W10 | **Shell casings** | 2×2 brass pixels | Ejected by the pulse carbine and coil rifle, bounce on floors | Tiny casing sprite (2–3 frames of spin) |
| W11 | **Explosion** | Bursts of yellow and orange squares, dark smoke squares, a light flash and a scorch mark on the wall | Disc charges, mortars, robot deaths, boss deaths | Small (≈64 px) and large (≈160 px) explosion animations (8–12 frames), smoke puff (6–8 frames), scorch decal |
| W12 | **Weapon held by the hunter** | The weapon concept sprite is pasted over the hunter's own rifle | Shows which of the 4 weapons is equipped | Covered by the hunter rig work; listed so each weapon gets a held version with a grip point and muzzle point |

-----

## 4. Pickups and power-ups (`src/render.js`, `drawPickups`)

Pickups are 22×22 collision boxes that bob up and down and glow. They drop with gravity from crates and enemies.

| ID | Pickup | Current look | Effect | Deliver |
| --- | --- | --- | --- | --- |
| P1 | **Medkit** | 18×14 white box with a red cross | +35 health | Sprite ~18–22 px with an emissive element |
| P2 | **Coil slugs** (ammo) | 18×12 dark box with a cyan stripe | +12 coil rifle ammo | One ammo-case design per ammo type, colour-coded to its weapon |
| P3 | **Fuel cell** (ammo) | Same box, orange stripe | +80 incinerator fuel | As P2 |
| P4 | **Plasma cells** (ammo) | Same box, pale cyan stripe | +50 plasma cutter cells | As P2 |
| P5 | **Disc charges** (ammo) | Same box, yellow stripe | +2 disc charges | As P2 |
| P6 | **Optic camo** (power-up) | 14 px cyan orb, pulsing, with a white bar | 10 s of invisibility; enemies ignore the hunter | Distinct power-up icon, animated (4–6 frames) |
| P7 | **Overdrive** (power-up) | 14 px orange orb, pulsing | 10 s of +30% speed and faster fire | As P6 |
| P8 | Weapon pickups | Already use the weapon concept sprites | Gives the weapon and ammo | Optional: a glow or pedestal treatment so weapons stand out |

The cargo crate already uses its concept sprite (`crate`, 60×25). It needs a **destruction effect**: it currently breaks into flat-colour squares.

-----

## 5. Backgrounds (`src/render.js` `render()`, `src/tiles.js` `makeMidStrip`)

| ID | Layer | Current look | Behaviour | Deliver |
| --- | --- | --- | --- | --- |
| B1 | **Sky** | Two-colour vertical gradient per zone | Fixed | Can stay as a gradient, or a sky image per zone |
| B2 | **Far layer** | The flattened scene concept, blurred and darkened, mirrored every other repeat to hide the seam | Scrolls at 1/8 of camera speed horizontally, slightly vertically. Drawn about 600 px tall. | Per zone: a horizontally seamless far layer (at least 1,920 px wide, about 600 px tall) with no characters or walkable-looking platforms in it |
| B3 | **Mid layer** | Procedural silhouettes: tower blocks with random window dots and neon strips (upper), brutalist blocks and walkways (lower), pipes and tanks (underbelly), stalactites and stalagmites with glowing specks (caverns), rib arches (depths) | Scrolls at 0.35× camera speed; 1,600×740 px strip repeated horizontally; drawn at 80% opacity with fog at the bottom | Per zone: one or two horizontally seamless mid layers (≈1,600×740) |
| B4 | **Foreground layer** | None | — | Optional: sparse foreground silhouettes (pipes, cables, roots) passing in front of the action at >1× scroll, kept out of the play area |
| B5 | **Weather and ambience** | Rain: thin light-blue diagonal lines in screen space (upper and lower zones). Drips from ceilings (caves, underbelly, depths). Rising cyan embers in the depths. | Purely decorative | Rain streak and splash sprites; drip and splash; ember. Optional fog/haze overlay texture per zone. |

-----

## 6. Characters and enemies: extra states not covered by normal animation

| ID | State | Current look | Purpose | Deliver |
| --- | --- | --- | --- | --- |
| C1 | **Hunter downed** | Full hunter sprite rotated 90° on the floor, with a revive progress ring and bleed-out countdown above | A downed hunter can be revived by a partner standing next to them for 1.6 s, or bleeds out after 18 s | Downed pose (loop), revive get-up animation |
| C2 | **Hunter respawn / reconstitute** | Burst of coloured particles | After dying or a wipe | Short materialise effect (8–12 frames) |
| C3 | **Player 2 colour variant** | Player 1 has amber lights; player 2 is an automatic hue shift of the same art to cyan | Telling the two hunters apart | A proper player 2 palette: lights, stripes and accents designed in cyan |
| C4 | **Optic camo** | Hunter drawn at 35% opacity (14% to the partner) with a faint white shimmer | P6 power-up | A camo effect: distortion or shimmer overlay, or a dedicated cloaked sprite treatment |
| C5 | **Hit flash** | Whole sprite flashes white for 0.08 s | Every hit on an enemy or player | Can stay code-generated |
| C6 | **Stalker cocoon** | The stalker sprite upside down, darkened and sepia-tinted, with a thin line up to the ceiling | In cavern zones some stalkers hang from the ceiling and drop when a hunter passes below (from *Abuse*) | Cocoon/hanging sprite, a short idle twitch, and a drop/hatch animation |
| C7 | **Worm burrowing** | Invisible; brown dirt particles show where it travels under the floor. It rises out of the floor, clipped at floor level. | Sewer worms and the Sump Leviathan boss travel hidden, erupt next to a hunter, spit, then dive | Dirt mound or ripple that travels along the floor, an emerge animation and a dive animation (regular and boss size) |
| C8 | **Wall burster spawning** | The burster scales up by 5% and sprays blood particles | It releases a stalker or rat every few seconds while hunters are near | A "birth" animation, and an emissive pulse while active |
| C9 | **Enemy eyes and sensors** | 3×2 px dots drawn after lighting so enemies read in the dark: red for machines, cyan in the depths, yellow otherwise | Readability in dark zones | Built into each enemy's emissive layer |
| C10 | **Drone searchlight** | Code-generated light cone | Drones sweep a light toward their target | Stays code-generated; the drone sprite needs a lamp position |
| C11 | **Gibs** | Random rectangles cut from the enemy's sprite, spinning as they fly | Enemy deaths | 4–6 gib pieces per enemy type (or from the decomposed body parts), plus a charred variant used for fire and explosion kills |
| C12 | **Enemy health bar** | 30×3 px red bar above a damaged enemy | Feedback | Optional styled bar |

-----

## 7. HUD and menus (`src/render.js` `drawHUD`, `index.html`, `style.css`)

| ID | Element | Current look | Purpose | Deliver |
| --- | --- | --- | --- | --- |
| H1 | **Game logo** | "TECHNOPHAGE" in a system monospace font with a soft glow | Main menu, root landing page, browser tab | Wordmark logo (PNG, about 600 px wide, plus a small version) |
| H2 | **Favicon** | Amber "T" on black, inline SVG | Browser tab | 32×32 and 16×16 icon |
| H3 | **Player panel** | 220×58 dark translucent box with a coloured left edge: name, score, 20-segment health bar, weapon name and ammo, slots 1–4, disc count, power-up timers. Top-left for player 1, top-right for player 2 | Status | Panel frame, health bar segments (full/empty/low), small icons: 4 weapons, 4 ammo types, disc, camo, overdrive. Text stays as text. |
| H4 | **Boss health bar** | 420×8 red bar with the boss name above, bottom centre | Boss fights | Styled bar frame |
| H5 | **Crosshair** | 7 px circle with four ticks, in the player's colour. In mouse-only mode, two chevrons beside it show walking direction, and "FIRING" appears under it when fire is toggled on. | Aiming | Crosshair sprite (amber and cyan, or tintable), chevron sprite |
| H6 | **Partner arrow** | Small triangle at the screen edge pointing to an off-screen partner; flashes red when they are downed | Co-op | Arrow sprite, normal and downed states |
| H7 | **Zone title card** | Black band across the screen with the zone name and subtitle in monospace text | Start of every zone | Optional: a title-card frame or per-zone emblem |
| H8 | **Screen overlays** | Red full-screen flash when hurt, pulsing red tint at low health, vignette, 1 px scanlines every 3 px | Feedback and mood | Can stay code-generated; optionally a vignette or film-grain texture |
| H9 | **Menu, lobby and pause panels** | CSS: dark translucent panels with an amber left edge, monospace text, flat buttons | Navigation | Optional: panel frame and button styles (9-slice PNGs) to match the logo |
| H10 | **Menu background** | Darkened upper-megacity scene art | Main menu and lobby | A dedicated title-screen illustration |
| H11 | **Root landing page card** | Hunter portrait plus text (`baddergames/index.html`) | Lists the games | Uses H1 and a game thumbnail (about 400×225) |

-----

## 8. Particles and decals (`src/render.js`, `addP` / `burst`, `LevelArt.decal`)

All particles are coloured squares of 1–4 px. They are small and numerous (up to 1,400 at once), so sprites must stay tiny.

| ID | Particle | Used for | Deliver |
| --- | --- | --- | --- |
| D1 | Blood / ichor drops (colour per enemy) | Hits and deaths. When a drop hits a wall or floor it is stamped onto the level art as a permanent stain. | 3–4 droplet sprites; 4–6 splat decals per colour family (red, ochre, green ichor) |
| D2 | Sparks | Hits on machines, bullet impacts | 2–3 frame spark |
| D3 | Dust | Hard landings | Small dust puff (4–6 frames) |
| D4 | Debris | Breakable blocks, crates, explosions | 4–6 chunk sprites per zone material (metal, concrete, rock, flesh) |
| D5 | Dash streaks | Player dash | Speed-line or afterimage sprite |
| D6 | Liquid bubbles | Liquid surfaces | Bubble pop (3–4 frames) per liquid colour |
| D7 | Scorch marks | Explosions | 2–3 scorch decals |

-----

## Things that should stay code-generated

- The light map: radial glows, lamp and shoulder-lamp cones, searchlights. Only the light-emitting objects need art.
- Hit flash (white silhouette), screen shake, hurt flash, vignette and scanlines.
- All text: names, scores, messages, timers.
- Collision and gameplay sizes. Art can be larger than the collision box, but feet must sit on the floor line and the walkable surface of tiles must stay at the top of the tile.
