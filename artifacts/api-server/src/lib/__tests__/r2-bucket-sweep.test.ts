/**
 * R2 bucket-wide orphan multipart sweep (stack400 C-08 follow-on).
 *
 * The in-process sweep in routes/r2-upload.ts aborts stale sessions the
 * CURRENT process started. Sessions orphaned by a restart, a crash, or
 * another instance are invisible to it — the bucket's own listing
 * (r2ListMultipartUploads) is the only place they exist. This sweep is
 * that listing's consumer, and these tests pin its safety contract
 * against a faked lib/r2-client:
 *  - an untracked upload older than the 24h house horizon is aborted;
 *  - a young upload is never touched;
 *  - an upload the live tracker holds is never aborted by this sweep —
 *    in-window it is actively in flight, past-window the in-process
 *    sweep owns it (it runs on the same init trigger);
 *  - an upload whose age cannot be proven (Initiated missing/garbage)
 *    is never aborted — abort only on proven age;
 *  - malformed listing entries are skipped, never acted on;
 *  - one failed abort never stops the sweep (fail-open per upload);
 *  - a failed listing, or R2 not configured at all, degrades to a
 *    logged no-op — the sweep can never crash its caller;
 *  - runs are throttled: the sweep rides the multipart-init trigger
 *    like the in-process sweep, but lists the bucket at most once per
 *    interval unless forced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* The fns close over the module-scope `h` binding; they only run after
   the hoisted object is assigned, so the self-reference is safe. */
const h = vi.hoisted(() => ({
  configured: true,
  uploads: [] as any[],
  listError: null as Error | null,
  abortFailures: new Set<string>(),
  list: vi.fn(async (): Promise<any[]> => {
    if (h.listError) throw h.listError;
    return h.uploads;
  }),
  abort: vi.fn(async (_key: string, uploadId: string) => {
    if (h.abortFailures.has(uploadId)) throw new Error("abort blew up");
  }),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../r2-client", () => ({
  isR2Configured: () => h.configured,
  r2ListMultipartUploads: h.list,
  r2AbortMultipartUpload: h.abort,
}));

vi.mock("../logger", () => ({ logger: h.log }));

import {
  sweepOrphanedMultipartUploads,
  R2_BUCKET_SWEEP_MAX_AGE_MS,
} from "../r2-bucket-sweep";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function oldOrphan(over: Record<string, unknown> = {}) {
  return {
    key: "user-1/big.mp4",
    uploadId: "up-old",
    initiated: new Date(NOW - 25 * HOUR),
    ...over,
  };
}

beforeEach(() => {
  h.configured = true;
  h.uploads = [];
  h.listError = null;
  h.abortFailures = new Set();
  h.list.mockClear();
  h.abort.mockClear();
  h.log.info.mockClear();
  h.log.warn.mockClear();
  h.log.error.mockClear();
});

