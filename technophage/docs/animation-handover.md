# Technophage: animations to replace placeholder motion

14 Nov 2026 · Game version 0.4.0

Every moving character, creature and machine in the game is currently a single still image moved by code: tilted, skewed, bobbed or squashed. This document lists each one, what the code does today, and the animations needed to replace it: the action, how long it lasts in the game, a suggested frame count, and the moments that must line up with gameplay.

Static items such as tiles, pickups, projectiles, the HUD and backgrounds are in [`programmer-art-handover.md`](programmer-art-handover.md). The art session's general brief is in [`handover.md`](../handover.md).

-----

## How to read this

- **Duration** comes from the game code. Where the game decides the timing (an attack wind-up, a dash), the animation must fit that time, or the code timing changes to match.
- **Frames** is a suggestion for frame-by-frame art at the given frames per second (fps). With a skeletal (bone) rig, read it as the number of key poses.
- **Event frame** is the frame where something happens in the game: a projectile spawns, a foot hits the ground, a creature is released. The code needs these numbers.
- **Loop** means it repeats until the state changes.
- The game runs at 60 updates per second; animation playback is independent of that.

-----

## Delivery specification

| Item | Requirement |
| --- | --- |
| Facing | Draw everything facing right. The code mirrors it for left. |
| Anchor | Ground characters: bottom-centre of the feet. Flyers and swarms: centre of the body. Give the anchor per animation, or per frame if it moves. |
| Scale | 1 art pixel = 1 game pixel at 960×540. Keep each character the size of its current sprite (table below) unless agreed otherwise. Collision boxes are separate and will not change. |
| Attachment points per frame | Muzzle (where shots spawn), eyes/lamps (glow points), and for the hunter the shoulder pivot. Give them as x,y in frame coordinates. |
| Emissive layer | Glowing parts (eyes, lamps, screens, muzzle flashes, bioluminescence) as a separate layer per frame, so they glow in the dark zones. |
| Player 2 | Every hunter animation also needs the player-2 palette (cyan lights instead of amber), or a palette-swap map. |
| Format | PNG strip per animation (or an atlas) plus JSON: frame size, frame count, fps, loop, anchor, event frames, attachment points. For a skeletal rig: part images with pivot points, plus the animation data. |
| Hybrid option | The hunter's aim and each gun enemy's weapon can stay rotated by code if the rig keeps arms/weapon as separate parts with a shoulder pivot. Legs, body, heads and creature motion should be animated. |

### Current sprite and collision sizes (pixels)

| Character | Sprite | Collision box | Speed |
| --- | --- | --- | --- |
| Hunter | 75×84 (legs and torso are separate images) | 26×60 | 235 px/s run (×1.3 with overdrive), 620 px/s dash, 170 px/s climb |
| Techno-rat | 60×32 | 44×26 | 215 px/s |
| Xenophage stalker | 104×60 | 70×48 | 265 px/s |
| Insectoid mutant | 120×78 | 84×64 | 105 px/s, 420 px/s charging |
| Augmented enforcer | 57×80 | 30×76 | 120 px/s |
| Industrial mech | 154×132 | 96×124 | 55 px/s |
| Security drone | 88×54 | 70×38 | 150 px/s (flying) |
| Nano-swarm | 72×59 | 44×40 | 240 px/s (flying) |
| Sentient mould | 96×46 | 86×34 | stationary |
| Wall burster | 174×112 | 120×100 | stationary |
| Sewer worm | 132×69 | 100×56 | 170 px/s underground |
| Spire Gunship (boss) | 176×108 | 150×80 | 120 px/s (flying) |
| Enforcement Chassis (boss) | 309×264 | 200×250 | 45 px/s |
| Sump Leviathan (boss) | 264×138 | 200×112 | 200 px/s underground |
| Brood Matriarch (boss) | 240×155 | 170×130 | 130 px/s, 520 px/s charging |
| Hive Heart (boss) | 348×224 | 250×210 | stationary |

-----

## Placeholder motion in the game today

These are the transformations to be replaced (code: `drawPlayer` and `drawEnemy` in `src/render.js`).

