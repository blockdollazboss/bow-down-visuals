<<<<<<< HEAD
# Lane stack29/w3-co-release — Co-Release (co-posts phase 2) — REPORT

Base: stack29/coposts @ d0539e1d · Branch: stack29/w3-co-release · No push.
(Phase 1's REPORT/GAP/MIGRATION for co-posts are at the parent commit and
in ~/workspace/bdv-wt-coposts/.lane/ — this lane's versions supersede them
in this branch's .lane/ with pointers back.)

## What works end-to-end (code-complete; DB half lights up with held migration 0206)

Phase 1 parked store/distribute co-release because it "rides
royalty-splits consent". This lane builds exactly that consent layer,
following phase 1's patterns (pure machine + DB translation + routes +
probe-first 503 + guarded reads + FE contract/panel docked in Collabs).

### The flow
1. **Draft** — Collabs page → **Co-releases tab** (also "Start a
   co-release" on accepted collab cards): creator A picks a partner,
   one of THEIR OWN existing items (release from
   `GET /api/distribution/releases`, or store product from their own
   storefront list), and proposes a royalty split — creator-entered
   percentages for the two sides. Server re-validates ownership of the
   item, the two-different-creators rule, and the split. A's side
   starts `accepted` (they proposed it); B's side starts `pending`.
   The co-release is visible on NEITHER profile while pending.
2. **Consent** — B must explicitly approve BOTH the split and the
   release (`POST /api/co-releases/:id/accept`). There is no publish
   path on one side's say-so: the initiator re-accepting is refused,
   strangers get 403, a decline or pre-live withdrawal ends it, and a
   late accept after either is refused (`co_release_ended`).
3. **Publish + freeze** — the second accept sets
   `co_releases.published_at` and freezes each side's
   `agreed_share_pct` from the proposal B approved, in the same
   request. From then on the item appears on BOTH profiles
   (`GET /api/co-releases/by-profile/:id`, phase-1 shared pattern) and
   the split is immutable: no API mutates it (amend-split is
   pre-publish, initiator-only, and the co-author must still approve
   the new proposal), and the held migration adds a DB trigger that
   refuses any UPDATE to the agreed columns / published_at once set.
4. **Attribution (read layer, accounting — never a payout)** —
   `GET /api/co-releases/:id/attribution` (sides only) applies the
   FROZEN split to earnings the existing rails recorded on/after
   publish: for releases, the author's logged income
   (`money_entries.release_id`, the same model as
   `GET /api/splits/overview`); for products, completed
   `store_orders.creator_amount_cents`. Cents split exactly (floor per
   side, remainder to the author — shares always sum to the total).
5. **Withdraw** — either side, after accepting: only their side's row
   changes; the item leaves THEIR profile list, the other keeps
   theirs (state `live_one_side`). The agreed split is NOT rewritten —
   past (and accruing) earnings attribution is byte-identical after a
   withdrawal (test-pinned).

### Money rules — nothing invented
- Splits are creator-entered percentages, validated server-side:
  exactly two sides, each > 0 and < 100, ≤ 2dp, sum = 100 within the
  existing distribution rail's 0.01 tolerance.
- The platform fee is NOT part of the split: product attribution
  splits only `creator_amount_cents` — what remains AFTER the store
  rail's flat 5% fee (verified in `lib/platform-fees.ts`:
  PLATFORM_FEE_BPS = 500, owner ruling 2026-10-23; env-overridable by
  the rail, never by this lane). FE copy states the 5% and the lock
  rule verbatim (pinned by tests), and `displaySharePct` shows the
  agreed share once published — displays equal rails.
- Free throughout: co-release consent is pure interface, like
  co-posts and collab requests. No price/fee was created or touched.
  The site pays nobody real money; attribution is split accounting in
  the splits/overview model, with the disclaimer in the response.

### Surfaces changed
- API: `src/lib/co-releases.ts` (pure split-consent machine),
  `src/lib/co-releases-db.ts`, `src/routes/co-releases.ts` (8
  endpoints, mounted in routes/index.ts next to co-posts).
