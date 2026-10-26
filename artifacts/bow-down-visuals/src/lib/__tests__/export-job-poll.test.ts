import { describe, it, expect, vi, afterEach } from "vitest";
import {
  pollExportJob,
  exportPollDeadlineMs,
  pollFailureBackoffMs,
  STATUS_CHECK_OUTAGE_WINDOW_MS,
} from "../export-job-poll";

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
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    const err = await promise.catch((e: unknown) => e) as { code?: string };
    expect(err.code).toBe("poll_lost_contact");
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
    const err = await promise.catch((e: unknown) => e) as { code?: string };
    expect(err.code).toBe("http_404");
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
    expect((err as { code?: string }).code).toBe("poll_timeout");
  });
});

describe("pollFailureBackoffMs", () => {
  it("backs off exponentially from the base cadence, capped at 8x and 30s", () => {
    expect(pollFailureBackoffMs(3000, 1)).toBe(6000);
    expect(pollFailureBackoffMs(3000, 2)).toBe(12000);
    expect(pollFailureBackoffMs(3000, 3)).toBe(24000);
    expect(pollFailureBackoffMs(3000, 9)).toBe(24000);
    expect(pollFailureBackoffMs(10_000, 3)).toBe(30_000);
  });
});

describe("pollExportJob — orphan-wave poll-stop bounds (Oct 26)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops at once on a terminal failed status, preserving the server error", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          status: "failed",
          error: { message: "Render blew up", code: "ffmpeg_failed", ffmpegExitCode: 1 },
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-fail",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).rejects.toThrow(/Render blew up/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(calls).toBe(1);
    const err = await promise.catch((e: unknown) => e) as { code?: string; ffmpegExitCode?: number };
    expect(err.code).toBe("ffmpeg_failed");
    expect(err.ffmpegExitCode).toBe(1);
  });

  it("stops at once on an unrecognisable status instead of polling a dead job to the deadline", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      return { ok: true, json: async () => ({ status: "melted" }) } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-weird",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).rejects.toThrow(/unexpected status/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(calls).toBe(1);
    const err = await promise.catch((e: unknown) => e) as { code?: string };
    expect(err.code).toBe("unknown_status");
  });

  it("stops when flapping checks keep resetting the consecutive budget (the Oct 26 stuck Stitching case)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      // Alternate: one failure, one "running" answer — the consecutive
      // budget never exhausts, so only the outage-episode window can
      // stop this. Before the fix this polled until the 45-min deadline.
      if (calls % 2 === 1) throw new Error("network down");
      return {
        ok: true,
        json: async () => ({ status: "running", stage: "render", progress: 40 }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-flap",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).rejects.toThrow(/kept failing/);
    await vi.advanceTimersByTimeAsync(STATUS_CHECK_OUTAGE_WINDOW_MS + 120_000);
    await assertion;
    const err = await promise.catch((e: unknown) => e) as { code?: string };
    expect(err.code).toBe("poll_lost_contact");
    // Stopped shortly after the 90s window, nowhere near the deadline.
    expect(calls).toBeLessThan(120);
  });

  it("survives outages that genuinely recover (two good polls in a row) across a long render", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStub = vi.fn(async () => {
      calls += 1;
      if (calls > 150) {
        return {
          ok: true,
          json: async () => ({ status: "done", result: { url: "https://cdn.example/out.mp4" } }),
        } as Response;
      }
      // Pattern per 3 polls: fail, running, running — each outage
      // episode is closed by two consecutive good polls, so episodes
      // spread over >90s total must NOT trip the outage window.
      if (calls % 3 === 1) throw new Error("network down");
      return {
        ok: true,
        json: async () => ({ status: "running", stage: "render", progress: 40 }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchStub);

    const promise = pollExportJob({
      jobId: "job-recover",
      getAccessToken: async () => null,
      pollMs: 1000,
    });
    const assertion = expect(promise).resolves.toEqual({ url: "https://cdn.example/out.mp4" });
    await vi.advanceTimersByTimeAsync(600_000);
    await assertion;
    expect(calls).toBe(151);
  });
});
