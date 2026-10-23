# OPEN WORLD — 100-ITEM STACK BOARD

Owner's order (Oct 22, 18:33 EDT): "Stack 100 things inside the open world in all aspects"
+ "I should be able to do everything inside my website, inside the virtual world."
Ordered by impact. **[PICK]** = needs the owner's design pick (Gate-1 artifact) ·
**[NO PICK]** = buildable now · **[BANKED]** = already landed in stage 3 (commit 4f9d9ead).
Evidence for every item: .lane/audit.md (visual) and .lane/parity-map.md (parity).

## GRAPHICS & MATERIALS (1–18)

1. **[PICK]** Palace façade: a real exterior — stone courses, cornice, pilasters, windows, banners, pediment. Today the plaza faces the inside of the hall's back wall (audit geometry #7, Sev 5).
2. **[PICK]** Roofline & silhouette: roofs, parapet, towers/dome massing. Ceilings are single-sided; from any raised angle the palace is see-through (geometry #8, Sev 5).
3. **[PICK]** Real sky, day: gradient dome, sun disc, drifting clouds. Today: one flat colour (lighting A1, Sev 5).
4. **[PICK]** Real sky, night: star field + moon disc. Today: flat 0x030303 void (A1, Sev 5). Moon*light* itself is BANKED (item 19).
5. **[PICK]** Backdrop ring: distant palace wings / gardens / water / skyline + ground skirt beyond the 1.05 m wall, so the world stops ending in void (geometry #15, Sev 5).
6. **[PICK]** Outdoor ground system: real paving (setts/slabs with joints) replacing the indoor marble outdoors (geometry #1, Sev 5; textures T1).
7. **[NO PICK]** Per-metre texture repeats / world-scale UVs — the same repeat count on a 1 m lintel and a 28.8 m wall is an objective defect (textures T6, geometry #2).
8. **[PICK]** Lawns & planting: textured grass, beds, edging, parterre — replacing two flat plastic slabs covering 37% of the grounds (geometry #5, textures T4, Sev 5).
9. **[NO PICK]** Real PBR maps: authored normal/roughness/AO for marble, stone, gold. Today bump is faked from the colour map; the code header's "PBR" claim is false (textures T3, Sev 5).
10. **[PICK]** New 2048–4096 tileable source textures (marble, paving, stone, grass). The shipped 1024px files give ~145 px/m; upscaling adds no detail — this is new art (textures T2/T15).
11. **[NO PICK]** Seamless tiling: kill the kaleidoscope — non-seamless sources + mirrored wrapping draw Rorschach veins every ~7–9 m (textures T7).
12. **[NO PICK]** Metal/gold material pass: brushed + roughness-variation maps and a sky-true env, so gold stops reading as yellow plastic (textures T10, lighting C3).
13. **[NO PICK]** Guard figure resolution: raise the figure canvas cap from h=768 to 1536–2048 — the approved 2167px art is being thrown away in code (textures T9). *Stage-3 build.*
14. **[NO PICK]** Anisotropy to the renderer's real max (16) for floor/wall maps — the plaza's dominant view is a grazing angle (textures T12). *Stage-3 build.*
15. **[NO PICK]** Texture load fallback: onError → origin copy / neutral material. Today an R2/CORS failure renders black (textures T14). *Stage-3 build.*
16. **[NO PICK]** Kingdom Board monument finished on all four faces; plate renders REAL board headlines at 1024×1408 instead of six grey "ruled, never lettered" rectangles (geometry #11, textures T11).
17. **[PICK]** Monument scale & sculpture: bigger, bevelled, relieved — today a 4-sided cone cap and 0.09 m sphere finials in 974 m² (geometry #11/#12).
18. **[NO PICK]** Variation system: rotation/scale/colour jitter + 2–3 variants for planter crowns, troughs, gates, columns — perfect clones are the strongest "prototype" cue after the void (geometry #18).

## LIGHTING, SKY-LIFE & PLACE (19–30)

19. **[BANKED]** One sun/moon, aimed where you stand: plaza-fitted shadow camera (±36 m, far 120), moonlight at night. Was: indoor-aimed sun, no night key light (lighting B1/B2/B3, Sev 5).
20. **[BANKED]** Per-area fog: courtyard 48→140 (day) / 34→115 (night); the hall keeps its own. Was: dark fog 16→46 m ate the plaza (lighting C1, Sev 4).
21. **[NO PICK]** Outdoor environment map baked from a real sky scene (PMREM) — gold/marble currently reflect a fake indoor room (lighting C3).
22. **[NO PICK]** Adaptive quality ladder: frame-time monitor with auto step-down/up + a user quality control. Today the rung is guessed once from pointer+cores and never adapts (lighting E1, Sev 5).
23. **[NO PICK]** Reflector gating + hall portal-culling: stop re-rendering the scene (and the whole hall interior) for a 4.4 m arch glimpse from the plaza (lighting E3).
24. **[NO PICK]** Room-scoped light toggling: ~15–17 lights currently shade every plaza fragment in the forward renderer (lighting E6).
25. **[NO PICK]** Instancing/merging of static plaza geometry: ~150–250 draw calls per frame → target <80 (lighting E5).
26. **[PICK]** Daylight life: waving banners on gates/monument, drifting pollen/dust outdoors. The light-theme plaza today has ZERO animated life (lighting D1, Sev 5).
27. **[NO PICK]** Night life: ember/spark particles at braziers + lantern glow sprites. Courtyard brazier coals/halo parity is BANKED (stage 3); embers are the remaining piece (lighting D1/D3).
28. **[PICK]** Water: fountain and/or reflecting pool with an animated surface — no water exists anywhere in the world (lighting D1, geometry #17).
29. **[PICK]** Plaza lighting furniture: lamp posts/standards that carry the night rig (geometry #17/#20).
30. **[PICK]** Plaza furniture set: benches, tables, urns, stalls — physical place-making; today the middle ~900 m² holds one monument and hologram rings (geometry #17, Sev 5).

## DISTRICTS BUILT FOR REAL (31–38)

31. **[PICK]** Stage Grounds district build (beyond its gate: a real outdoor stage quarter).
32. **[PICK]** Listening Gardens district build.
33. **[PICK]** Creation Row district build.
34. **[PICK]** The Ateliers district build.
35. **[PICK]** The Boardwalk district build.
36. **[PICK]** Creator Heights district build.
37. **[NO PICK]** Honest gates NOW: remove/replace the four dishonest gates (two painted on a solid wall, two freestanding in open floor, floating plates) — honesty is a floor, not a taste call (geometry #13).
38. **[PICK]** Elevation: ceremonial stair to the hall arch, terraces, climbable monument steps — the world is currently dead flat (geometry #4).

## COLLISION & WALK FEEL (39–44)

39. **[NO PICK]** Prop collision for planters, columns, gates, braziers via the layout `blocked` mechanism. Monument collision is BANKED (stage 3); the rest are still walk-through ghosts (geometry #19).
40. **[PICK]** Spawn arrival moment: marked threshold, arrival dressing, a first-look composition worthy of the palace (geometry #6, coordinator V-5).
41. **[NO PICK]** Creator Rooms arch: path spur + flanking returns so it stops floating in open floor (geometry #23).
42. **[NO PICK]** Perimeter completion: wall runs form one enclosure (today: three unrelated fragments, SE edge open) (geometry #14).
43. **[NO PICK]** Wall-top columns grounded: real piers from the ground, or converted to lamp standards — today shafts grow out of a knee wall supporting nothing (geometry #16).
44. **[NO PICK]** Movement/camera feel pass: stride/bob tuning, camera collision with walls/props.

## PARITY — CREATE FINISH (45–52)

45. **[NO PICK]** In-world Scheduler: compose + schedule a post on the real rails — PROMOTE's finish step and CREATE's broken last mile (parity A gap #1).
46. **[NO PICK]** Every "Schedule it" chip opens the in-world scheduler instead of a target=_blank exit.
47. **[NO PICK]** Jukebox authority fix: a song published at the Song Desk plays on the jukebox from the Create Wing (today the add never lands outside the Music Hall). *Stage-3 build candidate.*
48. **[NO PICK]** Creator-profile creation in-world — unblocks a new creator's first publish, which today errors out to the website (parity A gap #5).
49. **[NO PICK]** Song Desk finishers: cover-from-package + synced-lyrics .lrc export in-world.
50. **[NO PICK]** Thumbnail CTR apply-suggestions rail in-world (prediction exists; the apply doesn't).
51. **[NO PICK]** Audio Desk deep end I: Harmony AI mode + stems remix-levels mixdown.
52. **[NO PICK]** Audio Desk deep end II: arrangement editing beyond title/BPM/mutes (comping/automation/FX/export on the shared draft).

## PARITY — PROMOTE (53–60)

53. **[NO PICK]** Distribution wizard in-world: create/edit release, metadata, splits, UPC/barcode (parity A gap #2).
54. **[NO PICK]** Smartlinks / pre-save in-world: release link, pixel settings, view/click analytics.
55. **[NO PICK]** Cover Desk "Release it" chip opens the in-world release desk (kills the /distribute exit).
56. **[NO PICK]** UGC Product Ads station: AI script, persona (100 VB), ad video (400 VB), pin-to-product, briefs board — an entire headline feature with zero in-world presence (parity A gap #3).
57. **[NO PICK]** Scheduler full surface: calendar view, drag-reschedule, connect social accounts, best-time.
58. **[NO PICK]** Post Assist ("Write It For Me", 100 VB) in the in-world feed composer + Promote Room.
59. **[NO PICK]** Link-in-bio editing in-world: links, themes, slug, avatar + the 100 VB publish action.
60. **[NO PICK]** Promo-card full history in-world (today: this sitting's pack only).

## PARITY — MONEY (61–70)

61. **[NO PICK]** Buy Visual Bucs in-world: a packs desk in the Treasury; hosted checkout remains the sanctioned tab. Today every out-of-credits state is a dead end (parity A gap #7).
62. **[NO PICK]** Payouts in-world: Stripe Connect status + cash-out at the Get Paid Room; bank onboarding via the hosted flow (parity A gap #4).
63. **[NO PICK]** Membership tier creation/management (seller side) at Crowns & Memberships — fans can join in-world; creators can't build what's being sold (parity A gap #8).
64. **[NO PICK]** Creator-Room store: real cart + checkout matching the Marketplace stand (today: "Buy on the website").
65. **[NO PICK]** Beats licensing marketplace station: browse/preview, Basic/Premium/Exclusive + custom templates, sell, seller dashboard.
66. **[NO PICK]** Tip any creator in-world: portrait-card tipping + tip page/settings surface (stage tips already work).
67. **[NO PICK]** Money management actions: distribution permanence elections + Content-ID claim accept/dispute/resolve (today read-only).
68. **[NO PICK]** Storefront custom domains in-world (attach/verify).
69. **[NO PICK]** Site plan subscriptions (Pro/Elite) purchasable in-world.
70. **[NO PICK]** Full credit-history surface in-world (paginated ledger, not just recent rows).

## PARITY — BRAND MAINTENANCE (71–75)

71. **[NO PICK]** Press-kit full editing in-world (socials, achievements, quotes, photos, top tracks, public toggle, PDF, delete).
72. **[NO PICK]** Brand-kit manual field editing in-world (hand-edit colours/fonts/bio lines).
73. **[NO PICK]** Logo → brand-kit save-back in-world (the desk currently tells you to use the website).
74. **[NO PICK]** Jewelry bench in-world (the Atelier's missing desk).
75. **[NO PICK]** Monetization Coach on the creator's REAL inputs (today: one action computed from hardcoded defaults).

## PARITY — SOCIAL & COMMUNITY (76–84)

76. **[NO PICK]** Groups in-world: browse/create/join/leave + group feeds at the Community Hall — the station's own tagline already promises them (parity B gap #1).
77. **[NO PICK]** Group forums in-world: channels, threads, replies, pin/lock.
78. **[NO PICK]** Notifications inbox in-world (chrome bell + panel) — a member in the palace is currently deaf to follows/tips/DM requests (parity B gap #4).
79. **[NO PICK]** Feed parity: For You + New Drops views + pagination (today a 12-post chrono window).
80. **[NO PICK]** Feed verbs: repost, save/bookmark, delete own post, poll vote.
81. **[NO PICK]** Explore + creator/post search in-world.
82. **[NO PICK]** Community moderation bench in-world (admin; today explicitly transfer-only).
83. **[NO PICK]** Own-profile view in-world (my public page as others see it).
84. **[NO PICK]** Profile editing in-world (bio, layout blocks, theme, socials, referral).

## PARITY — LIVE (85–91)

85. **[NO PICK]** Go Live in-world: start a stream without leaving (studio flow on the real rails; ingest/destination keys, loyalty) (parity B gap #2).
86. **[NO PICK]** Stream guests & backstage in-world (invite links, promote/demote/remove, backstage chat).
87. **[NO PICK]** Join a stream as a guest in-world.
88. **[NO PICK]** Stream scheduling/management in-world.
89. **[NO PICK]** Stream Controller deck in-world (scenes/transitions/remote) beyond the hall screen panel.
90. **[NO PICK]** Live-watch parity in the hall: dedicated stream chat + follow-the-streamer rail.
91. **[NO PICK]** Premiere / broadcast scheduling in-world.

## PARITY — ACCOUNT, ADMIN & GAMES (92–98)

92. **[NO PICK]** Admin room-door lock verb in-world — presence shows a Locked pill but NO client verb can lock/unlock (peace-law headline power, display-only today).
93. **[NO PICK]** Admin person lock-out (timed room ban) + moderation queue in-world.
94. **[NO PICK]** Account settings in-world (fields, preferences) + danger zone (data export; account deletion stays behind its 2D confirmations by design note).
95. **[NO PICK]** 2D giveaway contests (/api/contests) in-world — a separate system from World Contests; only one of the two works today.
96. **[NO PICK]** Jackpot in-world: player entry + admin creation surface.
97. **[NO PICK]** Daily Drop template "Use" opens the matching native desk instead of ejecting the walker to the website. *Stage-3 build candidate.*
98. **[NO PICK]** Avatar creation/appearance editing in-world (today the picker can only pick/rename/remove; making or restyling a character is a Creative Vault link-out).

## PERFORMANCE & SYSTEMS (99–100)

99. **[NO PICK]** Meaningful quality rungs: per-rung reflector size/off, MSAA, fog/draw, anisotropy, particle counts — today the ladder changes only 4 variables and the low rung strips the night plaza's only lights (lighting E7). (Phone pixel-ratio rungs + frozen static shadow map are BANKED, stage 3.)
100. **[NO PICK]** Voice reliability: TURN relay evaluation + honest connection state — the proximity voice mesh has no relay, so some networks silently never connect (parity B §5).

---

**Counts:** 100 items · 24 [PICK] (all visual/district direction) · 73 [NO PICK] · 3 [BANKED]
(19, 20, 99-partial; monument collision inside 39 also banked). Every parity item calls the
real rails at the real Visual Bucs prices with confirmation law intact — nothing mocked.
