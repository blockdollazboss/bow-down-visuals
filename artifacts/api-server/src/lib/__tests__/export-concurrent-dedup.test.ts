/**
 * Stack400 lane s400-exports-idempotency — C-05 (lib level) + C-37.
 *
 * C-05: the music + video export stores' duplicate-submit guard was
 * a SELECT-then-INSERT with no unique backing — two simultaneous
 * start POSTs both missed the lookup and both inserted (music:
 * duplicate renders; video: duplicate A-07 reservations, one per
 * row). Migration 0331 adds partial UNIQUE indexes on
 * (user_id, attempt_key) for in-flight states — music on its real
 * column, video on the new attempt_key column the key used to hide
 * in the params jsonb — and both create functions now return the
 * WINNING job when their insert loses the race. These tests drive
 * the real stores against pg-mem WITH the 0331 indexes applied and
 * fire the creates concurrently: one row, one job, both callers.
 * (For video, one row is what "one reservation" means at this
 * layer: the worker's reserve flips the row's credits_charged flag
 * exactly once per row — export-jobs-refund.test.ts pins that.)
 *
 * C-37: the music store's terminal-row prune was best-effort on the
 * create path only, and persisted params kept signed stem URLs at
 * rest indefinitely. pruneMusicExportJobs is now a named sweep
 * (boot recovery runs it — routes/music-export.ts), and recovery's
 * terminal failure strips signed query strings from the params it
 * leaves behind.
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* export-jobs.ts builds its drizzle client from the module's
   `drizzle` import (its own pool) — intercept that one factory so
   the store under test lands on this suite's pg-mem, while every
   other consumer (the test harness itself) gets the real builder. */
const shim = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("drizzle-orm/node-postgres", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    drizzle: (...args: unknown[]) =>
      shim.current ?? (actual.drizzle as (...a: unknown[]) => unknown)(...args),
  };
});

/* export-jobs.ts imports the credits rail for its charge/reserve
   functions — not under test here; keep them inert. */
vi.mock("../credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    canUseCredits: async () => true,
    OutOfCreditsError,
    CreditsDisabledError: class CreditsDisabledError extends Error {},
    deductCreditsDetailed: async () => ({
      balance: 0,
      split: { fromBonus: 0, fromRegular: 0, bonusExpiresAt: null },
    }),
    refundCredits: async () => 0,
  };
});

import {
  __setMusicExportJobsDb,
  claimMusicExportJob,
  createMusicExportJob,
  getMusicExportJob,
  pruneMusicExportJobs,
  recoverInterruptedMusicExportJobs,
  stripPersistedStemUrls,
} from "../music-export-jobs";
import { createExportJob, findActiveExportJobByAttemptKey } from "../export-jobs";
import { createTestDb, MUSIC_EXPORT_JOBS_DDL, type TestDb } from "./test-db";

/* The 0331 statements, verbatim-shaped, applied over the test DDL. */
const MUSIC_ATTEMPT_INDEX_DDL = `
CREATE UNIQUE INDEX music_export_jobs_active_attempt_uniq
  ON music_export_jobs (user_id, attempt_key)
  WHERE state IN ('queued', 'processing') AND attempt_key IS NOT NULL;`;

const EXPORT_JOBS_FULL_DDL = `
CREATE TABLE export_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  params jsonb NOT NULL,
  result jsonb,
  error jsonb,
  credits_charged boolean NOT NULL DEFAULT false,
  credits_from_bonus integer,
  credits_bonus_expires_at timestamptz,
  attempt_key text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX export_jobs_active_attempt_uniq
  ON export_jobs (user_id, attempt_key)
  WHERE state IN ('queued', 'active') AND attempt_key IS NOT NULL;`;

const USER = randomUUID();
const MUSIC_PARAMS = { stems: [{ name: "Lead" }], masterVolume: 100, format: "mp3" };

async function rowCount(td: TestDb, table: string): Promise<number> {
  const res = await td.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return Number((res.rows[0] as Record<string, unknown>)["n"]);
}

describe("music export store — C-05 constraint backing", () => {
  let td: TestDb;
  beforeEach(() => {
    td = createTestDb();
    td.mem.public.none(MUSIC_EXPORT_JOBS_DDL);
    td.mem.public.none(MUSIC_ATTEMPT_INDEX_DDL);
    __setMusicExportJobsDb(td.db);
  });
  afterEach(() => {
    __setMusicExportJobsDb(null);
  });

  it("two simultaneous creates for one attempt key produce ONE row and the same job", async () => {
    const [a, b] = await Promise.all([
      createMusicExportJob(randomUUID(), USER, MUSIC_PARAMS, "race-key"),
      createMusicExportJob(randomUUID(), USER, MUSIC_PARAMS, "race-key"),
    ]);
    expect(b.id).toBe(a.id);
    expect(await rowCount(td, "music_export_jobs")).toBe(1);
  });

  it("keyless creates never conflict — NULL keys stay independent", async () => {
    const a = await createMusicExportJob(randomUUID(), USER, MUSIC_PARAMS, null);
    const b = await createMusicExportJob(randomUUID(), USER, MUSIC_PARAMS, null);
    expect(b.id).not.toBe(a.id);
    expect(await rowCount(td, "music_export_jobs")).toBe(2);
  });

  it("the same key under a different user is a different job", async () => {
    const a = await createMusicExportJob(randomUUID(), USER, MUSIC_PARAMS, "shared-key");
    const b = await createMusicExportJob(randomUUID(), randomUUID(), MUSIC_PARAMS, "shared-key");
    expect(b.id).not.toBe(a.id);
  });

  it("a terminal job frees the key — a fresh export may start", async () => {
    const id = randomUUID();
    await createMusicExportJob(id, USER, MUSIC_PARAMS, "cycle-key");
    await claimMusicExportJob(id);
    await td.db.execute(sql`UPDATE music_export_jobs SET state = 'done' WHERE id = ${id}`);
    const next = await createMusicExportJob(randomUUID(), USER, MUSIC_PARAMS, "cycle-key");
    expect(next.id).not.toBe(id);
  });
});

