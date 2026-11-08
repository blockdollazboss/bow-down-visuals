// migrate-boot.mjs — non-interactive boot-time migration runner.
//
// Replaces `drizzle-kit push --force` (retired 2026-10-06). drizzle-kit push
// cannot run here for two reasons:
//   1. It needs a TTY for its table-conflict prompt and dies on every deploy
//      ("Interactive prompts require a TTY terminal"), silently skipping all
//      schema changes (this caused the 2026-10-06 credit-ledger outage).
//   2. It is conceptually wrong for this database: the Drizzle TS schema only
//      covers ~40 of ~70 production tables, so push perpetually sees dozens
//      of "deleted" tables and would prompt (or worse, drop them).
//
// How it works:
//   - Applies lib/db/migrations/NNNN_*.sql in order, exactly once, tracked in
//     the data_migrations table (by filename).
//   - Migrations numbered <= BASELINE were applied manually under the old
//     process and are skipped on databases that already have the schema
//     (detected via the credit_usage canary table). A brand-new database
//     runs every migration from 0001.
//   - Each migration runs inside a transaction (unless the file manages its
//     own), guarded by a Postgres advisory lock so overlapping containers
//     during a zero-downtime deploy cannot double-apply.
//   - Transient connection failures are retried; a real SQL failure exits
//     non-zero so the deploy stalls LOUDLY instead of drifting silently
//     (Render keeps the previous healthy deploy serving).
//
// Migration-file conventions (see lib/db/migrations/README.md):
//   - Idempotent DDL (IF NOT EXISTS), no explicit BEGIN/COMMIT (the runner
//     wraps), no CONCURRENTLY (can't run in a transaction), never edit a
//     file after it has been applied — add a new numbered file instead.
//
// Baseline-table assertion (Stack 400, item C-39): the BASELINE skip
// below ASSUMES migrations <= BASELINE were applied manually pre-runner,
// but nothing ever verified that assumption — the credit_usage canary
// proves only that credit_usage exists. Staging carried the canary but
// not hourly_crate_claims (0055), so the table errored on every access
// while the runner skipped its migration on every boot. After the
// migration pass, this runner now checks the baseline-created tables
// the crate-claims module family reads through the Drizzle schema —
// the family hourly_crate_claims lives in (lib/bonus.ts,
// lib/retention.ts, routes/activity-feed.ts): any such table missing
// from the database fails the boot LOUDLY (the deploy stalls instead
// of drifting), with the repair spelled out — re-issue the creating
// migration verbatim in a new file numbered above BASELINE (0328 is
// the worked example). The list is pinned in code
// (BASELINE_TABLE_ASSERTIONS) and in the test suite
// (baseline-tables.test.ts re-derives it from the migrations on disk,
// so the pin and the files can never quietly drift apart). The
// family's later-created tables (quest progress, streaks, drops…)
// are NOT in this set — files above the baseline always run, so
// those tables cannot be skipped into existence-gap by the baseline
// assumption; asserting exactly the <= BASELINE members keeps every
// boot failure this check raises a real, repairable one.

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

const BASELINE = 55; // <= 0055 applied manually pre-runner; only newer auto-apply
/* The crate-claims family's tables whose CREATING migration is
   numbered <= BASELINE — the set the baseline skip puts at risk.
   Kept in exact sync with the test-time derivation in
   artifacts/api-server/src/lib/__tests__/baseline-tables.test.ts
   (Stack 400, item C-39); if that test goes red, a baseline-created
   table was added to the family's read set — update this list AND
   give the new table the same above-baseline repair treatment if
   any live database might lack it. (profiles is deliberately NOT
   asserted: the family reads it through the Supabase admin client
   by name — .from("profiles") — not through the Drizzle schema,
   and its Render-side existence is migration 0000's own job.) */