- DB schema: `coReleasesTable` + `coReleaseSidesTable` in
  `lib/db/src/schema/collab.ts`, in sync with held migration 0206.
- FE: `src/lib/co-releases.ts` (+ tests), `src/components/collabs/
  CoReleasesPanel.tsx`, `src/pages/collabs.tsx` (Co-releases tab,
  ?tab=coreleases deep link used by notifications, accepted-collab
  "Start a co-release" buttons).

## Migration held
`co_releases` + `co_release_sides` (+ immutability triggers) — exact
idempotent SQL in `.lane/MIGRATION-NEEDED.md`, claiming **0206**
(phase 1 holds 0205), NOT applied. Until it lands: writes probe first
and answer `503 co_release_not_ready` before creating anything;
reads treat the missing tables as "no co-releases yet".

## Parked / holds (details in MIGRATION-NEEDED.md)
- **No mirroring into `distribution_royalty_splits`**: that ledger's
  owner-only PUT supersedes versions unilaterally — mirroring would
  let one side silently supersede a consented split. Integrator call,
  with the guard it would need, recorded in the migration doc.
- **Checkout rail unchanged**: store checkout still records one
  creator amount to the item's owner; the co-release split applies in
  the attribution/read layer. Splitting at the rail (per-side order
  rows/balances) needs its own migration + money review.
- No payouts anywhere (site model: Visual Bucs / creator's own money
  rails only) — attribution is accounting, stated in UI + API.

## Tests — numbers ONLY from finished logs in `.lane/logs/`
Suites run SEQUENTIALLY, `--maxWorkers=1`, TMPDIR in-worktree,
node_modules farmed from the main checkout with @workspace/db +
@workspace/api-zod verified by readlink into THIS worktree.
- Libs build (`tsc -b lib/db lib/api-zod`): exit 0 (build-libs-2.log).
- API typecheck: exit 0 (api-typecheck.log).
- API targeted (api-targeted.log): **3 files / 55 tests, all passed**
  — co-releases machine (22: no-publish-without-both-approvals, split
  sum validation, withdraw semantics, split immutability, exact-cent
  attribution, missing-table honesty) + co-posts (18) + platform-fees (15).
- API scope (api-scope.log): **5 files / 111 tests, all passed** —
  collabs, distribution, distribution-router-order, trust-money,
  paid-series-store.
- FE typecheck: exit 0 (fe-typecheck-2.log; attempt 1 was OOM-killed
  exit 137 on the shared box — load ~21 from concurrent lanes — and
  the retry with a 3 GB heap cap finished clean).
- FE targeted (fe-targeted-w3.log): **2 files / 24 tests, all passed**
  — co-releases contract (13) + co-posts (11).
- FE scope (fe-scope-w3.log): **11 files / 375 tests, all passed** —
  phase 1's scope set plus the new co-releases contract.
||||||| f1b5d666
=======
# Lane 19 (W3) — Fan Segments, fan-graph phase 2

Branch: `stack29/w3-fan-segments` off `stack29/fan-graph` @ f1b5d666.
Worktree: `~/workspace/bdv-wt-w3-fansegs` (@workspace/db + api-zod
verified resolving into THIS worktree's lib/ after mirroring the
node_modules farm from the main checkout and re-pointing the two
@workspace links; lib dists built in-worktree). No push, no
deletions, no spend, no prices.

## What phase 1's model actually provided

