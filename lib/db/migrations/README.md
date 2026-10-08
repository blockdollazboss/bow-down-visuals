# Database migrations — Render Postgres

Every schema change to the Render Postgres database ships as a numbered SQL
file in this directory: `NNNN_short_description.sql` (next number: **0057**).
Files are applied **automatically at container boot** by
`../migrate-boot.mjs` (wired into the Dockerfile `CMD`) — in filename order,
exactly once, tracked in the `data_migrations` table. There is no manual step
and no Render Shell needed.

## Rules for a new migration

1. **Idempotent DDL.** Use `IF NOT EXISTS` everywhere (`ADD COLUMN IF NOT
   EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
   The file may be retried after a partial failure.
2. **No explicit transaction control.** The runner wraps each file in
   `BEGIN`/`COMMIT` automatically. (Legacy files with their own `BEGIN;`
   still work — the runner detects and skips wrapping.)
3. **No `CONCURRENTLY`.** It cannot run inside a transaction block.
4. **Data migrations must be exactly-once safe.** Guard with `WHERE NOT
   EXISTS`, `ON CONFLICT DO NOTHING`, or a `data_migrations`-style marker —
   a retried file must never double-apply.
5. **Never edit a file after it has been applied.** Add a new numbered file
   instead. Applied files are skipped by filename.
6. **Keep the Drizzle TS schema in sync.** `lib/db/src/schema/` is what
   drizzle-orm queries against — add the matching table/column there in the
   same commit so types and queries see the new shape.
7. **Migration numbers must be unique.** Parallel workers once created two
   pairs of files sharing a number (see renumber note below). Always `git
   pull` latest staging before choosing the next number, and `ls` the
   directory to confirm the number is free.

## Renumbered 2026-10-07 (worker 6 sweep)

Two pairs of migrations were created with duplicate numbers and had already
been applied on staging when the collision was found. Because the runner
tracks by filename in `data_migrations`, all four were verified fully
idempotent (`IF NOT EXISTS` on every statement — safe to re-run as no-ops)
and renamed with `git mv`, content unchanged:

- `0063_press_releases.sql` → `0070_press_releases.sql`
- `0063_review_links.sql` → `0071_review_links.sql`
- `0066_hum_recordings.sql` → `0072_hum_recordings.sql`
- `0066_user_luts.sql` → `0073_user_luts.sql`

On databases where the old filenames already applied, the renamed files run
again once as harmless no-ops; on fresh databases they apply normally.
(NB: `0045` and `0046` also have duplicate numbers, but both files in each
pair are ≤ `BASELINE = 55` so the runner skips them on set-up databases —
left as-is.)

## What the runner does

- `BASELINE = 55`: files `<= 0055` were applied manually before the runner
  existed and are skipped on databases that already have the schema.
- New files (`> 0055`) apply automatically on the next deploy to staging,
  then production (staging-first, as always).
- A failed migration aborts the boot with a non-zero exit — the deploy
  stalls loudly and Render keeps the previous healthy version serving.
  Check the deploy logs for `[migrate-boot]` lines.

## Retired

`drizzle-kit push` is retired for deploys (2026-10-06): it requires a TTY for
its conflict prompt, and the TS schema intentionally covers only a subset of
the database tables, so push could never reconcile them. `drizzle-kit push`
remains usable for interactive local development only.
