# STACK-28 (STACK-100 #2 · SITE) — BOARD OF 100

Base: `stack28/site` @ 0bdfcefa (grand join tree, live on gated main as ace33dea).
Audit sources: `.lane/audit/a1-routes.md`, `a2-honesty.md`, `a3-resilience.md`, `a4-theme.md`, `a5-mobile-perf-media.md`, `a6-kb-integration.md`, `a7-locale.md`.
Rules: NO price/charge changes (displays move to rail truth, charges never move) · NO migrations · NO deletions · NO visual redesigns (item 53 needs a Gate-1 preview artifact) · never weaken a test (pin corrections only toward provably newer truth, documented) · stay out of `src/lib/world/*` and world scene code.
Status key: OPEN → FIXED (with test evidence) / FLAGGED (built, decision noted) / PARKED (named blocker).

## I · HONESTY — displayed ≠ charged (A2)

1. **Distribution fallback constants lie 100×** — `src/lib/distribution.ts:41-45` fallback displays 10/20/30 VB; the rail charges 1,000/2,000/3,000 (`api-server distribution.ts:58-62`). A2 Scope-3 proof: fallback IS reachable (distribute.tsx pricing stays null on fetch failure; stale figure reaches tier cards, wizard, submit confirm; World twin reads the same lib via release-desk). FIX: align fallback constants to 1,000/2,000/3,000 + pin FE fallback == rail constants. No charged price changes (the rail never reads the fallback). [A2-01]
2. **Export Doctor phantom prices** — registry + confirmedFetch quote 100–400 VB for 13 endpoints whose rails charge 0 (`credit-costs.ts:69-100`, `ExportDoctor.tsx:880+`; `export-doctor.ts` has zero credit logic). FIX: registry entries → cost 0 with the free-truth comment pattern used by other 0-rails; ExportDoctor quotes follow the registry; rail-truth suite updated. [A2-05]
3. **Pre-x100 stale price family (8 actions)** — Meme Machine shows 1 (charges 100), Style Stealer 2 (200), Three Second Lab 2 (200), Stream Copilot prep 1 (100), clips 1 (100), Trend Jacker 2 (200), Lyric Stories 2/card (200/card), Community tools 1 (100 ×4, `pages/community.tsx`). None is in the registry, so stale copy is the only price shown. FIX: correct every display to rail truth, add registry entries so the family is pinned, fix the same stale figures in en/ar/de catalogs. [A2-04]
4. **Tier-fee ladder displayed, flat 5% charged** — creator-pricing.tsx + guides/pricing.ts + TIER_PLANS display Free 10% / Pro 7% / Elite 5%; every checkout rail charges flat 5% (`shops.ts`, `store.ts`, `storefront.ts`); `feeSplitForTier` feeds only projections. FIX: all fee displays + projection math move to the real flat 5% (display-side only; no rail touched). [A2-09]
5. **Single-shot thumbnail under-quoted** — registry/HelpPanel say 100 (range 100–200); rail charges 300 on delivery and the 402 pre-check requires 300 (`thumbnail.ts:17-21,339-344`). FIX: registry + HelpPanel display 300; pin registry == rail. [A2-08]
6. **Promo Clips homepage over-quoted** — grid + FAQ display 400 VB and a 1,300 VB bundle total (en.json:346,459; home.tsx:138); rail charges 100 (`promo.ts:11,185`), true total 1,000. FIX: displays → 100 / 1,000 in en + all catalogs carrying the strings. [A2-07]
7. **Instagram post modal over-quoted** — displays 200 VB (`InstagramPostModal.tsx:203,308`); rail charges 100 (`social.ts:115,501`). FIX: display → 100, derived/pinned. [A2-02]
8. **TikTok post modal over-quoted** — displays 200 VB (`TikTokPostModal.tsx:213,326`); rail charges 100 (`social.ts:706`). FIX: display → 100, derived/pinned. [A2-03]
9. **/api/chat three-way disagreement** — registry says 100 (`credit-costs.ts:173`); rail default charges 1 VB (pre-x100 `?? "1"`, `ai-chat-assistant.ts:71-74`); `chat.ts:38` comment claims "free by default". Live widget uses free /api/free-chat. FIX (display-side only): registry + comment aligned to the rail's actual behavior and pinned; FLAG in the closure note: the intended price (free / 1 / 100) is an owner call — the charge itself is NOT changed by this stack. [A2-06]
10. **Distribute sells a mock as the real thing** — hero ("Get your music on Spotify…", en.json:3313) and the submit confirmation carry no sandbox qualifier while the default aggregator is MockAggregatorAdapter and real VB is charged; sandbox badges exist only around/after the spend. FIX: honest test-mode/sandbox qualifier on the hero + pre-spend confirmation, matching the in-flow badges (copy only). [A2-10]
11. **Go Live hub invites to a hall that is now a plaza** — `go-live.tsx:510-517` "step into the King's Hall / One room / Enter the hall" + `EnterWorldButton.tsx:25-26` vs the shipped plaza entry. FIX: copy → King's Plaza / open world, en + catalogs. [A2-12]

