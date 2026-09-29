/**
 * Boot-time safety net for the Cheat Code Jackpot tables.
 *
 * The Dockerfile also runs `drizzle-kit push` before boot, but if that ever
 * fails silently (the startup script lets the server start anyway), the
 * jackpot endpoints 500. This runs the same idempotent DDL directly through
 * the app's own DB connection on every boot, so the tables are guaranteed
 * to exist before any request needs them. Safe to run repeatedly.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const CHEAT_CODE_DDL = [
  `ALTER TABLE cheat_code_events ADD COLUMN IF NOT EXISTS code_sequence TEXT`,
  `CREATE TABLE IF NOT EXISTS cheat_code_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    code_length INTEGER NOT NULL,
    prize_credits INTEGER NOT NULL DEFAULT 100,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    winner_user_id UUID,
    winner_display_name TEXT,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cheat_code_events_name_ux
    ON cheat_code_events (name)`,
  `CREATE INDEX IF NOT EXISTS cheat_code_events_active_idx
    ON cheat_code_events (is_active, starts_at, ends_at)`,
  `CREATE TABLE IF NOT EXISTS cheat_code_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES cheat_code_events (id) ON DELETE CASCADE,
    user_id UUID,
    ip TEXT,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS cheat_code_attempts_event_idx
    ON cheat_code_attempts (event_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS cheat_code_attempts_user_idx
    ON cheat_code_attempts (user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS cheat_code_attempts_ip_idx
    ON cheat_code_attempts (ip, created_at)`,
];

export async function ensureCheatCodeTables(): Promise<void> {
  for (const statement of CHEAT_CODE_DDL) {
    await db.execute(sql.raw(statement));
  }
  logger.info("Cheat Code Jackpot tables ensured");
}
