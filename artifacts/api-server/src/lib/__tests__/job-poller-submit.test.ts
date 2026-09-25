/**
 * $0 verification suite for the submit worker's failure handling.
 *
 * runSubmitWorker must treat provider rejections by kind:
 *  - transient (429 / plan-concurrency): park the job with a long backoff,
 *    burn no attempts, raise no failure notification;
 *  - permanent (422/auth): fail fast with exactly one notification;
 *  - transport (network): re-queue against the normal attempts budget.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testHooks } from "../job-poller";
import {
  __setLipSyncJobsDb,
  claimQueuedJobs,
  createLipSyncJob,
  deferSubmitJob,
  getLipSyncJob,
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb, listPendingNotifications } from "../job-notifications";
import { claimWhenDue, createTestDb } from "./test-db";

const { mockSubmit } = vi.hoisted(() => ({ mockSubmit: vi.fn() }));

vi.mock("../sync-labs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../sync-labs")>();
  return {
    ...mod,
    syncLabsSubmit: (...args: unknown[]) => mockSubmit(...args),
  };
});

// The real SyncLabsError class, re-exported through the mocked module.
import { SyncLabsError } from "../sync-labs";

const PARAMS = { clipUrl: "https://x/clip.mp4", audioUrl: "https://x/audio.mp3", sceneStartSec: 0, sceneEndSec: 5 };

beforeEach(() => {
  const { db } = createTestDb();
  __setLipSyncJobsDb(db);
  __setJobNotificationsDb(db);
  mockSubmit.mockReset();
  __testHooks.__setPrepareSubmitMedia(async () => ({
    segmentUrl: "https://x/seg.mp3",
    providerClipUrl: "https://x/clip.mp4",
    durationSec: 5,
  }));
});

afterEach(() => {
  __setLipSyncJobsDb(null);
  __setJobNotificationsDb(null);
});

async function claimedJob(): Promise<LipSyncJob> {
  await createLipSyncJob({ userId: randomUUID(), params: PARAMS });
  const [job] = await claimQueuedJobs(1);
  return job;
}

describe("runSubmitWorker failure handling", () => {
  it("transient 429 parks the job with backoff: no attempts burned, no failure ping", async () => {
    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 429 — concurrency limit", 429));
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "test-key");

    const parked = (await getLipSyncJob(job.id))!;
    expect(parked.state).toBe("queued");
    expect(parked.submitDeferrals).toBe(1);
    expect(parked.attempts).toBe(0);
    expect(parked.nextAttemptAt).not.toBeNull();
    expect(parked.nextAttemptAt!).toBeGreaterThan(Date.now() + 4 * 60_000); // ≥5min backoff
    expect(await listPendingNotifications()).toHaveLength(0);
  });

  it("plan-concurrency message without a status is also transient", async () => {
    mockSubmit.mockRejectedValue(new Error("This plan allows 3 concurrent generations"));
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "test-key");

    const parked = (await getLipSyncJob(job.id))!;
    expect(parked.state).toBe("queued");
    expect(parked.submitDeferrals).toBe(1);
  });

  it("permanent 422 fails fast with exactly one notification", async () => {
    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 422 — bad payload", 422));
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "test-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_rejected");
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("failed");
    expect(mockSubmit).toHaveBeenCalledTimes(1); // no pointless retries
  });

  it("transport failure re-queues against the attempts budget", async () => {
    mockSubmit.mockRejectedValue(new Error("fetch failed"));
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "test-key");

    const queued = (await getLipSyncJob(job.id))!;
    expect(queued.state).toBe("queued");
    expect(queued.attempts).toBe(1); // attempt was spent, unlike transient
    expect(queued.submitDeferrals).toBe(0);
    expect(await listPendingNotifications()).toHaveLength(0);
  });

  it("deferring past the cap fails the job with provider_busy_timeout and one ping", async () => {
    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 429 — busy", 429));
    const job = await claimedJob(); // submitting, deferrals = 0
    // Burn 35 deferrals first (each parks, each claim picks back up);
    // the worker's defer is the 36th → terminal.
    for (let i = 0; i < 35; i++) {
      const r = await deferSubmitJob(job.id, 0, 36);
      expect(r!.failed).toBe(false);
      await claimWhenDue(() => claimQueuedJobs(1).then((rows) => rows[0]));
    }
    // Job is submitting with 35 deferrals; the worker's defer is terminal.
    const current = (await getLipSyncJob(job.id))!;
    await __testHooks.runSubmitWorker(current, "test-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_busy_timeout");
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("failed");
  });

  it("a successful submit moves the job to polling with the provider id", async () => {
    mockSubmit.mockResolvedValue("sync-abc");
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "test-key");

    const polling = (await getLipSyncJob(job.id))!;
    expect(polling.state).toBe("polling");
    expect(polling.providerJobId).toBe("sync-abc");
    expect(polling.nextPollAt).not.toBeNull();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(await listPendingNotifications()).toHaveLength(0);
  });
});
