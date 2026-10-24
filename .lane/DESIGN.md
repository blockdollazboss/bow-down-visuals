# FUNDING GOALS on the tip page — Stack-100 #3, Wave Lane 5

## Scout finding (why this lane is a fix, not a greenfield)
A `goalAmount`/`goalLabel` pair already existed on tip-page settings, and
both the public page and the creator dashboard rendered a progress bar —
but the bar was computed from **tip intents**: in-memory records that sit
at `pending_payment` forever and never represent a charge (see the
honesty contract at the top of `routes/generate/tip-jar.ts`). Anyone
could inflate "progress" by recording intents. The durable money record
is `tip_jar_tips` (migration 0142): one row per real Checkout session,
flipped to `paid` exactly once by the verify endpoint.

## Design
- **Storage — no DDL.** The goal rides the existing tip-page settings
  object (`TipPageSettings`, the same settings storage the pre-existing
  `goalAmount`/`goalLabel` already lived in), extended with:
  - `fundingGoal: { id, targetAmount, label, startedAt } | null` — the
    ONE active goal. `goalAmount`/`goalLabel` stay as mirrors for
    existing readers.
  - `goalHistory: FundingGoalRecord[]` — reached goals are archived
    here when replaced/removed, never silently erased. Unreached goals
    that are removed are simply gone (stated plainly, per scope).
  - Inherited caveat, unchanged from v1: tip-page settings storage is
    in-memory (documented in the file header since v1: "NOT
    restart-safe — move to DB-backed storage before real payments
    ship"). Goal *definitions* share that pre-existing debt; goal
    *progress* never does — it is derived from the durable table.
    **New migration hold: NONE.** No new table/column is needed.
- **Progress derivation (never a stored counter).** Every read computes
  progress live from `tip_jar_tips` rows for the page owner through the
  pure function `computeFundingProgress(rows, goal)`:
  - counts a row ONLY when `status === "paid"` (the rail's one real
    money state — set exactly once by checkout verify);
  - `pending_payment`, `refunded`, or any other status never counts;
  - tip *intents* never reach this table and so can never count;
  - currency must match the rail's USD;
  - only tips paid at/after the goal's `startedAt` count (a goal counts
    money raised toward it, not lifetime earnings);
  - `reachedAt` is derived by walking qualifying tips chronologically
    to the crossing point.
  If the rows cannot be read, endpoints return the goal with
  `progressUnavailable: true` and NO numbers — never a fabricated $0.
- **Lifecycle** (`applyFundingGoalChange`, pure + tested):
  - set with no active goal → new goal, `startedAt = now`;
  - edit (target/label changed) on an unreached goal → same goal,
    same `startedAt` — progress basis never resets under the creator;
  - identical re-save (the settings form resubmits goal fields on
    every save) → untouched, even if reached;
  - changed values on a REACHED goal, or removal of a reached goal →
    the reached goal is archived to `goalHistory`, then the new goal
    starts fresh / the slot clears;
  - removal of an unreached goal → slot clears, nothing archived.
- **Endpoints** (all docked on the existing tip surface, no new page):
  - `POST /api/tips/settings` — existing save, now runs the lifecycle.
  - `POST /api/tips/goal` — set/edit the active goal (auth, own page
    only — handlers only ever touch `req.userId`'s settings).
  - `DELETE /api/tips/goal` — remove the active goal (archives if
    reached).
  - `GET /api/tips/page/:handle` — gains `goal` (honest progress +
    `reached`/`reachedAt`); legacy `stats.goalProgress` now carries the
    same honest value instead of the intent-based one.
  - `GET /api/tips/dashboard` — gains `goal` + `goalHistory`; legacy
    `goalProgress` likewise made honest.
- **Money rules untouched.** No fees invented, no tip economics
  changed, currency stays the rail's USD everywhere. This is a
  display + settings layer over the existing rail only.
- **Frontend.** Public tip page renders the goal from `goal`
  (raised/target/percent from paid tips only) and a reached
  celebration state in the page's existing gold visual language.
  The Tips management page shows the same honest progress, the
  reached state, past reached goals, and a Remove-goal action.
- **Operator KB.** Registered as a DOCKED_FEATURES entry
  (`funding-goals`, host `/tips`, stage money) in
  `scripts/generate-operator-knowledge.mjs` + regenerated JSON —
  the same pattern the order-bumps lane used.
