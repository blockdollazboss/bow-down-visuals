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