| Who | What the code does now |
| --- | --- |
| Hunter, running | Legs image skewed side to side (±0.14) on a sine wave, plus a 2 px bob. The "wiggling feet". |
| Hunter, in the air | Legs squashed to 95% height |
| Hunter, climbing | Legs skewed by ±0.08 as the hunter moves up and down |
| Hunter, aiming | Whole upper body (head, torso, arms, rifle) rotated around the chest, up to ±83°. Beyond that the hunter turns around. |
| Hunter, firing | Upper body pushed back up to 3 px |
| Hunter, downed | Full sprite rotated 90° onto its side |
| Hunter, dead | Not drawn |
| Walking enemies (rat, stalker, insectoid, enforcer, mech, Enforcement Chassis, Brood Matriarch) | Skewed ±0.1 on a sine wave plus a 2 px bob while moving (fast enemies twice as fast). Standing still: 1.5% vertical "breathing". The Enforcement Chassis "wiggle" is this. |
| Insectoid / Brood Matriarch wind-up | Shakes 2 px left and right |
| Stalker cocoon | Sprite flipped upside down and darkened, with a drawn thread |
| Drone, Spire Gunship | Tilted up to ±14° by horizontal speed, bobs 3 px |
| Nano-swarm | Whole sprite spins continuously and pulses ±12% in size |
| Sentient mould | Squashes and stretches 6%, jumps +15% taller when it spits |
| Wall burster, Hive Heart | Pulses 2% in size, +5% when releasing a creature |
| Sewer worm, Sump Leviathan | Rocks ±5°; rises out of the floor (cut off at floor level) and sinks back |
| All enemies, hit | White flash for 0.08 s (fine to keep) |
| All enemies, death | Replaced by random rectangles cut from the sprite, flying apart |
| Enemy gunfire | No muzzle flash and no firing pose; shots appear from a fixed point |

-----

## 1. Hunter (players 1 and 2)

The hunter has independent aim, as in *Abuse*: legs move, the upper body points at the cursor. Animate legs and upper body separately; legs play these locomotion animations while the upper body aims and fires.

### Legs and body

| Animation | Action | Duration in game | Frames (fps) | Loop | Event frames and notes |
| --- | --- | --- | --- | --- | --- |
| Idle | Standing, breathing, tendrils/dreadlocks swaying | — | 6–8 (8) | Yes | — |
| Run | Running at 235 px/s | — | 8 (16–18), about 0.5 s per full cycle (two steps) | Yes | Footsteps on 2 frames. Playback speed will scale with movement speed (overdrive is 1.3×). |
| Run backwards | Backpedalling while aiming the other way (facing follows the aim, so moving away from where you aim is common) | — | 8 (14) | Yes | Footstep frames |
| Jump take-off | Push off the ground | 0.05–0.1 s | 2 | No | Launch on the last frame |
| Rising | Going up; jump height up to 140 px, about 0.4 s | — | 2 (10) | Yes | — |
| Apex | Top of the jump | ~0.1 s | 1–2 | No | — |
| Falling | Coming down; also used when walking off ledges and dropping through catwalks | — | 2 (10) | Yes | Fall speed up to 950 px/s |
| Land | Soft landing | 0.1 s | 2–3 | No | — |
| Hard land | Landing after a long fall (faster than 300 px/s) | 0.2 s | 3–4 | No | Crouch absorbs the impact |
| Dash | Burst sideways at 620 px/s | 0.16 s, then 0.55 s cooldown | 3–4 (24) plus 2 to recover | No | Invulnerable during the dash. Afterimage or smear frames welcome. |
| Climb | Climbing a ladder at 170 px/s (ladder rungs are 8 px apart, 4 per tile) | — | 4–6 (12) | Yes | Plays backwards when climbing down. Hands should meet rungs, so one cycle should cover a multiple of 8 px. |
| Ladder idle | Holding still on a ladder | — | 1–2 | Yes | The hunter can aim and fire while climbing |
| Wade/swim | In toxic liquid: 55% speed, slow fall | — | 6 (10) | Yes | — |
| Swim kick | Each jump press in liquid | 0.2 s | 3 | No | — |
| Hurt flinch | Hit by an attack (knocked back up to 360 px/s) | 0.15–0.25 s | 2–3 | No | Interrupts nothing, plays over movement |
| Downed collapse | Health reaches 0 in co-op | 0.4 s | 5–6 (12) | No | — |
| Downed loop | Lying wounded, waiting for revive (up to 18 s) | — | 4 (6) | Yes | Crawling or reaching; the revive ring is drawn by code |
| Revive get-up | Partner revives (after 1.6 s next to them) | 0.5 s | 6 (12) | No | — |
| Death | Bleeds out, or dies in solo | 0.6 s | 6–8 (12) | No | Then the hunter disappears until respawn (4 s) |
| Respawn | Reconstitutes at a checkpoint, the partner or the arena entrance | 0.5 s | 8 (16) | No | Invulnerable for 2 s afterwards |
| Board lift (optional) | Standing on the exit lift as it activates | 1.5 s | 4–6 | No | — |