const BASELINE_TABLE_ASSERTIONS = [
  "contest_entries",
  "generations",
  "hourly_crate_claims",
  "social_publish_attempts",
];
const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);
const MAX_ATTEMPTS = 5;
const LOCK_KEY = "bowdownvisuals_migrations";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[migrate-boot] ${msg}`);

async function connectWithRetry(connectionString) {
  let lastErr = null;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      return client;
    } catch (e) {
      lastErr = e;
      await client.end().catch(() => {});
      log(`connection attempt ${i}/${MAX_ATTEMPTS} failed: ${e.message}`);
      if (i < MAX_ATTEMPTS) await sleep(2000 * i);
    }
  }
  throw lastErr;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log("FATAL: DATABASE_URL is not set — refusing to boot without migrations");
    process.exit(1);
  }

  const allFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  log(`found ${allFiles.length} migration files`);

  const client = await connectWithRetry(connectionString);
  try {
    // Serialize with any overlapping container (zero-downtime deploy overlap).
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS data_migrations (
           name TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );

      const { rows: canary } = await client.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'credit_usage'`
      );
      const isFreshDb = canary.length === 0;
      if (isFreshDb) {
        log("WARNING: fresh database detected (no credit_usage table) — " +
            "running ALL migrations from 0001; verify completeness manually");
      }

      // Audit aid: log the full table inventory every boot so schema drift
      // is visible in the deploy logs without needing database access.
      const { rows: inventory } = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY 1`
      );
      log(`database tables (${inventory.length}): ` +
          inventory.map((r) => r.table_name).join(", "));

      const pending = [];
      for (const f of allFiles) {
        const num = parseInt(f.slice(0, 4), 10);
        if (!isFreshDb && num <= BASELINE) continue; // applied manually pre-runner
        const { rows } = await client.query(
          "SELECT 1 FROM data_migrations WHERE name = $1",
          [f]
        );
        if (rows.length === 0) pending.push(f);
      }

      if (pending.length === 0) {
        log("no pending migrations — schema is current");
      } else {
      log(`pending: ${pending.join(", ")}`);

      for (const f of pending) {
        const sql = readFileSync(new URL(f, MIGRATIONS_DIR), "utf8");
        const hasOwnTxn = /^\s*BEGIN\s*;/im.test(sql);
        log(`applying ${f} ...`);
        try {
          if (!hasOwnTxn) await client.query("BEGIN");
          await client.query(sql);
          await client.query(
            "INSERT INTO data_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
            [f]
          );
          if (!hasOwnTxn) await client.query("COMMIT");
          log(`applied ${f}`);
        } catch (e) {
          try {
            if (!hasOwnTxn) await client.query("ROLLBACK");
          } catch { /* ignore rollback errors */ }
          throw new Error(`migration ${f} failed: ${e.message}`);
        }
      }
      log(`done — applied ${pending.length} migration(s)`);
      }

      /* Baseline-table assertion (Stack 400, item C-39): every table
         live code reads whose creating migration the BASELINE skip
         assumes was applied manually must actually exist now that
         this boot's migrations (including above-baseline repairs
         like 0328) have run. A miss fails the boot LOUDLY — Render
         keeps the previous healthy deploy serving — instead of the
         table erroring on every request while its migration is
         skipped forever. Repair for a named table: re-issue its
         creating migration verbatim in a new file numbered above
         BASELINE (0328_hourly_crate_claims_baseline_repair.sql is
         the worked example); never edit the baseline file. */
      const { rows: presentRows } = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [BASELINE_TABLE_ASSERTIONS]
      );
      const presentTables = new Set(presentRows.map((r) => r.table_name));
      const missingBaseline = BASELINE_TABLE_ASSERTIONS.filter(
        (t) => !presentTables.has(t)
      );
      if (missingBaseline.length > 0) {
        throw new Error(
          `baseline table assertion failed — code-referenced table(s) ` +
          `missing from this database: ${missingBaseline.join(", ")}. ` +
          `Their creating migrations are <= ${BASELINE} and were skipped ` +
          `by the baseline rule; repair by re-issuing the creating ` +
          `migration verbatim in a new file numbered above ${BASELINE} ` +
          `(see 0328 for the pattern). Refusing to boot on a schema ` +
          `the code cannot read.`
        );
      }
      log(
        `baseline tables verified (${BASELINE_TABLE_ASSERTIONS.length}): ` +
        BASELINE_TABLE_ASSERTIONS.join(", ")
      );
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY])
        .catch(() => {});
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`[migrate-boot] FATAL: ${e.message}`);
  process.exit(1);
});
