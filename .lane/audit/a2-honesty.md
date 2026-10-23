# AUDIT LANE A2 — HONESTY: DISPLAYED vs CHARGED, PROMISED vs DELIVERED

Tree: `~/workspace/bdv-wt-stack28`, branch `stack28/site` @ `0bdfcefa`. Read-only audit; no code edited.
Method: frontend credit-cost registry (`artifacts/bow-down-visuals/src/lib/credit-costs.ts`) and every
rendered price string in pages/components/locales were cross-checked against the actual charge site in
`artifacts/api-server/src` (charge constants + `chargeCredits` call sites, handler-scoped). A scripted
sweep of all ~190 registry entries was run; every candidate it flagged was verified by hand at the
handler level (7 of 7 script "mismatch" candidates were same-file/multi-handler false positives —
see Verified Consistent). Prior pins (`credit-costs-rail-truth.test.ts`, `honesty-copy-prices.test.ts`)
were re-verified, not assumed.

Severity key: HIGH = user is shown a materially wrong price at a spend moment (100× or a phantom
charge). MED = wrong price/fee/promise in sales copy or a confirmation path. LOW = transient,
label-only, or unsubstantiated-but-not-priced copy.

---

## CONFIRMED DISPLAY ≠ CHARGE MISMATCHES

### A2-01 — Distribution tier fallback shows 10 / 20 / 30 VB; rail charges 1,000 / 2,000 / 3,000 VB
- Claim (display): Single 10, EP 20, Album 30 Visual Bucs.
  - `artifacts/bow-down-visuals/src/lib/distribution.ts:41-45` — `DISTRIBUTION_TIERS` credits 10/20/30; `tierCredits()` at :49-51 (fallback `?? 10`).
  - Rendered at `artifacts/bow-down-visuals/src/pages/distribute.tsx:556` (tier cards fall back to `DISTRIBUTION_TIERS` when live pricing absent), `:397` + `:914` + `:924` (wizard price + "Create & pay {tierPrice} Visual Bucs"), and `:2072` + `:2077-2080` (release-detail submit price printed in the `window.confirm` the user agrees to).
  - World twin: `artifacts/bow-down-visuals/src/lib/world/release-desk.ts:79-85` (`FALLBACK_PRICING` built from the same constants).
- Truth (charge): `artifacts/api-server/src/routes/generate/distribution.ts:58-62` — `RELEASE_TIER_CREDITS` single 1000 / ep 2000 / album 3000; charged at `:1351-1368` (`chargeCredits(req.userId!, cost)` in the submit handler). Live pricing endpoint at `:1449-1475` returns the true figures.
- Reachability proof (scope item 3, full proof in §3 below): the fallback is NOT dead code. On `/distribute`, `pricing` starts `null` (`distribute.tsx:3141`) and stays `null` forever if the pricing fetch fails, is non-OK, or returns no `tiers` array (`:3209-3227`, catch comment: "pricing falls back to the lib constants"). Before the fetch resolves, and permanently after any failure, every display above — including the pre-spend confirmation — shows 10/20/30 while the rail charges 1000/2000/3000. Aligning the fallback constants to 1000/2000/3000 would change NO charged price (the rail never reads the frontend constants; the charge is `RELEASE_TIER_CREDITS[releaseType]` server-side) — it would only fix the display.
- Severity: HIGH (100× understatement at the exact confirmation moment, on a real failure path).

