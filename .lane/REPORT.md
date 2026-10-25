# STACK-200 LANE 4 — Membership Pause (wave-4 #39)

Branch: `stack200/membership-pause` (from `stack200/integration` @ 11eecb49)
Worktree: `~/workspace/bdv-wt-s200-pause`
Status: BUILT, not pushed, not joined (per brief).
(Note: this file replaces a prior lane's REPORT.md that shipped in the
integration base tree — it even carried unresolved conflict markers.)

## What shipped

A fan whose money is tight can now **Pause for 1–3 months** instead of
cancelling — access sleeps everywhere at once, billing skips, resume is
one tap, and the resume date is stated plainly before the fan confirms.

### Design decisions

1. **The rail, honestly.** The brief said "billing skips on the existing
   Stripe subscription rail" — the codebase proves fan memberships are
   NOT a Stripe subscription: they are one paid period at a time via
   Stripe-hosted checkout, with no auto-charge and no subscription id
   anywhere (see the header of `routes/generate/memberships.ts`). So
   "billing skip" is implemented as the honest equivalent on the real
   rail: **the paid-period clock freezes**. While paused, no paid time
   burns; on resume `current_period_end` shifts forward by exactly the
   time rested, so the next renewal falls due that much later and never
   during the rest. No charge is created, moved, or skipped silently —
   there is no recurring charge to skip on this rail.

2. **One shared effective-status mirror.** All membership gates already
   admit only effective `trialing`/`active`:
   - members-only posts → `lib/close-friends.ts` (`evaluateMemberPost`)
   - tier-gated rooms → `lib/fan-tier-gate.ts` (`evaluateTierGate`)
   - email member segments → stored-status `IN ('active','trialing')`
   - the memberships desk itself → `effectiveMemberStatus`
   The pause semantics live once in the new pure module
   `artifacts/api-server/src/lib/membership-pause.ts`
   (`pausedEffectiveStatus`), and BOTH read-time mirrors
   (`effectiveMemberStatus`, `effectiveFanMemberStatus`) delegate to it,
   so no surface can drift. A stored `paused` row therefore sleeps at
   every gate by construction, and the raw-status segment query excludes
   it without a change.

3. **Auto-resume at read time; one-tap resume as a write.** Stored rows
   are never silently rewritten (the house rule for effective statuses).
   Once `paused_until` passes, the effective status reads `active` on
   the pause-shifted period; if the shifted period also ran out it reads
   `expired`. `POST /mine/:id/resume` performs exactly the same capped
   shift as a write (a late tap never over-shifts past the planned rest)
   and answers an honest 409 (`PAUSE_PERIOD_ENDED`) when the shifted
   period has ended — rejoining is the door, not a fake extension.

4. **Pause ≠ dunning, by construction.** Pause requires an effective
   `active` seat: a `past_due` seat gets 409 with a pointer to the
   card-update door. A paused row is stored `paused`, and dunning works
   stored `past_due` only (`lib/email-automations.collectRecoveryTriggers`
   + `dunningTriggersForMember` returns [] for anything not past_due),
   so a resting fan is never chased and never appears in the creator
   Recovery list. Both facts are pinned by tests. Pause from `trialing`
   is also 409 (a free trial has nothing to rest from).

5. **Creator disable per tier.** `fan_tiers.pause_enabled` (default
   true — pause is offered unless the creator turns it off). Wired
   through tier create/update schemas, the tier DTO, the tier form
   checkbox, the tier card's honest state line, and the `/mine` DTO
   (`pauseOffered`) so the fan's Pause button only appears when the
   offer is real. The pause door itself enforces it server-side (403
   `PAUSE_NOT_OFFERED`) — the hidden button is never the only guard.

