/**
 * $0 verification suite for the lip-sync poller AFTER the sync-3
 * strip (stack1400 — owner deleted that provider account 2026-11-02).
 *
 * Pins (all through the real poller, the WaveSpeed submit/status
 * faked — the removed route has no client left to fake):
 *  - a job with NO stored provider + WaveSpeed key → WaveSpeed submits;
 *  - the same job + ONLY the removed route's old keys → never claimed,
 *    never submitted, no attempt burned (nothing is connected);
 *  - the same job + explicit LIP_SYNC_PROVIDER naming the removed
 *    route → never claimed or submitted, even with the WaveSpeed key
 *    present (explicit removed selection fails closed);
 *  - a QUEUED job STORED with the removed route was never submitted
 *    to the closed account, so it runs on the live route instead;
 *  - a POLLING job STORED with the removed route carries a foreign
 *    provider job id from a closed account: it fails honestly with
 *    provider_route_removed and the live route is never polled with
 *    that id.
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
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb } from "../job-notifications";
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

/** Job params with NO stored provider — the no-choice / legacy shape. */
const NO_PROVIDER_PARAMS = {
  clipUrl: "https://x/clip.mp4",
  audioUrl: "https://x/audio.mp3",
  sceneStartSec: 0,
  sceneEndSec: 5,
};

const ENV_KEYS = [
  "LIP_SYNC_PROVIDER",
  "WAVESPEED_API_KEY",
  "LIP_SYNC_API_KEY",
  "SYNC_LABS_API_KEY",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  const { db } = createTestDb();
  __setLipSyncJobsDb(db);
  __setJobNotificationsDb(db);
  mockWsSubmit.mockReset();
  mockWsStatus.mockReset();
  mockWsSubmit.mockResolvedValue("pred-default");
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

/** Fire-and-forget submit workers settle on microtasks + pg-mem writes;
    wait until the job leaves `queued` (or give up and let the assert
    report the real state). */
async function settle(jobId: string, ms = 3000): Promise<LipSyncJob> {
  const deadline = Date.now() + ms;
  let job = (await getLipSyncJob(jobId))!;
  while (job.state === "queued" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    job = (await getLipSyncJob(jobId))!;
  }
  return job;
}

describe("lip-sync poller after the sync-3 strip", () => {
  it(
    "DEFAULT: a no-choice job with the WaveSpeed key configured submits through WaveSpeed (LatentSync)",
    async () => {
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: NO_PROVIDER_PARAMS as LipSyncJob["params"],
      });

      await runPollerTick();
      const after = await settle(job.id);

      expect(after.state).toBe("polling");
      expect(after.providerJobId).toBe("pred-default");
      expect(mockWsSubmit).toHaveBeenCalledTimes(1);
      expect(mockWsSubmit).toHaveBeenCalledWith(
        "https://x/clip.mp4",
        "https://x/seg.mp3",
        "ws-key",
      );
      expect(after.resultMeta).toMatchObject({
        provider: "latentsync",
        model: "bytedance/latentsync",
      });
    },
    60_000,
  );

  it(
    "REMOVED ROUTE NEVER BY KEY: with ONLY the removed route's old keys, a no-choice job is never claimed or submitted",
    async () => {
      process.env["LIP_SYNC_API_KEY"] = "removed-key";
      process.env["SYNC_LABS_API_KEY"] = "removed-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: NO_PROVIDER_PARAMS as LipSyncJob["params"],
      });

      await runPollerTick();
      await runPollerTick();
      await new Promise((r) => setTimeout(r, 300));

      const after = (await getLipSyncJob(job.id))!;
      expect(after.state).toBe("queued");
      expect(after.attempts).toBe(0); // never claimed, never burned
      expect(after.providerJobId).toBeNull();
      expect(mockWsSubmit).not.toHaveBeenCalled();
    },
    60_000,
  );

  it(
    "REMOVED ROUTE NEVER BY EXPLICIT SELECTION: LIP_SYNC_PROVIDER naming the removed route fails closed",
    async () => {
      process.env["LIP_SYNC_PROVIDER"] = "sync";
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      process.env["LIP_SYNC_API_KEY"] = "removed-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: NO_PROVIDER_PARAMS as LipSyncJob["params"],
      });

      await runPollerTick();
      await new Promise((r) => setTimeout(r, 300));

      const after = (await getLipSyncJob(job.id))!;
      expect(after.state).toBe("queued");
      expect(after.attempts).toBe(0);
      expect(after.providerJobId).toBeNull();
      expect(mockWsSubmit).not.toHaveBeenCalled();
    },
    60_000,
  );

  it(
    "QUEUED legacy job stored with the removed route runs on the live route (it was never submitted to the closed account)",
    async () => {
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: {
          ...NO_PROVIDER_PARAMS,
          provider: "sync",
        } as LipSyncJob["params"],
      });

      await runPollerTick();
      const after = await settle(job.id);

      expect(after.state).toBe("polling");
      expect(after.providerJobId).toBe("pred-default");
      expect(mockWsSubmit).toHaveBeenCalledTimes(1);
      expect(after.resultMeta).toMatchObject({ provider: "latentsync" });
    },
    60_000,
  );

  it(
    "POLLING legacy job stored with the removed route fails honestly (provider_route_removed) and never polls the live route with its foreign id",
    async () => {
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: {
          ...NO_PROVIDER_PARAMS,
          provider: "sync",
        } as LipSyncJob["params"],
      });
      const [claimed] = await claimQueuedJobs(1);
      expect(claimed.id).toBe(job.id);
      await markJobSubmitted(job.id, "foreign-provider-job-1", 0);
      const polling = (await getLipSyncJob(job.id))!;
      expect(polling.state).toBe("polling");

      await __testHooks.pollOneJob(polling, "ws-key");

      const after = (await getLipSyncJob(job.id))!;
      expect(after.state).toBe("failed");
      expect(after.error?.code).toBe("provider_route_removed");
      expect(mockWsStatus).not.toHaveBeenCalled();
    },
    60_000,
  );
});
