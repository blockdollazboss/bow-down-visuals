# AUDIT FACET B — Graphics systems (verbatim findings, worker 7572511a)
SKY:
- B-S1 Night sky FLAT: applySkyDomeColors (sky-env.ts:212-225) called once per build; moon pinned x-8; star canvas static; ZERO night twinkle/drift/shooting stars. Moon drifts 18m over 8min (156 steps) then FREEZES until next build.
- B-S2 Day clouds DON'T drift: twin cloud layers counter-drift ±0.35% over 480s then freeze (sky-env.ts:192-193); hold at extremes.
- B-S3 Moon DISC painted into static star canvas; actual moon = plain sphere (no texture/craters/glow). Sprite halo IS the glow (no additive halo mesh on moon itself).
- B-S4 Glow sprite scale pulsates ∝ moon x-position (visual alias for altitude, sky-env.ts:190-191) — breathe dies when drift stops.
WATER:
- B-W1 pool ShaderMaterial has NO time uniform — reflection shimmer frozen (plaza-engine.ts:86-113). Rivers DO animate (ticks.ts:64-97 dash offset).
- B-W2 NO waterline foam/wet-edge anywhere; water meets stone in a hard line (pools/rivers/dams).
- B-W3 Rivers are tubes with NO banks; bank = plaza ground plane ends mid-water; no shore geometry/trim — water visibly levitates over ground gap.
DAY/NIGHT PARITY:
- B-P1 STRICTLY one-way: every living system exists at night only (stars, glow sprites, embers, lantern flicker). Day has ZERO embers/sparks/pollen/dust motes anywhere.
- B-P2 Window glass Switch: night opacity .92+2.2 emissive amber; day .55+0.15 pale — thin geometry reads flat in day close-up.
- B-P3 Day key light = the MOON light itself (color lerps to #ffe3ba, 3.2 int, no shadow re-derivation); "sun" is a warm PointLight prop — day shadows are moon-shaped, no sun path/disc sync.
MATERIALS:
- B-M1 bumpScale per use-site magic numbers (1.5/2.5; 0.5 cinematic; 3.0 doors) scattered across palace-geometry.ts — no central table.
- B-M2 gold PBR derivation: color darkened RGBx0.72 + roughness x0.62 GLOBAL rules for every gold surface; hinges/crown/plaques/chain all share one response.
- B-M3 ONE global env-map intensity (registerLookMaterials, hall-scene.ts:543) — stone/marble/gold/glass all reflect at same strength.
LIGHTS/SHADOWS:
- B-L1 perimeter perimeterLights (14 lamps) castShadow=false vs interior point lights cast=true — inversion; plaza night has NO cast shadow from its lamps.
- B-L2 shadow radius hardcoded 3 at three sites (hall-scene.ts:612,3934, moon-shadows.ts:9) — ignores rung softness table (radius 2/3/4).
- B-L3 moon shadows enabled: moon-shadows.ts:23-29 guard inverted — moonLight.castShadow stays true even when shadowsMode "off/reflectors".
- B-L4 shadow camera left untyped (OrthographicCamera:any, hall-scene.ts:4384) — resize/clamps skipped on applyQualityTier.
- B-L5 rectangle-area "skylight" above stage (RectAreaLight 12x8, hall-scene.ts:3210) — no visible fixture/prop, reads as unexplained glow.
LADDER:
- B-Q1 high+medium rungs IDENTICAL anisotropy (16/16); low drops to 4.
- B-Q2 reflectorRes/roundness/particles fields declared on tier type + preset tables but NEVER read at runtime (echoes E-2).
- B-Q3 tier DECISION runs on a time-based cosine curve of wall-clock (hall-looks.ts:214-215), not device capability — device-blind.
- B-Q4 NO user-facing quality control found anywhere in world.tsx (governor unwired per E-1; no manual override either).
MONUMENT/GATES:
- B-G1 monument headline plate NEVER re-renders after mount (drawBoardPlate called once at construction, hall-scene.ts:1967) — headlines freeze at entry state while board data updates.
- B-G2 gold-plaque scalar (hall-scene.ts:1482) hardcoded 0.64 — no day/night variant.
- B-G3 facade gates are FLAT image planes (single PlaneGeometry/side, palace-exterior.ts:110-113); gates open at a DOORWAY but render as pictures.
- B-G4 TWO gate systems: exterior image-plane gates (8) AND interior district-gate lintels (14) overlap in name/count, NOT reconciled.
- B-G5 wall-trim scalar flips day 0.94 / night 0.64 via two code paths; monument scalar uses neither (consistency).
POSITIVES: sky dome shader (gradient+horizon+star canvas+glow sprite), rivers animate, facade plates crisp.
