# Stage C — Art Sub-Lane Texture Manifest (item 10, Living Night Palace + golden-morning twin)

Branch: `openworld/ow2-c-art` · Base: `51e8759f` · Location: `artifacts/bow-down-visuals/public/world/textures/`
Colour maps only (normal maps are the scene lanes' procedural job). Existing `marble-black.jpg`, `marble-cream.jpg`, `brocade-gold.jpg`, `velvet-black.jpg` untouched.

## Method (measured, not eyeballed)
- Generated natively square with the media generator. **The generator's largest returned size is 1600×1600** — consistent across all 9 generations. That is above the 1024 floor but short of the 2048 target; files are shipped at native 1600 rather than upscaled (an upscale would add pixels but no detail). Honest shortfall, same reason for every file.
- Tileability repair: offset-by-half wrap-blend per axis — roll by half so the original seam sits at centre, mirror cross-fade across a wide smooth cosine band (28% of width each axis, peak blend 0.5 exactly at the seam), roll back. Then JPEG q85, 4:4:4 (subsampling=1), optimize.
- Edge discontinuity = mean absolute difference (0–255 scale) between opposite edge columns (L/R) and rows (T/B), measured on the raw generation (before) and on the shipped JPEG file (after). Pre-save repaired values were 0.11–0.23; the small rise in shipped values is JPEG edge-block noise. Interior adjacent-pixel baseline is included for scale — shipped edge values sit well below ordinary interior texture variation.

## Files

| File | Dims | Bytes | Edge L/R before → after | Edge T/B before → after | Interior baseline | Mean RGB | Intended surfaces |
|---|---|---|---|---|---|---|---|
| marble-black-goldvein.jpg | 1600×1600 | 541,095 | 15.06 → 0.67 | 15.01 → 0.54 | 5.93 | 33.9, 33.2, 31.8 | Dusk hero: palace facade accents, plaza monument, plinths — golden black marble with gold veins |
| marble-cream-goldvein.jpg | 1600×1600 | 367,090 | 12.43 → 0.76 | 13.06 → 0.53 | 2.44 | 241.2, 227.8, 199.0 | Day twin of the above — golden white/cream marble, soft gold veins |
| paving-dark.jpg | 1600×1600 | 533,582 | 23.45 → 0.58 | 42.06 → 0.52 | 5.68 | 35.2, 36.7, 40.1 | King's Plaza / district ground, dusk — dark stone setts, subtle gold fleck |
| paving-light.jpg | 1600×1600 | 632,565 | 13.96 → 0.89 | 10.71 → 0.60 | 7.36 | 218.0, 197.7, 167.3 | Day twin plaza paving — warm light stone setts |
| lawn-dark.jpg | 1600×1600 | 1,035,720 | 26.34 → 0.93 | 27.06 → 0.75 | 17.21 | 32.6, 64.5, 25.6 | Listening Gardens lawns, dusk — deep green manicured grass |
| lawn-light.jpg | 1600×1600 | 1,280,107 | 42.00 → 1.13 | 40.30 → 0.88 | 26.83 | 71.2, 111.4, 39.2 | Day twin lawns — bright healthy grass (largest file: high-frequency grass detail at q85) |
| water-dark.jpg | 1600×1600 | 414,440 | 13.44 → 0.64 | 32.51 → 0.53 | 3.74 | 19.5, 37.9, 44.6 | Reflecting pools / water features base colour, dusk — dark still water, faint gold reflection; animation is scene-shader work |
| stone-dark.jpg | 1600×1600 | 547,832 | 16.02 → 0.49 | 33.59 → 0.54 | 6.72 | 45.8, 46.4, 45.9 | Palace facade skin, dusk — dark ashlar block courses |
| stone-light.jpg | 1600×1600 | 710,946 | 17.06 → 0.85 | 20.14 → 0.64 | 9.68 | 208.0, 186.8, 154.6 | Day twin facade skin — warm light ashlar blocks |

## Notes for scene lanes
- All files are square 1600×1600, sRGB JPEG, tileable on both axes (shipped edge discontinuity ≤1.13 on a 0–255 scale, 12–46× lower than the raw generations).
- Suggested repeats: paving/stone read as regular courses — keep repeat counts integral so joints stay even. Water is a base colour map only, per brief.
- No R2 upload performed (coordinator handles uploads at integration); the local `public/` files are the source of truth.
