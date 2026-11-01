/**
 * $0 verification suite for the lip-sync DEFAULT vs the owner's ruling
 * (2026-10-26): LatentSync via WaveSpeed is THE lip-sync model; sync-3
 * is premium-only, never the default.
 *
 * The disease this suite exists to keep dead: provider resolution used
 * to fall back to Sync.so whenever the Sync.so key existed — in
 * getLipSyncProviderName (key detection) and again in the poller's
 * resolveJobProvider (terminal ?? "sync"). One absent/rotated
 * WAVESPEED_API_KEY silently flipped every no-choice job onto the
 * premium route at several times the per-second cost, against a flat
 * 300 VB/clip price.
 *
 * Pins (all through the real poller tick, both provider submits faked):
 *  - a job with NO stored provider + WaveSpeed key → WaveSpeed submits;
 *  - the same job + ONLY the Sync.so key → never claimed, never
 *    submitted, no attempt burned (it waits for an explicit selection);
 *  - the same job + explicit LIP_SYNC_PROVIDER=sync → Sync.so submits
 *    (the premium route stays reachable by explicit selection);
 *  - a job STORED as sync (explicitly selected at creation) runs on
 *    Sync.so even with both keys present — jobs are never rerouted.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testHooks, runPollerTick } from "../job-poller";
import {
  __setLipSyncJobsDb,
  createLipSyncJob,
  getLipSyncJob,
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb } from "../job-notifications";
import { createTestDb } from "./test-db";

const { mockWsSubmit, mockSyncSubmit } = vi.hoisted(() => ({
  mockWsSubmit: vi.fn(),
  mockSyncSubmit: vi.fn(),
}));

vi.mock("../wavespeed", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../wavespeed")>();
  return {
    ...mod,
    waveSpeedSubmit: (...args: unknown[]) => mockWsSubmit(...args),
  };
});

vi.mock("../sync-labs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../sync-labs")>();
  return {
    ...mod,
    syncLabsSubmit: (...args: unknown[]) => mockSyncSubmit(...args),
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
  mockSyncSubmit.mockReset();
  mockWsSubmit.mockResolvedValue("pred-default");
  mockSyncSubmit.mockResolvedValue("sync-job-1");
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

describe("lip-sync default vs the owner's ruling — poller tick", () => {
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
      expect(mockSyncSubmit).not.toHaveBeenCalled();
      expect(after.resultMeta).toMatchObject({
        provider: "latentsync",
        model: "bytedance/latentsync",
      });
    },
    60_000,
  );

  it(
    "PREMIUM NEVER BY FALLBACK: with ONLY the Sync.so key, a no-choice job is never claimed or submitted",
    async () => {
      process.env["LIP_SYNC_API_KEY"] = "sync-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: NO_PROVIDER_PARAMS as LipSyncJob["params"],
      });

      await runPollerTick();
      await runPollerTick();
      // A wrongly-claimed job would flip state within this window —
      // every provider call in this suite resolves instantly.
      await new Promise((r) => setTimeout(r, 300));

      const after = (await getLipSyncJob(job.id))!;
      expect(after.state).toBe("queued");
      expect(after.attempts).toBe(0); // never claimed, never burned
      expect(after.providerJobId).toBeNull();
      expect(mockSyncSubmit).not.toHaveBeenCalled();
      expect(mockWsSubmit).not.toHaveBeenCalled();
    },
    60_000,
  );

  it(
    "PREMIUM BY EXPLICIT SELECTION: LIP_SYNC_PROVIDER=sync routes a no-choice job to Sync.so",
    async () => {
      process.env["LIP_SYNC_PROVIDER"] = "sync";
      process.env["LIP_SYNC_API_KEY"] = "sync-key";
      const job = await createLipSyncJob({
        userId: randomUUID(),
        params: NO_PROVIDER_PARAMS as LipSyncJob["params"],
      });

      await runPollerTick();
      const after = await settle(job.id);

      expect(after.state).toBe("polling");
      expect(after.providerJobId).toBe("sync-job-1");
      expect(mockSyncSubmit).toHaveBeenCalledTimes(1);
      expect(mockSyncSubmit).toHaveBeenCalledWith(
        "https://x/clip.mp4",
        "https://x/seg.mp3",
        "sync-key",
        undefined, // no strength recorded on this job
      );
      expect(mockWsSubmit).not.toHaveBeenCalled();
      expect(after.resultMeta).toMatchObject({
        provider: "sync",
        model: "sync-3",
      });
    },
    60_000,
  );

  it(
    "STORED CHOICE WINS: a job created on the premium route runs on Sync.so even with both keys present",
    async () => {
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      process.env["LIP_SYNC_API_KEY"] = "sync-key";
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
      expect(after.providerJobId).toBe("sync-job-1");
      expect(mockSyncSubmit).toHaveBeenCalledTimes(1);
      expect(mockWsSubmit).not.toHaveBeenCalled();
    },
    60_000,
  );
});