6. **Honest knock copy for paused fans.** Tier-gated rooms and
   members-only posts gained a `paused` viewer status (otherwise they'd
   have been told their membership "has ended" — it hasn't). Copy says
   the membership is paused and resuming restores the room/post; the FE
   knock button reads "Resume your membership" for that status
   (`group-detail.tsx`, World `GroupsDesk.tsx`, `social-api.ts` types).

7. **The resume date is stated before confirming, twice.** The fan's
   picker states the resume date for the chosen 1/2/3 months, and the
   confirm dialog repeats it (client `addMonthsClamped` mirrors the
   server calendar-month math incl. Jan-31 clamping). The response's
   `resumesAt` IS the stored `paused_until` — pinned by a test that the
   promise and the row can never drift.

### Surfaces touched
- API: `lib/membership-pause.ts` (new), `lib/fan-tier-gate.ts`,
  `lib/close-friends.ts`, `lib/dunning.ts` (separation note),
  `lib/fan-graph.ts` (paused ranks as a live-but-resting relationship,
  never counted as an active member), `routes/generate/memberships.ts`
  (pause/resume doors, tier toggle, member DTO pause fields,
  `pausedMembers` dashboard count, pause fields cleared on
  cancel/verify/re-join).
- FE: `pages/memberships.tsx` (fan Pause picker + paused panel +
  one-tap Resume; creator per-tier toggle + card state; creator member
  list renders paused honestly), `lib/social-api.ts`,
  `pages/group-detail.tsx`, `components/world/native/GroupsDesk.tsx`
  (paused knock status + label).
- DB: schema `lib/db/src/schema/fan-memberships.ts` + migration 0239.

## Migration note

**Migration 0239 IS required** (`lib/db/migrations/0239_membership_pause.sql`),
idempotent, no BEGIN/COMMIT, no CONCURRENTLY:
- `fan_members.paused_at timestamptz` (nullable)
- `fan_members.paused_until timestamptz` (nullable)
- `fan_tiers.pause_enabled boolean NOT NULL DEFAULT true`

`FanMemberStatus` gains `"paused"`. `lib/db` dist was rebuilt before the
API typecheck, per house rule.

## Tests

New suites:
- `artifacts/api-server/src/lib/__tests__/membership-pause.test.ts` — 16 tests:
  pause math (calendar months, clamp, 1–3 validation, elapsed cap),
  effective status (resting / auto-resume / expired-after-shift / manual
  rows / missing window), gate honoring (tier gate + members-post gate,
  `paused` knock status, back-in after the date), dunning exclusion
  (+ past_due control).
- `artifacts/api-server/src/routes/__tests__/memberships-pause.test.ts` — 14 tests:
  pause happy path + stated-date == stored date, /mine read-back with
  shifted period end, 400 months, 404 foreign, 401 guest, 409 past_due
  (dunning separation), 409 trialing, 409 already-paused, 403
  creator-disabled, resume shift exactness, capped late shift,
  409 spent-period resume, read-time auto-resume, Recovery exclusion,
  cancel-while-paused.
- `artifacts/bow-down-visuals/src/pages/memberships-pause.test.ts` — 7 tests:
  FE wiring (button gating, picker, stated date, confirm copy, doors,
  creator toggle, card state).

### Numbers (from finished logs only; logs in the worktree `tmp/`)

- New API pause suites: **30/30 passed** (2 files, 10.0s).
- Full API suite (`tmp/api-full.log`, sequential, --maxWorkers=1,
  duration 6705.68s under heavy parallel-lane load): **509/510 test
  files passed, 6384/6385 tests passed**. The one failure was
  `operator-tier0.test.ts` › "'what did I earn?' with the earnings
  marker" at 26006ms — a timeout while the box sat at load average
  21+ from sibling lanes; the same test's siblings finished in
  46–453ms. **Standalone rerun of that file: 21/21 passed**
  (`tmp/api-tier0-rerun.log`, exit 0). Unrelated to this lane (no
  shared code path with memberships).
- Full FE suite (`tmp/fe-full.log`, sequential, --maxWorkers=1):
  **393/393 test files passed, 5177/5177 tests passed**.
- API typecheck (`tsc -p tsconfig.json --noEmit`): **exit 0**, empty log.
- FE typecheck (`tsc -p tsconfig.json --noEmit`): **exit 0**, empty log.
- `lib/db` + `lib/api-zod` dist builds: exit 0 (db dist rebuilt after
  the schema edit, before the API typecheck, per house rule).

## Deviations / notes for the join

- Brief said "Stripe subscription rail" — no such rail exists for fan
  memberships (period checkout). Implemented as period-clock freeze;
  see Design decision 1. A literal Stripe `pause_collection` behaviour
  would require first migrating fan memberships onto Stripe
  Subscriptions — a separate, larger lane.
- Creator-side PATCH member status cannot set `paused` (fan-only state,
  by design); the creator list renders a fan's pause as a disabled
  "Paused (fan is resting)" option so the status is never invisible.
- No push, no join performed by this lane.
