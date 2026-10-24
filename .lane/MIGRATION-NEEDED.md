# MIGRATION NEEDED — held, NOT applied by this lane (Stack-100 #3 W3, Fan Segments / fan-graph phase 2)

**Number: NOT claimed by this lane.** 0205+ are already held by other
Stack-100 #3 lanes; numbering is assigned at join. The integrator
drops the SQL below into `lib/db/migrations/<assigned>_fan_segments.sql`.
Last migration at base f1b5d666: `0204_abandoned_checkouts.sql`.

**Why a migration is required:** saved fan segments need one row per
(creator, segment definition). No existing table can hold them
honestly: `email_segments` is per-LIST with list-criteria semantics
(tags/sources/engagement over subscriber rows) — fan segments are
per-CREATOR with fan-graph rule semantics (follow/member/spend over
merged fan records); overloading it would corrupt both models.
Nothing else about this lane needs schema: the send rides the
existing `email_campaigns` table (kind = 'fan_segment', a value of
the existing `kind` text column — no new column, no new sender).

**Drizzle source of truth already in sync:** `lib/db/src/schema/fan-segments.ts`
(`fanSegmentsTable`) matches this SQL column-for-column, per the
house rule — the integrator only drops in the file. `lib/db/dist`
was rebuilt in-lane (`tsc -b .` from lib/db).

**What the code does until this lands (already built + tested):**
- Every fan_segments read/write goes through lib/fan-segment-store,
  which maps Postgres 42P01 (undefined table, read through
  lib/pg-errors) to FanSegmentsUnavailableError.
- Saved-segment CRUD routes answer `503 { code: "fan_segments_not_ready" }`;
  the list endpoint still serves presets with live counts and
  reports `savedAvailable: false` so the UI says saving opens soon
  instead of failing.
- Presets, live previews, and one-click sends with preset or ad-hoc
  rules need NO new table and work fully pre-migration. A send that
  references a saved segment id answers the same honest 503.
- Nothing half-applies: no fallback storage, no in-memory pretense.

## Exact migration SQL (idempotent, no BEGIN/COMMIT, no CONCURRENTLY)

```sql
-- Fan segments (Stack-100 #3, fan-graph phase 2): a creator's saved
-- audience definitions over the One Fan Graph. The row stores ONLY
-- the definition (name + rule set as JSON text, the
-- email_segments.criteria pattern); membership is computed live
-- from the graph on every read and every send, so a saved segment
-- can never drift from the fan data it describes. user_id is the
-- OWNING creator — every store query filters by it, and evaluation
-- runs over loadFanGraph(user_id) only, so a segment can only ever
-- contain the owner's own fans.
CREATE TABLE IF NOT EXISTS fan_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  rules text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fan_segments_user_idx ON fan_segments (user_id, created_at DESC);
```