describe("sweepOrphanedMultipartUploads", () => {
  it("aborts an untracked upload past the 24h horizon", async () => {
    h.uploads = [oldOrphan()];
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.abort).toHaveBeenCalledWith("user-1/big.mp4", "up-old");
    expect(s).toMatchObject({ ran: true, listed: 1, aborted: 1, abortFailures: 0 });
  });

  it("never touches a young upload", async () => {
    h.uploads = [oldOrphan({ uploadId: "up-young", initiated: new Date(NOW - 1 * HOUR) })];
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(h.abort).not.toHaveBeenCalled();
    expect(s).toMatchObject({ ran: true, aborted: 0, skippedYoung: 1 });
  });

  it("never touches an upload exactly at the horizon", async () => {
    h.uploads = [
      oldOrphan({ uploadId: "up-edge", initiated: new Date(NOW - R2_BUCKET_SWEEP_MAX_AGE_MS) }),
    ];
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(h.abort).not.toHaveBeenCalled();
    expect(s.skippedYoung).toBe(1);
  });

  it("never aborts a tracked in-flight upload, even when the bucket age looks old", async () => {
    h.uploads = [oldOrphan()];
    const s = await sweepOrphanedMultipartUploads({
      now: NOW,
      force: true,
      trackedStartedAt: () => NOW - 5 * 60 * 1000,
    });
    expect(h.abort).not.toHaveBeenCalled();
    expect(s).toMatchObject({ aborted: 0, skippedTracked: 1 });
  });

  it("leaves a tracked stale upload to the in-process sweep that owns it", async () => {
    h.uploads = [oldOrphan()];
    const s = await sweepOrphanedMultipartUploads({
      now: NOW,
      force: true,
      trackedStartedAt: () => NOW - 30 * HOUR,
    });
    expect(h.abort).not.toHaveBeenCalled();
    expect(s).toMatchObject({ aborted: 0, skippedTracked: 1 });
  });

  it("never aborts an upload whose age cannot be proven", async () => {
    h.uploads = [
      oldOrphan({ uploadId: "up-nodate", initiated: null }),
      oldOrphan({ uploadId: "up-baddate", initiated: "not-a-date" }),
    ];
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(h.abort).not.toHaveBeenCalled();
    expect(s).toMatchObject({ aborted: 0, skippedUnknownAge: 2 });
  });

  it("skips malformed listing entries and still sweeps the valid ones", async () => {
    h.uploads = [
      { uploadId: "up-nokey", initiated: new Date(NOW - 30 * HOUR) },
      { key: "user-2/x.mp4", initiated: new Date(NOW - 30 * HOUR) },
      null,
      oldOrphan({ key: "user-3/ok.mp4", uploadId: "up-ok" }),
    ];
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.abort).toHaveBeenCalledWith("user-3/ok.mp4", "up-ok");
    expect(s).toMatchObject({ listed: 4, aborted: 1, skippedMalformed: 3 });
  });

  it("one failed abort never stops the sweep", async () => {
    h.abortFailures = new Set(["up-bad"]);
    h.uploads = [
      oldOrphan({ key: "user-1/a.mp4", uploadId: "up-bad" }),
      oldOrphan({ key: "user-2/b.mp4", uploadId: "up-good" }),
    ];
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(h.abort).toHaveBeenCalledTimes(2);
    expect(s).toMatchObject({ aborted: 1, abortFailures: 1 });
    expect(h.log.error).toHaveBeenCalled();
  });

  it("a failed listing is a logged no-op, never a throw", async () => {
    h.listError = new Error("R2 credentials not configured");
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(s).toMatchObject({ ran: false, reason: "list-failed", aborted: 0 });
    expect(h.abort).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalled();
  });

  it("an unconfigured R2 is a logged no-op and never lists", async () => {
    h.configured = false;
    const s = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(s).toMatchObject({ ran: false, reason: "not-configured" });
    expect(h.list).not.toHaveBeenCalled();
    expect(h.abort).not.toHaveBeenCalled();
  });

  it("logs a structured summary of what it did", async () => {
    h.uploads = [oldOrphan()];
    await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    const summaryCall = h.log.info.mock.calls.find(
      (c: any[]) => c[0]?.event === "r2_bucket_sweep_complete",
    );
    expect(summaryCall).toBeTruthy();
    expect(summaryCall![0]).toMatchObject({ listed: 1, aborted: 1 });
  });

  it("throttles repeat runs inside the interval unless forced", async () => {
    h.uploads = [oldOrphan()];
    const first = await sweepOrphanedMultipartUploads({ now: NOW, force: true });
    expect(first.ran).toBe(true);
    const second = await sweepOrphanedMultipartUploads({ now: NOW + 60 * 1000 });
    expect(second).toMatchObject({ ran: false, reason: "throttled" });
    expect(h.list).toHaveBeenCalledTimes(1);
    const third = await sweepOrphanedMultipartUploads({ now: NOW + 60 * 1000, force: true });
    expect(third.ran).toBe(true);
    expect(h.list).toHaveBeenCalledTimes(2);
  });
});
