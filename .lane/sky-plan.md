# sky-light lane — plan + evidence (Stack-100 #2, items 1–19 + 40)

Baseline: FE world 99 files/1770 tests pass (sky-baseline-world.log).

Facet-B claims verified STALE vs current tree (close as pins):
- B-M3 env intensity: already per-material (0.3 lawn … 1.35 gold) in makeMaterials.
- B-M1 bumpScale: no bumpMap/bumpScale anywhere; relief = derived normal maps.
- B-L3 moon guard: no moon-shadows.ts; one directional, castShadow=rung.shadows.
- B-L4 shadow camera `any`: camera is typed, aimSun re-fits + updateProjectionMatrix.
- B-L5 RectAreaLight: none exists in src.
- B-G3/B-S3 moon mesh: moon is a shader disc+halo in the dome; no moon mesh/casters.
- Item 12 textures: manifest — generator max 1600², shipped native 1600 (no upscale).
- Item 40 (board 42): lions/compass/dams DO NOT EXIST (districts dbce307e) → PARK.

Real gaps built: sky twinkle/MW/drift + day scatter/cloud shade; water ripple
normals + moat animated + plaza fountain fall/ripple + wet edge; stoneFor kind;
hero derivation cap; gold per-metre; relief table; day glass env; monument lit
plate + 4-face relief; gate identity/leaves/lantern mesh/backed plates; rung
shadowRadius + 4096 high + local brazier shadow lights (high only); animated-
caster shadow refresh cadence; theme crossfade; fake light pools.
