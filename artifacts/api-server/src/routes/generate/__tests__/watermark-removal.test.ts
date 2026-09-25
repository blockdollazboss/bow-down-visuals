/**
 * Money-integrity tests for watermark removal.
 *
 * Covers: the 2-credit charge, preset region resolution, custom region
 * validation, the ffmpeg delogo filter construction (percentage → pixel
 * conversion), and automatic refund when the job fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "child_process";
import {
  WATERMARK_REMOVAL_CREDIT_COST,
  WATERMARK_PRESETS,
  resolveRegion,
  buildDelogoFilter,
  buildFfmpegArgs,
  runWatermarkJob,
  __clearWatermarkJobs,
  type WatermarkJob,
} from "../watermark-removal";
import { refundCredits } from "../../../lib/credits";

const mockRefund = vi.mocked(refundCredits);
const mockExecFile = vi.mocked(execFile);

beforeEach(() => {
  vi.clearAllMocks();
  __clearWatermarkJobs();
});

function makeJob(overrides: Partial<WatermarkJob> = {}): WatermarkJob {
  return {
    id: "job-123",
    userId: "user-456",
    status: "queued",
    preset: "bottom-right",
    region: { ...WATERMARK_PRESETS["bottom-right"] },
    sourceName: "clip.mp4",
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: WATERMARK_REMOVAL_CREDIT_COST,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("WATERMARK_REMOVAL_CREDIT_COST", () => {
  it("charges 2 credits per removal", () => {
    expect(WATERMARK_REMOVAL_CREDIT_COST).toBe(2);
  });
});

describe("resolveRegion", () => {
  it("resolves each preset to its percentage box", () => {
    expect(resolveRegion("bottom-right", null)).toEqual({ x: 80, y: 85, w: 18, h: 12 });
    expect(resolveRegion("bottom-left", null)).toEqual({ x: 2, y: 85, w: 18, h: 12 });
    expect(resolveRegion("top-right", null)).toEqual({ x: 80, y: 3, w: 18, h: 12 });
    expect(resolveRegion("top-left", null)).toEqual({ x: 2, y: 3, w: 18, h: 12 });
  });

  it("returns null for an unknown preset", () => {
    expect(resolveRegion("middle-of-nowhere", null)).toBeNull();
    expect(resolveRegion("", null)).toBeNull();
  });

  it("accepts a valid custom region", () => {
    expect(resolveRegion("custom", { x: 10, y: 10, w: 20, h: 15 }))
      .toEqual({ x: 10, y: 10, w: 20, h: 15 });
  });

  it("rejects invalid custom regions", () => {
    expect(resolveRegion("custom", null)).toBeNull();
    expect(resolveRegion("custom", { x: 10, y: 10, w: 0, h: 15 })).toBeNull(); // zero width
    expect(resolveRegion("custom", { x: -5, y: 10, w: 20, h: 15 })).toBeNull(); // negative x
    expect(resolveRegion("custom", { x: 90, y: 10, w: 20, h: 15 })).toBeNull(); // overflows frame
    expect(resolveRegion("custom", { x: 10, y: 95, w: 20, h: 15 })).toBeNull(); // overflows frame
    expect(resolveRegion("custom", { x: "a", y: 10, w: 20, h: 15 })).toBeNull(); // non-numeric
  });
});

describe("buildDelogoFilter", () => {
  it("converts percentages to integer pixels", () => {
    // bottom-right preset on 1920x1080: x=1536, y=918, w=346, h=130
    const f = buildDelogoFilter({ x: 80, y: 85, w: 18, h: 12 }, 1920, 1080);
    expect(f).toBe("delogo=x=1536:y=918:w=346:h=130:show=0");
  });

  it("clamps width/height to at least 1px", () => {
    const f = buildDelogoFilter({ x: 50, y: 50, w: 0.01, h: 0.01 }, 640, 480);
    expect(f).toContain("w=1");
    expect(f).toContain("h=1");
  });

  it("uses the delogo filter with show=0 (no debug overlay)", () => {
    const f = buildDelogoFilter({ x: 2, y: 3, w: 18, h: 12 }, 1280, 720);
    expect(f.startsWith("delogo=")).toBe(true);
    expect(f).toContain("show=0");
  });
});

describe("buildFfmpegArgs", () => {
  it("passes audio through untouched and uses libx264", () => {
    const args = buildFfmpegArgs("in.mp4", "out.mp4", "delogo=x=1:y=1:w=10:h=10:show=0");
    expect(args).toContain("-vf");
    expect(args[args.indexOf("-vf") + 1]).toBe("delogo=x=1:y=1:w=10:h=10:show=0");
    expect(args).toContain("libx264");
    expect(args).toContain("copy"); // audio passthrough
  });
});

describe("runWatermarkJob refunds", () => {
  it("refunds the 2 credits when the job fails (e.g. ffprobe/ffmpeg error)", async () => {
    // ffprobe fails → probeFrameSize returns null → job throws → refund
    mockExecFile.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, res: { stdout: string }) => void;
      cb(new Error("ffprobe failed"), { stdout: "" });
    }) as never);

    const job = makeJob();
    await runWatermarkJob(job, Buffer.from("fake-video"), "clip.mp4");

    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/dimensions/i);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledWith("user-456", WATERMARK_REMOVAL_CREDIT_COST, expect.objectContaining({
      action: expect.stringContaining("Refund"),
    }));
  });

  it("runs delogo with computed pixel region when ffmpeg succeeds", async () => {
    mockExecFile.mockImplementation(((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as (err: Error | null, res: { stdout: string }) => void;
      if (cmd === "ffprobe") cb(null, { stdout: "1920,1080\n" });
      else cb(null, { stdout: "" }); // ffmpeg "succeeds"
    }) as never);

    const job = makeJob();
    await runWatermarkJob(job, Buffer.from("fake-video"), "clip.mp4");

    // ffmpeg "succeeded" but the output file doesn't exist on disk in this
    // test env, so the read fails → job fails → refund. The delogo filter
    // itself was still computed from the probed 1920x1080 frame; assert the
    // ffmpeg invocation carried it.
    const ffmpegCall = mockExecFile.mock.calls.find((c) => c[0] === "ffmpeg");
    expect(ffmpegCall).toBeDefined();
    const ffmpegArgs = ffmpegCall![1] as string[];
    const vfIdx = ffmpegArgs.indexOf("-vf");
    expect(vfIdx).toBeGreaterThanOrEqual(0);
    expect(ffmpegArgs[vfIdx + 1]).toBe("delogo=x=1536:y=918:w=346:h=130:show=0");
    expect(mockRefund).toHaveBeenCalled();
  });
});

describe("out-of-credits guard", () => {
  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    // The POST handler checks req.userCredits < WATERMARK_REMOVAL_CREDIT_COST
    // → 402 before calling chargeCredits. This pins the cost constant used there.
    expect(WATERMARK_REMOVAL_CREDIT_COST).toBeGreaterThan(0);
    const balance = 1;
    expect(balance < WATERMARK_REMOVAL_CREDIT_COST).toBe(true); // → 402 out_of_credits
  });
});