`lib/fan-graph.ts` (phase 1) merges 8 creator-scoped sources into
`FanRecord`: id/userId, emails[] (merge-proven set), displayName,
follows (+since), subscribed (ACTIVE only) / unsubscribed,
member {tierName, status, joinedAt}, spentUsdCents, spentVb,
purchaseCount, lastActivityAt, sources[]. The merge is conservative:
account↔email bridge ONLY via a fan_members row carrying both;
shared email alone never merges. There is NO per-fan engagement
field in the model (opens/clicks live on subscriber rows) — so fan
segments have no engagement predicate; inventing one would lie.
`GET /api/email-list/fan-graph` + `FanGraphTab` in the Email List
page are the dock; the existing desk is `routes/generate/email-list.ts`
+ `lib/email-segments.ts` (per-LIST subscriber segments) +
`lib/email-campaign-send.ts` (`dispatchCampaign` → `sendCampaignDelivery`,
the tracked Resend rail) + the poller sender
`lib/email-campaign-sender.ts`.

## Segment design

- `lib/fan-segments.ts` — pure rule engine. Predicates (AND across
  all present; absent = no opinion): follows / subscribed / buyer
  (tri-states), member (any|active|member|none),
  minSpentUsdCents / minSpentVb / minPurchases floors, hasEmail,
  sourcesAny (OR inside), activeWithinDays (vs lastActivityAt).
  Strict normalization (malformed ⇒ refused, never approximated).
  Segments are LIVE views: membership is evaluated from the current
  graph on every read and re-evaluated at send time — no snapshots
  anywhere, so nothing can drift (same derived-at-read discipline
  as phase 1 and the email desk's auto-tags).
- Presets (all supported by real fields): **buyers-not-followers**
  (buyer=yes, follows=no), **top-spenders** (minSpentUsdCents≥1,
  previews spend-ordered), plus subscribed-not-buyers
  (subscribed=yes, buyer=no).
- Counts/preview: `previewFanSegment` returns full count + a
  preview list ordered spend (USD, then VB), then recency.
- Saved segments: new `fan_segments` table (id, user_id, name,
  rules JSON text — the email_segments.criteria pattern), drizzle
  schema added in sync (`lib/db/src/schema/fan-segments.ts`,
  dist rebuilt). **Migration HELD** — exact SQL in
  `.lane/MIGRATION-NEEDED.md`, number not claimed (join assigns).
  Pre-migration behavior is probe-first/fail-honest: the store maps
  42P01 → FanSegmentsUnavailableError; CRUD answers 503
  `fan_segments_not_ready`, the list endpoint serves presets and
  reports `savedAvailable:false`; presets/preview/ad-hoc sends
  (no new table needed) work fully.
- Scoping: evaluation only ever runs over
  `loadFanGraph(callerId)` fans and the store filters every row by
  owner — a segment can only contain the creator's own fans
  (pinned by tests at lib, send, and route layers).

## Send-handoff design (the thinnest honest adapter)

The desk is list-centric and its dispatch resolves audiences only
as (whole list) or (per-list subscriber segment). A fan segment's
membership is neither — so, WITHOUT any new sender or mail path:

1. `lib/fan-segment-send.ts` (orchestration, injectable deps):
   verifies the target list belongs to the caller → loads the graph
   FRESH and evaluates the segment AT SEND TIME → resolves
   membership to ACTIVE subscriber rows of that list
   (`resolveSegmentAudience`: match on any merge-proven email,
   one row per fan, unsubscribed NEVER returned) → creates a
   normal campaign row on the list (`kind:"fan_segment"`,
   status draft) → hands it to the desk dispatch.
   Segment fans the desk cannot honestly email are counted and
   reported, never emailed and never silently subscribed:
   noEmail / notSubscribed (to this list) / unsubscribed.
2. `lib/email-campaign-send.ts` gains `dispatchCampaignToAudience`
   — the ONLY new dispatch door, and it is a door INTO the existing
   rail: same atomic claim discipline (draft|failed → sending),
   same `prepareCampaignSend`, same `sendCampaignDelivery`
   (delivery rows, tracking pixel/links, unsubscribe, provider
   gate, already-sent resumability), same final accounting.
   It serves ONLY kind="fan_segment" campaigns.
3. Widening is closed at every other door: `dispatchCampaign`
   refuses kind="fan_segment" (`fan_segment_audience`); the
   poller drain now claims only kind="campaign" queued rows; the
   generic /send and /queue doors in email-list.ts 409 fan_segment
   campaigns back to the Fan Graph tab. Fan campaigns never sit in
   "queued", so no race window exists. Clients can never create
   kind="fan_segment" (the campaign route's schema only allows
   kind "campaign" on insert) — only the fan-segment send creates
   them, server-side.
4. BOARDED (cannot do, honestly): segment fans who are not active
   subscribers of the chosen list receive nothing (counted in the
   result) — emailing non-subscribers would need consent the graph
   doesn't carry, and auto-subscribing them would be a consent
   violation. The campaign→segment link is not persisted on the
   campaign row (no column exists; kind is the marker) — the send
   RESPONSE carries the segment name + full accounting, and the
   campaign appears in desk history as a fan_segment campaign.

## Docking / FE

`FanSegmentsPanel` inside `FanGraphTab` (the Fan Graph tab of the
Email List page — no standalone page): preset + saved cards with
live counts and preview lists, a custom rule builder with live
preview before save/send, and a send composer (list / subject /
body) whose result line reports the desk's accounting (sent /
mailable / matched / not-emailable). 33 `email-list.fan_seg_*`
keys in ALL 10 catalogs, locale pin 4304 → 4337. Operator KB:
the fan-graph DOCKED_FEATURES entry's endpoints extended to the
segment endpoints (description gains fan_seg_intro); JSON
regenerated with a clean 8-line diff.