### Upper body (aim and weapons)

| Animation | Action | Duration in game | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Aim directions | Upper body pointing from straight up to straight down | — | 13 poses (every 15°, -90° to +90°) per weapon, or one rig with a rotating arm/weapon part | — | *Abuse* used 24 directions over 360°. Shoulder pivot and muzzle point needed per pose. |
| Fire: pulse carbine | Light recoil | Fires every 0.11 s (0.066 s with overdrive) | 2 (24) | No | Muzzle flash on frame 1 |
| Fire: coil rifle | Heavy kick; the shot also pushes the hunter back 140 px/s | Fires every 0.55 s | 4–5 (18) | No | Muzzle flash on frame 1; recovery fits within 0.55 s |
| Fire: incinerator | Continuous flame | Hold to fire (a flame every 0.035 s) | 2–3 (16) | Yes | Nozzle flame layer |
| Fire: plasma cutter | Continuous beam | Hold to fire (pulse every 0.05 s) | 2–3 (16) | Yes | Beam starts at the muzzle point |
| Throw disc charge | Arm throws a grenade | 0.2 s (0.6 s cooldown) | 3–4 (16) | No | Release on frame 2 or 3 |
| Weapon switch | Lower one weapon, raise the next | 0.2 s | 3–4 | No | Currently instant |
| Held weapons | Hunter holding each of the 4 weapons (pulse carbine, coil rifle, incinerator, plasma cutter) | — | — | — | Currently the weapon picture is pasted over the hunter's own rifle |

-----

## 2. Regular enemies

### Techno-rat (fast, weak, swarms)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle | Sniffing, twitching | — | 4 (8) | Yes | — |
| Scurry | Running at 215 px/s | — | 6 (18), ~0.33 s | Yes | — |
| Jump | Hops obstacles and up to ledges (520 px/s up) | ~0.5 s airborne | 3 | No | — |
| Bite | Contact attack, 8 damage | 0.2 s | 3 (15) | No | Contact damage is continuous; the bite plays on hit |
| Death | — | 0.3 s | 4–5 | No | Or gib parts |

### Xenophage stalker (fast predator; based on *Abuse*'s ants)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle | Crouched, tail swaying | — | 6 (8) | Yes | — |
| Run | Running at 265 px/s | — | 8 (18), ~0.4 s | Yes | — |
| Screech | First sight of a hunter | 0.5 s | 5–6 | No | Plays once when it notices you |
| Pounce | Leaps at a hunter within 150 px (430 px/s forward and up) | ~0.5 s, 1.1 s cooldown | 2 crouch + 2 air + 2 land | No | Launch at the end of the crouch |
| Long leap | Leaps from more than 280 px away (560 px/s forward and up) | ~0.65 s | Reuses pounce with a longer air loop | No | — |
| Dodge | Hops away after being hit (25% chance) | ~0.5 s | 3–4 | No | — |
| Slash | Contact attack, 15 damage | 0.25 s | 4 (16) | No | — |
| Cocoon hang | Hanging from a cave ceiling, wrapped | — | 4 (4) twitch | Yes | Hangs until a hunter passes within 140 px below |
| Cocoon drop | Unfurls and falls | 0.4 s | 6 (15) | No | Then falls and lands into run |
| Death | — | 0.4 s | 5–6 | No | Or gib parts |

### Insectoid mutant (armoured charger)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Walk | Heavy walk at 105 px/s | — | 8 (10), ~0.8 s | Yes | Footstep frames |
| Wind-up | Rears, scrapes, readies a charge (currently a 2 px shake) | 0.55 s | 6 (11) | No | Must clearly warn the player |
| Charge | Runs at 420 px/s | up to 1.1 s | 6 (18) | Yes | Contact does double damage |
| Wall impact | Hits a wall during a charge, screen shakes | 0.2 s | 3 | No | Leads into stun |
| Stunned | Dazed after hitting a wall | 1.0 s | 4 (8) | Yes | — |
| Death | — | 0.5 s | 6 | No | — |