## II · WALLPAPERS DESK + KB INTEGRATION (A6)

12. **Screensaver "Generate video" is wired to a dead endpoint** — desk POSTs `/api/generate-video` (404, pinned dead by S27-73) with a "400 Visual Bucs" label and NO confirmation. FIX: rewire to the real rail `/api/generate-runway-clip` (400 VB) with its request/poll shapes mapped, confirmation restored. MUST land before item 21 (KB regen would otherwise learn the dead path). [A6-W2]
13. **The King's Set cannot be rendered** — starter-pack assets are site-relative URLs; both wallpapers rails reject non-http(s) with 400 before any render. FIX: absolutify King's Set URLs at selection (or accept same-origin relative in the rails — one place, both buttons) + integration test desk-shape → rail-schema. [A6-W1]
14. **Clean theme pack: cancelling the 2nd confirmation throws away a paid render** — `makePack()` discards the confirmed+charged phone render from desk state on desktop-cancel. FIX: one up-front pack confirmation (800) OR keep partial pack state + tell the user the render exists in their history. [A6-W3]
15. **Desk price figures are unpinned literals** — GENERATE_COST/CLEAN_RENDER_COST + "— 100/400/800 Visual Bucs" string literals, no test ties them to server constants. FIX: derive from the registry like the template gallery does; pin desk == server constants in both suites. [A6-W4]
16. **Store listing promises the full set, attaches only the phone render** — `listPack()` posts `mediaUrls: [pack.phoneUrl]` while the description promises phone + lock + desktop. FIX: attach `[phoneUrl, desktopUrl]`. [A6-W5]
17. **Template editor panel still hardcodes 250** — `TemplatesTabPanel.tsx:110` `useState(250)` initial (overwritten from server before the CTA, but the exact pattern the gallery eliminated). FIX: initialise from `VIDEO_TEMPLATE_APPLY_COST`/registry. [A6-T1]
18. **Template refund has no test pin** — apply → render-failure → refundCredits is wired but unexercised by any suite. FIX: API test pinning charge-on-success / refund-on-failure for /api/video-template/apply. [A6-T2]
19. **KB: Wallpapers & Themes desk does not exist to the operator** — no entry, price, or endpoint (grep "wallpaper" over the KB = 0). FIX: `DOCKED_FEATURES` entry per A6 §1.3 (render 0 / screensaver-render 400 from the registry; SCREENSAVER_RENDER_COST cross-check added; clean-400 represented as the override variant, NOT a naive cross-check). [A6-K1]
20. **KB: six open districts are unnamed** — world description names none; the Stack-26 pin's honesty half is now stale by the owner's own Stack-100 order. FIX: `pages/world.tsx:316` meta → A6-K2 text (names all six districts, states gates open, ≤300 chars, no money) + minimum K7 line (palace desks mirror the site's Create/Brand/Promote/Money features) + deliberately reverse the district pin (contains all six names, still never "closed") — the documented deliberate-revisit pattern. [A6-K2+K7-min]
21. **KB: World locks (4415/4416) unknown to the operator's knowledge** — hands can execute locks; grounding cannot explain them (no entry, none of the 5 lock endpoints). FIX: `DOCKED_FEATURES` reviewed-literal entry per A6-K3 (door lock vs person lock, 1-hour default, 7-day max, "not a glitch" card) + pins. [A6-K3]
22. **KB regeneration pass** — after items 12, 19–21: fix en.json `create.subtitle` "nine ways" → ten (K6); regenerate; verify K4 (stale `/api/video-background-removal` gone from 7 entries), K5 (social-publish 100×3 attributed; templates-hub gains 250), counts (features 235→237, pricedActions 216→217); move/add the pins listed in A6 §1.3.5. Bare regen without the source fixes is explicitly NOT this item. [A6-K4/K5/K6]

## III · DASHBOARD LAW — one bad section must never sink a page (A3)

23. **Analytics Hub: failed overview ⇒ "nothing is connected"** — `analytics-hub.tsx:398,427-444,582`: overview null on error/loading renders Connect cards for every platform. FIX: distinct loading / error-with-retry / genuinely-unconnected states. [A3-F1]
24. **Referrals page can spin forever** — `referrals.tsx:490-502`: `/api/referrals/me` outside try/catch, `setLoading(false)` after it; contest fetch awaited before the user's own data. FIX: guarded load with error+retry state; own data first, contest parallel/after. [A3-F2]
25. **Sponsor Dashboard paints fake zeros** — `sponsor-dashboard.tsx:79,137-157,177`: "$0.00 earned / 0 deals / 0 applications" renders during loading and after failure, above the real error card. FIX: banner follows the section state (skeleton while loading, hidden/error-note on failure, numbers only on success). [A3-F3]
26. **Broadcast: one failing source blanks both + hides the create form** — `broadcast.tsx:38` Promise.all(channels, inbox), no per-source catch. FIX: per-source guards on the dashboard-sections pattern; form always reachable. [A3-F4]
27. **Artist Setup: failed profile load ⇒ "brand-new creator"** — `artist-setup.tsx:238-239` catches fetchMyProfile failure into `emptyProfile()` (exists=false); save then walks the create branch for an existing creator. FIX: load failure = error state with retry, never the new-creator branch. [A3-F5]
28. **No fetch timeout anywhere in the shared layer** — `lib/social-api.ts:160-186` apiFetch/apiJson (and most page loaders) carry no AbortSignal; a stalled connection hangs skeletons forever. FIX: default timeout on the shared helpers following the in-codebase model (`lib/earnings-data.ts:130-141`), opt-out where a long call is legitimate. [A3-F6]
29. **False "not found" family (8 public pages)** — challenge, albums/public, bio-public, plan-public, press-public, sync-one-sheet-public, nfc-card-profile, tip-page render "doesn't exist / not active" on 500s and network failures. FIX: 404-only → not-found; other failures → error+retry, copying `artist-public.tsx:158-167` / `showcase/item.tsx:27-51`. [A3-F7]
30. **Group Detail: slow feed blocks the whole page** — `group-detail.tsx:104-118,265`: load() awaits loadFeed() before clearing the page spinner, defeating its own per-section feed error state. FIX: clear page loading on core data; feed resolves in its section. [A3-F9]
31. **Email List: one Promise.all discards four healthy panels** — `email-list.tsx:357` raw-fetch all(tags, segments, campaigns, automations); one transport failure empties all four, all rendering silent empty states. FIX: per-panel loads with per-panel error states. [A3-F10]
32. **Loyalty Settings: hard-coded defaults pose as saved rules** — `LoyaltySettingsPanel.tsx:27-65` has no error/loading state; on failure the defaults (enabled, 10/2/5 points, 1000 cost) display as the creator's earn rules. FIX: loading + error states; form only from loaded values. [A3-F11]
33. **Silent-empty batch A** — hashtag page renders "0 pieces of content" on failure (F8); party lobby Promise.all discards healthy lists when one source fails (F12). FIX: error states + per-source guards. [A3-F8/F12]
34. **Silent-empty batch B (low)** — ShortsMenu silent empties, TrophyShelf hide-on-error, team-spending section vanishes on failure, ReachWatch raid-poll coupling (F13–F16). FIX: honest per-section states. [A3-F13–16]

## IV · THEME — real defects only, per the AGENTS.md triage (A4)

35. **Audio Studio DAW rails unreadable in light** — `bg-[#171208]`/`bg-[#241b08]` (ArrangementStudio, PianoRoll) sit outside the remap tables with zero isLight handling; remapped labels go dark-on-dark. Also serves the in-world AudioDesk. FIX: add the hexes to the remap tables or branch the rails isLight — whichever the existing studio pattern supports; pin with a theme test. [A4-D1]
36. **`text-amber-100` opacity family unremapped** — /40–/75,/90 have no rule (only base + /80): my-music subtitle/purchase/receipt text ≈ invisible on ivory cards; also DistributionLegacyPanels, LipSyncStudio, GuideMe. FIX: complete the amber-100 opacity ladder in index.css §tables + coverage test. [A4-D2]
37. **Border remap gaps** — `border-white/12` (26+ uses: ManualDAW, SongWorkflow, ArrangementStudio, PianoRoll, RoyalCourtPicker…) and `border-white/[0.09]` (CommandCenter, StemFxChainEditor) have no remap → borderless blobs in light. FIX: add both rungs to the border tables + coverage test. [A4-E1/E2]
38. **Pale-variant remap batch** — emerald-100/80,/60, red-100/80, green-100/85, sky-200/90, emerald-200/90,/80, text-blue-200 (no rule at all): storefront-product, live-shopping, label-pitch, SyncTab, discovery cards, scheduler. FIX: extend the 100/200 text remaps to the shipped opacity rungs + coverage test. [A4-D3]
39. **Gradient-end `to-[#0d0a04]` has no remap rule** — stream/playlist Series Studio panel goes ivory-to-black in light (labels sink), gamers chips, AttachmentView gradient. FIX: add the missing gradient-end rule(s) in index.css + coverage test. [A4-A1/A2/A3]
40. **Custom-domain sites lose the theme toggle + hardcode black** — SiteModeGate replaces AppShell (where the only FloatingThemeToggle lives); SiteMode splash + not-found are `bg-black` in both themes. FIX: mount the toggle in the SiteMode shell; theme the splash/not-found surfaces. [A4-F1]
41. **Homepage demo panels are ghost glass in dark** — `home.tsx:708,725` `bg-black/40` + `border-white/[0.07]` directly over the stage photo, no solid ground. FIX: sanctioned solid panel ground (the shell's `.content-panel` pattern). Restores the owner's solid-panel law — not a redesign. [A4-F2]
42. **Outside-table surfaces batch** — party.tsx pale-gold `text-[#f0d878]` on a remapping scrim (~1.4:1 flash), context-menu `bg-[#0a0a0a]/[0.98]`, StreamAlertOverlay `bg-[#14100a]/95`. FIX: remap rules or token swaps per surface + coverage test. [A4-D4/D5/D6]

## V · ROUTES & DOORS (A1)

43. **Lip Sync's two primary buttons are permanently disabled, unexplained** — `LipSyncStudio.tsx:543,553` bare `disabled`, no label/title/copy. FIX: wire to the existing lip-sync run flow if the component's rails support it, else honest "Coming soon" labeling per the analytics-hub pattern — the lane documents which from code. [A1-01]
44. **Sidebar "Quests" door drops users at the top of the Dashboard** — QuestsWidget sits mid-page (`dashboard.tsx:510`) with no `id`; the door carries no anchor. FIX: widget id + anchor link (scroll-margin for the shell header). [A1-03]
45. **Pricing WantedMeter stars lie to screen readers** — `pricing.tsx:156` hardcodes `aria-checked={false}`. FIX: bind aria-checked to selection state. [A1-04]
46. **Templates gallery promises guests what the gate denies** — page/hub copy says "Public… No login required / free to browse" and the public footer links guests in, but GuestGate walls /templates* (rig-proven). FIX: copy aligned to the access law (sign-in to browse) everywhere the promise appears. NOTE: opening the route instead is the owner's alternative — not taken by this stack. [A1-02]

## VI · MOBILE + FIRST LOAD (A5)

47. **Home first load is 10.9 MB (dark) / 5.8 MB (light) vs the 2.5 MB Oct 22 baseline** — CinematicHero loads all 3 sprite sheets at mount (5.47 MB) + FogCanvas loads 3 PNG smoke textures (4.45 MB) before code/fonts. FIX: defer sprite/fog media until after first paint / on hero visibility, keeping the shipped look identical once loaded (hero law surfaces untouched: fog z, set, King, mic, copy layers unchanged). [A5-P1]
48. **English catalog is 42% of entry gzip** — en.json (218 KB gzip) ships inside the 1.74 MB entry chunk for every visitor. FIX: split locale catalogs out of the entry path (async locale loading; en inlined only if the i18n stack requires a fallback, documented). [A5-P2]
49. **21 marketing/SEO page modules are eager for every visitor** despite 127 lazy routes. FIX: move the eager set behind the same lazy route pattern; entry composition test. [A5-P3]
50. **33 Google-Font families block paint on every route** — 3 stylesheets in index.html; only Inter/Playfair are UI fonts. FIX: caption/library families load on demand in the surfaces that use them; UI fonts stay; font-display behavior pinned. [A5-P4]
51. **No chunk budget; giant lazy chunks wait downstream** — video-editor 374 KB gzip, world 287 KB, hall-scene 177 KB, analytics-hub 147 KB (recharts inside). FIX: split the worst offenders along their natural seams + a chunkSizeWarningLimit/budget check in the build config so regressions surface. [A5-P5]
52. **The generation-wait screen downloads a 12.9 MB video** — witty-loader plays `loading-light-temp.mp4` as a waiting background (poster already exists). FIX: poster-first; the video fetches only when a wait actually runs (preload="none" / lazy mount). [A5-P7]
53. **Video Editor is unusable under 768px** — both section panels are `hidden md:block` (`video-editor.tsx:2216,3249`); all 19+ section renders live inside them; rail buttons switch state to nothing. FIX: a mobile section sheet/panel so every editor section is reachable and usable at 390px. **VISUAL CHANGE → Gate-1 preview artifact required before this item can close; artifact ID recorded in the closure log.** [A5-M1]
54. **Pinch zoom is disabled site-wide** — `index.html:5` `maximum-scale=1`. FIX: remove the zoom cap (keep viewport-fit), verify no layout depends on it. [A5-M2]
55. **Tables silently clip at 390px** — live-shopping revenue table + SplitCalculator collaborators table sit in `overflow-hidden` parents with no scroll wrapper (the global overflow-x: clip guard hides the symptom); llc-guide fee table is vertical-scroll only. FIX: `overflow-x-auto` wrappers per the verified store-dashboard pattern. [A5-M3]
56. **Primary tap targets under 40px** — editor transport buttons 28×28 (~13), top-bar Save/Export 32px, design-system sm=32px / icon=36px. FIX: raise the primary-action floors to ≥40px on the editor transport + top bar + the two design-system sizes (audit every consumer of sm/icon for layout breakage). [A5-M4]
57. **Editor text below readable size** — video-editor alone has 57 sub-12px hits incl. 9px transport labels and a 7px badge. FIX: editor-scoped readability pass (transport labels, badges, panel microcopy → ≥11px with layout preserved). [A5-M5-scoped]
58. **Floating chrome stacks collide at 390px** — top-left carries language switcher + theme toggle + Enter-the-World pill in the same ~150px; bottom carries sidebar trigger + player bar + chat drawer with no shared budget. FIX: a corner budget in the shell (offset/stacking rules per breakpoint), verified on home + one interior page. [A5-M6]

## VII · PARKED — named, with the reason (not dropped, not forced)

59. **PARKED — "19 studios" count** (en.json:92,115,291,451; home.tsx:138,173): no derivation exists anywhere in the tree. Owner copy call — already on his list as Stack-27 S27-24. [A2-11]
60. **PARKED — ActiveArtistBanner inline black slab**: remediation is light-branch vs formal dark-lock — an open owner design call (Stack-27 S27-61). Readable in both themes today. [A4-B1]
61. **PARKED — World ShopStands first-paint fee flash**: `components/world/native/ShopStands.tsx` initialises feePct to 10 and can paint 90/10 before the server's 5% lands. File belongs to the World lane's surface family — cross-lane hand-off, named for the sibling coordinator. [A2-13]
62. **PARKED — Lock cards have no "choose another room" door** (A1-05): the cards live in world.tsx and their flow is the World lane's surface in this stack; the z-20 directory bar above the overlay already stays clickable (mitigation verified). Cross-lane hand-off. [A1-05]
63. **PARKED — KB in-world parity registry (full form)**: teaching the generator a stations-registry source (`lib/world/stations.ts`) so every native desk is a KB fact is a design decision; the minimum honest line ships in item 20. [A6-K7-full]
64. **PARKED — World textures 404 on R2 before origin fallback** (9 textures, ~6.06 MB, every cold World load): the loader (`hallTexture()`) is World-lane scene code. Cross-lane hand-off. [A5-X1]
65. **PARKED — King's Set media never mirrored to R2** (~19.9 MB served from origin): the mirror upload needs the bucket credentials held only in the suspended staging service's Render env (browser-task step) — same blocker as Stack-27 S27-16. [A5-X2]
66. **PARKED — Emoji stickers bypass the CDN**: `kingEmojiUrl()` is origin-relative; pointing it at the CDN before the stickers exist on R2 would 404 them. Rides the same credential blocker as item 65. [A5-X4]
67. **PARKED — 277.5 MB of duplicated media still ships in `public/`**: R2 migration duplicated instead of moving; removal is a deletion — already inside the owner's pending 90-candidate deletion ruling (incl. the dead `public/images/king-throne-room.webp`). No file is deleted by this stack. [A5-X3/X5]
68. **PARKED — Stale extra locale keys** (21–105 per locale not present in en, mostly dead `nav.*`): removal from the catalogs is a deletion-class change; waves in §VIII leave them untouched and the closure audit re-counts them. [A7-side]
69. **PARKED — 145 en keys carry {{count}} with no plural forms**: converting them is an en-source change that ripples all 9 catalogs + the guard; scoped as its own future item rather than smuggled into a wave. [A7-§4]

## VIII · LOCALE GAP CLOSURE — guard-external waves (A7)

Standard for every wave: close the wave's missing keys AND translate its REAL identical-to-en values (per A7 §1.4 classification; legit identicals — brand/house names, platforms, URLs, numbers/formats, per-locale cognates — stay identical and are documented in the wave log). Commerce inversions and brand erasures are the priority defect classes (Stack-26 standard). CLDR plural families completed whole (all suffix forms the locale requires). Byte-verified JSON (no U+FFFD introduced; hi waves also repair the 18 pre-corrupted keys assigned to them in A7 §3). Each wave closes with a pin: a wave test asserting the wave's namespaces are 100% present and no wave key remains REAL-identical. Namespace lists are verbatim from A7 §5 (`a7-locale.md`); key counts = missing + identical per A7.

70. **ar-W1** (656) — commerce first: pricing, referrals, merch, memberships + wave namespaces per A7 §5.
71. **de-W1** (687) — pricing, referrals, merch, memberships + §5.
72. **es-W1** (687) — pricing, referrals, merch, memberships + §5.
73. **fr-W1** (700) — pricing, referrals, merch, memberships + §5.
74. **hi-W1** (700) — pricing, referrals, memberships, merch + §5 (+ assigned FFFD repairs).
75. **it-W1** (681) — pricing, referrals, memberships, merch + §5.
76. **ja-W1** (663) — pricing, referrals, memberships, merch + §5.
77. **ko-W1** (670) — pricing, referrals, memberships, merch + §5.
78. **pt-W1** (699) — pricing, referrals, memberships, merch + §5.
79. **ar-W2** (692) — retentionDoctor, retentionDelight, invite, fomoFeed + §5.
80. **de-W2** (661) — distribute, labelPitch, brandCalculator, playlistPitch + §5.
81. **es-W2** (669) — retentionDoctor, retentionDelight, invite, fomoFeed + §5.
82. **fr-W2** (695) — brandCalculator, sponsorsPost, playlistPitch, sponsors + §5.
83. **hi-W2** (663) — brandCalculator, playlistPitch, retentionDoctor, retentionDelight + §5 (+ FFFD).
84. **it-W2** (700) — labelPitch, distribute, brandCalculator, playlistPitch + §5.
85. **ja-W2** (661) — retentionDoctor, retentionDelight, invite, fomoFeed + §5.
86. **ko-W2** (663) — retentionDoctor, retentionDelight, invite, fomoFeed + §5.
87. **pt-W2** (695) — sponsorDealDetail, sponsors, sponsorsPost, retentionDoctor + §5.
88. **ar-W3** (699) — bgStudio, headshotStudio, colorGrade, photoEnhance + §5.
89. **de-W3** (676) — movies, motionGraphics, cartoonStudio, bgStudio + §5.
90. **es-W3** (684) — cartoonStudio, bgStudio, headshotStudio, colorGrade + §5.
91. **fr-W3** (690) — cartoonStudio, bgStudio, headshotStudio, colorGrade + §5.
92. **hi-W3** (661) — cartoonStudio, bgStudio, headshotStudio, colorGrade + §5 (+ FFFD).
93. **it-W3** (659) — motionGraphics, cartoonStudio, bgStudio, headshotStudio + §5.
94. **ja-W3** (660) — cartoonStudio, bgStudio, headshotStudio, colorGrade + §5.
95. **ko-W3** (698) — cartoonStudio, bgStudio, headshotStudio, colorGrade + §5.
96. **pt-W3** (688) — cartoonStudio, bgStudio, headshotStudio, colorGrade + §5.
97. **ar-W4** (687) — vocalPolish, vocalTune, songRework, producerTag + §5.
98. **ja-W4** (688) — lrcExport, samples, vocalPolish, vocalTune + §5.
99. **ko-W4** (683) — samples, vocalPolish, vocalTune, songRework + §5.
100. **hi-W4** (636) — lrcExport, samples, vocalPolish, vocalTune + §5 (+ FFFD).

## APPENDIX — real but unboarded (named overflow, next stack's first candidates)

Locale waves beyond item 100 (A7 §5, exact): de-W4 (595), es-W4 (617), fr-W4 (627), it-W4 (534), pt-W4 (628), ar-W5 (486), de-W5 (700), es-W5 (664), fr-W5 (685), hi-W5 (666), it-W5 (672), ja-W5 (700), ko-W5 (654), pt-W5 (672), ar-W6 (447), de-W6 (479), es-W6 (567), fr-W6 (605), hi-W6 (515), it-W6 (459), ja-W6 (365), ko-W6 (360), pt-W6 (556), de-W7 (470), it-W7 (412) — 25 waves ≈ 13,900 keys. Plus: SecretChallengePopup's false "bundled through Vite" header comment (A5-X5, honesty nit), the A5-M7 note that the overflow-clip guard can mask future real overflows, and A6's minor desk observations (prompt chips clobber typed text; brand-palette latch is one-way; generate confirmation names the model "(Turbo)" vs registry "(Pro)").