## Tests (numbers from finished logs in this directory)

- API final consolidated (fan-segments lib 21 + send handoff 5 +
  dispatch 7 + fan-segments routes 9 + phase-1 fan-graph lib/route
  18 + email-list + email-automations + campaign-sender):
  **9 files / 133 tests, ALL PASS** — test-api-final.log.
  (Earlier per-suite logs: test-api-fansegs-1.log — first run,
  30/32 with the dispatch suite missing an escapeHtml mock export,
  fixed; test-api-dispatch-2.log 7/7; test-api-routes-1.log 26/26;
  test-api-email-desk-1.log 77/77; test-api-email-auto-1.log 72/72.)
- KB trio (knowledge + door mapping + hands price integrity):
  **3 files / 72 tests, ALL PASS** — test-kb.log.
- FE locales + email surface: **9 files / 206 tests, ALL PASS** —
  test-fe-locales-1.log. Locale waves: first run 3 failures
  (es/fr/it identical-to-en on fan_seg_count_fans / fan_seg_no —
  real defects, fixed by translation + two justified allowlist
  entries following the syncPitch.no precedent) — re-run
  **3 files / 63 tests, ALL PASS** — test-fe-waves-2.log.
  Findability nav: 16/16 — test-fe-nav.log.
- Typechecks: API exit 0 (typecheck-api.log), FE exit 0
  (typecheck-fe.log).
- Full suites deferred to the join, per the Stack-100 #2/#3
  practice (phase 1 did the same under box-wide lane contention);
  every suite touching this lane's surface is green above.

Pinned semantics include: each predicate + AND combinations,
preset membership on the real merged fixture, conservative-merge
inheritance (the unbridged Cy pair stays two fans in segment math;
a bridged subscriber-buyer is one), count/preview correctness,
audience resolution (active-only, one-per-fan, unsubscribed
absolute), send-time membership (not a preview snapshot), the
handoff going through the desk dispatch entry point (never a
direct mail call — the send module has no mail function), the
generic doors refusing fan_segment campaigns, no-provider honesty,
empty-audience honesty, re-dispatch no-double-email, and
owner-scoping at every layer (foreign list 404, foreign segment
404, signed-out 401).

## Migration holds

ONE: `fan_segments` table — exact SQL in
`.lane/MIGRATION-NEEDED.md` (number unclaimed, join assigns).
Everything else in this lane needs no schema: the send rides the
existing email_campaigns.kind text value.
>>>>>>> stack29/w3-fan-segments
