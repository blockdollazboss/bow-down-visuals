import { describe, it, expect, vi, afterEach } from "vitest";
import { pollExportJob, exportPollDeadlineMs } from "../export-job-poll";

/**
 * Lane D item A-10 pins: the FE export poller used to give up at a flat
 * 20 minutes while the server's legal worst case is far longer (each
 * phase-1 ffmpeg step is budgeted max(10 min, 10x clip duration) in
 * export-video.ts, plus two 8-minute delivery passes). Long videos
 * finished — and saved — server-side after the client declared timeout.
 */
describe("exportPollDeadlineMs", () => {
  it("floors at 45 minutes when the duration is unknown", () => {
    expect(exportPollDeadlineMs()).toBe(45 * 60 * 1000);
    expect(exportPollDeadlineMs(0)).toBe(45 * 60 * 1000);
    expect(exportPollDeadlineMs(-5)).toBe(45 * 60 * 1000);
    expect(exportPollDeadlineMs(Number.NaN)).toBe(45 * 60 * 1000);
  });

  it("never returns the old 20-minute cap", () => {
    expect(exportPollDeadlineMs(30)).toBeGreaterThan(20 * 60 * 1000);
  });

  it("scales past the server's 10x step budget for long media", () => {
    // 10-minute video: server may legally spend 10x = 100 min on one step.
    expect(exportPollDeadlineMs(600)).toBe(12 * 600 * 1000 + 15 * 60 * 1000);
    expect(exportPollDeadlineMs(600)).toBeGreaterThan(10 * 600 * 1000);
  });
});

describe("pollExportJob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps polling past the old 20-minute cap and resolves when the job lands", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      // Job reports "running" for the first 25 fake minutes — past the old
      // 20-minute deadline — then completes.
      const done = calls > 25;
      return {
        ok: true,
        json: async () =>
          done
            ? { status: "done", result: { url: "https://cdn.example/out.mp4" } }
            : { status: "running", stage: "render", progress: 40 },
      } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-1",
      getAccessToken: async () => null,
      durationSec: 120,
      pollMs: 60 * 1000,
    });
    const assertion = expect(promise).resolves.toEqual({ url: "https://cdn.example/out.mp4" });
    await vi.advanceTimersByTimeAsync(26 * 60 * 1000);
    await assertion;
    expect(calls).toBe(26);
  });

  it("rides out transient poll failures (network blip + 5xx) and still resolves", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      if (calls === 2) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "done", result: { url: "https://cdn.example/out.mp4" } }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-3",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).resolves.toEqual({ url: "https://cdn.example/out.mp4" });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(calls).toBe(3);
  });

  it("surfaces plainly after the consecutive-failure budget is exhausted", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-4",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).rejects.toThrow(/kept failing/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("does not tolerate a non-transient 4xx status check", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-5",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).rejects.toThrow(/HTTP 404/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(calls).toBe(1);
  });

  it("times out with honest copy — no pointer to a nonexistent Exports history", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ status: "running", stage: "render", progress: 10 }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-2",
      getAccessToken: async () => null,
      timeoutMs: 5 * 60 * 1000,
      pollMs: 60 * 1000,
    });
    const assertion = expect(promise).rejects.toThrow(/taking longer than expected/);
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    await assertion;

    const err = await promise.catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain("Exports history");
  });
});
