# OPEN WORLD OVERHAUL — AUDIT (draft, coordinator's own findings; facet reports appended on arrival)

Owner verdict (Oct 22, 18:30 EDT, after walking Phase 1 on his phone): "nowhere near done...
a million times better... better graphics." Phase 1 was a ~97-mesh skeleton. This audit is
defects-first, grounded in construction (the preview rig cannot render WebGL2).

## Coordinator-confirmed findings (direct code reads, hall-scene.ts / hall-looks.ts / palace-layout.ts)

- V-1 [Sev 5 · BUG] Dark look has NO sun (hall-looks.ts: dark `sun.present=false`) and fog
  16–46 m. Spawn (0, 31.5) faces the palace ~19–31 m away: in the DEFAULT dark theme the
  palace is fog-drowned against a flat near-black background (0x030303). The arrival moment —
  the first thing every visitor sees — is broken at night. (Phase 1's own report conceded:
  "the palace reads through fog (16–46 m) from the promenade".)
- V-2 [Sev 4 · BUG] The only directional light is aimed at the hall stage
  (buildLights: pos (-13.5, 10.5, -1) → target (7, 0, -5)); its 40×40 m shadow camera does
  not cover the plaza (z 12.4–34). Outdoors gets NO sun shadows even in the light theme;
  the plaza is lit by ambient/hemisphere wash + (dark, higher tiers) 4 brazier point lights.
- V-3 [Sev 4 · FLOOR] Sky = flat `scene.background` Color in both looks. No gradient, sun,
  clouds, or stars. Outdoors reads as a void, worst in dark.
- V-4 [Sev 3 · FLOOR] Plaza floor is the INTERIOR marble texture (repeat ~8×4 over
  56×22 m, bumpMap = the same color map), on a transparent plane (opacity 0.97,
  depthWrite:false, renderOrder 2) — wash + sorting risk, and no outdoor ground identity
  of its own beyond lawn slabs + one path.
- V-5 [Sev 3 · FLOOR/TASTE] Lawns are flat 5 cm solid-color boxes (#478f36 / #1f4d26, no
  texture). Planters are icosahedron blobs. No trees, hedges, fountains, water, benches,
  or lamps on the plaza. Total outdoor dressing ≈ 97 meshes for a 56×22 m plaza + promenade.
- V-6 [Sev 3 · TASTE] District gates are barred signposts — "closed" reads louder than
  "coming". No district exists beyond its gate.
- V-7 [Sev 2 · FLOOR] World edge: a 1.05 m low wall, then nothing — no backdrop terrain,
  skyline, or horizon treatment; camera far 120 vs fog far 46/68 means the palace floats
  in void from every outdoor angle.
- V-8 [PERF] Ladder on phones (coarse pointer): medium = PR 1.75 + shadows; low = PR 1.5,
  shadows OFF, candle lights OFF — on low the plaza loses all shadow and all brazier light.
  The single shadow-casting light is the hall sun (2048 high / 1024 medium).

## Facet reports (appended as they land)
- Geometry/materials/dressing facet: COMPLETE (worker 8ea3cbe4). Headline [Sev 5]: THE PALACE
  HAS NO EXTERIOR - from the plaza you see the inside face of the hall's back wall and an
  unbroken flat 6.5 m top edge against flat sky: no roofline, pediment, towers, dome, parapet,
  or facade skin; the hall's windows lie inside its volume (invisible from outside). The
  building the whole open world is named for does not exist from outdoors.
  Other findings: construction is 100% axis-aligned BoxGeometry (~170-180 outdoor meshes,
  zero cylinders/curves/spheres except monument cap+finials and planter blobs) [4/TASTE];
  plaza floors are two coplanar transparent planes, bumpMap = own colour map, and the SE
  quadrant (x 16.4..28.2, z 26..34) has NO floor mesh at all - background void under the
  lawn's edge [4/BUG - stage-3 fix S3-F]; plaza is dead flat (path 0.016 proud, no steps/
  terraces/level change) [4/TASTE]; lawns float 0.03 proud, no curbs/beds/paths, no trees -
  hedges are planter troughs with icosahedron blobs [4/MIXED]; ~79% of district frontage is
  blank wall or lawn edge, gates are 13 meshes each (posts+bar+plate) with visible side gaps,
  two gates' bars sit ON the wall face [4/TASTE]; low walls stop mid-run leaving unguarded
  lawn corners [3/BUG-ish]; NO COLLISION anywhere - monument, columns, planters, gates are
  all walk-through ghosts (clipping) [3/BUG - stage-3 fix S3-G: blocked rect for the monument];
  no benches/lamps on a 56 m plaza (braziers are the only furniture besides planters) [3/TASTE];
  monument is the best-dressed object outdoors (16 meshes) but its plate is a static canvas
  texture [3/MIXED]; floating gold ring renderOrder-hacked over a transparent floor [2/BUG];
  every marble surface shares two JPEGs, no roughness/normal/AO maps anywhere [4/MIXED];
  spawn arrival: 4.4 m gold door in a flat wall, nothing marks the threshold [3/MIXED];
  creator arch (13 meshes) is the only non-box construction outdoors [positive].
