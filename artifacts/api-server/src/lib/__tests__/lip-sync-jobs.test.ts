/**
 * $0 verification suite for the DB-backed lip-sync job store.
 *
 * These tests exercise the exactly-once paths that are the whole point of
 * the server-owned job branch — atomic claims under race, the
 * history_recorded gate, submit-deferral backoff, and boot recovery —
 * against an in-memory Postgres (pg-mem), so no live database is needed.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  __setLipSyncJobsDb,
  claimJobForSubmit,
  claimQueuedJobs,
  completeLipSyncJob,
  createLipSyncJob,
  deferSubmitJob,
  failLipSyncJob,
  getJobsDueForPoll,
  getLipSyncJob,
  markHistoryRecorded,
  markJobSubmitted,
  recoverInterruptedLipSyncJobs,
  requeueSubmitJob,
} from "../lip-sync-jobs";
import { claimWhenDue, createTestDb } from "./test-db";

const PARAMS = { clipUrl: "https://x/clip.mp4", audioUrl: "https://x/audio.mp3", sceneStartSec: 0, sceneEndSec: 5 };

let testDb: ReturnType<typeof createTestDb>;

beforeEach(() => {
  testDb = createTestDb();
  __setLipSyncJobsDb(testDb.db);
});

afterEach(() => {
  __setLipSyncJobsDb(null);
});

async function makeJob() {
  return createLipSyncJob({ userId: randomUUID(), params: PARAMS });
}

/** Insert a queued job with an explicit created_at (for oldest-first tests). */
async function insertJobAt(createdAtIso: string): Promise<string> {
  const id = randomUUID();
  await testDb.db.execute(sql`
    INSERT INTO lip_sync_jobs (id, user_id, state, params, created_at)
    VALUES (${id}, ${randomUUID()}, 'queued', ${JSON.stringify(PARAMS)}::jsonb, ${createdAtIso}::timestamptz)
  `);
  return id;
}

describe("createLipSyncJob", () => {
  it("creates a queued job with sane defaults", async () => {
    const job = await makeJob();
    expect(job.state).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.submitDeferrals).toBe(0);
    expect(job.nextAttemptAt).toBeNull();
    expect(job.historyRecorded).toBe(false);
    expect(job.params.clipUrl).toBe(PARAMS.clipUrl);
  });
});

describe("atomic submit claims", () => {
  it("two racers claiming the same job produce exactly one winner", async () => {
    const job = await makeJob();
    const [a, b] = await Promise.all([claimJobForSubmit(job.id), claimJobForSubmit(job.id)]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.state).toBe("submitting");
    expect(winners[0]!.attempts).toBe(1);
  });

  it("claimQueuedJobs takes oldest first and never double-claims", async () => {
    // NOTE: pg-mem ignores LIMIT inside UPDATE..WHERE id IN (SELECT..LIMIT)
    // — a pg-mem decorrelation bug; real Postgres honors it — and pg-mem
    // does not preserve the subquery's order in UPDATE..RETURNING. So the
    // batch-size cap and RETURNING order can't be asserted under pg-mem;
    // priority order is asserted on the claim subquery itself, and
    // atomicity + exactly-once on the claim function.
    const now = Date.now();
    const newest = await insertJobAt(new Date(now).toISOString());
    const oldest = await insertJobAt(new Date(now - 300_000).toISOString());
    const middle = await insertJobAt(new Date(now - 60_000).toISOString());

    const ordered = await testDb.db.execute(sql`
      SELECT id FROM lip_sync_jobs
      WHERE state = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at ASC
    `);
    expect((ordered.rows as { id: string }[]).map((r) => r.id)).toEqual([
      oldest,
      middle,
      newest,
    ]);

    const batch1 = await claimQueuedJobs(10);
    expect(batch1).toHaveLength(3);
    expect(batch1.every((j) => j.state === "submitting")).toBe(true);
    expect(new Set(batch1.map((j) => j.id)).size).toBe(3);

    // A second sweep finds nothing: claims are exactly once.
    expect(await claimQueuedJobs(10)).toHaveLength(0);
    expect(await claimJobForSubmit(oldest)).toBeUndefined();
  });

  it("claiming a non-queued job returns undefined", async () => {
    const job = await makeJob();
    await claimJobForSubmit(job.id);
    expect(await claimJobForSubmit(job.id)).toBeUndefined();
  });
});