### Augmented enforcer (soldier with a gun)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle / patrol stand | Weapon held, looking around | — | 4–6 (6) | Yes | — |
| Walk | Walks at 120 px/s | — | 8 (12), ~0.65 s | Yes | — |
| Walk backwards | Backs away to keep about 260 px from the hunter | — | 8 (12) | Yes | Faces the hunter while retreating |
| Aim | Raises the weapon; aims up or down toward the hunter | 0.15 s | 2–3, plus 3–5 aim angles | No | Muzzle point per angle |
| Fire burst | 3 shots, 0.12 s apart | 0.36 s, then 1.7 s cooldown | 2 per shot (24) | Yes during the burst | Muzzle flash on frame 1 of each shot |
| Hit react | Staggers | 0.15 s | 2 | No | — |
| Death | Falls | 0.5 s | 6–8 | No | — |

### Industrial mech

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle | Hydraulics hiss, servo twitch | — | 4 (6) | Yes | — |
| Walk | Heavy stomp at 55 px/s | — | 8–10 (8), ~1.2 s | Yes | Two footstep frames (screen-shake hooks) |
| Walk backwards | Keeps about 340 px from the hunter | — | 8–10 | Yes | — |
| Minigun spin-up | Barrels start turning | 0.25 s | 3 | No | — |
| Minigun fire | 9 shots, 0.07 s apart | 0.63 s, then 2.4 s cooldown | 3–4 barrel spin (24) | Yes | Muzzle flash each shot; recoil shake |
| Spin-down | — | 0.3 s | 3 | No | — |
| Death | Sparks, buckles, explodes | 0.8 s | 10 | No | Then an explosion effect |

### Security drone

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Hover | Rotors spinning | — | 4 (20) rotor blur | Yes | — |
| Lean | Leans into its direction of travel (now done by tilting the whole sprite) | — | 3 poses (back, level, forward) | — | — |
| Searchlight | Lamp swivels toward its target | — | Separate lamp part or 3–5 angles | — | Lamp position needed for the light cone |
| Fire | Single shot every 1.5 s | 0.15 s | 2 | No | Muzzle point |
| Death | Spins and falls, then explodes | 0.6 s | 6 | No | — |

### Nano-swarm

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Swarm loop | Shards orbiting a glowing core (now the whole image spins and pulses) | — | 8–12 (15), ~0.7 s | Yes | Core glow on the emissive layer |
| Lunge | Shards tighten as it dives at a hunter | 0.3 s | 4 | No | Contact damage 10 |
| Death | Shards scatter, core pops | 0.4 s | 6 | No | — |

### Sentient mould (stationary)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle | Slow pulsing, oozing | — | 8 (5), ~1.6 s | Yes | — |
| Spit | Contracts and lobs acid | 0.3 s, every ~1.9 s | 5 (16) | No | Acid spawns on frame 3 or 4 |
| Hit | Jiggle | 0.15 s | 2–3 | No | — |
| Death | Melts, dries out | 0.6 s | 6–8 | No | — |

### Wall burster (stationary nest)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle | Breathing flesh in a broken machine housing | — | 6–8 (4), ~2 s | Yes | — |
| Birth | Releases a stalker or rat while hunters are within 700 px; up to 3 alive at once | 0.6 s, every ~3.6 s | 8–10 (15) | No | Creature appears on the event frame |
| Hit | Recoil | 0.15 s | 2 | No | — |
| Death | Collapses, bursts | 0.8 s | 10 | No | — |

### Sewer worm (burrows under the floor)

| Animation | Action | Duration | Frames (fps) | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| Burrowed trail | Moving under the floor at up to 170 px/s (now only dirt particles) | — | 4 (10) dirt mound or ripple | Yes | Invulnerable while burrowed |
| Emerge | Erupts within 120 px of a hunter | 0.45 s | 6–8 (16) | No | Becomes hittable at the end; screen shakes |
| Attack idle | Swaying above ground | 2.2 s window | 6 (10) | Yes | — |
| Spit | Spits acid every 0.5 s while up | 0.2 s | 3–4 | No | Acid spawns at the mouth (mouth point per frame) |
| Sink | Dives back under | 0.6 s | 6 (10) | No | — |
| Death | — | 0.5 s | 6 | No | — |

-----

## 3. Bosses

Bosses use the regular enemy's animations at twice the size, plus the extra attacks below. Give every boss a clear wind-up before each attack.

### Spire Gunship (upper megacity; large drone)