- Textures/assets facet: COMPLETE (worker ad1d5054). Headline: the ENTIRE outdoor world
  runs on ONE texture file per theme - marble-cream.jpg / marble-black.jpg, both 1024x1024
  baseline JPEGs (FFmpeg transcoded, not authored exports). R2 serves the exact same bytes
  (HEAD-verified identical lengths) - no larger/WebP variant exists anywhere. There are NO
  normal, roughness, metalness, AO, or emissive maps anywhere in src/lib/world (grep zero).
  Findings: T1 one texture for the whole outdoors [5/BUG/M]; T2 1024px over a 56.4 m plaza =
  ~145 px/m, soft smear at grazing angles [5/BUG/M - needs new 2048-4096 sources, NOT $0-solvable
  by upscaling]; T3 "PBR" header claim is false - colour map only, bump faked FROM the colour
  map (veins emboss as grooves, JPEG artefacts become relief) [5/BUG/M]; T4 lawns/foliage have
  NO texture at all - flat plastic colour + 18 identical icosahedron blobs [5/BUG/M];
  T5 no sky/exterior texture asset of any kind; env reflections are a PMREM of a fake indoor
  room [5/BUG/M]; T6 repeat is per-material not per-metre - same 5x1.4 repeat on a 1 m lintel
  and a 28.8 m wall [4/BUG/S-M, $0]; T7 non-seamless source + MirroredRepeatWrapping =
  kaleidoscope veining every ~7-9 m [4/BUG/M]; T8 marble-cream is nearly featureless
  (mean RGB 243,228,193, sigma R=5.0) and dark textures are crushed by fog [4/TASTE/BUG];
  T9 GUARD ART THROWN AWAY - sources are 979x2167/1003x2171 but figure.ts caps the canvas
  at h=768, discarding ~65% of approved resolution [4/BUG/S, $0 - raise cap]; T10 all metal/
  wood/trim is flat colour - gold reads as yellow plastic [4/TASTE/M]; T11 Kingdom Board plate
  is a 640x896 canvas with six grey rectangles "ruled, never lettered" for fake postings [3/TASTE+S];
  T12 anisotropy hard-capped at 8 (plates 4) instead of renderer max (16) [3/BUG/S, $0];
  T13 no variation/weathering/decals anywhere - pristine = prototype read [3/TASTE/M];
  T14 texture loading has NO onError/fallback - an R2/CORS failure renders black with no
  local fallback [2/BUG/S, $0]; T15 pipeline floor - no modern format, no source larger than
  the shipped file exists anywhere [2/BUG/M]. Facet's $0 bundle: T9+T12 (use resolution already
  on disk) + T6 (per-metre repeats) + procedural floors for T3/T4/T10 + gradient sky (T5-floor).
- Lighting/sky/perf facet: COMPLETE (worker 3c88168a). Headline: there is NO outdoor lighting
  rig — the plaza inherits the hall's indoor lights, fog, exposure, env map and flat-colour
  "sky" because there is no sky. Findings (sev/type/cost):
  A1 no sky, flat colour both themes [5/BUG/M]; A2 no palace exterior/roofline/horizon [4/BUG/M-L];
  B1 sun is an indoor light mis-aimed for the plaza [5/BUG/M]; B2 shadow camera ±20 m/far 45
  cannot cover the 56 m plaza — hard clip boundary [5/BUG/S-M]; B3 night: no key light, ZERO
  shadow-casting lights outdoors [5/BUG/M]; B4 shadow map 1024 on phones too coarse, low=none [4/BUG/S];
  B5 people cast no shadows (guard gets a painted blob; capsule/portrait figures not even that) [4/BUG/S-M];
  C1 hall fog (dark 16->46 m) eats the plaza — far corner renders as solid fog colour [4/BUG/S, no perf cost];
  C2 one indoor ambient/hemi wash shared in+out [3/BUG/S]; C3 gold/marble reflect a fake INDOOR room
  env map, no sun glint or sky [4/BUG/M]; C4 tone mapping itself sound [2/TASTE/S];
  D1 light-theme plaza has ZERO animated life (dust/haze/beams are hall-only; braziers dark-only;
  no banners, water, birds, particles) [5/TASTE/M]; D2 lawns flat colour boxes, planter blobs,
  indoor marble as outdoor ground [4/BUG/M]; D3 courtyard braziers missing the hall's coals+halo [3/BUG/S];
  E1 ladder guessed once (pointer+cores), no FPS adaptation, no user control [5/BUG/M];
  E2 phone rung PR 1.75 + always-on MSAA; low rung still 1.5, no 1.0-1.25 rung [5/BUG/S];
  E3 Reflector re-renders scene (512 on phones); hall interior always drawn from the plaza [4/BUG/M];
  E4 static sun's shadow map re-rendered EVERY frame (autoUpdate never set false) [3/BUG/S];
  E5 zero InstancedMesh/LOD/merging; ~150-250 draw calls per plaza frame before shadow+reflector passes [4/BUG/M-L];
  E6 ~15-17 lights shade every plaza fragment (forward renderer, no per-area culling) [4/BUG/M];
  E7 ladder touches only 4 variables; low rung strips the night plaza's ONLY dynamic lights [4/BUG/M].
  Facet's own cheapest high-yield sequence: C1+B2+C2 -> A1+B3 -> E2+E4+E1 -> D1.