describe("transient-deferral backoff", () => {
  it("deferSubmitJob parks the job with a not-before timestamp and neutralizes the attempt", async () => {
    const job = await makeJob();
    const claimed = await claimJobForSubmit(job.id);
    expect(claimed!.attempts).toBe(1);

    const before = Date.now();
    const res = await deferSubmitJob(job.id, 10 * 60_000, 36);
    expect(res).not.toBeNull();
    expect(res!.failed).toBe(false);
    expect(res!.deferrals).toBe(1);

    const parked = (await getLipSyncJob(job.id))!;
    expect(parked.state).toBe("queued");
    expect(parked.submitDeferrals).toBe(1);
    expect(parked.attempts).toBe(0); // the claim's +1 is neutralized: waiting is not failing
    expect(parked.nextAttemptAt).not.toBeNull();
    expect(parked.nextAttemptAt!).toBeGreaterThanOrEqual(before + 10 * 60_000 - 5_000);
  });

  it("submit claims skip deferred jobs until the backoff window elapses", async () => {
    const job = await makeJob();
    await claimJobForSubmit(job.id);
    await deferSubmitJob(job.id, 60 * 60_000, 36); // 1h in the future

    expect(await claimQueuedJobs(10)).toHaveLength(0);
    expect(await claimJobForSubmit(job.id)).toBeUndefined();
  });

  it("a deferred job whose window elapsed becomes claimable again", async () => {
    const job = await makeJob();
    await claimWhenDue(() => claimJobForSubmit(job.id));
    await deferSubmitJob(job.id, 0, 36); // not-before = now → immediately due
    const claimed = await claimWhenDue(() => claimJobForSubmit(job.id));
    expect(claimed.state).toBe("submitting");
  });

  it("deferring past the cap fails the job with provider_busy_timeout", async () => {
    const job = await makeJob();
    await claimWhenDue(() => claimJobForSubmit(job.id)); // submitting, deferrals = 0
    // Simulate 35 prior deferrals: each defer parks the job, each claim
    // picks it back up once the (0ms) window elapses.
    for (let i = 0; i < 35; i++) {
      const r = await deferSubmitJob(job.id, 0, 36);
      expect(r!.failed).toBe(false);
      expect(r!.deferrals).toBe(i + 1);
      const c = await claimWhenDue(() => claimJobForSubmit(job.id));
      expect(c.state).toBe("submitting");
    }
    // The 36th defer is terminal.
    const res = await deferSubmitJob(job.id, 0, 36);
    expect(res!.failed).toBe(true);
    expect(res!.deferrals).toBe(36);

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_busy_timeout");
    expect(failed.nextAttemptAt).toBeNull();
  });

  it("deferSubmitJob on a non-submitting job returns null", async () => {
    const job = await makeJob(); // still queued
    expect(await deferSubmitJob(job.id, 60_000, 36)).toBeNull();
  });
});

describe("history_recorded gate", () => {
  it("only the first flipper wins — exactly once", async () => {
    const job = await makeJob();
    const [a, b] = await Promise.all([markHistoryRecorded(job.id), markHistoryRecorded(job.id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await getLipSyncJob(job.id))!.historyRecorded).toBe(true);
  });
});

describe("requeueSubmitJob", () => {
  it("re-queues when attempts remain", async () => {
    const job = await makeJob();
    await claimJobForSubmit(job.id); // attempts = 1
    const attempts = await requeueSubmitJob(job.id, 3);
    expect(attempts).toBe(1);
    expect((await getLipSyncJob(job.id))!.state).toBe("queued");
  });

  it("fails the job once attempts are exhausted", async () => {
    const job = await makeJob();
    for (let i = 0; i < 3; i++) {
      await claimJobForSubmit(job.id); // attempts = i + 1
      await requeueSubmitJob(job.id, 3);
    }
    // The 3rd claim burned the last attempt → requeue flipped to failed.
    const done = (await getLipSyncJob(job.id))!;
    expect(done.state).toBe("failed");
    expect(done.attempts).toBe(3);
    expect(done.error?.code).toBe("interrupted");
    // Nothing left to requeue once terminal.
    expect(await requeueSubmitJob(job.id, 3)).toBe(0);
  });
});

describe("boot recovery", () => {
  it("re-queues interrupted submits and resumes polling jobs", async () => {
    const s = await makeJob();
    await claimJobForSubmit(s.id); // submitting, attempts = 1

    const p = await makeJob();
    await claimJobForSubmit(p.id);
    await markJobSubmitted(p.id, "prov-123", 60 * 60_000); // polling, next poll 1h out

    await recoverInterruptedLipSyncJobs(3);

    expect((await getLipSyncJob(s.id))!.state).toBe("queued");
    const resumed = (await getLipSyncJob(p.id))!;
    expect(resumed.state).toBe("polling");
    expect(resumed.providerJobId).toBe("prov-123");
    // next_poll_at clamped to now → due immediately
    const due = await getJobsDueForPoll(10);
    expect(due.map((j) => j.id)).toContain(p.id);
  });

  it("fails interrupted submits that already burned their attempts", async () => {
    const job = await makeJob();
    await claimJobForSubmit(job.id); // attempts = 1
    await requeueSubmitJob(job.id, 3); // back to queued
    await claimJobForSubmit(job.id); // attempts = 2
    await requeueSubmitJob(job.id, 3); // back to queued
    await claimJobForSubmit(job.id); // attempts = 3, still submitting (interrupted)
    await recoverInterruptedLipSyncJobs(3);
    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("interrupted");
  });
});

describe("terminal transitions", () => {
  it("complete → done; fail → failed with error payload", async () => {
    const job = await makeJob();
    await claimJobForSubmit(job.id);
    await markJobSubmitted(job.id, "prov-9", 60_000);
    await completeLipSyncJob(job.id, "https://x/out.mp4");
    const done = (await getLipSyncJob(job.id))!;
    expect(done.state).toBe("done");
    expect(done.resultUrl).toBe("https://x/out.mp4");

    const job2 = await makeJob();
    await failLipSyncJob(job2.id, { message: "boom", code: "test" });
    const failed = (await getLipSyncJob(job2.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("test");
  });
});
