# AUDIT FACET A — Districts & scene (verbatim findings, worker 04a5e8c5)
Global defects:
- G-1 SIX cloned instanced fence kits (identical 5-post kit, all 6 districts) — only instanced meshes in the world (perf-instancing.ts:36-60).
- G-2 IDENTICAL gold wall trim at one height on all 14 rooms (hall-scene.ts:1474-1484) — every room reads as same shell.
- G-3 ZERO benches/seating outside Stage Grounds (its 12 stools + 4 long benches); districts have nothing to sit on.
- G-4 NO animated life in ANY dressing layer (gardens birds/carp static textures; rivers shader-animated = only water motion).
- G-5 Lawns = ONE flat untextured #2c5a26 box per 2 garden parcels; hall "greenery" = trough+icosahedron blobs (hall-scene.ts:3340-3384).
- G-6 collision rects round UP generously — walkable floors read narrower than they look (district-thresholds.ts:60-63 fudge).
Stage Grounds (FINISHED):
- SG-1 arrival gate is a plain lintel in open floor + 1.2m sign pedestal; no arch/proscenium/portal vs proscenium at z=-54.
- SG-2 audience slope steps collide as blocks but mesh includes a "ramp" visual the collider doesn't follow (raked seats read climbable, aren't) — item-38 territory.
Listening Gardens (MOSTLY-FINISHED):
- LG-1 "fountain" = 60-seg river tube + pond discs; NO basin rim, jet, or vertical water.
- LG-2 audio-node lily discs sit at y=0.03 while pond surface is y=0.02 (floating pads).
- LG-3 under-stage "river" runs y=-0.18 sunk below opaque plaza ground plane (invisible?) — verify.
Creation Row (MOSTLY-FINISHED):
- CR-1 look identical at night: 3 of 7 lamp posts clustered on a 3m span (x 69..72, z 47..50).
- CR-2 scaffold A-frames (10) all identical, single rotation.
- CR-3 poster frames angle by index (fake variety), heights vary ±0.05m.
The Ateliers (MOSTLY-FINISHED):
- AT-1 mannequins don't collide (body punch-through worst at station point).
- AT-2 mannequin "heads" are the guard-capsule texture, squashed spheres (scale y .82).
- AT-3 fabric bolts all one width, one colour, no unroll/cascade mesh.
Boardwalk (MOSTLY-FINISHED):
- BW-1 shop awnings have NO posts — float 1.1m above stalls.
- BW-2 stall counters don't collide (only frame posts do).
- BW-3 game-stand spinning prize wheel is STATIC; nothing on the boardwalk animates except water dashes.
Creator Heights (SKELETAL — least-finished district):
- CH-1 14.7x9.8m enclave: 55% of every sibling's footprint; dressing = tapestries+banner+plants+trim+carpet+fence only.
- CH-2 residents' name plates are BLANK gold plates — no names, ever (nameLine sampled at build; updateRoster never re-letters).
- CH-3 front-desk is a bare counter slab (no bell, lamp, paper, chair).
- CH-4 ONE plant per wall bay vs Boardwalk's 12 troughs; no benches/lamps/tables (lean-to planters only).
- CH-5 district sign is an overhead GATE-style beam, not the wall lintel every other district gets.
King's Plaza (MOSTLY-FINISHED):
- PL-1 etiquette plate carries a title (4 rules) but body text = only 2 of the 4 rules the station promises (hall-scene.ts:445-455).
- PL-2 every plaza sculpture/dressing mesh is collision-free (2 marble lions walk-through, compass rose, telescope, standards, boards).
- PL-3 neither river dam has a collision cap; dam tops read as bridges, aren't (up to 11.2m into open water).
- PL-4 compass rose is a flat decal — no rim, ring, inlay relief.
King's Hall (FINISHED):
- KH-1 the only animated textiles (4 banners) hang in the hall — districts get zero animated dressing.
Verdicts: SG FINISHED · KH FINISHED · LG/CR/AT/BW MOSTLY · CH SKELETAL · PLAZA MOSTLY.
