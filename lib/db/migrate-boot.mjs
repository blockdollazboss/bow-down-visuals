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

import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

const BASELINE = 55; // <= 0055 applied manually pre-runner; only newer auto-apply
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
        return;
      }
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
