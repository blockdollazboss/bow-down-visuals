# STACK-100 #2 — WORLD BOARD (100 items)

Owner's order (Oct 23, 09:06–09:07 EDT): "Stack 100 more on the site an the vr world" —
corrected to **100 each**: 100 site (sibling coordinator) + **100 here in the VR World**.
Base: `grand/integration` @ 0bdfcefa (live as ace33dea) → branch `stack28/world`.
Direction: inside the owner's picked **Living Night Palace + golden-morning day twin** —
no new design direction; refinements only. Rules: real rails only, no price/charge changes,
no migrations, no deletions, never weaken a test, no push (parent pushes on the owner's word).

Evidence: `.lane/audit-facet{A-districts,B-graphics,C-movement,D-parity,E-perf}.md`
(a re-walk of the SHIPPED world, file:line cited). Baseline on this branch:
FE 307 files / 4,070 tests, API 408 files / 5,122 tests, both typechecks exit 0 (`.lane/baseline.md`).
[PICK] = Gate-1 preview artifact owed before it can ship (visual refinement inside the picked
direction). Everything else is buildable now.

## GRAPHICS ROUND 2 — SKY, SUN, WATER, MATERIALS (1–12)

1. **Night sky life** [PICK]: star twinkle, slow star-field drift, continuous moon travel —
   today the sky is applied once at build, the moon drifts 18 m over 8 min then freezes,
   zero twinkle (B-S1). Done = the night sky visibly lives for a whole session.
2. **Moon face**: real moon disc — textured sphere (craters) + additive halo mesh —
   today a plain sphere lit by a sprite (B-S3).
3. **True day sun**: a real directional day key with a sun path synced to a visible sun
   disc — today the day face is lit by the moon light recolored, shadows moon-shaped (B-P3).
4. **Day sky life**: continuous cloud drift for both cloud layers (today ±0.35% over
   480 s then frozen at extremes, B-S2) + drifting pollen/dust motes in daylight —
   every living system is currently night-only (B-P1).
5. **Pool water shimmer**: the pools' shader gains a time uniform — today the reflection
   shimmer is a frozen still (B-W1). Rivers already animate; pools join them.
6. **Waterline wet-edge**: foam/wet-band treatment where water meets stone on pools,
   rivers and dams — today a hard CG line everywhere (B-W2).
7. **River banks**: shore geometry/trim where the rivers meet the ground — today the
   ground plane ends mid-water and the tubes read as levitating (B-W3).
8. **Day window glass**: richer day treatment for the palace window glass — today the
   day values (.55 opacity, 0.15 emissive) read flat in close-up (B-P2).
9. **Central relief table**: one named per-surface bump/relief table replaces the
   scattered magic numbers (1.5/2.5/0.5/3.0) across palace-geometry.ts (B-M1).
10. **Gold derivation classes**: the global gold PBR rule (colour ×0.72, roughness ×0.62)
    splits into per-class responses (crown/chain/plaque/trim) — today every gold surface
    answers light identically (B-M2).
11. **Per-material env intensity**: stone/marble/gold/glass get their own env-map
    intensities — today one global value for everything (B-M3).
12. **Native high-res hero textures**: the two highest-traffic surfaces (plaza paving,
    palace facade stone) get natively generated seamless sources at the generator's true
    maximum, measured for edge-continuity like the Stage-C manifest — closing the honest
    residue of round-1 item 10 where the surface allows it; no fake upscale (texture-manifest.md).

## LIGHT & SHADOW TRUTH (13–19)

13. **Perimeter lamp shadows** [PICK]: the plaza's 14 perimeter lamps cast shadows at
    night on the rungs that can afford it — today they cast none while interior candle
    points do, an inversion that leaves the night plaza shadowless (B-L1).
14. **Shadow softness follows the rung**: shadow radius reads the ladder's softness
    table (2/3/4) — today hardcoded 3 at three separate sites (B-L2).
15. **Moon shadows obey the off mode**: when a rung's shadows mode is off/reflectors,
    the moon stops casting — today a guard inversion keeps it casting (B-L3).
16. **Typed shadow cameras**: the shadow camera loses its `any` typing so tier changes
    re-clamp its frustum — today resize/clamps are skipped on tier change (B-L4; E-13 companion).
17. **Stage skylight fixture**: the unexplained RectAreaLight glow above the stage gets
    a visible fixture — light must come from something (B-L5).
18. **Shadow freeze honesty**: flickering flame lights and swaying seat lights stop
    defeating the frozen static shadow map — shadow-casting moves to the lights that
    are actually static, or the casters join the dynamic set deliberately (E-12).
19. **One moon caster**: the 5,710-tri shared moon's casters are authored once instead
    of re-rendered per room shadow camera where the freeze allows (E-13, perf-safe half).

## DISTRICT FINISHING — CREATOR HEIGHTS (skeletal → finished) (20–26)

20. **Roster plates letter real names** [PICK]: the residents' gold plates re-letter
    when the roster updates — today they are blank forever (A CH-2 / D-H9).
21. **Front desk dressed**: bell, lamp, papers, chair — today a bare counter slab (A CH-3).
22. **Heights seating & lamps**: benches and lamp standards join the enclave — today
    zero seating, zero lamps (A CH-4 / G-3).
23. **Wall-bay planting parity**: one dressed planter per wall bay, matching the
    Boardwalk's trough standard (A CH-4).
24. **Heights sign reconciled**: the district sign takes the same wall-lintel form as
    every other district instead of a one-off gate beam (A CH-5; B-G4 companion).
25. **Enclave ground dressing**: carpet/runner + trim continuity so the small plaza
    reads as a finished court, not a leftover corner (A CH-1).
26. **Arrival threshold dressing**: a marked threshold moment at the Heights gate,
    matching the spawn-arrival standard (A CH-1; round-1 item 40's bar).

## DISTRICT FINISHING — BOARDWALK (27–30)

27. **Awning posts**: every shop awning gets its posts — today all 10 float 1.1 m
    above the stalls (A BW-1).
28. **Stall counters collide**: counters join the blocked spec — today a walker
    passes through 10 counters and only the frame posts stop them (A BW-2).
29. **Prize wheel moves**: the game-stand wheel spins (idle sway + spin on approach
    or interval) — today it is the boardwalk's only "game" and it is static (A BW-3).
30. **Animated stall dressing**: hanging wares/flags gain the sway the hall banners
    have — districts get animated textiles too (A KH-1 / G-4).

## DISTRICT FINISHING — THE ATELIERS (31–33)

31. **Mannequins collide**: the four Ateliers mannequins join the blocked spec —
    today the station point itself invites a punch-through (A AT-1).
32. **Mannequin heads**: real head forms replace the squashed guard-capsule texture
    spheres (A AT-2).
33. **Fabric bolts variety**: varied widths, colours, and one unrolled cascade bolt —
    today nine identical rolls (A AT-3).

## DISTRICT FINISHING — CREATION ROW (34–35)

34. **Lamp spread**: the three lamp posts clustered on a 3 m span redistribute along
    the Row so its night look matches its day look (A CR-1).
35. **Scaffold variety**: the 10 identical A-frames gain rotation/height variation
    within the variation system (A CR-2; round-1 item 18's system extended).

## DISTRICT FINISHING — LISTENING GARDENS (36–38)

36. **A real fountain** [PICK]: basin rim, centre jet and falling-water treatment at
    the gardens' heart — today the "fountain" is a flat river tube + discs (A LG-1).
37. **Lily pads sit on the water**: audio-node discs drop to the pond surface
    (y 0.03 → 0.02) — today they hover (A LG-2).
38. **Sunk river resolved**: the under-stage river run at y −0.18 is either surfaced
    honestly (visible channel) or removed from the build path — today it renders
    under an opaque ground plane (A LG-3; removal = geometry change, not file deletion).

## DISTRICT FINISHING — STAGE GROUNDS & PLAZA & HALL (39–47)

39. **Stage Grounds arrival gate dressed**: arch/proscenium dressing at the district
    threshold to match the proscenium it leads to — today a plain lintel in open
    floor (A SG-1).
40. **Fence kit variety**: the six identical instanced fence kits gain per-district
    variation (cap/finial/colourway) — today one cloned kit is the world's only
    instancing and its strongest clone cue (A G-1).
41. **Room trim identity**: the identical gold trim line on all 14 rooms gains
    per-room variation (height/profile/accent) so rooms stop reading as one shell
    re-skinned (A G-2).
42. **Plaza props collide**: the two marble lions, compass rose, telescope, standards
    and boards join the blocked spec — today every plaza dressing mesh is a
    walk-through ghost (A PL-2).
43. **Dam caps**: both river dams get collision caps — their tops read as bridges
    and today a walker slides up to 11.2 m into open water (A PL-3).
44. **Compass rose relief**: rim, ring and inlay relief replace the flat decal (A PL-4).
45. **Etiquette plate tells all four rules**: the plate's body renders the 4 rules
    its title promises — today only 2 are lettered (A PL-1).
46. **Textured lawns**: lawn parcels take the shipped lawn textures with per-metre
    repeats — today one flat #2c5a26 box per parcel and blob "greenery" in the hall
    troughs (A G-5; round-1 T4 residue).
47. **Hall greenery upgrade**: trough blobs become shaped planting matching the
    gardens' standard (A G-5 companion).

## MOVEMENT — CLIMBABLE-Y, THE PARKED ITEM 38 FINISHED (48–55)

48. **Figure carries Y**: the world figure gains a real `y` (schema + server figure),
    replacing the z-as-y legacy — the foundation stone of item 38 (C-M1).
49. **Grounds height map**: the layout's grounds/terraces carry authored heights and
    the server validates a walker's Y against the room's height map (clamp +
    honesty), so height is server-mirrored, not client-asserted (C-M2/C-M3).
50. **Client Y-follow**: movement follows ramps/stairs/terraces smoothly (step-up,
    slope slide rules) instead of walls-or-glides (C-M2).
51. **Ceremonial stair climbable**: the hall-arch ceremonial stair becomes a real
    climb (round-1 item 38's named set piece).
52. **Terrace access**: district terraces/audience slopes become walkable at their
    authored heights — the Stage Grounds raked seating stops being a visual lie
    (A SG-2; district-thresholds fudge A G-6 resolved against real heights).
53. **Spawn & thresholds at height**: spawn, doorway transfers and gate settles
    place the figure at the destination's ground height — no sinking/floating
    on room change (C-K1 companion).
54. **Height in presence**: remote figures render at their true Y (no ground-snapping
    of a creator standing on a terrace).
55. **Fall safety**: walking off an edge resolves to the lower ground honestly
    (step-down limit, no void falls, no teleport pops).

## MOVEMENT, CAMERA & INPUT FEEL (56–60)

56. **Camera collision**: the third-person camera clamps against walls and props —
    today `collisionStart` is never assigned and the camera passes through
    everything (C-C1).
57. **Stride & bob wired**: the existing stride/bob math joins the render loop —
    today it is dead code with no call site (C-C2).
58. **Gate passability semantics**: the collider vocabulary stops calling push-out
    gates "passable" — gate/door zones get truthful kinds the movement and the
    honesty tests can both read (C-K1).
59. **Gamepad LT/RT bound**: triggers 6/7 (indexed, never consumed) drive real
    actions (voice push-to-talk / view toggle) (C-I1).
60. **Touch height control**: a second touch zone / jump-step control so phone
    walkers can climb what pads and keys can (C-I2).

## PRESENCE TRUTH (61–64)

61. **Sweep decoupled from traffic**: the 90 s ghost sweep stops depending on
    directory-request traffic to run (C-P1).
62. **Stale-counter hardening**: the presence counters stop relying on
    singleton-closure state (C-P2).
63. **Quiet-room signal in mixed rooms**: the honest "quiet" caption renders by
    room state, not only when a room has exactly 1 member (C-P3).
64. **Jewellery cases fully blocked**: the 3 of 8 unblocked display cases join the
    blocked spec (C-K3).

## VOICE (65–67)

65. **Voice labels single-sourced**: the 55-row parallel SHAPE_LABELS array is
    derived from the shape data it describes — no drift-prone duplication (C-V3).
66. **Voice summary cost**: the connection summary stops recomputing on every
    snapshot incl. join/partway states where nothing changed (C-V4).
67. **Sibling-mesh honesty note**: the go-live guest mesh and stage-room mesh share
    the World's STUN-only shape; the World voice-config rail's shape is documented
    as reusable by them (note only — sibling surfaces are the site stack's; C/turn-eval).

## PARITY RE-WALK — HONESTY & FINISH (68–84)

68. **Hook Desk Preview works**: the Preview button does what it says in-world —
    today it only saves a draft and tells you to view it on the page you are
    already standing in (D-H1).
69. **Hum-tab bug**: `humAudioUrl` is used before assignment in the Song Desk hum
    tab — fixed and pinned (D-H2).
70. **Live Desk count honesty**: the active-count header stops incrementing locally
    on join (double-count) and reads server truth (D-H3).
71. **Scheduler success receipt**: a completed in-world schedule shows title + when
    + channel back to the creator — today scheduling ends with no confirmation
    render (D-S1).
72. **AI-assist gate reason**: the scheduler's AI toggle states the true gate
    (feature flag vs entitlement) instead of misattributing it (D-S2).
73. **Pricing badge honesty**: the "Write with AI ✓ included" badge stops certifying
    a price that is fetched dynamically — it shows the fetched price or no badge (D-H5).
74. **Daily Drop music kinds land**: sample-pack/preset drops route to the Music
    Wing with their payload like hook kinds do — today the kind set {hook,count}
    strands them (D-H6 + D-97c).
75. **Atelier roster copy**: the "today's bench" copy matches the daily-rotation
    truth instead of implying a fixed assignment (D-H7).
76. **One My-Studio truth**: the three overlapping My-Studio navs converge on one
    getStatus and one shape (D-H8 + D-89b).
77. **Tutorial overlay follows stations**: the tutorial re-opens its step when the
    walker changes station, not only on mount-state changes (D-X1).
78. **No side-effects in render**: the JOIN_VOICE blocked notice moves its timer
    out of the render path (D-X2).
79. **Stream key honesty**: the go-live key surface labels the key as untested
    until a broadcast actually connects — no silent "ready" implication (D-L1/D-89a companion).
80. **Post Assist names its place**: the composer label stops pointing off-station
    at the 2D page for an in-world action (D-H4).

## PERFORMANCE — THE LADDER MADE REAL (81–96)

81. **Governor wired to the scene** [headline]: the FrameGovernor's decisions
    actually drive `applyQualityTier` — today `onTier` fires into a void closure
    and the rung is set once from device hints at construction (E-1). The
    adaptive ladder the owner was sold starts existing.
82. **Rungs fully applied**: pixel ratio, anisotropy, reflector resolution, particle
    counts and fog all read the rung — today applyQualityTier reads two fields
    and its own side table (E-2/B-Q2).
83. **One pixel-ratio owner**: a single governor sets pixel ratio — today the
    scene constructor and the page rAF loop fight with different caps (E-3).
84. **Anisotropy spread**: rungs read 16/8/4 honestly — today high and medium are
    both 16 (B-Q1).
85. **User quality control**: an in-world quality setting (Auto/High/Medium/Low)
    in the World chrome — today no user control exists anywhere (B-Q4).
86. **Columns instanced**: the 276 six-piece district columns join the instancing
    system (E-4).
87. **Braziers & street lights instanced**: 24 two-mesh braziers and 24 five-mesh
    street lights instanced (E-4).
88. **Troughs, stalls, chairs instanced**: trough+blob pairs (120 meshes), market
    stalls (60) and Ateliers chair+lamp pairs join the system (E-4).
89. **Shared geometry & materials across districts**: one geometry/material cache
    serves all districts — today geo is shared per-file only and materials are
    re-created per mesh (27 in the Ateliers alone) (E-5).
90. **Backdrop LOD**: the fog-ring skyline (16 towers, 8 domes, colonnade) gets
    distance-simplified forms — today full geometry at 65–115 m inside fog (E-6).
91. **District LOD pass**: braziers, monument reliefs and the hall chandelier get
    far forms (E-6 companion).
92. **Reflector honesty**: rung reflector resolution is really applied (low rung
    stops rendering a full-window ~7.8 MB target for a 512 nominal) and the two
    reflectors' clip treatment is symmetric (E-8/E-9).
93. **Texture step-down per rung**: lower rungs load stepped-down texture sizes —
    today the ~39 MB decoded set is identical on every rung (E-10).
94. **Gates take anisotropy**: the ceremony gates' 17 material maps join the bulk
    anisotropy pass, and the Front Row seats' marble joins the surface registry
    (E-10/E-11).
95. **Figure draw budget**: crowd figures get a budget (pooled/impostor far form)
    — today 6 draw calls × 30 figures ≈ 360 calls plus eager canvas uploads for
    off-screen figures (E-14).
96. **Per-frame allocation cuts**: figure-depth sorting and remote-move maps stop
    allocating fresh structures every frame (E-15/E-16).

## THE FOUR PARKED FINISHES (97–100)

97. **Panel payload channel** (parked item 97 finished): the station panel-swap
    protocol gains a typed payload, generalizing the one-shot `hookDeskSeed`
    pattern — desk handoffs carry their context (template, media, title)
    instead of dropping it (D-97a/b). Consumers wired: Daily Drop audio kinds
    (with item 74), thumbnail/video "Schedule it" keeps its payload instead of
    a hardcoded editor URL with the context lost (D-97d), wallpaper handoff
    stops navigating out of the world (D-97c).
98. **Controller deck executor** (parked item 89 finished): the Go Live studio
    publishes its live state on the real rails (`goLiveStartedAt` written at
    start, one shared getStatus), and the in-world deck drives the real studio
    off that state — "Studio not open" only when truly closed (D-89a/b, D-L2).
    The deck's 2 s polling is replaced or justified against the socket
    (D-89c) — no fake liveness either way.
99. **Distribution splits invite** (parked item 53 extras finished): the real
    rail is built — `POST /api/distribution/splits/invite` (documented TODO
    at distribution.ts:14-15) with pending-invite state; the in-world split
    editor invites by email / share link instead of demanding raw user ids,
    and the client test that faked invite acceptance is rewritten against
    the real rail (D-53a/b). No price/charge change: splits are percentages
    of the creator's own release, as the rail already models them.
100. **TURN readiness, code-side only** (parked item 100's buildable half):
    the voice-config rail gains ephemeral credentials — when
    `WORLD_TURN_SECRET` is set, the server signs short-lived per-session
    TURN credentials (coturn REST style) instead of serving one static
    shared credential; the client seam already consumes what it is served.
    NO relay is stood up, nothing is bought, no env is set in production —
    the owner's infra/money call stays his; the day he sets the env, the
    rail is ready (C-V1; turn-evaluation.md upgrade path).

---

**Counts:** 100 items — Graphics 12 · Light/Shadow 7 · Heights 7 · Boardwalk 4 ·
Ateliers 3 · Creation Row 2 · Gardens 3 · Stage/Plaza/Hall 9 · Climbable-Y 8 ·
Camera/Input 5 · Presence 4 · Voice 3 · Parity honesty 13 · Performance 16 ·
Parked finishes 4 (38 = items 48–55, 89 = item 98, 97 = item 97, 53 = item 99,
100-relay = item 100 code-side). [PICK] items: 1, 13, 20, 36 (+85's control is
chrome UI inside the picked direction — preview bundled with the graphics pass).
Every item cites audit evidence; nothing is padded — each is a named defect or a
named parked finish with a verifiable done-state.
