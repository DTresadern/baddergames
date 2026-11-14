# Art production handover

14 Nov 2026. This is a partial art pass against [programmer-art-handover.md](programmer-art-handover.md) and [animation-handover.md](animation-handover.md). **None of the new images has been exported or verified as a runtime sprite, tileset or animation.** Existing `assets/`, manifest, renderer and game code were not changed. The source studies live in [`generated-art/production-pass/`](../generated-art/production-pass/); each PNG has an exact-prompt provenance record and an independent visual review.

## Direction and use

Keep gameplay silhouettes and walkable tops clear against the backgrounds. Let zone materials carry the change in place: cool steel above, monumental concrete below, oxidised teal in the pumps, violet mineral rock in the caverns, and crimson tissue overtaking machinery in the depths. Reserve the strongest cyan, amber, green and red for interaction, projectiles and hazards; put emissive pixels on separate layers so the lighting pass can control their visibility. Avoid using hazard stripes on every surface: too many make the gate and breakable blocks less distinct.

## Terrain — T1–T3

Five concept sheets are in [`tiles/`](../generated-art/production-pass/tiles/), one for each zone. Each shows sixteen large illustrated material/edge examples. They express the visual direction, not the requested 32×32 autotiles: cells are irregular, joins were not authored to match, and the upper sheet has especially severe background contamination. Rock and tissue cross the notional cell boundaries. Repaint or rebuild the set on an exact 32-pixel grid, include all neighbour cases and interior variants, remove halos, and inspect every join at game scale. T4–T8 (damage states beyond the block concept below, one-way platforms, ladders, spikes and animated liquid) remain open.

## Interactive objects — O1–O4, T4 and P1–P7

- [`arena-gate-study.png`](../generated-art/production-pass/objects/arena-gate-study.png): a closed shutter design. It is a single illustration; make a repeatable segment or 32×608 asset, separate the red light, and author open/close states. The gate should read as a barrier immediately, with a short, forceful close.
- [`exit-lift-study.png`](../generated-art/production-pass/objects/exit-lift-study.png): closed door and broad platform. Top suspension parts meet the image boundary. Create separate doors, deck, status-light layers and open/close states; preserve the 160×96 gameplay area.
- [`checkpoint-study.png`](../generated-art/production-pass/objects/checkpoint-study.png): amber console design. Simplify small controls for its approximately 24–32×40–48 pixel footprint, and make idle/active screen states and an emissive layer. Its brightness should announce activation without competing with player silhouettes.
- [`lamp-fixtures-study.png`](../generated-art/production-pass/objects/lamp-fixtures-study.png): three industrial fixture concepts. The pale background and shadows are baked in, so it is not a transparent atlas. Isolate and redraw at the intended scale; supply separate illuminated parts. Cave and organic variants remain open.
- [`pickups-study.png`](../generated-art/production-pass/objects/pickups-study.png): seven recognisable pickup concepts. Silhouette as well as color should distinguish ammo and power-ups at 22×22; simplify fine marks, isolate and clean colored fringes, and make emissive accents. Power-up loops are not supplied.
- [`breakable-study.png`](../generated-art/production-pass/objects/breakable-study.png): four consecutive damage appearances. This is not registered to 32×32 and its last pose retains a wall behind the rubble. Produce aligned states, a clear destroyed opening, and separate debris.

## Backgrounds — B2

Five 2172×724 panoramic studies are in [`background/`](../generated-art/production-pass/background/). They have no obvious characters and could guide replacement far layers. They are flattened: rain, smoke and waterfalls are baked into several, and all show bilateral repetition. The first and last pixel columns are **not identical** in any image (mean absolute per-channel differences: upper 7.50, lower 5.32, underbelly 4.87, caverns 5.49, depths 8.69 on a 0–255 scale). Repair and test horizontal wrap while scrolling before use. Keep the background bridges and ledges visibly less prominent than collision surfaces. Independent midground/foreground layers, sky treatments and weather sprites remain open.

## Effects — W1–W11 and T8

[`effects/`](../generated-art/production-pass/effects/) contains projectile, muzzle-flash, explosion and liquid concept sheets. None has an authored runtime frame grid, timing, attachment anchor or separate emissive layer. Projectile and muzzle-flash sheets have overlapping glow; the explosion has inconsistent centers and colored edge artifacts; liquids are five static strips with embedded wall details rather than animated, repeatable surface tiles. Use them for shape and palette direction, then create clean, separately registered effects. Keep enemy bolts distinct from player shots, keep acid visible over green scenery, and keep impact flashes short enough not to obscure enemies. Impacts, trails, shells, casings, smoke and decals still need production assets.

## Animation handover

[`animation/hunter-run-study.png`](../generated-art/production-pass/animation/hunter-run-study.png) shows eight lower-body poses so a separately aimable torso can be retained. Several poses are similar, markings shift, and cell bounds, ground line, hip anchor, timing, loop closure and upper-body registration have not been validated. The current hunter sprite is 75×84 and its upper body must continue to aim independently. This does not cover the other hunter actions, weapon poses, P2 palette or emissive frames.

[`animation/mech-walk-study.png`](../generated-art/production-pass/animation/mech-walk-study.png) shows eight articulated walk poses. The chassis is broadly consistent, but weight transfer, foot contacts, consistent dimensions, anchors and loop closure need work. The boss is currently twice the base mech size. Neither sheet has the JSON animation metadata requested by the code agent; no frame count, fps or event points should be assumed from visual spacing. Earlier enemy pose and rig concepts are documented separately in [`animation-studies/`](../generated-art/animation-studies/README.md); they are also unregistered and incomplete. The full hunter, enemy and boss animation lists remain open, including independent emissive layers and any rigged alternatives.

## Other open requests

No production-ready HUD, logo, menu, parallax mid-layers, weather, particles, decals, gib sets, animated pickup states, hazard tiles or completed boss-specific attacks have been delivered. Do not wire in the studies as though the requested specifications were met. Before integration, confirm exact dimensions, transparent edge quality, animation playback, anchors/event points, emissive layers, collision alignment and readability in the running game. Exact prompts and reference paths are recorded beside each image.