| Animation | Action | Duration | Frames (fps) | Notes |
| --- | --- | --- | --- | --- |
| Hover, lean, searchlight | As the drone | — | As the drone | — |
| Spread volley | 5 shots 0.08 s apart, every 1.3 s | 0.4 s | 2 per shot | One or more muzzle points |
| Release swarm | Bay opens and releases 2 nano-swarms, every 7 s | 0.5 s | 6 (12) | Swarms appear on the event frame |
| Damaged state | Below half health: smoke, sparks | — | Overlay loop 4 | Optional |
| Death | Loses control, crashes, explodes | 1.0 s | 12–16 | — |

### Enforcement Chassis (lower megacity; large mech)

| Animation | Action | Duration | Frames (fps) | Notes |
| --- | --- | --- | --- | --- |
| Walk | Very heavy stomp at 45 px/s (now the "wiggling robot") | ~1.4 s cycle | 10–12 (8) | Two footstep frames for screen shake |
| Minigun burst | 16 shots 0.05 s apart, every 1.8 s | 0.8 s plus spin-up and spin-down | Spin-up 3, loop 4, spin-down 3 | — |
| Mortar volley | Shoulder launcher fires 3 shells upward, every 4.5 s | 0.5 s | 6 (12) | Shells spawn on the event frames |
| Damaged state | Below half health: sparks, exposed frame | — | Overlay loop 4 | Optional |
| Death | Buckles, chain of explosions, collapses | 1.2 s | 16–20 | — |

### Sump Leviathan (underbelly; giant worm)

| Animation | Action | Duration | Frames (fps) | Notes |
| --- | --- | --- | --- | --- |
| Burrowed trail | Large mound or ripple | — | 4 | — |
| Emerge | Bursts out of the floor with debris | 0.45 s | 8–10 | Screen shakes |
| Attack window | Up for 3.2 s, spitting acid every 0.22 s | 3.2 s | Mouth open/close loop 4 (18) | Mouth point per frame |
| Sink | — | 0.6 s | 6–8 | Underground for 1.2 s between attacks |
| Death | — | 1.0 s | 12 | — |

### Brood Matriarch (caverns; giant insectoid)

| Animation | Action | Duration | Frames (fps) | Notes |
| --- | --- | --- | --- | --- |
| Walk, wind-up, charge, stun | As the insectoid mutant (130 px/s walk, 520 px/s charge) | As the insectoid | As the insectoid | Wind-up must read from across the arena |
| Spit | 3 acid globs every 2.4 s | 0.4 s | 5 | — |
| Birth | Releases 2 rats every 5 s (up to 6 alive) | 0.6 s | 6–8 | Rats appear on the event frame |
| Death | — | 1.0 s | 12 | — |

### Hive Heart (infested depths; giant wall burster)

| Animation | Action | Duration | Frames (fps) | Notes |
| --- | --- | --- | --- | --- |
| Idle | Heaving organ in machinery | — | 8 (5) | — |
| Birth | Releases a stalker, nano-swarm or rat every 2.6 s (up to 6 alive) | 0.6 s | 8–10 | Event frame |
| Spore fan | Contracts and fires 7 globs upward in a fan, every 2.2 s | 0.5 s | 6 (12) | Globs spawn on the event frame |
| Death | — | 1.5 s | 16–20 | — |

-----

## 4. Other objects with placeholder motion

These are also listed as art requests in `programmer-art-handover.md`; here are their animation timings.

| Object | Now | Animation needed | Duration | Frames |
| --- | --- | --- | --- | --- |
| Arena gate | Appears and disappears instantly | Close (slams down) and open | Close 0.3–0.4 s; open 0.6 s | 6–8 each |
| Exit lift doors | None | Doors open when the boss dies; descent when everyone boards | Open 0.8 s; descent 1.5 s | 8; 8–12 |
| Checkpoint console | Screen brightness pulses | Activation flash, then an active-screen loop | 0.4 s; loop | 6; 4–6 |
| Crate | Breaks into squares | Break apart | 0.3 s | 5–6 |
| Breakable block | Disappears into squares | Crumble | 0.3 s | 4–6 |
| Pickups | Bob 2 px, power-up orbs pulse | Optional idle shimmer | Loop | 4–6 |
| Summoned or spawned creatures | Appear instantly | Spawn-in (from a nest, a bay or the ground) | 0.3 s | 4–6 |
| Enemy muzzle flashes | None | Per enemy weapon | 0.05–0.1 s | 2–3 |
| Gibs | Random rectangles from the sprite | 4–6 authored body pieces per enemy, normal and burnt | — | Static pieces, spun by code |
