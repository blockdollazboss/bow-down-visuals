# A-08 — Exact migration required (NOT written by Lane D; lane rule: no migrations)

Verified state (Lane D continuation, this tree @ f96d7b72 + lane commits):

- `routes/generate/export-multi-ratio.ts:109` — `const jobs = new Map`. The full
  `costTotal` is charged up front (line 197, chargeCredits) and ALL refunds run
  inside the in-process worker's try/finally (lines 429–471). A hard kill
  (SIGKILL/OOM/deploy) skips the finally: the charge stands, the job record is
  gone, the poll endpoint 404s, and completed ratios' URLs (durable in
  storage) become unreachable. The in-code comment's "a restart refunds any
  ratio that never completed" is true only for graceful in-process exits.
- `routes/lip-sync.ts:1207` — `const lipSyncRuns = new Map`. The per-scene
  sub-jobs are durable (`lip_sync_jobs`) and the final export is durable
  (`export_jobs`), but the run record + the in-process `processRunAll` loop
  are not: a restart mid-run strands finished sub-jobs (their lipSyncUrl IS
  saved onto the project scenes, so work is not lost) with no run to poll —
  GET /api/lip-sync/run/:runId 404s ("Run not found or expired") and the FE's
  persisted runId points at nothing.
- `export_jobs` cannot simply absorb either store: it has no `kind`
  discriminator, `project_id`/`params` are shaped for executeExport, and
  `recoverInterruptedJobs` re-queues every queued/active row into the MAIN
  export worker — foreign rows would be claimed and run through the wrong
  pipeline.

## Migration 1 — lip_sync_runs (run-all orchestration)

```sql
CREATE TABLE IF NOT EXISTS lip_sync_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'running',          -- running | done | failed
  scenes jsonb NOT NULL DEFAULT '[]'::jsonb,      -- RunAllScene[]
  export_state text NOT NULL DEFAULT 'pending',   -- pending | running | done | failed | skipped
  export_job_id uuid,
  video_url text,
  error text,
  -- Everything needed to RESUME orchestration after a restart: scene ids +
  -- clip URLs, timings, resolved audio ref, settings snapshot. NOT the
  -- request JWT: resume runs under the service-role client with ownership
  -- re-verified from user_id/project_id (the pattern the final save already
  -- uses — see the robustness note in routes/lip-sync.ts).
  params jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lip_sync_runs_user_idx
  ON lip_sync_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lip_sync_runs_state_idx
  ON lip_sync_runs (state) WHERE state = 'running';
```

Plus, same commit: drizzle table in `lib/db/src/schema/` (name
`lipSyncRunsTable`), `lib/db` dist rebuild, and the route changes:
INSERT the row at run creation (replacing/augmenting the Map), UPDATE on
every `patchRun`/scene transition, GET reads the row, and a boot recovery
(next to export-jobs' `recoverInterruptedJobs`) that re-drives rows left in
`running`: scenes whose lipSyncUrl is already saved on the project are
skipped, remaining scenes re-enter `processRunAll` from `params`. The
2-hour Map sweep becomes a row-retention sweep (delete terminal rows older
than the TTL) or the Map is dropped entirely once reads are DB-backed.

## Migration 2 — multi_ratio_jobs (recommended) OR export_jobs.kind

Recommended: a dedicated table mirroring the in-memory `MultiRatioJob`
(per-ratio charging does not fit export_jobs' single boolean
`credits_charged` flag):

```sql
CREATE TABLE IF NOT EXISTS multi_ratio_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  video_url text NOT NULL,
  cost_total integer NOT NULL,
  cost_per_ratio integer NOT NULL,
  ratios jsonb NOT NULL DEFAULT '[]'::jsonb,      -- RatioResult[]
  state text NOT NULL DEFAULT 'queued',           -- queued | active | done | failed
  error text,
  refunded integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS multi_ratio_jobs_user_idx
  ON multi_ratio_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS multi_ratio_jobs_state_idx
  ON multi_ratio_jobs (state) WHERE state IN ('queued', 'active');
```

Plus: drizzle table, dist rebuild, route changes (INSERT at creation,
UPDATE per ratio transition, GET reads the row), and boot recovery with the
money rule made durable: for a job found in queued/active at boot, refund
every ratio that never completed (the refund math already exists in the
worker's finally block — it moves to a settle function callable from both
the worker and recovery), then mark the job failed with
error 'interrupted_by_restart'. Completed ratios keep their durable
storage URLs on the row, so a post-restart poll still delivers them.

Alternative considered and NOT recommended: `ALTER TABLE export_jobs ADD
COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'final';` + kind-filtered
claiming. Less new surface, but multi-ratio's per-ratio charge/refund
tracking would be squeezed into params/result jsonb while the row claims a
single-charge flag it never uses — the next reader will misread the money
state. The dedicated table keeps the money shape honest.

## Numbering

Both files are idempotent, no BEGIN/COMMIT, no CONCURRENTLY, per house
rules. File numbers are the join's call: Stack-100 #3 holds already run
0205–0214 (order-bumps claimed 0205), so these land AFTER those — e.g.
`0215_lip_sync_runs.sql` and `0216_multi_ratio_jobs.sql` if the join keeps
that order. Schema source files land in the same commits.