### A2-02 — Instagram publish modal says 200 VB; rail charges 100 VB
- Display: `artifacts/bow-down-visuals/src/components/InstagramPostModal.tsx:203` ("200 Visual Bucs · publishes as a Reel") and `:308` ("Publish Reel · 200 Visual Bucs"). The modal posts to `/api/social/instagram/publish` (`:150`, via confirmedFetch).
- Charge: `artifacts/api-server/src/routes/social.ts:115` `INSTAGRAM_POST_CREDITS … || 100`; charged at `:501`. Registry agrees with the rail: `credit-costs.ts` `/api/social/instagram/publish` = 100 (so the spend-confirmation dialog says 100 while the modal's own copy says 200 — the two displays contradict each other in the same flow).
- Severity: MED (overstatement; same defect class S27-21 fixed in ConnectedAccounts/FacebookPostModal but missed these two modals).

### A2-03 — TikTok publish modal says 200 VB; rail charges 100 VB
- Display: `artifacts/bow-down-visuals/src/components/TikTokPostModal.tsx:213` and `:326` ("200 Visual Bucs"). Posts to `/api/social/tiktok/publish` (`:158`).
- Charge: `artifacts/api-server/src/routes/social.ts:706` `TIKTOK_POST_CREDITS … || 100`. Registry = 100.
- Severity: MED (same as A2-02).

### A2-04 — Pre-x100 stale price family: seven surfaces display 1–2 VB; rails charge 100–200 VB
All of these endpoints are ALSO missing from `credit-costs.ts` entirely, so confirmedFetch has no
correct figure to show — the stale copy is the only price the user sees. (Registry does contain the
different endpoint `/api/meme` = 100 and `/api/comment-replies` = 100, neither of which is the rail
these surfaces call.)

| Surface (display) | Displayed | Endpoint | Charged | Rail evidence |
|---|---|---|---|---|
| Meme Machine desc — `components/editor/sections/MemeMachineSection.tsx:171`; also `locales/en.json:7493` `memeMachineDesc` | 1 VB | `/api/meme-machine/captions` (Section :111) | 100 | `api-server/src/routes/generate/meme-machine.ts:24` `CAPTIONS_CREDITS … \|\| 100`, charged :65 |
| Style Stealer desc — `components/editor/sections/StyleStealerSection.tsx:140`; `locales/en.json:7509` | 2 VB | `/api/style-stealer/analyze` | 200 | `routes/generate/style-stealer.ts:37` `ANALYZE_CREDITS … \|\| 200`, charged :179 |
| Three Second Lab desc — `components/editor/sections/ThreeSecondLabSection.tsx:130`; `locales/en.json:7525` `labDesc` | 2 VB | `/api/three-second-lab/openings` | 200 | `routes/generate/three-second-lab.ts:31` `OPENINGS_CREDITS … \|\| 200`, charged :94 |
| Stream Copilot prep button — `components/go-live/StreamCopilotSection.tsx:155` | 1 VB | `/api/stream-copilot/prep` | 100 | `routes/generate/stream-copilot.ts:31` `PREP_CREDITS … \|\| 100` |
| Stream Copilot clips button — `StreamCopilotSection.tsx:188` | 1 VB | `/api/stream-copilot/clip-plan` | 100 | `stream-copilot.ts:32` `CLIP_PLAN_CREDITS … \|\| 100` |
| Trend Jacker cost — `components/scheduler/TrendJackerSection.tsx:145` | 2 VB / draft | `/api/trend-jacker/draft` | 200 | `routes/generate/trend-jacker.ts:28` `DRAFT_CREDITS … \|\| 200`, charged :87 |
| Lyric Stories cost — `components/hooks/LyricStoriesSection.tsx:91` | 2 VB / card | `/api/lyric-stories/generate` | 200 / card | `routes/generate/lyric-stories.ts:24-25` `CREDITS_PER_CARD … \|\| 200`; total = per-card × count at :115, charged :127 |
| Community tools — `pages/community.tsx:63-66` (tool list), rendered `:641`, `:706`, `:777`; also `locales/en.json:2703-2715` | 1 VB / 50 comments, / batch, / report, / scan | `/api/community/moderate`, `/api/comment-replies`, `/api/community/sentiment`, `/api/community/superfans` | 100 each (moderation: 100 per 50-comment batch) | `routes/generate/community.ts:21-29` (`COMMUNITY_MODERATE_CREDITS`, `…_SENTIMENT_…`, `…_SUPERFAN_…`, `…_REPLY_…` all `|| 100`), batch size 50 at :23, cost fn :33 |

Translated locales carry the same stale figures (e.g. `locales/ar.json:2497-2509, 6635, 6695, 7000`;
`locales/de.json:2477-2489, 6587, 6647, 6952`).
- Severity: HIGH (100× understatement, rendered, on eight priced actions; the server's own header
  comments in those route files still say "1 credit" / "2 credits" — the x100 migration updated the
  constants but not the copy).

### A2-05 — Export Doctor: registry + confirmation dialog quote 100–400 VB for 13 endpoints; the rail charges 0
- Display: `credit-costs.ts:69-100` — `/api/export-doctor/export` 400, `export-all` 400,
  `export-audio` 200, `export-all-audio` 200, `export-all-captions` 200, `export-all-effects` 200,
  `export-all-overlays` 200, `export-overlays-range` 200, `export-effects-range` 200,
  `export-effects-transitions` 200, `export-audio-sync-short` 200, `repair-normalize` 100,
  `repair-clip` 100. These are user-visible: `components/editor/sections/ExportDoctor.tsx` routes
  these calls through confirmedFetch (e.g. :880, :902, :954, :995, :1070, :1093, :1187, :1308,
  :1339, :1372, :1411, :1450, :1484), so the spend-confirmation names these prices, and the
  operator knowledge base quotes the same registry.
- Truth: `artifacts/api-server/src/routes/generate/export-doctor.ts` (5,208 lines) contains ZERO
  credit logic — no `chargeCredits`, no `deductCredits`, no occurrence of the word "credit" at all;
  its helper `routes/generate/effects-ffmpeg.ts` likewise has 0 charge calls. Nothing is ever charged.
- Severity: HIGH (systematic phantom prices: users "confirm" spends that never happen; balances
  never move, so the confirmation is fiction in the overstatement direction).

### A2-06 — `/api/chat`: registry says 100 VB; rail default charges 1 VB; code comments disagree with both
- Display: `credit-costs.ts:173` — `"/api/chat": { cost: 100, feature: "Chat Message" }` (this is
  what the operator quotes from the registry).
- Charge: `artifacts/api-server/src/lib/ai-chat-assistant.ts:71-74` — `getChatCreditCost()` defaults
  to `Number(process.env["CHAT_CREDIT_COST"] ?? "1")` = **1** (a pre-x100 leftover default), charged
  at `artifacts/api-server/src/routes/chat.ts:94-104`. The header comment in the same route file
  (`chat.ts:38-39`) claims "Free by default (CHAT_CREDIT_COST=0)" — false against the `?? "1"`
  default. Env-dependent: with `CHAT_CREDIT_COST` set the charge is that value; nothing in the tree
  sets it to 100.
- Mitigating fact: the live chat widget does not use this rail — `components/ThyCheatCodeChat.tsx:216,337`
  posts to `/api/free-chat` (free; `routes/free-chat.ts:177`), and its own comment (:229) says "chat
  is now free". So the mismatch hits the operator's quoted price and any direct `/api/chat` caller,
  not the widget user.
- Severity: MED (three-way disagreement: display 100 / default charge 1 / comments "free").

### A2-07 — Homepage "Promo Clips" price 400 VB (and a 1,300 VB bundle total); rail charges 100 VB
- Display: `locales/en.json` studio grid, Promote category "Promo Clips" `"cost": "400 VB"` (:346);
  FAQ at `:459`: "A song (400 VB) + a music video (400 VB) + promo clips (400 VB) + a hook pack
  (100 VB) = 1,300 Visual Bucs." Same grid/FAQ hardcoded in `pages/home.tsx:138` (FAQ answer).
- Charge: `artifacts/api-server/src/routes/generate/promo.ts:11` `CREDIT_COST = 100`, charged :185;
  registry `credit-costs.ts:58` = 100. True bundle total = 400+400+100+100 = **1,000**, not 1,300.
- Severity: MED (headline sales copy overstates a flagship tool 4× and mis-adds the bundle).

### A2-08 — Single-shot thumbnail: registry/HelpPanel say 100 (range 100–200); delivered charge is 300 when the image lands
- Display: `credit-costs.ts:139` `/api/generate-thumbnail` = 100. `components/HelpPanel.tsx:23-29`
  derives its thumbnail range from the registry: 100–200 VB.
- Charge: `artifacts/api-server/src/routes/generate/thumbnail.ts:17-21` — `TEXT_CREDIT_COST = 100`,
  `IMAGE_CREDIT_COST = 200`, pre-check requires the full 300 (`CREDIT_COST`, :272-273); actual
  charge at :339-344 is `100 + (thumbnailImageUrl ? 200 : 0)` — i.e. **300 in the normal delivered
  case**, 100 only when image generation fails. The 402 pre-check also means a user with 100–299 VB
  who believed the displayed 100 price is refused outright.
- Severity: MED (understatement on the success path; the registry figure is the failure-path price).

### A2-09 — Tier fee story (Free 10% / Pro 7% / Elite 5%) vs checkout rails: flat 5% for everyone
- Display: `pages/creator-pricing.tsx:184` ("Pro takes 7% instead of 10%"), `:210` ("Free keeps
  90% of every sale, Pro keeps 93%"), `:383` ("Free sells with the standard 10% fee");
  `guides/pricing.ts:26-38` (Pro "drops your platform fee to 7%", Elite "lowest platform fee …
  at 5%", tip "fee drop from 10% to 7%"); server-side catalog copy in
  `api-server/src/lib/platform-fees.ts` TIER_PLANS feature labels ("standard 10% fee" / "Only 7%
  platform fee" / "Only 5% platform fee", :159-205) with `TIER_FEE_BPS` free 1000 / pro 700 /
  elite 500 at :41-45.
- Charged: shop/storefront/store checkout rails apply `STOREFRONT_PLATFORM_FEE_BPS = 500` (5%) flat,
  regardless of tier — `api-server/src/routes/generate/shops.ts:1056-1058` (owner ruling
  2026-10-18 comment on the constant), fee taken at `:1487`; `routes/store.ts:58` reuses the same
  constant; `routes/storefront.ts:182` `feeSplit(amountCents, PLATFORM_FEE_BPS)` (same 500).
  `feeSplitForTier` / `TIER_FEE_BPS` are consumed only by `routes/creator-tiers.ts` (:137-138,
  :320, :361-378) for tier display and next-tier projections — no checkout rail charges by tier.
- Net: a Free seller is told 10% and charged 5%; a Pro seller is told 7% (a paid benefit of the
  $12/mo plan) and charged the same 5% as Free. The tier fee ladder as displayed is not delivered
  by any sale rail.
- Severity: MED-HIGH (pricing-page fee promises ≠ charged fees; also undercuts the paid tiers'
  headline benefit).
- NOT part of this mismatch (verified consistent): memberships rail is genuinely 10%
  (`routes/generate/memberships.ts:44` `MEMBERSHIPS_PLATFORM_FEE_PCT = 10`; `pages/memberships.tsx:15`
  says 10%); shoutouts 10% (`routes/generate/shoutouts.ts:38`); beats 15%
  (`routes/generate/beats-pricing.ts:16`; `pages/beats.tsx:41` says 15%); sponsors 15%
  (`routes/generate/sponsors.ts:498` 1500 bps; `pages/sponsor-deal-detail.tsx:20` says 15%);
  live shopping 5% (`pages/live-shopping.tsx:22` + `src/lib/live-shopping.ts:21`).

---

## PROMISED vs DELIVERED (non-price)

### A2-10 — Distribute: hero promises real platform delivery; default aggregator is a sandbox that delivers nothing — and distribution charges real VB for it
- Claim: `locales/en.json:3313` hero sub ("Get your music on Spotify, Apple Music, TikTok, and
  every major platform…"), rendered at `pages/distribute.tsx:3276`. The submit confirmation
  (`distribute.tsx:2077-2080`, and the World twin in `components/world/native/ReleaseDesk.tsx`
  submitRelease) says "This pays the aggregator delivery fee and queues delivery to {platforms}"
  with no sandbox qualifier in the dialog itself.
- Truth: `api-server/src/lib/distribution-aggregator.ts:247-254` — `getAggregator()` returns
  `TooLostAdapter` only when `DISTRIBUTION_AGGREGATOR=toolost` AND `TOOLOST_API_KEY` set; otherwise
  `MockAggregatorAdapter` (:117). In mock mode the submit handler charges the full tier price
  (A2-01) and the API notice admits simulation (`distribution.ts:1433-1438`).
- Mitigations present (credit where due): sandbox badges/notices in the wizard
  (`distribute.tsx:548-550, 915-917`), the submitted view (:2621-2634), and `SandboxBadge` on the
  release detail (:218-223, :2258) — but all appear around/after the spend, none in the hero or
  the confirmation dialog.
- Severity: MED (promise framing vs delivery reality; labeling exists but not at the two moments
  that sell and confirm).

### A2-11 — "19 studios" — a count with no derivation anywhere in the tree
- Claim: `locales/en.json:92` (meta description), `:115` (heroSub), `:291` (manifestoBody),
  `:451` (FAQ); hardcoded again in `pages/home.tsx:138,173`.
- Truth: no constant, list, or count of 19 studios exists in the codebase — grep for the figure
  finds only this copy. The site ships 168 page files under `src/pages/` and the operator
  knowledge base counts 235 features; nothing derives 19. The number is unsubstantiated by any
  source in the tree (it may be a legacy count, but no current derivation supports it).
- Severity: LOW-MED (unverifiable marketing count on the homepage + SEO meta).

### A2-12 — Post-grand-push staleness: Go Live hub still describes the World as one hall (scope item 4)
- Claim: `pages/go-live.tsx:510-517` — "The World — step into the King's Hall", "One room,
  everybody in it together: walk the hall, watch the big screen, talk by proximity", CTA
  "Enter the hall".
- Truth: since the open-world push, entry lands on the King's Plaza in an open world of
  districts — `pages/world.tsx:316` (page title "The World — The King's Plaza"), `:356-361`
  ("Admission lands on the King's Plaza (Open World Phase 1)…"), `:2806` ("Entering the King's
  Plaza…"). The hall is one interior space, not the entry or the whole World.
- Also: `components/EnterWorldButton.tsx:25-26` — aria-label/title "Enter the World — step into
  the King's Hall" (label-only staleness).
- Checked and NOT stale: wallpapers are present and linked (branding-kit tab
  `pages/branding-kit.tsx:45`, Create panel `pages/create.tsx:53`); no non-World copy found
  calling the World/districts "coming soon" or closed; no "wallpapers coming/absent" copy found.
- Severity: LOW-MED (go-live card), LOW (button label).

### A2-13 — Shop stand initial fee state renders 10% before the server value lands (transient)
- `components/world/native/ShopStands.tsx:178` — `useState(10)` for `feePct`, corrected to the
  server value on load (`:226` `setFeePct(data.platformFeePct ?? 5)`; server sends 5,
  `shops.ts:1214`). The rendered line at `:475` ("Sellers keep {100 - feePct}%…") can therefore
  paint 90%/10% briefly before settling to the true 95%/5%. The membership desk in the same file
  (:1972) also inits 10 but its server value genuinely is 10 (A2-09 note), so only the shop
  stand's initial frame is wrong.
- Severity: LOW (transient first paint; settles to truth without interaction).

---

## §3 — DISTRIBUTION PRICING PROOF (scope item 3, standalone)

Question: are the frontend fallback constants (10/20/30) reachable in any user path, and would
aligning them change any charged price?

1. The rail never reads them. The only charge for a distribution submit is
   `RELEASE_TIER_CREDITS[releaseType]` in `api-server/src/routes/generate/distribution.ts:1351`,
   charged at `:1368`. `RELEASE_TIER_CREDITS` (:58-62) = 1000 / 2000 / 3000 (env-overridable
   server-side only). The frontend constants in `src/lib/distribution.ts:41-45` are display-only.
   → Aligning the fallback to 1000/2000/3000 changes NO charged price, in either direction.
2. The fallback IS reachable, three ways:
   a. Initial paint: `pages/distribute.tsx:3141` `useState<PricingInfo | null>(null)` — until the
      pricing fetch resolves, `tierCards` (:556), wizard `tierPrice` (:397, rendered :914, :924),
      and detail `submitPrice` (:2072) all resolve through `tierCredits()` → 10/20/30.
   b. Fetch failure: `:3209-3227` — non-OK response, thrown fetch, or a body without a `tiers`
      array leaves `pricing` null permanently (catch comment: "pricing falls back to the lib
      constants"). Same displays as (a), including the `window.confirm` at :2077-2080 that quotes
      `submitPrice` immediately before the paid submit POST.
   c. World Release Desk: `lib/world/release-desk.ts:101` — `parseReleasePricing` returns
      `FALLBACK_PRICING` (built from the same 10/20/30 constants, :79-85) whenever the pricing
      payload yields zero tiers; `submitPriceFor` (:112-113) then quotes the fallback in the
      World submit confirmation. (The desk does block submit while `pricing` is wholly null —
      `components/world/native/ReleaseDesk.tsx` submitRelease guard — so the World path needs a
      malformed-but-OK pricing response, while the 2D paths need only a slow or failed fetch.)
3. Related constants checked: `DISTRIBUTION_AI_CREDIT_COST = 100` (`lib/distribution.ts:21`)
   MATCHES the rail (`distribution.ts:41`, charged :528/:626; also returned live by the pricing
   endpoint :1472-1473). `DISTRIBUTION_PACKAGING_CREDITS = 10` (`lib/distribution.ts:22`) has no
   server counterpart and is never rendered — imported and assigned at `distribute.tsx:61` and
   never used again (dead display constant, not a user-facing mismatch). The pricing endpoint's
   own fallback inside `distribute.tsx:3219-3220` (`aiMetadataCost ?? 1`) is unreachable against
   the real endpoint, which always returns both fields (:1472-1473).
4. Stale server comments: `distribution.ts:36-41` and `:47-56` still describe "10 credits per
   release" and "Single 10cr ≈ $5.00" — pre-x100 prose around the correct 1000/2000/3000
   constants. Comments only; no user sees them.

Conclusion: the fallback is a live display path, not a safety net that never fires; the fix is
display-side only and cannot move any charge.

---

## VERIFIED CONSISTENT (checked, no mismatch — including the known-fixed list)

- Known-fixed, still fixed: jewelry STL 400 (`routes/generate/jewelry-pricing.ts:15`; registry
  `credit-costs.ts` `/api/jewelry/export-stl` 400); sample packs 500/1200/2000
  (`routes/generate/sample-pack-pricing.ts:13-15`); Auto-Grade 100
  (`routes/generate/pro-tools-ai.ts:32`; registry 100); template apply 250
  (server `TEMPLATE_COST = 250`; registry `/api/video-template/apply` 250).
- Registry sweep: every other registry entry with a resolvable handler-level charge matched,
  including songs 400/800/1200 tiers (`routes/generate/music-audio.ts:40-43`), hum-to-song 500 +
  extend-by-length (400 for 30s), voice clone 500 / vault clone 200, stems 400 / instrumental 300
  (`stem-splitter.ts:24,28,560`), mix/master 800/1500, harmony classic 300 / AI 600
  (`song-harmony.ts:54-55`), intro/outro 750 = 5s × 150 (`intro-outro-pricing.ts:17-22`),
  logo standard 100 / premium 200 (`logo-pricing.ts:9-10`; FE `pages/logo-maker.tsx:35` displays
  both), cover art standard 200 / premium 300 (`cover-art.ts:20-23`; FE passes `overrideCost`
  per tier, `pages/cover-art.tsx:98-99`), product photo packshot 100 / lifestyle 150 (FE
  constants = server constants, passed as `overrideCost`, `components/photo/ProductPhotoStudio.tsx:26-27,173`),
  artist-image models 100/100/100/200/100 (FE `components/generate-artist-image.ts:22-28` =
  `artist-image-pricing.ts:10-30`), brand deals 200/100, show finder 200/100, freeze 150 / mask
  200, thumbnail batch 200, thumbnail test/improve 200/200, AI interview questions 100 / package
  200, niche 150 / validate-idea 75, catalog vault 200 (`milestones.ts:41`), website builder
  3000/200 (admin-only page), wallpaper clean 400 / screensaver 400 / branded free
  (`routes/wallpapers.ts:23,28,326-338`), spoken replies 100 (`routes/chat-speak.ts:52-53`,
  FE reads it from `/api/chat/speak/status`, never hardcodes).
- Money packs: FE 1,000/$9, 5,000/$39, 15,000/$99, 50,000/$249 (`locales/en.json`
  pricing.creditPacks) = server credit amounts (`routes/stripe-payments.ts:16-19`); dollar
  prices live in Stripe price IDs (test mode, labeled as such on the page).
- Ads: Spotlight $1,000/7 days (`lib/db/src/schema/spotlight.ts:30`; `components/SpotlightPromo.tsx:43`),
  Loading Screen $2,500 fallback (`components/LoadingScreenModal.tsx:66`) — both derive from the
  server offer with matching fallbacks.
- Creator tiers $12 / $29 (`guides/pricing.ts:26-38`, `pages/creator-pricing.tsx`) =
  `lib/platform-fees.ts` TIER_PLANS (approved prices in code). Hosting plan honestly shows
  "price coming soon" (`creator-pricing.tsx:307`) matching `hostingPriceConfigured()` = false
  until the owner sets a price (`platform-fees.ts`, HOSTING_PLAN block).
- Legacy subscription plans on `/pricing` are honestly parked: locale note "Billing is not live
  yet. All plan buttons join the beta list" — no rail charges them.
- Referrals: referee welcome 1,000 VB (`routes/referrals.ts:19`; FE derives from server `info`),
  promoter ladder 25/28/30/33/35/40% rendered from server data (`pages/referrals.tsx:580,616,782`
  read `ratePct` from the API payload, tiers at `referrals.ts:38-44`), 90-day share window
  (`referrals.ts:21` = the "25% … for 90 days" blurb in `PlanReview.tsx` via `locales/en.json:11339,11347`
  — accurate at the entry tier; higher tiers earn more, so the blurb understates, never overstates).
- Jackpot: monthly prize 10,000 VB (`routes/cheat-code.ts:76`) = FE display
  (`components/cheat-code-jackpot.tsx:631`).
- Distribute Unlimited 399/yr: displayed only as "coming soon" (`distribute.tsx:3277-3280` from
  the live pricing payload; server `ANNUAL_UNLIMITED_PLAN.comingSoon: true`,
  `distribution.ts:65-72`) — promised as future, not sold. Consistent.
- Honest-parked labels verified: branding-shop checkout "coming soon"
  (`pages/branding-shop.tsx:1262`), shoutout payments "coming soon" (`pages/shoutouts.tsx:16`),
  contracts PDF upload (`pages/contracts.tsx:186`), royalty auto-sync "coming soon"
  (`components/coach/RoyaltyTrackerPanel.tsx:24`).
- Script-sweep false positives (handler-verified equal): `/api/beat/generate` 300
  (`beat.ts:10,161`), `/api/generate-song` 400 (`song.ts:12,215`), `/api/generate-song-video` 400
  (`song-video.ts:11,290`), `/api/playlist-pitch/tracker` free (only charge in file is the kit
  handler, `playlist-pitch.ts:375`), `/api/song-inspo/analyze` free (charge is in the generate
  handler, `song-inspo.ts:199`), `/api/stock/search` free (charge is import-only, `stock.ts:350`).

## NOTES / NOT COUNTED
- Code-comment staleness (not user-visible, not counted as findings): pre-x100 figures survive in
  header comments — `FinishMySong.tsx:13` "4 VB", `RateMyMix.tsx:13` "1 VB",
  `FanDecoderSection.tsx:12` "1 VB", `CoverInMotionPanel.tsx:13` "4 VB",
  `LinkToHitPanel.tsx:21` "3 VB", `pages/thumbnail-studio.tsx:102-105` "1 Visual Buc", and the
  route-file headers listed in A2-04. In every case the RENDERED string is correct (e.g.
  `FinishMySong.tsx:114` renders "400 VB", `RateMyMix.tsx:102` "100 VB",
  `FanDecoderSection.tsx:95` "100 VB", `CoverInMotionPanel.tsx:80` "400 VB").
- `/api/generate-thumbnail`'s sibling `/api/thumbnail-generator` (200) and the Artwork-mode
  single-shot flow share one studio page; A2-08 is about the single-shot rail only.
- Env-overridable charges: every figure above is the code default (env unset). Where a
  production/staging env override exists it is not visible from the tree; displays that read
  the live endpoint (distribution pricing, speak status, shop `platformFeePct`) track overrides
  automatically, hardcoded copy does not.
