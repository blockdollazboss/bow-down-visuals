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

## FINAL STATUS (lane complete)
- Commits: 33077982 (sky 1-2), bb2f706a (water 5-7), 15ea71de (materials 8-12),
  f50ab5bb (monument+gates), 0be466f0 (light 13-19 + crossfade).
- Item 40: PARKED with evidence (no lions / fountain dams / compass rose
  exist as built solids in the tree; pool+fountain already in PLAZA_BLOCKED).
- Final verification: FE world suites 99 files / 1,808 tests ALL PASS
  (.lane/sky-final-world.log; baseline 99/1,770 => +38 new, 0 regressions);
  FE typecheck exit 0 (.lane/sky-typecheck-final.log).
- Pin corrections (2): listening-gardens item-36 waters-push pin (bb2f706a);
  quality.test high shadowMapSize 2048->4096 (0be466f0, item-15-ordered).
