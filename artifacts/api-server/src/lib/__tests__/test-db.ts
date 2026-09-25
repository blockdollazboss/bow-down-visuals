/**
 * In-memory Postgres for the $0 verification suite (pg-mem + drizzle).
 *
 * The lip-sync job store speaks raw SQL through drizzle's `execute()`, so
 * pg-mem gives us real database semantics — atomic UPDATEs, UNIQUE
 * constraints, ON CONFLICT — without a live Postgres. Each test gets a
 * fresh database via `createTestDb()`.
 */
import { newDb, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

export const LIP_SYNC_JOBS_DDL = `
CREATE TABLE lip_sync_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid,
  scene_id text,
  state text NOT NULL DEFAULT 'queued',
  params jsonb NOT NULL,
  provider_job_id text,
  result_url text,
  error jsonb,
  attempts integer NOT NULL DEFAULT 0,
  polls integer NOT NULL DEFAULT 0,
  consecutive_poll_errors integer NOT NULL DEFAULT 0,
  next_poll_at timestamptz,
  next_attempt_at timestamptz,
  submit_deferrals integer NOT NULL DEFAULT 0,
  history_recorded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

export const JOB_NOTIFICATIONS_DDL = `
CREATE TABLE job_notifications (
  id uuid PRIMARY KEY,
  job_type text NOT NULL,
  job_id text NOT NULL,
  user_id uuid NOT NULL,
  project_id uuid,
  status text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  video_url text,
  delivered_at timestamptz,
  delivery_channel text,
  delivery_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_notifications_job_uniq UNIQUE (job_type, job_id)
);`;

export interface TestDb {
  mem: IMemoryDb;
  db: ReturnType<typeof drizzle>;
}

/** Fresh in-memory DB with the job tables created. */
export function createTestDb(): TestDb {  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.none(LIP_SYNC_JOBS_DDL);
  mem.public.none(JOB_NOTIFICATIONS_DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  // pg-mem cannot adapt drizzle's `types.getTypeParser` query config
  // (drizzle uses it to control timestamp parsing). Strip it before
  // delegating — pg-mem returns Date objects for timestamps, which the
  // store's `new Date(...)` parsing handles either way.
  const clientShim = {
    query: (config: unknown, values?: unknown[]) => {
      const cfg =
        config !== null &&
        typeof config === "object" &&
        !Array.isArray(config) &&
        "types" in config
          ? (({ types: _stripped, ...rest }: Record<string, unknown>) => rest)(config)
          : config;
      return (pool as unknown as { query: (c: unknown, v?: unknown[]) => Promise<unknown> }).query(cfg, values);
    },
  };
  const db = drizzle(clientShim as never);
  return { mem, db };
}

/**
 * Claim a job that was deferred with a ~0ms backoff. The not-before
 * timestamp is computed in JS just before the UPDATE runs, so a claim in
 * the same millisecond can race pg-mem's now(); retry briefly instead of
 * assuming immediate claimability. Fails loudly if the job never frees up.
 */
export async function claimWhenDue<T>(
  claim: () => Promise<T | undefined>,
  tries = 200,
): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const c = await claim();
    if (c !== undefined) return c;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("claimWhenDue: job never became claimable");
}
