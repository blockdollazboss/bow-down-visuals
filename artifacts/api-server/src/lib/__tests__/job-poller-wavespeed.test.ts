/**
 * $0 verification suite for the LatentSync (WaveSpeed) route through the
 * background poller — the default lip-sync route since the owner's
 * 2026-10-24 verdict.
 *
 * Pins:
 *  - a latentsync job submits through WaveSpeed exactly once and lands in
 *    polling with provider/model/input-dimension metadata recorded;
 *  - an out-of-funds provider fails the job CLOSED (provider_balance) —
 *    no deferral loop, no resubmit, exactly one notification;
 *  - a no-response submit fails as submit_outcome_unknown and is NEVER
 *    resubmitted (a blind retry could bill the generation twice);
 *  - an answered 429/5xx defers on the shared backoff, attempts intact;
 *  - completion records resolution metadata (probe-unknown stays null —
 *    stated, not hidden) and mirrors the output like every other route;
 *  - the tick claims only jobs whose own provider is configured: a sync
 *    job with no Sync.so key stays queued and untouched.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testHooks, runPollerTick } from "../job-poller";
import {
  __setLipSyncJobsDb,
  claimQueuedJobs,
  createLipSyncJob,
  getLipSyncJob,
  markJobSubmitted,
  mergeLipSyncJobResultMeta,
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb, listPendingNotifications } from "../job-notifications";
import { createTestDb } from "./test-db";

const { mockWsSubmit, mockWsStatus } = vi.hoisted(() => ({
  mockWsSubmit: vi.fn(),
  mockWsStatus: vi.fn(),
}));

vi.mock("../wavespeed", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../wavespeed")>();
  return {
    ...mod,
    waveSpeedSubmit: (...args: unknown[]) => mockWsSubmit(...args),
    waveSpeedStatus: (...args: unknown[]) => mockWsStatus(...args),
  };
});

vi.mock("../mirrorMedia", () => ({
  mirrorExternalMediaUrl: async () => "https://cdn.example/stored.mp4",
}));

// The real WaveSpeedError class, re-exported through the mocked module.
import { WaveSpeedError } from "../wavespeed";

const PARAMS = {
  clipUrl: "https://x/clip.mp4",
  audioUrl: "https://x/audio.mp3",
  sceneStartSec: 0,
  sceneEndSec: 5,
  provider: "latentsync",
};

const ENV_KEYS = ["WAVESPEED_API_KEY", "LIP_SYNC_API_KEY", "SYNC_LABS_API_KEY", "LIP_SYNC_PROVIDER"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  const { db } = createTestDb();
  __setLipSyncJobsDb(db);
  __setJobNotificationsDb(db);
  mockWsSubmit.mockReset();
  mockWsStatus.mockReset();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __testHooks.__setPrepareSubmitMedia(async () => ({
    segmentUrl: "https://x/seg.mp3",
    providerClipUrl: "https://x/clip.mp4",
    durationSec: 5,
    inputWidth: 672,
    inputHeight: 1344,
  }));
});

afterEach(() => {
  __setLipSyncJobsDb(null);
  __setJobNotificationsDb(null);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function claimedJob(params: Record<string, unknown> = PARAMS): Promise<LipSyncJob> {
  await createLipSyncJob({ userId: randomUUID(), params: params as LipSyncJob["params"] });
  const [job] = await claimQueuedJobs(1);
  return job;
}

describe("runSubmitWorker — WaveSpeed route", () => {
  it("submits once and lands in polling with input metadata recorded", async () => {
    mockWsSubmit.mockResolvedValue("pred-123");
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "ws-key");

    const polling = (await getLipSyncJob(job.id))!;
    expect(polling.state).toBe("polling");
    expect(polling.providerJobId).toBe("pred-123");
    expect(mockWsSubmit).toHaveBeenCalledTimes(1);
    expect(mockWsSubmit).toHaveBeenCalledWith("https://x/clip.mp4", "https://x/seg.mp3", "ws-key");
    expect(polling.resultMeta).toMatchObject({
      provider: "latentsync",
      model: "bytedance/latentsync",
      inputWidth: 672,
      inputHeight: 1344,
    });
    expect(await listPendingNotifications()).toHaveLength(0);
  });

  it("balance failure fails closed: provider_balance, no deferral, one notification", async () => {
    mockWsSubmit.mockRejectedValue(
      new WaveSpeedError("WaveSpeed submit failed: HTTP 402 — Insufficient balance", 402),
    );
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "ws-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_balance");
    expect(failed.submitDeferrals).toBe(0);
    expect(mockWsSubmit).toHaveBeenCalledTimes(1);
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("failed");
  });

  it("a no-response submit is NEVER resubmitted: submit_outcome_unknown, exactly one attempt", async () => {
    mockWsSubmit.mockRejectedValue(
      new WaveSpeedError("WaveSpeed submit outcome unknown (no response): fetch failed", null),
    );
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "ws-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("submit_outcome_unknown");
    expect(mockWsSubmit).toHaveBeenCalledTimes(1);
    expect(await listPendingNotifications()).toHaveLength(1);
  });

  it("an answered 503 defers with backoff: queued, no attempts burned, no failure ping", async () => {
    mockWsSubmit.mockRejectedValue(
      new WaveSpeedError("WaveSpeed submit failed: HTTP 503 — service unavailable", 503),
    );
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "ws-key");

    const parked = (await getLipSyncJob(job.id))!;
    expect(parked.state).toBe("queued");
    expect(parked.submitDeferrals).toBe(1);
    expect(parked.attempts).toBe(0);
    expect(parked.nextAttemptAt).not.toBeNull();
    expect(await listPendingNotifications()).toHaveLength(0);
  });

  it("a 422 fails fast as provider_rejected with one notification", async () => {
    mockWsSubmit.mockRejectedValue(
      new WaveSpeedError("WaveSpeed submit failed: HTTP 422 — invalid input", 422),
    );
    const job = await claimedJob();

    await __testHooks.runSubmitWorker(job, "ws-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_rejected");
    expect(mockWsSubmit).toHaveBeenCalledTimes(1);
    expect(await listPendingNotifications()).toHaveLength(1);
  });
});

describe("pollOneJob — WaveSpeed route", () => {
  async function pollingJob(): Promise<LipSyncJob> {
    const job = await claimedJob();
    await markJobSubmitted(job.id, "pred-9", 1000);
    await mergeLipSyncJobResultMeta(job.id, {
      provider: "latentsync",
      model: "bytedance/latentsync",
      inputWidth: 672,
      inputHeight: 1344,
    });
    return (await getLipSyncJob(job.id))!;
  }

  it("completion mirrors the output and records resolution metadata (unknown probe stays null)", async () => {
    // 127.0.0.1:9 refuses instantly, so the dimension probe answers
    // "unknown" fast instead of hanging the suite on a real network.
    mockWsStatus.mockResolvedValue({ status: "completed", outputUrl: "https://127.0.0.1:9/out.mp4" });
    const job = await pollingJob();

    await __testHooks.pollOneJob(job, "ws-key");

    const done = (await getLipSyncJob(job.id))!;
    expect(done.state).toBe("done");
    expect(done.resultUrl).toBe("https://cdn.example/stored.mp4");
    expect(done.resultMeta).toMatchObject({
      provider: "latentsync",
      inputWidth: 672,
      inputHeight: 1344,
      outputWidth: null,
      resolutionReduced: null, // unknown is recorded as unknown, never hidden
    });
    const pending = await listPendingNotifications();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("completed");
  });

  it("a provider-reported failure is terminal with the WaveSpeed name on it", async () => {
    mockWsStatus.mockResolvedValue({ status: "failed", error: "model exploded" });
    const job = await pollingJob();

    await __testHooks.pollOneJob(job, "ws-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_failed");
    expect(failed.error?.message).toContain("WaveSpeed reported the generation failed");
    expect(mockWsStatus).toHaveBeenCalledTimes(1); // no silent re-polls of a terminal state
  });

  it("a balance error while polling fails closed instead of burning the poll budget", async () => {
    mockWsStatus.mockRejectedValue(
      new WaveSpeedError("WaveSpeed status check failed: HTTP 402 — Insufficient balance", 402),
    );
    const job = await pollingJob();

    await __testHooks.pollOneJob(job, "ws-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(failed.error?.code).toBe("provider_balance");
  });
});

describe("submit phase — per-provider claiming", () => {
  it(
    "the tick submits the latentsync job and leaves the unconfigured sync job queued and untouched",
    async () => {
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      mockWsSubmit.mockResolvedValue("pred-tick");
      const wsJob = await createLipSyncJob({ userId: randomUUID(), params: PARAMS as LipSyncJob["params"] });
      const syncJob = await createLipSyncJob({
        userId: randomUUID(),
        params: { ...PARAMS, provider: "sync" } as LipSyncJob["params"],
      });

      await runPollerTick();

      const wsAfter = (await getLipSyncJob(wsJob.id))!;
      expect(wsAfter.state).toBe("polling");
      expect(wsAfter.providerJobId).toBe("pred-tick");
      const syncAfter = (await getLipSyncJob(syncJob.id))!;
      expect(syncAfter.state).toBe("queued");
      expect(syncAfter.attempts).toBe(0); // never claimed, never burned
    },
    60_000,
  );
});
