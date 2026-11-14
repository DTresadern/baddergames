# Technophage — visual development set

Original concept art for a side-scrolling co-op shooter, using the screenshots in `art-references/` as visual references for framing, industrial texture and creature mood. The images are static mockups and isolated concepts, not finished animation cycles or seamless production tiles.

## Direction

The setting descends through incompatible environments: a cyberpunk upper megacity of petrol blue, dirty cyan, magenta and sodium; an oppressive lower megacity of concrete ochre, iron grey and warning red; a corroded teal-black industrial underbelly; then fungal green, mineral violet and cold cyan in the caves, deepening to bruised crimson and bone in the infested depths. Distinct silhouettes and readable horizontal platforms keep gameplay legible against detailed backgrounds.

The selected visual seed was `f1f93ec808eba84d`, interpreted as order versus growth and clean infrastructure interrupted by biological residue. `f0f2bf01e9114cf0` also informed the human-scale routes through colossal, patched infrastructure. Seeds were creative prompts, not generator seeds. The visual direction was chosen for this production pass without a separate user-steered concept round.

## Use

- `scenes/`: wide, flattened environment mockups. They are not separated parallax layers.
- `characters/`, `enemies/`, `weapons/`, `props/`: individual transparent character and object concepts.
- Each PNG has a `.generated.json` companion recording the exact prompt, reference paths, image hash and visual inspection.

The images use a high-resolution pixel-styled aesthetic and will need art direction, scale normalization, cleanup, animation and technical integration before production. Referenced screenshots remain in `art-references/` and are not original assets generated for this project.

## Review notes

Several transparent enemy and prop concepts retain dark or red halos and will need edge cleanup before compositing. The scene images are flattened and sometimes include characters on walkways; they are not production parallax layers. The seven scene images include alternate interpretations of the surface and caves as well as a dedicated lower-megacity location.