describe("video export store — C-05 constraint backing", () => {
  let td: TestDb;
  beforeEach(() => {
    td = createTestDb();
    td.mem.public.none(EXPORT_JOBS_FULL_DDL);
    shim.current = td.db;
  });
  afterEach(() => {
    shim.current = null;
  });

  it("two simultaneous creates for one attempt key produce ONE row and the same job", async () => {
    const project = randomUUID();
    const params = { attemptKey: "video-race-key", clipUrls: ["https://cdn.example/a.mp4"] };
    const [a, b] = await Promise.all([
      createExportJob(USER, project, params),
      createExportJob(USER, project, params),
    ]);
    expect(b.id).toBe(a.id);
    expect(a.attemptKey).toBe("video-race-key");
    expect(await rowCount(td, "export_jobs")).toBe(1);
  });

  it("the finder matches the new column — and a legacy row whose key lives only in params", async () => {
    const project = randomUUID();
    const job = await createExportJob(USER, project, { attemptKey: "video-col-key" });
    expect((await findActiveExportJobByAttemptKey(USER, "video-col-key"))?.id).toBe(job.id);

    const legacyId = randomUUID();
    await td.db.execute(sql`
      INSERT INTO export_jobs (id, user_id, project_id, params)
      VALUES (${legacyId}, ${USER}, ${project}, ${JSON.stringify({ attemptKey: "legacy-key" })}::jsonb)
    `);
    expect((await findActiveExportJobByAttemptKey(USER, "legacy-key"))?.id).toBe(legacyId);
  });

  it("a terminal job frees the key — a fresh export may start", async () => {
    const project = randomUUID();
    const params = { attemptKey: "video-cycle-key" };
    const first = await createExportJob(USER, project, params);
    await td.db.execute(sql`UPDATE export_jobs SET state = 'done' WHERE id = ${first.id}`);
    const second = await createExportJob(USER, project, params);
    expect(second.id).not.toBe(first.id);
  });
});

describe("music export store — C-37 prune + strip", () => {
  let td: TestDb;
  beforeEach(() => {
    td = createTestDb();
    td.mem.public.none(MUSIC_EXPORT_JOBS_DDL);
    td.mem.public.none(MUSIC_ATTEMPT_INDEX_DDL);
    __setMusicExportJobsDb(td.db);
  });
  afterEach(() => {
    __setMusicExportJobsDb(null);
  });

  it("pruneMusicExportJobs sweeps old terminal rows on its own — no create needed", async () => {
    const oldDone = randomUUID();
    const freshDone = randomUUID();
    const oldQueued = randomUUID();
    await td.db.execute(sql`
      INSERT INTO music_export_jobs (id, user_id, state, params, created_at, updated_at)
      VALUES (${oldDone}, ${USER}, 'done', '{}'::jsonb, now() - interval '3 hours', now())
    `);
    await td.db.execute(sql`
      INSERT INTO music_export_jobs (id, user_id, state, params, created_at, updated_at)
      VALUES (${freshDone}, ${USER}, 'done', '{}'::jsonb, now(), now())
    `);
    await td.db.execute(sql`
      INSERT INTO music_export_jobs (id, user_id, state, params, created_at, updated_at)
      VALUES (${oldQueued}, ${USER}, 'queued', '{}'::jsonb, now() - interval '3 hours', now())
    `);

    await pruneMusicExportJobs();

    expect(await getMusicExportJob(oldDone)).toBeUndefined();
    expect((await getMusicExportJob(freshDone))?.state).toBe("done");
    expect((await getMusicExportJob(oldQueued))?.state).toBe("queued");
  });

  it("recovery's terminal failure strips signed query strings from the persisted params", async () => {
    const id = randomUUID();
    const params = {
      stems: [
        { name: "Lead", url: "https://cdn.example/lead.wav?X-Amz-Signature=abc&X-Amz-Expires=300" },
        { name: "Drums", url: "https://cdn.example/drums.wav" },
      ],
      format: "mp3",
    };
    await createMusicExportJob(id, USER, params, null);
    // Burn the attempt cap, then leave the job processing — a dead
    // process's poison job, exactly what boot recovery terminal-fails.
    for (let i = 0; i < 3; i++) {
      await claimMusicExportJob(id);
      await td.db.execute(sql`UPDATE music_export_jobs SET state = 'queued' WHERE id = ${id}`);
    }
    await claimMusicExportJob(id);

    await recoverInterruptedMusicExportJobs(async () => {});

    const job = await getMusicExportJob(id);
    expect(job?.state).toBe("failed");
    expect(job?.code).toBe("interrupted");
    const persisted = job?.params as { stems: Array<{ url: string }> };
    expect(persisted.stems[0]?.url).toBe("https://cdn.example/lead.wav");
    expect(persisted.stems[1]?.url).toBe("https://cdn.example/drums.wav");
  });

  it("stripPersistedStemUrls leaves queryless params untouched", () => {
    const p = { stems: [{ url: "https://cdn.example/a.wav" }] };
    expect(stripPersistedStemUrls(p)).toBe(p);
    expect(stripPersistedStemUrls(null)).toBe(null);
    expect(stripPersistedStemUrls({ noStems: true })).toEqual({ noStems: true });
  });
});