- Parity facet A (create/brand/promote/money): COMPLETE (worker 5013d79c). Full map in
  .lane/parity-map.md. Verdict: CREATE generation is genuinely strong - Song/Video/Song+Video/
  Cover/Thumbnail/Audio desks call the real rails at registry prices; Visual Vibes editor
  mounts full-screen inside /world; brand-kit/logo/intro/headshot/stream-pack/press-kit
  generation all work in-world; Marketplace + Branding Shop + fan memberships check out
  in-world (hosted payment tab = sanctioned exception); earnings/ledger/statements view
  in-world; Treasury VB economy works. The loop BREAKS AT THE FINISH LINE: scheduler has
  NO compose/calendar/connect in-world (read-only next-3) and every desk's "Schedule it"
  chip is a target=_blank exit to 2D; distribution wizard + smartlinks/pre-save are
  status-only/absent; UGC Product Ads ENTIRELY MISSING (not even a station); payouts/Stripe
  Connect cash-out MISSING; buying Visual Bucs MISSING (every out-of-credits state dead-ends
  on "top up"); beats licensing marketplace MISSING; membership tier CREATION (seller side)
  MISSING; Creator-Room store is link-only ("Buy on the website") while the same goods cart
  in-world at the Marketplace stand; no creator-profile creation in-world (blocks a new
  creator's first publish); Post Assist MISSING; tip jar (real-money tips) MISSING; brand
  maintenance (press-kit full edit, bio-page edit+publish, logo->kit save, jewelry bench)
  all PARTIAL/leaves. Parity gaps ranked 1-14 in the facet report; top-5: scheduler,
  distribution+smartlinks, UGC ads, payouts, profile creation.
- Parity facet B (social/live/quests/account/systems): COMPLETE (worker 20efce72). Full map
  in .lane/parity-map.md. Verdict: DMs (full: threads, new convo, requests, attachments,
  drafts, search) WORK; feed posting/reacting/threads/drafts WORK but feed is a 12-post
  chrono window (no For You/New Drops/pagination) and repost/save/delete-own/poll-vote are
  MISSING; follow works; quests/drops/games/party tables/world contests/court season/
  jukebox/listening parties/office hours all genuinely native; avatar/voice/camera/
  controller/fullscreen/VR systems WORK; admin mute/remove/herald WORK. Big holes: GROUPS &
  FORUMS ENTIRELY MISSING while the Community Hall station tagline PROMISES them; you CANNOT
  START A LIVESTREAM in-world (Go Live studio LINK-ONLY - in-world live starts only after
  you're live elsewhere); stream guests/backstage MISSING; notifications MISSING (member in
  the palace is deaf to follows/tips/DM requests); profile EDITING + own-profile view MISSING;
  account settings/danger zone MISSING; admin room-door lock + person lock-out are
  DISPLAY-ONLY (no client verb exists despite peace law); 2D giveaway contests (separate
  /api/contests system) MISSING; jackpot MISSING; Daily Drop template "Use" buttons eject
  to the website instead of opening the native desk; avatar creation/appearance editing is
  LINK-ONLY (Creative Vault).

## Audit synthesis (coordinator)

The owner's verdict is correct on both pillars, and the causes are structural, not polish:
(1) VISUAL: there is no outdoor scene at all - an indoor room shell turned sideways (no sky,
no roof, no facade, no ground system, no furniture, one texture, indoor lights/fog/env),
~95 net-new meshes of which 44% are one cloned gate kit. (2) PARITY: creation GENERATION is
real and strong, but the FINISH of every workflow - schedule, distribute, cash out, buy
credits, sell memberships, start a stream, run a group - still lives on the 2D site. The
World is a creation lobby with a website attached, not the website in-world. Stage-3 fixes
landed so far (commit 4f9d9ead): room-aimed sun/moon + fitted shadows + per-area fog,
phone pixel-ratio rungs, figure grounding blobs, courtyard brazier parity, SE floor hole,
monument collision. Remaining work is itemized in .lane/stack-100.md; the visual direction
is the owner's Gate-1 pick in the openworld-overhaul-designs artifact.
